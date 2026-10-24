// Server job runner: graphics and videos made without a browser.
// Each step sends its long calls through pg_net (v2_http) and the next tick reads the answers,
// so no edge function waits minutes on a render. A cron tick runs every minute and loops ~50s.
import { APP, FN, DB, api, brandOf, callFn, httpLater, httpResults, kitOf, newUiId, saveItem, videoBrand } from './common.ts';
import { sendImage as waImage, sendText as waText } from './wa.ts';
import { remember } from './session.ts';

type Job = Record<string, any>;
// replies of a job: real WhatsApp, or collected on the job in test mode; a failed send never fails the job
async function sendText(d: DB, j: Job, phone: string, text: string) {
  // every bot answer is kept in the conversation log (the WhatsApp requests screen shows it)
  await d.from('v2_wa_msgs').insert({ id: 'out-' + crypto.randomUUID(), phone, org_id: j.org_id, member_id: j.member_id, dir: 'out', body: String(text).slice(0, 2000) }).then(() => {}, () => {});
  if (j.input?.dry) { const m = [...(j.data?.msgs ?? []), text]; j.data = { ...(j.data ?? {}), msgs: m }; await d.from('v2_jobs').update({ data: j.data }).eq('id', j.id); return; }
  try { await waText(phone, text); }
  catch (e1) {
    // a momentary provider error ("(#131000) Something went wrong", 5xx): one more try
    await sleep(2500);
    try { await waText(phone, text); } catch (e) { console.error('wa send', e instanceof Error ? e.message : e, e1 instanceof Error ? e1.message : ''); }
  }
}
async function sendImage(d: DB, j: Job, phone: string, url: string, org: string) {
  if (j.input?.dry) return sendText(d, j, phone, '[image] ' + url);
  await waImage(phone, url, org);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function tokenOf(d: DB, memberId: string) {
  const { data } = await d.from('api_tokens').select('token').eq('member_id', memberId).eq('kind', 'internal').limit(1).maybeSingle();
  if (!data) throw new Error('no_token');
  return data.token as string;
}
async function orgName(d: DB, orgId: string) {
  const { data } = await d.from('organizations').select('name').eq('id', orgId).maybeSingle();
  return data?.name ?? '';
}
async function memberOf(d: DB, id: string) {
  const { data } = await d.from('org_members').select('name,dept').eq('id', id).maybeSingle();
  return data ?? { name: '', dept: '' };
}
// every write after a step releases the claim, so the next tick can pick the job up at next_at
const upd = (d: DB, j: Job, row: Record<string, unknown>) => d.from('v2_jobs').update({ lock_until: new Date().toISOString(), ...row, updated_at: new Date().toISOString() }).eq('id', j.id);
const later = (s: number) => new Date(Date.now() + s * 1000).toISOString();

// ---------------- one step forward ----------------
async function advance(d: DB, j: Job) {
  const token = await tokenOf(d, j.member_id);
  const pend: Record<string, number> = j.pend ?? {};
  const ids = Object.values(pend).map(Number).filter(Boolean);
  let res: Record<string, any> = {};
  if (ids.length) {
    const got = await httpResults(d, ids);
    if (ids.some((id) => !got.has(id))) { await upd(d, j, { next_at: later(4), lock_until: new Date().toISOString() }); return; }
    for (const [k, id] of Object.entries(pend)) res[k] = got.get(Number(id));
  }
  const data = j.data ?? {};
  const inp = j.input ?? {};
  const ok = (r: any) => r && r.status >= 200 && r.status < 300 && r.json && !r.json.error;
  const retry = async (why: string) => {
    if ((j.tries ?? 0) < 2) { await upd(d, j, { pend: {}, tries: (j.tries ?? 0) + 1, next_at: later(5), lock_until: new Date().toISOString() }); return; }
    await fail(d, j, why);
  };
  const go = async (step: string, row: Record<string, unknown> = {}) => upd(d, j, { step, pend: {}, tries: 0, data, next_at: new Date().toISOString(), lock_until: new Date().toISOString(), ...row });

  // ---- graphic ----
  if (j.kind === 'graphic') {
    const org = await orgName(d, j.org_id);
    if (j.step === 'texts') {
      if (!ids.length) { const id = await httpLater(d, FN('generate'), token, { mode: 'graphic', org, dept: inp.dept || '', title: inp.title || '', brief: inp.brief || '' }); return upd(d, j, { pend: { t: id }, next_at: later(6) }); }
      if (!ok(res.t)) return retry('texts');
      const x = res.t.json;
      data.texts = { kicker: x.kicker || '', headline: x.headline || inp.title || '', sub: x.sub || '', details: x.details || [], cta: x.cta || '', icons: Array.isArray(x.icons) ? x.icons.slice(0, 4) : [], keyword: x.keyword || '' };
      data.caption = x.caption || ''; data.tags = x.tags || []; data.style = x.style || 'official'; data.palette = x.palette || '';
      return go('design');
    }
    if (j.step === 'design') {
      if (!ids.length) {
        const b = await brandOf(d, j.org_id);
        data.logo = b.logo;
        // the same call the app makes: brand kit from the logo, palette roles, style, keyword and icons. One image, so the answer comes faster.
        const kit = await kitOf(d, j.org_id, token, b, org);
        const id = await httpLater(d, FN('image'), token, { action: 'design', org, dept: inp.dept || '', size: 'square', brief: (inp.title || '') + '\n' + (inp.brief || ''), colors: b.colors, roles: b.roles, style: data.style || 'official', palette: data.palette || '', kit: kit || undefined, texts: data.texts, refs: [...(b.logo ? [b.logo] : []), ...(inp.photos || [])].slice(0, 4), logo: !!b.logo, note: inp.note || '', quality: 'high', n: 1 }, 170000);
        await upd(d, j, { data, lock_until: later(120) }); return upd(d, j, { pend: { g: id }, next_at: later(20) });
      }
      if (!ok(res.g)) return retry('design');
      data.url = res.g.json.url; data.check = res.g.json.check || { ok: true }; data.want = res.g.json.want || [];
      return go(data.check && !data.check.ok && (data.check.issues || []).length ? 'fix' : 'done');
    }
    if (j.step === 'fix') {
      if (!ids.length) { const id = await httpLater(d, FN('image'), token, { action: 'fixtext', url: data.url, issues: data.check.issues, fixes: data.check.fixes || [], want: data.want, size: 'square' }, 170000); return upd(d, j, { pend: { f: id }, next_at: later(15) }); }
      if (ok(res.f) && res.f.json.url) data.url = res.f.json.url;
      return go('done');
    }
    if (j.step === 'done') return finishGraphic(d, j, token, org);
  }

  // ---- video ----
  if (j.kind === 'video') {
    if (j.step === 'brief') {
      if (!ids.length) {
        const id = await httpLater(d, FN('generate'), token, { mode: 'vbrief', title: inp.title || '', desc: inp.desc || '', goal: inp.goal || 'marketing', aud: '', format: '9x16', duration: inp.dur || 30, style: 'ai', voice: true, music: true, voiceId: 'auto', media: (inp.imgs || []).map((m: any) => ({ url: m.url, name: m.name || '', v: !!m.v })), dept: inp.dept || '', change: inp.change || undefined, prev: inp.change ? data.brief : undefined }, 170000);
        return upd(d, j, { pend: { b: id }, next_at: later(30) });
      }
      if (!ok(res.b)) return retry('brief');
      data.brief = res.b.json;
      if (inp.auto) return go('media');
      await go('await', { state: 'await' });
      return notifyBrief(d, j, data.brief);
    }
    if (j.step === 'media') {
      const b = data.brief;
      const scenes: any[] = b.scenes || [];
      if (!ids.length) {
        const p: Record<string, number> = {};
        if (b.voice && scenes.some((s) => s.say)) p.voice = await httpLater(d, FN('generate'), token, { mode: 'vvoice', voiceId: b.voice.id, stab: b.stab, says: scenes.map((s) => s.say || '') }, 170000);
        const est = scenes.reduce((a, s) => a + (+s.dur || 3), 0) + 3;
        if (b.musicPrompt) p.music = await httpLater(d, FN('generate'), token, { mode: 'vmusic', prompt: b.musicPrompt, seconds: Math.min(95, est + 4) }, 170000);
        const stockQ = scenes.map((s, i) => ({ i, src: String(s.visual?.src ?? '') })).filter((x) => /^stockv?:/.test(x.src));
        if (stockQ.length) p.stock = await httpLater(d, FN('generate'), token, { mode: 'vstock', format: '9x16', queries: stockQ.map((x) => ({ q: x.src.replace(/^stockv?:/, ''), v: /^stockv:/.test(x.src) })) }, 170000);
        const ai = scenes.map((s, i) => ({ i, src: String(s.visual?.src ?? '') })).filter((x) => /^ai:/.test(x.src)).slice(0, 6);
        for (const x of ai) p['ai' + x.i] = await httpLater(d, FN('image'), token, { title: inp.title || '', brief: x.src.slice(3) + '\nהקשר: ' + (inp.desc || ''), dept: inp.dept || '', size: 'portrait', quality: 'high' }, 170000);
        if (!Object.keys(p).length) p.none = await httpLater(d, FN('generate'), token, { mode: 'vcaps' }, 30000);
        return upd(d, j, { pend: p, next_at: later(20) });
      }
      const imgs: any[] = inp.imgs || [];
      const stockQ = scenes.map((s, i) => ({ i, src: String(s.visual?.src ?? '') })).filter((x) => /^stockv?:/.test(x.src));
      const stockItems: any[] = ok(res.stock) ? res.stock.json.items || [] : [];
      const vis = scenes.map((s, i) => {
        const src = String(s.visual?.src ?? 'gradient');
        const base = { motion: s.visual?.motion, tint: s.visual?.tint != null ? Math.min(0.25, +s.visual.tint) : 0.12 };
        let m: RegExpExecArray | null;
        if (src === 'studio') return { ...base, kind: 'studio' };
        if ((m = /^mockup:(phone|app)/.exec(src))) return { ...base, kind: 'mockup', mock: m[1] };
        if ((m = /^upload:(\d+)/.exec(src)) && imgs[+m[1]]) return { ...base, kind: imgs[+m[1]].v ? 'video' : 'image', src: imgs[+m[1]].url };
        if (/^stockv?:/.test(src)) { const k = stockQ.findIndex((x) => x.i === i); const it = stockItems[k]; if (it && it.src) return { ...base, kind: it.v ? 'video' : 'image', src: it.src }; }
        if (/^ai:/.test(src) && ok(res['ai' + i]) && res['ai' + i].json.url) return { ...base, kind: 'image', src: res['ai' + i].json.url };
        return { ...base, kind: src === 'color' ? 'color' : 'gradient' };
      });
      const clips: any[] = ok(res.voice) ? res.voice.json.clips || [] : [];
      const music = ok(res.music) ? res.music.json : null;
      const sc = scenes.map((s, i) => {
        const c = clips[i];
        const o: any = { dur: c ? Math.max(s.dur, c.sec + 0.55) : s.dur, visual: vis[i], text: s.text, transition: s.transition, fx: s.fx };
        if (c) o.voice = { src: c.src, words: c.words, at: 0.25 };
        return o;
      });
      const br = await brandOf(d, j.org_id);
      const mem = await memberOf(d, j.member_id);
      let brand: any = videoBrand(await orgName(d, j.org_id), inp.dept || mem.dept || '', br.colors, br.logo);
      if (b.kind === 'memorial') brand = { ...brand, colors: { deep: '#0A0F1A', main: '#2B3445', accent: '#C9B37E', light: '#D9D4C7' } };
      data.plan = { format: '9x16', fps: 30, brand, font: b.font, mood: b.mood, fx: b.fx, scenes: sc, outro: { dur: 3.6, ...(b.outro || {}), ...(inp.outro || {}) }, captions: { style: b.captions || 'karaoke', words: [] }, audio: music && music.src ? { music: { src: music.src } } : {}, showLogo: true };
      data.thumb = ((vis.find((v: any) => v.kind === 'image') || {}) as any).src || '';
      return go('start');
    }
    if (j.step === 'start') {
      if (!ids.length) {
        const slot = await api(token, 'upload.sign', { name: 'video.mp4' });
        data.slot = { upload: slot.upload, url: slot.url }; data.t0 = Date.now();
        await upd(d, j, { data, lock_until: later(120) });
        const id = await httpLater(d, APP + '/api/video', token, { action: 'start', plan: data.plan, upload: slot.upload, url: slot.url }, 295000);
        return upd(d, j, { pend: { s: id }, next_at: later(60) });
      }
      if (res.s && res.s.json && res.s.json.error === 'quota') return fail(d, j, 'quota:' + JSON.stringify({ used: res.s.json.used, limit: res.s.json.limit, reset: res.s.json.reset }));
      if (!ok(res.s) || !res.s.json.sandboxId) return retry('render_start');
      data.sb = { sandboxId: res.s.json.sandboxId, cmdId: res.s.json.cmdId };
      return go('status', { next_at: later(15) });
    }
    if (j.step === 'status') {
      if (!ids.length) { const id = await httpLater(d, APP + '/api/video', token, { action: 'status', ...data.sb, upload: data.slot.upload, url: data.slot.url }, 120000); return upd(d, j, { pend: { st: id }, next_at: later(8) }); }
      const r = res.st;
      if (ok(r) && r.json.stage === 'done') { data.url = r.json.url; return go('done'); }
      if (ok(r) && (r.json.stage === 'error' || r.json.stage === 'expired')) return fail(d, j, 'render_' + r.json.stage);
      if (Date.now() - (data.t0 || Date.now()) > 25 * 60000) return fail(d, j, 'render_timeout');
      data.progress = ok(r) ? r.json.progress || 0 : data.progress || 0;
      return upd(d, j, { pend: {}, data, next_at: later(10), lock_until: new Date().toISOString() });
    }
    if (j.step === 'done') return finishVideo(d, j, token);
  }
  await upd(d, j, { lock_until: new Date().toISOString(), next_at: later(30) });
}

// ---------------- results ----------------
export const MENU = 'מה נעשה עכשיו?\n1. לתקן את התמונה?\n2. לתקן את הטקסט?\n3. לתזמן את הפוסט?\n4. ליצור חדש?\nאפשר להשיב במספר או פשוט לכתוב לי.';

async function finishGraphic(d: DB, j: Job, token: string, org: string) {
  const data = j.data, inp = j.input, mem = await memberOf(d, j.member_id);
  const id = j.ui_id ?? await newUiId(d, j.org_id);
  const ui: Record<string, unknown> = {
    id, t: (data.texts && data.texts.headline) || inp.title || 'גרפיקה מ-WhatsApp', ty: 'graphic', d: inp.dept || mem.dept || '', s: 'draft', o: mem.name, u: 'עכשיו', pub: '', ch: [], th: '',
    body: data.caption || '', cta: '', tags: data.tags || [], wait: 'דקה', src: j.src === 'wa' ? 'wa' : undefined,
    media: { kind: 'graphic', url: data.url, layout: 'ai', design: data.url, fmt: '1:1', ar: '1/1', ready: true },
  };
  await saveItem(token, ui);
  await upd(d, j, { state: 'done', step: 'done', ui_id: id, result: { url: data.url }, pend: {} });
  if (j.phone) {
    // three messages, in order: the image, the post text, then the menu
    try { await sendImage(d, j, j.phone, data.url, org); } catch (e) { await sendText(d, j, j.phone, 'הגרפיקה מוכנה: ' + data.url); }
    if (data.caption) await sendText(d, j, j.phone, data.caption + ((data.tags || []).length ? '\n' + (data.tags as string[]).slice(0, 5).join(' ') : ''));
    await sendText(d, j, j.phone, MENU);
    await remember(d, j.phone, { last: { ui: id, kind: 'graphic', job: j.id, title: ui.t }, menu: true, menuKind: null, menuFix: null, menuSched: null, await: null, awaitIdea: null });
  }
}
async function finishVideo(d: DB, j: Job, token: string) {
  const data = j.data, inp = j.input, b = data.brief || {}, mem = await memberOf(d, j.member_id);
  const sec = Math.round((Date.now() - (data.t0 || Date.now())) / 1000) + 20;
  callFn('generate', token, { mode: 'vrender', sec }).catch(() => {});
  if (j.src === 'web') { await upd(d, j, { state: 'done', step: 'done', result: { url: data.url, thumb: data.thumb || '' }, pend: {} }); return; }
  const id = j.ui_id ?? await newUiId(d, j.org_id);
  const ui: Record<string, unknown> = {
    id, t: inp.title || (b.brief && b.brief.idea) || 'סרטון מ-WhatsApp', ty: 'video', d: inp.dept || mem.dept || '', s: 'draft', o: mem.name, u: 'עכשיו', pub: '', ch: [], th: '',
    body: b.caption || inp.desc || '', cta: '', tags: (b.tags || []).slice(0, 6), wait: 'דקה', src: 'wa', fmts: ['9:16'],
    media: { kind: 'video', eng: 'v3', url: data.url, thumb: data.thumb || '', ready: true, fmt: '9:16', ar: '9/16', cta: (b.outro && b.outro.cta) || '', vmeta: { name: inp.title || '', desc: inp.desc || '', goal: inp.goal, aud: '', audQ: [], fmt: '9:16', ch: [], style: 'ai', clip: null, imgs: inp.imgs || [], dur: inp.dur || 30, voice: true, music: true, voiceId: 'auto', dept: inp.dept || '', brief: b } },
  };
  await saveItem(token, ui);
  await upd(d, j, { state: 'done', step: 'done', ui_id: id, result: { url: data.url }, pend: {} });
  if (j.phone) {
    await sendText(d, j, j.phone, 'הסרטון מוכן:\n' + data.url + (b.caption ? '\n\n' + b.caption : '') + '\n\nלתזמן? כתבו מתי ובאילו רשתות.\nלשינוי, כתבו מה לתקן.');
    await remember(d, j.phone, { last: { ui: id, kind: 'video', job: j.id, title: ui.t } });
  }
}
const KIND_HE: Record<string, string> = { official: 'רשמי', marketing: 'שיווקי', event: 'אירוע', showcase: 'ראווה', greeting: 'ברכה וחג', memorial: 'ממלכתי וזיכרון' };
async function notifyBrief(d: DB, j: Job, b: any) {
  if (!j.phone) return;
  const x = b.brief || {};
  const total = Math.round((b.scenes || []).reduce((a: number, s: any) => a + (+s.dur || 0), 0) + 3);
  const lines = [
    'הבריף לסרטון:',
    x.idea || '',
    `סוג: ${KIND_HE[b.kind] || ''} · כ-${total} שניות`,
    b.voice ? `קריינות: ${b.voice.n} (${b.voice.g === 'm' ? 'גבר' : 'אישה'})${x.delivery ? ', ' + x.delivery : ''}` : 'בלי קריינות',
    x.music ? 'מוזיקה: ' + x.music : '',
    (b.outro && b.outro.cta) ? 'סיום: ' + b.outro.cta : '',
    '',
    '1 - ליצור את הסרטון (כ-6 דקות)',
    '2 - לשנות משהו (כתבו מה)',
  ].filter((l, i, a) => l !== '' || (i > 0 && a[i - 1] !== ''));
  await sendText(d, j, j.phone, lines.join('\n'));
  await remember(d, j.phone, { await: { job: j.id }, awaitIdea: x.idea || '' });
}
async function fail(d: DB, j: Job, why: string) {
  await upd(d, j, { state: 'error', error: why.slice(0, 300), pend: {}, lock_until: new Date().toISOString() });
  if (why.startsWith('quota:')) {
    // the subscription month is used up: no retry, the person is told when it opens again
    let q: any = {}; try { q = JSON.parse(why.slice(6)); } catch { /* plain */ }
    const t = q.reset ? new Date(q.reset) : null;
    if (j.phone) await sendText(d, j, j.phone, `מכסת שניות הווידאו של החודש נוצלה (${q.used ?? ''} מתוך ${q.limit ?? ''}). יצירת סרטון חדש אפשרית מ-${t ? t.getDate() + '.' + (t.getMonth() + 1) : 'החודש הבא'}. בינתיים אפשר לשלוח לי סרטון מוכן ואני אכתוב לו פוסט ואתזמן.`).catch(() => {});
    return;
  }
  if (j.phone) await sendText(d, j, j.phone, (j.kind === 'video' ? 'יצירת הסרטון' : 'יצירת הגרפיקה') + ' לא הושלמה. אפשר לנסות שוב: כתבו "נסה שוב".').catch(() => {});
  if (j.phone) await remember(d, j.phone, { retry: { job: j.id } }).catch(() => {});
}

// ---------------- the tick ----------------
export async function tick(d: DB, budgetMs = 50000) {
  const t0 = Date.now();
  let n = 0, spawned = false;
  const BATCH = 24, PAR = 6;
  while (Date.now() - t0 < budgetMs) {
    const nowIso = new Date().toISOString();
    const { data: jobs } = await d.from('v2_jobs').select('*').eq('state', 'run').lte('next_at', nowIso).lte('lock_until', nowIso).order('next_at').limit(BATCH);
    if (!jobs || !jobs.length) {
      // nothing left to run at all: stop early instead of idling out the budget
      const { count } = await d.from('v2_jobs').select('id', { count: 'exact', head: true }).eq('state', 'run');
      if (!count) break;
      await sleep(3000); continue;
    }
    // a full batch means a queue: one more worker joins (each job is locked, so two workers never touch the same one)
    if (jobs.length === BATCH && !spawned) { spawned = true; kick(); }
    // each step only sends requests or reads answers, so a few run side by side
    const queue = [...(jobs as Job[])];
    const worker = async () => {
      while (queue.length) {
        const j = queue.shift()!;
        const { data: got } = await d.from('v2_jobs').update({ lock_until: new Date(Date.now() + 120000).toISOString() }).eq('id', j.id).lte('lock_until', nowIso).select('id');
        if (!got || !got.length) continue;
        n++;
        try {
          await advance(d, j);
          // the step is over: the lock goes, so the next tick (cron or another worker) continues the job as soon as next_at allows
          await d.from('v2_jobs').update({ lock_until: new Date().toISOString() }).eq('id', j.id).eq('state', 'run');
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error('job', j.id, j.step, msg);
          if ((j.tries ?? 0) < 2) await upd(d, j, { tries: (j.tries ?? 0) + 1, pend: {}, next_at: later(10), lock_until: new Date().toISOString() });
          else await fail(d, j, msg);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PAR, queue.length) }, worker));
  }
  return n;
}
export function kick() {
  const s = Deno.env.get('SMARTSEND_WEBHOOK_SECRET') ?? '';
  return fetch(FN('smartsend-webhook') + '?tick=1', { method: 'POST', headers: { 'content-type': 'application/json', 'x-tick': s }, body: '{}' }).then(() => {}, () => {});
}
