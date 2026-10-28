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
export const WEB_KINDS = ['graphic', 'doc', 'deck', 'vscan'];
export const FIRST_STEP: Record<string, string> = { graphic: 'texts', doc: 'texts', deck: 'texts', vscan: 'prep' };
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

// One carousel post: the texts of all slides in one call, then each slide in its own design call. Slide 1 is designed
// freely; every later slide gets slide 1 as its series reference and the same composition, so the post reads as one set.
// The person's photos are spread over the slides (one each, in order). A slide with Hebrew errors gets one fix round.
async function advanceCarousel(d: DB, j: Job, token: string, f: Flow, data: Res, inp: Job, ctx: ReturnType<typeof ctxOf>) {
  const { ids, res, ok } = f;
  const n = Math.min(6, Math.max(2, Math.round(+inp.carousel)));
  const fmt = String(inp.fmt || '1:1');
  const size = sizeOf(fmt);
  const photos: string[] = Array.isArray(inp.photos) ? inp.photos.slice(0, 6) : [];
  if (j.step === 'texts') {
    if (!ids.length) { const id = await httpLater(d, FN('generate'), token, { mode: 'carousel', slides: n, ...ctx, title: inp.title || '', brief: inp.brief || '', files: inp.files || [] }, 120000); return f.upd({ pend: { t: id }, next_at: f.later(4) }); }
    if (!ok(res.t)) return f.retry('texts');
    const x = res.t.json;
    const sl = (Array.isArray(x.slides) ? x.slides : []).slice(0, n).map((y: any) => ({ kicker: y.kicker || '', headline: y.headline || '', sub: y.sub || '', details: y.details || [], cta: y.cta || '', icons: Array.isArray(y.icons) ? y.icons.filter((i: any) => i && i.label).slice(0, 4) : [], keyword: y.keyword || '' }));
    if (sl.length < 2) return f.retry('texts');
    data.slides = sl; data.urls = []; data.checks = []; data.si = 0;
    data.texts = { ...sl[0], headline: sl[0].headline || inp.title || '' };
    data.caption = x.caption || ''; data.tags = (x.tags || []).slice(0, 6); data.style = x.style || 'official'; data.palette = x.palette || ''; data.styleWhy = x.styleWhy || '';
    return f.go('design');
  }
  if (j.step === 'design') {
    const i = +data.si || 0;
    if (!ids.length) {
      const b = await brandOf(d, j.org_id);
      data.logo = b.logo;
      const kit = b.logo ? await kitOf(d, j.org_id, token, b, ctx.org) : null;
      const photo = photos.length ? [photos[i % photos.length]] : [];
      const series = i > 0 && data.urls[0] ? { ref: data.urls[0], composition: data.comp || undefined, accent: data.accent || undefined, i: i + 1, n } : undefined;
      const id = await httpLater(d, FN('image'), token, {
        action: 'design', org: ctx.org, dept: ctx.dept, size, brief: (inp.title || '') + '\n' + (inp.brief || '') + `\nשקף ${i + 1} מתוך ${n} בקרוסלה אחת.`,
        colors: b.colors, roles: b.roles, style: data.style || 'official', palette: data.palette || '', kit: kit || undefined, texts: data.slides[i],
        refs: [...(b.logo ? [b.logo] : []), ...photo].slice(0, 3), logo: !!b.logo, note: '', quality: 'high', n: 2, series,
        font: b.font || undefined,
      }, 170000);
      await f.upd({ data, lock_until: f.later(120) }); return f.upd({ pend: { g: id }, next_at: f.later(15) });
    }
    if (!ok(res.g)) return f.retry('design');
    const g = res.g.json;
    if (i === 0) { data.comp = g.composition?.id || ''; data.accent = g.accent || ''; data.qa = g.qa || null; data.model = g.model || ''; }
    data.urls[i] = g.url; data.checks[i] = g.check || { ok: true }; data.want = data.want || []; data.wants = data.wants || []; data.wants[i] = g.want || [];
    const bad = g.check && !g.check.ok && (g.check.issues || []).length;
    return f.go(bad ? 'fix' : (i + 1 < n ? 'design' : 'fit'), bad ? { data } : { data: { ...data, si: i + 1 < n ? i + 1 : i } });
  }
  if (j.step === 'fix') {
    const i = +data.si || 0;
    if (!ids.length) { const c = data.checks[i]; const id = await httpLater(d, FN('image'), token, { action: 'fixtext', url: data.urls[i], issues: c.issues, fixes: c.fixes || [], want: data.wants[i] || [], size }, 170000); return f.upd({ pend: { f: id }, next_at: f.later(8) }); }
    if (ok(res.f) && res.f.json.url) {
      const c = res.f.json.check || { ok: true };
      const cnt = (x: any) => (x && !x.ok ? (x.issues || []).length || 1 : 0);
      if (cnt(c) < cnt(data.checks[i])) { data.urls[i] = res.f.json.url; data.checks[i] = c; }
    }
    return f.go(i + 1 < n ? 'design' : 'fit', { data: { ...data, si: i + 1 < n ? i + 1 : i } });
  }
  if (j.step === 'fit') {
    data.src = data.urls[0];
    if (size === 'square' && fmt === '1:1') { data.out = data.urls.slice(); return f.go('done', { data }); }
    if (!ids.length) {
      const { brand } = await brandBody(d, j);
      const id = await httpLater(d, FN('produce'), token, { brand, jobs: data.urls.map((u: string, k: number) => ({ id: 's' + k, kind: 'graphic', layout: 'fit', format: FMT_K[fmt] || '1x1', data: { image: u }, thumb: false, ref: refOf(j) })) }, 170000);
      return f.upd({ pend: { p: id }, next_at: f.later(6) });
    }
    const r = res.p;
    const rs = ok(r) ? (r.json.results || []) : [];
    data.out = data.urls.map((u: string, k: number) => { const x = rs.find((y: any) => y && y.id === 's' + k) || rs[k]; return x && x.ok && x.urls ? x.urls.main : u; });
    return f.go('done', { data });
  }
  if (j.step === 'done') {
    const t = data.slides?.[0] || {};
    const warn = (data.checks || []).flatMap((c: any, k: number) => (c && !c.ok ? (c.issues || []).map((x: string) => 'שקף ' + (k + 1) + ': ' + x) : []));
    const ui = {
      ...keepUi(inp), t: t.headline || inp.title || 'קרוסלה', body: data.caption || '', tags: data.tags || [],
      media: {
        kind: 'graphic', url: data.out[0], src: data.urls[0], slides: data.out, layout: 'ai', fmt, ar: AR[fmt] || '1/1', image: data.out[0], design: data.out[0], thumb: data.out[0], ready: true,
        style: data.style, qa: data.qa, model: data.model, warn: warn.length ? warn : null, dsize: size, dlay: 'ai',
      },
      car: data.slides, carousel: n,
      wiz: { kind: 'graphic', at: new Date().toISOString() },
    };
    await saveItem(token, ui);
    return f.upd({ state: 'done', step: 'done', result: { url: data.out[0], ui_id: j.ui_id }, pend: {}, data });
  }
}

