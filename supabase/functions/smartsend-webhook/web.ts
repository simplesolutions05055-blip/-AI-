// Server production for the app's wizards: a graphic, a document or a presentation made from the brief
// after "צור", without the browser. The browser creates the content item first (status "בהפקה"), the job
// carries its id, and the finished files are written into that item. The person can close the window
// and find the item ready in the library; if the window stays open the wizard shows the same result.
import { APP, DB, FN, brandOf, httpLater, kitOf, saveItem } from './common.ts';

type Job = Record<string, any>;
// deno-lint-ignore no-explicit-any
type Res = Record<string, any>;
export interface Flow {
  ids: number[];
  res: Res;
  ok: (r: any) => boolean;
  retry: (why: string) => Promise<void>;
  go: (step: string, row?: Record<string, unknown>) => Promise<unknown>;
  upd: (row: Record<string, unknown>) => Promise<unknown>;
  fail: (why: string) => Promise<void>;
  later: (s: number) => string;
}
export const WEB_KINDS = ['graphic', 'doc', 'deck'];
export const FIRST_STEP: Record<string, string> = { graphic: 'texts', doc: 'texts', deck: 'texts' };
const FMT_K: Record<string, string> = { '1:1': '1x1', '4:5': '4x5', '9:16': '9x16', '16:9': '16x9', '1.91:1': '1.91x1' };
const AR: Record<string, string> = { '1:1': '1/1', '4:5': '4/5', '9:16': '9/16', '16:9': '16/9', '1.91:1': '1.91/1' };
const sizeOf = (f: string) => (f === '4:5' || f === '9:16' ? 'portrait' : f === '16:9' || f === '1.91:1' ? 'landscape' : 'square');
const FAST_IMG = 'gpt-image-2.5-flare';
// the document body as the library shows it (same flattening as the app)
const flatDoc = (d: any) => [d.summary, ...((d.sections || []) as any[]).flatMap((x) => [x.h + ':', ...(x.paras || []), ...((x.bullets || []) as string[]).map((b) => '• ' + b)]), d.note].filter(Boolean);

// the organisation name of a job (the brief context travels with the job as the app sends it)
const ctxOf = (inp: Job) => ({ org: inp.ctx?.org || '', dept: inp.dept || inp.ctx?.dept || '', tone: inp.ctx?.tone || '', good: inp.ctx?.good || [], bad: inp.ctx?.bad || [], facts: inp.ctx?.facts || '' });
async function brandBody(d: DB, j: Job) {
  const b = await brandOf(d, j.org_id);
  return { brand: { org: j.input?.ctx?.org || '', dept: j.input?.dept || '', colors: b.colors, roles: b.roles }, b };
}
// what the item carries so the wizard can continue from it (edits, fixes) exactly as if the browser had produced it
const keepUi = (inp: Job) => ({ ...(inp.ui || {}), prod: null });
// the quota reference of the item: the first production took the quota at job start, later renders of the same item are free
const refOf = (j: Job) => 'wiz:' + (j.ui_id ?? j.id);

