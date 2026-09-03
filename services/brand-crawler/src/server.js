import http from 'node:http';
import { launch } from 'puppeteer-core';
import { assertPublicUrl, sameOriginLink } from './security.js';

const PORT = Number(process.env.PORT || 8080);
const SECRET = process.env.BRAND_CRAWLER_SECRET || '';
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
const MAX_BODY = 20_000;

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true });
  if (req.method !== 'POST' || req.url !== '/analyze') return send(res, 404, { error: 'not_found' });
  if (!SECRET || req.headers.authorization !== `Bearer ${SECRET}`) return send(res, 401, { error: 'unauthorized' });
  try {
    const body = await readJson(req);
    const url = await assertPublicUrl(body.url);
    const allowed = await robotsAllows(url);
    if (!allowed) return send(res, 451, { error: 'robots_disallowed', manual_entry_required: true });
    const result = await crawl(url, Math.min(Math.max(Number(body.max_pages) || 6, 1), 10), Boolean(body.include_content));
    return send(res, 200, result);
  } catch (error) {
    return send(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

async function crawl(startUrl, maxPages, includeContent) {
  const browser = await launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const visited = new Set();
  const queue = [startUrl.toString()];
  const colors = new Map();
  const pageContent = [];
  const locations = [];
  const warnings = [];
  let parentBrand = null;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    await page.setUserAgent('PrimeOSBrandReader/1.0 (+https://app.primeos.co.il; respects robots.txt)');
    await page.setRequestInterception(true);
    page.on('request', async (request) => {
      try {
        const target = await assertPublicUrl(request.url());
        if (!['document', 'stylesheet', 'script', 'xhr', 'fetch', 'image', 'font'].includes(request.resourceType())) return request.abort();
        if (request.isNavigationRequest() && target.origin !== startUrl.origin) return request.abort();
        request.continue();
      } catch { request.abort(); }
    });

    while (queue.length && visited.size < maxPages) {
      const next = queue.shift();
      if (!next || visited.has(next)) continue;
      visited.add(next);
      try {
        if (!(await robotsAllows(new URL(next)))) { warnings.push(`${next}: robots_disallowed`); continue; }
        await page.goto(next, { waitUntil: 'networkidle2', timeout: 45_000 });
        const data = await page.evaluate((keepContent) => {
          const visible = (el) => {
            const style = getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
          };
          const normalizeColor = (value) => {
            const match = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
            if (!match) return null;
            return `#${match.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
          };
          const colorRows = [];
          for (const el of [...document.querySelectorAll('header,nav,main,section,article,button,a,h1,h2,h3')].slice(0, 1500)) {
            if (!visible(el)) continue;
            const style = getComputedStyle(el);
            for (const value of [style.color, style.backgroundColor, style.borderColor]) {
              const hex = normalizeColor(value);
              if (hex && !['#FFFFFF', '#000000'].includes(hex)) colorRows.push([hex, Math.max(1, Math.round(el.getBoundingClientRect().width * el.getBoundingClientRect().height))]);
            }
          }
          const rawBlocks = keepContent ? [...document.querySelectorAll('main p, main li, article p, article li, [role=main] p, [role=main] li')]
            .filter(visible).map((el) => el.textContent?.replace(/\s+/g, ' ').trim()).filter((text) => text && text.length >= 40 && text.length <= 1800).slice(0, 80) : [];
          const bodyText = document.body.innerText.replace(/\s+/g, ' ');
          const phonePattern = /(?:\+972[-\s]?|0)(?:[23489]|5\d|7[2-9])[-\s]?\d{3}[-\s]?\d{4}/g;
          const addressNodes = [...document.querySelectorAll('address,[class*=address],[class*=contact],footer')].filter(visible).map((el) => el.textContent?.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 30);
          const links = [...document.querySelectorAll('a[href]')].map((a) => ({ href: a.href, text: a.textContent?.trim() || '' }));
          return { title: document.title, lang: document.documentElement.lang, colorRows, rawBlocks, phones: [...new Set(bodyText.match(phonePattern) || [])], addressNodes, links, ogSiteName: document.querySelector('meta[property="og:site_name"]')?.content || null };
        }, includeContent);
        for (const [hex, weight] of data.colorRows) colors.set(hex, (colors.get(hex) || 0) + weight);
        const uniqueBlocks = [...new Set(data.rawBlocks)];
        if (uniqueBlocks.length) pageContent.push({ title: data.title || 'תוכן מהאתר הרשמי', blocks: uniqueBlocks, source_url: page.url() });
        const bestAddress = data.addressNodes.sort((a, b) => b.length - a.length)[0];
        for (const phone of data.phones.slice(0, 8)) locations.push({ address: bestAddress?.slice(0, 500) || null, phone, source_url: page.url() });
        if (data.ogSiteName && !parentBrand && visited.size > 1) parentBrand = { name: data.ogSiteName, source_url: page.url() };
        const rankedLinks = data.links
          .filter((link) => /אודות|צור קשר|סניפים|שירותים|about|contact|branches|services/i.test(`${link.text} ${link.href}`))
          .map((link) => sameOriginLink(startUrl, link.href)).filter(Boolean);
        for (const link of rankedLinks) if (!visited.has(link) && !queue.includes(link)) queue.push(link);
      } catch (error) { warnings.push(`${next}: ${error instanceof Error ? error.message.slice(0, 120) : 'failed'}`); }
    }
  } finally { await browser.close(); }
  const sortedColors = [...colors.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex).slice(0, 8);
  const blockCounts = new Map();
  for (const page of pageContent) for (const block of new Set(page.blocks)) blockCounts.set(block, (blockCounts.get(block) || 0) + 1);
  const repeatedThreshold = Math.max(2, Math.ceil(pageContent.length * 0.5));
  const content = pageContent.map((page) => ({
    title: page.title,
    content: page.blocks.filter((block) => (blockCounts.get(block) || 0) < repeatedThreshold).join('\n\n').slice(0, 6000),
    source_url: page.source_url,
  })).filter((page) => page.content.length >= 40);
  return { ok: true, website: startUrl.toString(), pages_scanned: visited.size, colors: sortedColors, content, locations: dedupeLocations(locations), parent_brand: parentBrand, warnings };
}

async function robotsAllows(url) {
  try {
    const response = await fetch(new URL('/robots.txt', url), { signal: AbortSignal.timeout(8000) });
    if (response.status === 404) return true;
    if (!response.ok) return false;
    const text = await response.text();
    let applies = false;
    const rules = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.split('#')[0].trim();
      const [key, ...parts] = line.split(':');
      const value = parts.join(':').trim();
      if (key?.toLowerCase() === 'user-agent') applies = value === '*' || /PrimeOSBrandReader/i.test(value);
      if (applies && key?.toLowerCase() === 'disallow' && value) rules.push({ allow: false, path: value });
      if (applies && key?.toLowerCase() === 'allow' && value) rules.push({ allow: true, path: value });
    }
    const path = `${url.pathname}${url.search}`;
    const match = rules.filter((rule) => path.startsWith(rule.path.replace(/\*.*$/, ''))).sort((a, b) => b.path.length - a.path.length)[0];
    return match ? match.allow : true;
  } catch { return false; }
}
function dedupeLocations(rows) { const seen = new Set(); return rows.filter((row) => { const key = `${row.address}|${row.phone}`; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 20); }
async function readJson(req) { let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > MAX_BODY) throw new Error('body_too_large'); } return JSON.parse(raw || '{}'); }
function send(res, status, body) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); }
server.listen(PORT, '0.0.0.0');