export async function advanceWeb(d: DB, j: Job, token: string, f: Flow) {
  const { ids, res, ok } = f;
  const data = j.data ?? {};
  const inp = j.input ?? {};
  const ctx = ctxOf(inp);

  /* ---------------- carousel: texts -> design slide by slide (slide 1 sets the series) -> fit -> done ---------------- */
  if (j.kind === 'graphic' && +inp.carousel >= 2) return advanceCarousel(d, j, token, f, data, inp, ctx);

  /* ---------------- graphic: texts -> design -> fix -> fit -> done ---------------- */
  if (j.kind === 'graphic') {
    const fmt = String(inp.fmt || '1:1');
    const tpl = inp.tpl && inp.tpl.url ? inp.tpl : null;
    const size = tpl ? sizeOf(String(tpl.r || fmt)) : sizeOf(fmt);
    if (j.step === 'texts') {
      if (!ids.length) { const id = await httpLater(d, FN('generate'), token, { mode: 'graphic', ...ctx, title: inp.title || '', brief: inp.brief || '', files: inp.files || [] }, 120000); return f.upd({ pend: { t: id }, next_at: f.later(4) }); }
      if (!ok(res.t)) return f.retry('texts');
      const x = res.t.json;
      data.texts = { kicker: x.kicker || '', headline: x.headline || inp.title || '', sub: x.sub || '', details: x.details || [], cta: x.cta || '', icons: Array.isArray(x.icons) ? x.icons.filter((i: any) => i && i.label).slice(0, 5) : [], keyword: x.keyword || '' };
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
  /* ---------------- editing the person's footage: prepare -> transcribe -> understand -> the editor's plan ---------------- */
  if (j.kind === 'vscan') {
    const clips: any[] = Array.isArray(inp.clips) ? inp.clips : [];
    if (j.step === 'prep') {
      if (!ids.length) {
        // a signed upload target for every file the sandbox will write
        const sign = async (path: string) => { const r = await d.storage.from('v2-content').createSignedUploadUrl(path); if (r.error) throw r.error; return { upload: r.data.signedUrl, url: d.storage.from('v2-content').getPublicUrl(path).data.publicUrl }; };
        const base = `vedit/${j.org_id}/${j.id}`;
        const list = [] as any[];
        for (const c of clips) {
          const out: Record<string, any> = { proxy: await sign(`${base}/c${c.i}-proxy.mp4`), audio: await sign(`${base}/c${c.i}-audio.mp3`), clean: await sign(`${base}/c${c.i}-clean.m4a`) };
          for (let k = 0; k < 12; k++) out['t' + k] = await sign(`${base}/c${c.i}-t${String(k).padStart(2, '0')}.jpg`);
          list.push({ url: c.url, name: c.name || '', out });
        }
        const sum = await sign(`${base}/summary.json`);
        const id = await httpLater(d, APP + '/api/video', token, { action: 'prep', clips: list, summaryUpload: sum.upload, summaryUrl: sum.url }, 120000);
        data.summaryUrl = sum.url;
        await f.upd({ data });
        return f.upd({ pend: { p: id }, next_at: f.later(8) });
      }
      if (!ok(res.p) || !res.p.json.sandboxId) return f.retry('prep_start');
      data.sb = { sandboxId: res.p.json.sandboxId, cmdId: res.p.json.cmdId };
      data.t0 = Date.now();
      return f.go('prepwait', { next_at: f.later(20) });
    }
    if (j.step === 'prepwait') {
      if (!ids.length) { const id = await httpLater(d, APP + '/api/video', token, { action: 'prepStatus', ...data.sb, summaryUrl: data.summaryUrl }, 60000); return f.upd({ pend: { s: id }, next_at: f.later(8) }); }
      const r = res.s;
      if (ok(r) && r.json.stage === 'done') {
        data.summary = r.json.summary;
        return f.go('stt');
      }
      if (ok(r) && r.json.stage === 'error') return f.fail('prep_' + (r.json.message || 'failed'));
      if (Date.now() - (data.t0 || Date.now()) > 15 * 60000) return f.fail('prep_timeout');
      data.progress = ok(r) ? r.json.progress || '' : data.progress;
      return f.upd({ pend: {}, data, next_at: f.later(8) });
    }
    if (j.step === 'stt') {
      const sc: any[] = data.summary?.clips ?? [];
      // Hebrew transcription for every clip that has sound and is not mostly silent
      const todo = sc.filter((c) => c.files?.audio && (c.quietRatio ?? 1) < 0.97);
      if (!ids.length) {
        if (!todo.length) { data.transcripts = {}; return f.go('scan'); }
        const p: Record<string, number> = {};
        for (const c of todo) p['t' + c.i] = await httpLater(d, FN('generate'), token, { mode: 'vstt', audio: c.files.audio, sec: c.sec }, 170000);
        await f.upd({ data, lock_until: f.later(120) }); return f.upd({ pend: p, next_at: f.later(12) });
      }
      data.transcripts = {};
      for (const c of todo) { const r = res['t' + c.i]; if (ok(r) && Array.isArray(r.json.sentences)) data.transcripts[c.i] = { sentences: r.json.sentences, words: r.json.words ?? [] }; }
      return f.go('scan');
    }
    if (j.step === 'scan') {
      const sc: any[] = data.summary?.clips ?? [];
      if (!ids.length) {
        const list = sc.map((c) => ({ i: c.i, name: c.name, sec: c.sec, proxy: c.files?.proxy, thumbs: c.thumbs ?? [], cuts: c.cuts ?? [], silence: c.silence ?? [], transcript: (data.transcripts?.[c.i]?.sentences ?? []).map((x: any) => ({ s: x.s, e: x.e, t: x.t })) }));
        const id = await httpLater(d, FN('generate'), token, { mode: 'vscan', ...ctx, clips: list, brief: [inp.title, inp.message, inp.must].filter(Boolean).join(' | ') }, 170000);
        return f.upd({ pend: { a: id }, next_at: f.later(15) });
      }
      if (!ok(res.a) || !Array.isArray(res.a.json.clips) || !res.a.json.clips.length) return f.retry('scan');
      data.analysis = { how: res.a.json.how, model: res.a.json.model, clips: res.a.json.clips ?? [] };
      return f.go('direct');
    }
    if (j.step === 'direct') {
      const sc: any[] = data.summary?.clips ?? [];
      if (!ids.length) {
        const list = sc.map((c) => ({ i: c.i, name: c.name, sec: c.sec, transcript: (data.transcripts?.[c.i]?.sentences ?? []).map((x: any) => ({ s: x.s, e: x.e, t: x.t })) }));
        const body = { mode: 'vedit', ...ctx, title: inp.title, message: inp.message, goal: inp.goal, aud: inp.aud, cta: inp.cta, must: inp.must, avoid: inp.avoid, notes: inp.notes, duration: inp.duration, format: inp.format, pace: inp.pace, pack: inp.pack, toggles: inp.toggles ?? {}, voiceId: inp.voiceId || 'auto', clips: list, analysis: data.analysis, change: inp.change || undefined, prev: inp.change ? data.plan : undefined };
        const id = await httpLater(d, FN('generate'), token, body, 170000);
        return f.upd({ pend: { e: id }, next_at: f.later(15) });
      }
      if (!ok(res.e)) return f.retry('direct');
      data.plan = res.e.json;
      // what the render job needs about every clip
      data.clips = sc.map((c) => ({ i: c.i, url: c.url, name: c.name, sec: c.sec, w: c.w, h: c.h, audio: c.files?.audio || '', clean: c.files?.clean || '', thumbs: c.thumbs ?? [], words: data.transcripts?.[c.i]?.words ?? [] }));
      return f.upd({ state: 'done', step: 'done', result: { ok: true }, pend: {}, data });
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