export async function advanceWeb(d: DB, j: Job, token: string, f: Flow) {
  const { ids, res, ok } = f;
  const data = j.data ?? {};
  const inp = j.input ?? {};
  const ctx = ctxOf(inp);

  /* ---------------- graphic: texts -> design -> fix -> fit -> done ---------------- */
  if (j.kind === 'graphic') {
    const fmt = String(inp.fmt || '1:1');
    const tpl = inp.tpl && inp.tpl.url ? inp.tpl : null;
    const size = tpl ? sizeOf(String(tpl.r || fmt)) : sizeOf(fmt);
    if (j.step === 'texts') {
      if (!ids.length) { const id = await httpLater(d, FN('generate'), token, { mode: 'graphic', ...ctx, title: inp.title || '', brief: inp.brief || '', files: inp.files || [] }, 120000); return f.upd({ pend: { t: id }, next_at: f.later(4) }); }
      if (!ok(res.t)) return f.retry('texts');
      const x = res.t.json;
      data.texts = { kicker: x.kicker || '', headline: x.headline || inp.title || '', sub: x.sub || '', details: x.details || [], cta: x.cta || '', icons: Array.isArray(x.icons) ? x.icons.filter((i: any) => i && i.label).slice(0, 4) : [], keyword: x.keyword || '' };
      data.caption = x.caption || ''; data.tags = (x.tags || []).slice(0, 6); data.style = x.style || 'official'; data.palette = x.palette || ''; data.styleWhy = x.styleWhy || '';
      return f.go('design');
    }
    if (j.step === 'design') {
      if (!ids.length) {
        const b = await brandOf(d, j.org_id);
        data.logo = b.logo;
        const kit = !tpl && b.logo ? await kitOf(d, j.org_id, token, b, ctx.org) : null;
        const photos: string[] = Array.isArray(inp.photos) ? inp.photos.slice(0, 4) : [];
        const id = await httpLater(d, FN('image'), token, {
          action: 'design', org: ctx.org, dept: ctx.dept, size, brief: (inp.title || '') + '\n' + (inp.brief || ''),
          colors: b.colors, roles: b.roles, style: data.style || 'official', palette: data.palette || '', kit: kit || undefined, texts: data.texts,
          refs: [...(b.logo && !tpl ? [b.logo] : []), ...photos].slice(0, tpl ? 3 : 4), logo: !!b.logo && !tpl, note: '', quality: 'high', n: 2,
          font: b.font || undefined, template: tpl ? { url: tpl.url, desc: tpl.desc || '', slots: tpl.slots || [] } : undefined,
        }, 170000);
        await f.upd({ data, lock_until: f.later(120) }); return f.upd({ pend: { g: id }, next_at: f.later(15) });
      }
      if (!ok(res.g)) return f.retry('design');
      const g = res.g.json;
      data.src = g.url; data.check = g.check || { ok: true }; data.want = g.want || []; data.model = g.model || ''; data.qa = g.qa || null; data.style = g.style || data.style; data.edited = !!g.edited;
      data.best = { url: data.src, n: data.check && !data.check.ok ? (data.check.issues || []).length || 1 : 0 };
      return f.go(data.check && !data.check.ok && (data.check.issues || []).length ? 'fix' : 'fit');
    }
    if (j.step === 'fix') {
      // one round, like the app: the version with the fewest text errors is kept
      if (!ids.length) { const id = await httpLater(d, FN('image'), token, { action: 'fixtext', url: data.src, issues: data.check.issues, fixes: data.check.fixes || [], want: data.want, size }, 170000); return f.upd({ pend: { f: id }, next_at: f.later(8) }); }
      if (ok(res.f) && res.f.json.url) {
        const c = res.f.json.check || { ok: true };
        const n = c && !c.ok ? (c.issues || []).length || 1 : 0;
        if (n < (data.best?.n ?? 99)) { data.src = res.f.json.url; data.check = c; data.best = { url: data.src, n }; }
      }
      return f.go('fit');
    }
    if (j.step === 'fit') {
      // the design is square; any other platform size is placed into its format without cropping
      if (size === 'square' && fmt === '1:1') { data.url = data.src; return f.go('done'); }
      if (!ids.length) {
        const { brand } = await brandBody(d, j);
        const id = await httpLater(d, FN('produce'), token, { brand, jobs: [{ id: 'g', kind: 'graphic', layout: 'fit', format: FMT_K[fmt] || '1x1', data: { image: data.src }, thumb: false, ref: refOf(j) }] }, 170000);
        return f.upd({ pend: { p: id }, next_at: f.later(6) });
      }
      const r = res.p;
      if (r && r.json && r.json.error === 'quota') return f.fail('quota:' + JSON.stringify({ kind: r.json.kind, used: r.json.used, limit: r.json.limit, reset: r.json.reset }));
      const x = ok(r) ? (r.json.results || [])[0] : null;
      data.url = x && x.ok && x.urls ? x.urls.main : data.src;
      return f.go('done');
    }
    if (j.step === 'done') {
      const t = data.texts || {};
      const warn = data.check && !data.check.ok && (data.check.issues || []).length ? data.check.issues : null;
      const ui = {
        ...keepUi(inp), t: t.headline || inp.title || 'גרפיקה', body: data.caption || '', tags: data.tags || [],
        media: {
          kind: 'graphic', url: data.url, src: data.src, layout: tpl ? String(inp.layout || 'ai') : 'ai', fmt, ar: AR[fmt] || '1/1', image: '', ready: true,
          design: { kicker: t.kicker, sub: t.sub, details: t.details, cta: t.cta, keyword: t.keyword, icons: t.icons, style: data.style, palette: data.palette, styleWhy: data.styleWhy },
          style: data.style, qa: data.qa, model: data.model, warn, want: data.want || [], fixes: (data.check && data.check.fixes) || [], dsize: size, dlay: tpl ? String(inp.layout || 'ai') : 'ai',
        },
        wiz: { kind: 'graphic', at: new Date().toISOString() },
      };
      await saveItem(token, ui);
      return f.upd({ state: 'done', step: 'done', result: { url: data.url, ui_id: j.ui_id }, pend: {}, data });
    }
  }

  /* ---------------- document: texts (+ a photo for the designed style) -> render -> done ---------------- */
  if (j.kind === 'doc') {
    if (j.step === 'texts') {
      if (!ids.length) {
        const p: Record<string, number> = {};
        p.t = await httpLater(d, FN('generate'), token, { mode: 'doc2', ...ctx, style: inp.style, styleLabel: inp.styleLabel || '', title: inp.title || '', files: inp.files || [], brief: inp.brief || '' }, 170000);
        if (inp.style === 'designed') {
          const { b } = await brandBody(d, j);
          p.i = await httpLater(d, FN('image'), token, { brief: inp.prompt || inp.title || '', title: inp.title || '', dept: ctx.dept, people: 'auto', style: 'photo', size: 'landscape', quality: 'high', colors: b.colors }, 170000);
        }
        return f.upd({ pend: p, next_at: f.later(10) });
      }
      if (!ok(res.t)) return f.retry('texts');
      data.doc = res.t.json;
      if (res.i && ok(res.i) && res.i.json.url) data.image = res.i.json.url;
      return f.go('render');
    }
    if (j.step === 'render') {
      if (!ids.length) {
        const { brand } = await brandBody(d, j);
        const id = await httpLater(d, FN('produce'), token, { brand, jobs: [{ id: 'd', kind: 'doc', style: inp.style, data: data.doc, imageUrl: inp.style === 'designed' ? data.image : undefined, thumb: false, ref: refOf(j) }] }, 170000);
        return f.upd({ pend: { p: id }, next_at: f.later(8) });
      }
      const r = res.p;
      if (r && r.json && r.json.error === 'quota') return f.fail('quota:' + JSON.stringify({ kind: r.json.kind, used: r.json.used, limit: r.json.limit, reset: r.json.reset }));
      const x = ok(r) ? (r.json.results || [])[0] : null;
      if (!x || !x.ok || !x.urls) return f.retry('render');
      data.urls = x.urls;
      return f.go('done');
    }
    if (j.step === 'done') {
      const doc = data.doc || {};
      const title = doc.title || inp.title || 'מסמך';
      const ui = {
        ...keepUi(inp), t: title, body: flatDoc(doc).join('\n'), doc, ai: { title, paras: flatDoc(doc) },
        media: { kind: 'doc', url: data.urls.main, docx: data.urls.docx, thumb: data.urls.p1, ar: '210/297', style: inp.style, qa: doc.qa || null, image: data.image || '', ready: true },
        wiz: { kind: 'doc', at: new Date().toISOString() },
      };
      await saveItem(token, ui);
      return f.upd({ state: 'done', step: 'done', result: { url: data.urls.main, ui_id: j.ui_id }, pend: {}, data });
    }
  }

  /* ---------------- presentation: texts -> a picture per slide (the person's photos first) -> render -> done ---------------- */
  if (j.kind === 'deck') {
    const photos: string[] = Array.isArray(inp.photos) ? inp.photos.filter((u: unknown) => /^https:\/\//.test(String(u))).slice(0, 30) : [];
    if (j.step === 'texts') {
      if (!ids.length) { const id = await httpLater(d, FN('generate'), token, { mode: 'deck2', ...ctx, style: inp.style, title: inp.title || '', pages: inp.pages || 8, keep: !!inp.keep, files: inp.files || [], brief: inp.brief || '' }, 170000); return f.upd({ pend: { t: id }, next_at: f.later(12) }); }
      if (!ok(res.t)) return f.retry('texts');
      data.deck = res.t.json;
      return f.go('images');
    }
    if (j.step === 'images') {
      const deck = data.deck || {};
      const sl: any[] = deck.slides || [];
      const full = (s: any, i: number) => i === 0 || s.kind === 'end' || s.kind === 'quote' || s.kind === 'cover';
      // the person's own photos take the slides first: the cover, then every content slide in order; AI fills the rest
      const picks: Record<string, string> = {};
      const given: Record<string, string> = inp.picks && typeof inp.picks === 'object' ? inp.picks : {};
      Object.keys(given).forEach((k) => { if (/^https:\/\//.test(String(given[k]))) picks[k] = String(given[k]); });
      if (photos.length && !Object.keys(picks).length) {
        let at = 0;
        if (sl.length) picks['0'] = photos[at++];
        sl.forEach((s, i) => { if (i > 0 && at < photos.length && !full(s, i)) picks[String(i)] = photos[at++]; });
      }
      data.picks = picks;
      if (!ids.length) {
        const p: Record<string, number> = {};
        const { b } = await brandBody(d, j);
        for (let i = 0; i < Math.min(sl.length, 20); i++) {
          const s = sl[i];
          if (picks[String(i)]) continue;
          const body = full(s, i)
            ? { title: inp.title || '', brief: (i === 0 ? 'תמונת שער רחבה ואווירתית למצגת: ' + (deck.title || inp.title) : s.kind === 'end' ? 'תמונת סיום חמה ואופטימית למצגת: ' + (deck.title || inp.title) : 'תמונה שמלווה את השקף "' + (s.t || '') + '": ' + (s.pts || []).slice(0, 3).join('. ')) + '\n' + (inp.prompt || ''), dept: ctx.dept, size: 'landscape', quality: 'medium', model: FAST_IMG, people: 'auto', style: 'photo', colors: b.colors, cutout: false }
            : { title: inp.title || '', brief: 'דמות או אובייקט שממחישים את השקף "' + (s.t || '') + '": ' + (s.pts || []).slice(0, 3).join('. '), dept: ctx.dept, size: 'portrait', quality: 'medium', model: FAST_IMG, people: 'auto', style: 'photo', colors: b.colors, cutout: true };
          p['i' + i] = await httpLater(d, FN('image'), token, body, 170000);
        }
        if (!Object.keys(p).length) return f.go('render');
        await f.upd({ data, lock_until: f.later(120) }); return f.upd({ pend: p, next_at: f.later(15) });
      }
      const images: Record<string, string> = {};
      sl.forEach((_s, i) => {
        const u = picks[String(i)] || (ok(res['i' + i]) && res['i' + i].json.url) || '';
        if (u) images['s' + i] = u;
      });
      if (images.s0) images.cover = images.s0;
      data.images = images;
      return f.go('render');
    }
    if (j.step === 'render') {
      if (!data.images) { const images: Record<string, string> = {}; Object.keys(data.picks || {}).forEach((k) => { images['s' + k] = data.picks[k]; }); if (images.s0) images.cover = images.s0; data.images = images; }
      if (!ids.length) {
        const { brand } = await brandBody(d, j);
        const id = await httpLater(d, FN('produce'), token, { brand, jobs: [{ id: 'k', kind: 'deck', style: inp.style, data: data.deck, images: data.images || {}, photos, thumb: false, ref: refOf(j) }] }, 170000);
        return f.upd({ data, pend: { p: id }, next_at: f.later(10) });
      }
      const r = res.p;
      if (r && r.json && r.json.error === 'quota') return f.fail('quota:' + JSON.stringify({ kind: r.json.kind, used: r.json.used, limit: r.json.limit, reset: r.json.reset }));
      const x = ok(r) ? (r.json.results || [])[0] : null;
      if (!x || !x.ok || !x.urls) return f.retry('render');
      data.urls = x.urls; data.nslides = x.slides || (data.deck.slides || []).length;
      return f.go('done');
    }
    if (j.step === 'done') {
      const deck = data.deck || {};
      const sl: any[] = deck.slides || [];
      const title = deck.title || inp.title || 'מצגת';
      const slides = Array.from({ length: data.nslides || sl.length }, (_, i) => data.urls['s' + (i + 1)]).filter(Boolean);
      const ui = {
        ...keepUi(inp), t: title, body: sl.map((s, i) => (i === 0 ? title : s.t) + ((s.pts || []).length ? ': ' + s.pts.join(' · ') : '')).join('\n'), deck, slides: sl.map((s) => ({ t: s.t, pts: s.pts || [] })),
        media: { kind: 'deck', url: data.urls.main, pptx: data.urls.pptx, slides, thumb: slides[0] || '', ar: '16/9', style: inp.style, qa: deck.qa || null, images: data.images || {}, picks: data.picks || {}, photos, ready: true },
        wiz: { kind: 'deck', at: new Date().toISOString() },
      };
      await saveItem(token, ui);
      return f.upd({ state: 'done', step: 'done', result: { url: data.urls.main, ui_id: j.ui_id }, pend: {}, data });
    }
  }
  await f.upd({ next_at: f.later(30) });
}

// where a web job stands, for the wizard's progress line
export function webProgress(j: Job) {
  const s = j.step;
  if (j.kind === 'graphic') return s === 'texts' ? 0.1 : s === 'design' ? 0.35 : s === 'fix' ? 0.75 : s === 'fit' ? 0.9 : 0.99;
  if (j.kind === 'doc') return s === 'texts' ? 0.15 : s === 'render' ? 0.7 : 0.99;
  if (j.kind === 'deck') return s === 'texts' ? 0.1 : s === 'images' ? 0.4 : s === 'render' ? 0.8 : 0.99;
  return 0.05;
}
export const APP_URL = APP;
