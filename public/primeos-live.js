/* PrimeOS live layer.
 * The UI is the approved mockup (index.html) untouched. This file connects it to
 * the real backend: link login, persistence of every screen's data, and Claude
 * text generation. Loaded after the mockup scripts; boots the app.
 */
(function () {
  'use strict';
  // long generations (documents, decks) go straight to the edge function: no 60s proxy limit
  const LIVE_HOST = /(^|\.)primeos\.co\.il$|\.vercel\.app$/.test(location.hostname);
  // the API too: straight to the edge function on the live host (no proxy hop, no 30s cap); the same-origin proxy stays as a fallback
  const API_PROXY = '/api/v2';
  const API = LIVE_HOST ? 'https://tgropjisnheppsxejfdn.supabase.co/functions/v1/v2-api' : API_PROXY;
  const GEN = LIVE_HOST ? 'https://tgropjisnheppsxejfdn.supabase.co/functions/v1/generate' : '/api/generate';
  const L = (window.PrimeLive = { token: null, kind: null, org: null, me: null, admin: null, demo: false, ready: false });

  /* ---------------- transport ---------------- */
  async function post(url, body, timeoutMs) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs || 30000);
    try {
      let r;
      try {
        r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-primeos-token': L.token || '' }, body: JSON.stringify(body), signal: ctl.signal });
      } catch (e) {
        // the direct route is blocked (network, extension, DNS): the same-origin proxy carries the call
        if (url !== API || ctl.signal.aborted) throw e;
        r = await fetch(API_PROXY, { method: 'POST', headers: { 'content-type': 'application/json', 'x-primeos-token': L.token || '' }, body: JSON.stringify(body), signal: ctl.signal });
      }
      const j = await r.json().catch(() => ({ error: 'bad_response' }));
      if (r.status === 401 && (j.error === 'invalid_token' || j.error === 'session_required') && L.token && url === API) sessionLost();
      if (!r.ok || j.error) throw Object.assign(new Error(j.error || 'http_' + r.status), { status: r.status, detail: j });
      return j;
    } finally {
      clearTimeout(t);
    }
  }
  // the session ended (expired, logged out elsewhere): every loop stops at once and the login screen comes up, no more calls with a dead token
  function sessionLost() {
    if (L.dead) return;
    L.dead = true; L.ready = false;
    if (typeof SY !== 'undefined') SY.on = false;
    ls.del(L.kind === 'admin' || isAdminPath() ? SLOT.admin : SLOT.client);
    L.token = null;
    try { renderAuth('פג תוקף הכניסה. הזינו את כתובת הדוא״ל וקבלו קוד כניסה.'); } catch (e) { location.reload(); }
  }
  const call = (action, payload) => post(API, { action, payload: payload || {} });
  const gen = (payload) => {
    const body = Object.assign(aiCtx(), payload);
    // network-level failure on the direct route (no HTTP status) falls back to the same-origin proxy
    return post(GEN, body, 95000).catch((e) => (e.status || GEN === '/api/generate' ? Promise.reject(e) : post('/api/generate', body, 60000)));
  };

  /* ---------------- tokens (separate slot per interface) ---------------- */
  const ls = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
    del: (k) => { try { localStorage.removeItem(k); } catch (e) {} },
  };
  const SLOT = { client: 'primeos_tok_client', admin: 'primeos_tok_admin' };
  const isAdminPath = () => location.pathname.replace(/\/+$/, '') === '/admin' || location.pathname.startsWith('/admin/');
  function setPath(p) { if (location.pathname !== p) history.replaceState(null, '', p + location.hash); }

  /* ---------------- helpers ---------------- */
  const initials = (n) => String(n || '').trim().split(/\s+/).map((x) => x[0] || '').join('').slice(0, 2);
  const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
  const greet = () => { const h = new Date().getHours(); return h < 12 ? 'בוקר טוב' : h < 17 ? 'צהריים טובים' : 'ערב טוב'; };
  const DEMO_NAME = 'עיריית נווה הדר';
  const shortName = (n) => String(n || '').replace(/^(עיריית|מועצה אזורית|מועצה מקומית|מתנ״ס|מתנ"ס)\s*/, '');
  function replaceAll(arr, list) { arr.splice(0, arr.length, ...(list || [])); }
  function replaceObj(obj, data) { Object.keys(obj).forEach((k) => delete obj[k]); Object.assign(obj, data || {}); }
  // a saved value only replaces a live one of the same shape (a broken save never stops the app from loading)
  function restore(target, data) {
    if (data == null || target == null || typeof target !== 'object') return;
    if (Array.isArray(target)) { if (Array.isArray(data)) replaceAll(target, data); return; }
    if (typeof data === 'object' && !Array.isArray(data)) replaceObj(target, data);
  }
  const busyBtn = (sel, txt) => {
    const b = $(sel);
    if (!b) return () => {};
    const html = b.innerHTML;
    b.disabled = true;
    b.innerHTML = '<span class="gm-spin" style="width:15px;height:15px;border-width:2px;display:inline-block;vertical-align:middle"></span> ' + txt;
    return () => { if (document.body.contains(b)) { b.disabled = false; b.innerHTML = html; } };
  };
  const aiFail = (e) => toast('ה-AI לא הצליח להשלים', e && e.message === 'claude_not_configured' ? 'מפתח Claude לא מוגדר בשרת.' : 'נסו שוב בעוד רגע.', 'err');

  /* ---------------- unique numeric ids (multi-user safe) ---------------- */
  (function () {
    let last = S.seq || 100;
    Object.defineProperty(S, 'seq', {
      configurable: true,
      get() {
        const base = Math.floor((Date.now() - 1767225600000) / 1000) * 20 + Math.floor(Math.random() * 20);
        return Math.max(last + 1, base);
      },
      set(v) { last = Math.max(last, +v || 0); },
    });
  })();

  /* ---------------- which data each side persists ---------------- */
  const CLIENT_KEYS = {
    users: () => users, waRequests: () => waRequests, activity: () => activity, channels: () => channels,
    DEPTS: () => DEPTS, DEPT_C: () => DEPT_C, DEPT_INFO: () => DEPT_INFO, BRAND: () => BRAND, MAIN_APPR: () => MAIN_APPR, ROUTES: () => ROUTES,
  };
  function clientState() {
    const o = {};
    for (const k in CLIENT_KEYS) o[k] = CLIENT_KEYS[k]();
    o.users = users.map((u) => { const c = Object.assign({}, u); delete c.tok; return c; }); // login links never leave the server's answer
    o.camps = S.camps || [];
    o.events = S.events || [];
    o.flags = { docqDone: !!S.docqDone, defRoute: S.defRoute || 'full' };
    return o;
  }
  function hydrateClient(st) {
    for (const k in CLIENT_KEYS) if (st[k] !== undefined) restore(CLIENT_KEYS[k](), st[k]);
    if (Array.isArray(st.camps)) S.camps = st.camps;
    if (Array.isArray(st.events)) S.events = st.events;
    if (st.flags) { S.docqDone = !!st.flags.docqDone; if (st.flags.defRoute) S.defRoute = st.flags.defRoute; }
  }
  const ADMIN_KEYS = {
    ORGS: () => ORGS, AUSERS: () => AUSERS, PURCH: () => PURCH, REQS: () => REQS, MEETINGS: () => MEETINGS,
    MEET_CFG: () => MEET_CFG, ADMINS: () => ADMINS, PLAN_OF: () => PLAN_OF, PLANS: () => PLANS, PRICE: () => PRICE, QUOTA: () => QUOTA,
    VENDORS: () => VENDORS, FX: () => FX, RATES: () => RATES, PACKS: () => PACKS,
  };
  function adminStateObj() { const o = {}; for (const k in ADMIN_KEYS) o[k] = ADMIN_KEYS[k](); return o; }
  // plan names, descriptions and colours come from the code; only the prices are the admin's saved values
  const PLAN_DEF = JSON.parse(JSON.stringify(PLANS));
  const VENDOR_DEF = JSON.parse(JSON.stringify(VENDORS));
  const RATE_DEF = JSON.parse(JSON.stringify(RATES));
  function hydrateAdmin(st) {
    for (const k in ADMIN_KEYS) if (st[k] !== undefined) restore(ADMIN_KEYS[k](), st[k]);
    Object.keys(PLAN_DEF).forEach((k) => { if (!PLANS[k]) PLANS[k] = JSON.parse(JSON.stringify(PLAN_DEF[k])); PLANS[k].t = PLAN_DEF[k].t; PLANS[k].d = PLAN_DEF[k].d; PLANS[k].c = PLAN_DEF[k].c; if (!(+PLANS[k].cost > 100)) PLANS[k].cost = PLAN_DEF[k].cost; });
    VENDORS.forEach((v) => { if (typeof v.usd !== 'number') v.usd = +v.usd || 0; });
    // vendors and rates added after the admin last saved come back with their defaults
    VENDOR_DEF.forEach((v) => { if (!VENDORS.some((x) => x.k === v.k)) VENDORS.push(JSON.parse(JSON.stringify(v))); });
    Object.keys(RATE_DEF).forEach((k) => { if (typeof RATES[k] !== 'number') RATES[k] = RATE_DEF[k]; });
  }

  // 'דוברות' is the mockup's main department; a client may call it שיווק, תקשורת...
  function renameMainDept(name) {
    name = String(name || '').trim();
    const old = DEPTS.find((d) => DEPT_INFO[d] && DEPT_INFO[d].isMain) || 'דוברות';
    if (!name || name === old) return;
    const i = DEPTS.indexOf(old); if (i >= 0) DEPTS[i] = name; else DEPTS.unshift(name);
    DEPT_C[name] = DEPT_C[old] || '#0124C7'; delete DEPT_C[old];
    DEPT_INFO[name] = Object.assign({}, DEPT_INFO[old] || {}, { isMain: true }); delete DEPT_INFO[old];
    if (typeof TOPICS !== 'undefined' && TOPICS[old]) { TOPICS[name] = TOPICS[old]; }
    if (typeof TAG_BANK !== 'undefined' && TAG_BANK[old]) { TAG_BANK[name] = TAG_BANK[old]; }
    users.forEach((u) => { if (u.d === old) u.d = name; });
    if (S.user && S.user.dept === old) S.user.dept = name;
    ROUTES.forEach((r) => { r.t = r.t.split(old).join(name); r.steps.forEach((st) => { st[0] = st[0].split(old).join(name); }); });
  }
  // a new organisation starts with the departments the admin opened in the wizard, not the demo's
  function seedDepts(list) {
    if (!Array.isArray(list)) return;
    const main = DEPTS.find((d) => DEPT_INFO[d] && DEPT_INFO[d].isMain) || DEPTS[0];
    const keepC = DEPT_C[main];
    DEPTS.splice(0, DEPTS.length, main);
    Object.keys(DEPT_C).forEach((k) => { if (k !== main) delete DEPT_C[k]; });
    Object.keys(DEPT_INFO).forEach((k) => { if (k !== main) delete DEPT_INFO[k]; });
    DEPT_C[main] = keepC || DEPT_COLORS[5];
    list.forEach((d, i) => {
      const n = String(d && d.n || '').trim();
      if (!n || DEPTS.includes(n)) return;
      DEPTS.push(n);
      DEPT_C[n] = DEPT_COLORS[i % DEPT_COLORS.length] === DEPT_C[main] ? DEPT_COLORS[(i + 1) % DEPT_COLORS.length] : DEPT_COLORS[i % DEPT_COLORS.length];
      DEPT_INFO[n] = { lead: d.ap || '', route: 'full', phones: d.ph ? [d.ph] : [], mails: [], appr: d.ap ? { n: d.ap, ph: d.ph || '' } : null };
      if (typeof TOPICS !== 'undefined' && !TOPICS[n]) TOPICS[n] = TOPICS[main] || TOPICS['דוברות'];
      if (typeof TAG_BANK !== 'undefined' && !TAG_BANK[n]) TAG_BANK[n] = ['עדכון_לתושבים'];
    });
  }
  /* a brand-new organisation starts empty, not with the demo municipality's data */
  function freshClient() {
    items = [];
    replaceAll(waRequests, []);
    replaceAll(activity, []);
    S.camps = [];
    S.events = [];
    replaceAll(users, [{ n: L.me ? L.me.name : 'מנהל המערכת', r: 'מנהל/ת מערכת', d: DEPTS[0], st: 'פעיל', last: 'עכשיו', i: initials(L.me && L.me.name), direct: true }]);
    channels.forEach((c) => { c.st = 'לא מחובר'; c.acc = '-'; c.sync = '-'; c.fol = '-'; });
    Object.keys(DEPT_INFO).forEach((d) => { DEPT_INFO[d].lead = ''; DEPT_INFO[d].phones = []; DEPT_INFO[d].mails = []; if (!DEPT_INFO[d].isMain) DEPT_INFO[d].appr = null; });
    BRAND.docs = [];
    S.docqDone = false;
    renameMainDept(L.org && L.org.settings && L.org.settings.main_dept);
    seedDepts(L.org && L.org.settings && L.org.settings.depts);
    // the main approver is the organisation user, not the demo's spokesperson
    const mgr = L.me && L.me.role !== 'member' ? L.me : null;
    replaceObj(MAIN_APPR, { n: mgr ? mgr.name : 'משתמש הארגון', r: 'הרשאת מנהל (גישה מלאה)', ph: (mgr && mgr.phone) || '', mail: (mgr && mgr.email) || '' });
  }

  /* ---------------- sync engine ---------------- */
  const SY = { items: new Map(), state: '', inbox: new Set(), busy: false, fail: 0, on: false };
  const itemsSnap = () => { const m = new Map(); for (const it of items) m.set(it.id, JSON.stringify(it)); return m; };
  function baseline() {
    if (L.memberPatch && L.me && L.me.role === 'member') SY.mstate = JSON.stringify(L.memberPatch());
    // what the server already holds counts as saved; anything else is pushed on the first flush
    SY.items = L.kind === 'client' ? itemsSnap() : new Map();
    if (L.kind === 'client' && !L.srvHadItems) SY.items = new Map();
    SY.state = L.srvHadState ? JSON.stringify(L.kind === 'client' ? clientState() : adminStateObj()) : '';
    if (L.kind === 'client') { REQS.forEach((r) => SY.inbox.add('r:' + r.id)); MEETINGS.forEach((m) => SY.inbox.add('m:' + m.id)); }
  }
  async function flush() {
    if (!SY.on || SY.busy || L.dead) return;
    SY.busy = true;
    try {
      if (L.kind === 'client') {
        if (L.trackItems) L.trackItems(SY.items);
        const cur = itemsSnap();
        const ch = [];
        const rm = [];
        for (const [id, j] of cur) if (SY.items.get(id) !== j) ch.push(j);
        for (const id of SY.items.keys()) if (!cur.has(id)) rm.push(id);
        for (let i = 0; i < ch.length; i += 40) {
          const part = ch.slice(i, i + 40);
          await call('items.upsert', { items: part.map((j) => JSON.parse(j)) });
          part.forEach((j) => SY.items.set(JSON.parse(j).id, j));
        }
        if (rm.length) { await call('items.remove', { ids: rm }); rm.forEach((id) => SY.items.delete(id)); }
        if (L.memberPatch && L.me && L.me.role === 'member') {
          const mp = JSON.stringify(L.memberPatch());
          if (mp !== SY.mstate) { await call('state.patch', { data: JSON.parse(mp) }); SY.mstate = mp; }
        } else {
          const st = JSON.stringify(clientState());
          if (st !== SY.state) { await call('state.save', { data: JSON.parse(st) }); SY.state = st; }
        }
        const nr = REQS.filter((r) => !SY.inbox.has('r:' + r.id));
        const nm = MEETINGS.filter((m) => !SY.inbox.has('m:' + m.id));
        if (nr.length || nm.length) {
          await call('inbox.add', { reqs: nr.map((r) => Object.assign({}, r, { orgName: L.org.name })), meetings: nm.map((m) => Object.assign({}, m, { orgName: L.org.name })) });
          nr.forEach((r) => SY.inbox.add('r:' + r.id));
          nm.forEach((m) => SY.inbox.add('m:' + m.id));
        }
      } else if (L.kind === 'admin') {
        const st = JSON.stringify(adminStateObj());
        if (st !== SY.state) { await call('admin.state.save', { data: JSON.parse(st) }); SY.state = st; }
      }
      if (SY.fail) toast('השינויים נשמרו', '');
      SY.fail = 0;
    } catch (e) {
      SY.fail++;
      if (e.status === 401) { SY.on = false; toast('פג תוקף הכניסה', 'יש להיכנס מחדש מהקישור.', 'err'); return; }
      if (SY.fail === 2 || SY.fail % 20 === 0) toast('השמירה מתעכבת', 'השינויים יישמרו אוטומטית כשהחיבור יחזור.', 'err');
    } finally {
      SY.busy = false;
    }
  }
  function startSync() {
    baseline();
    SY.on = true;
    setInterval(flush, 1500);
    document.addEventListener('click', () => setTimeout(flush, 250), true);
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
    window.addEventListener('beforeunload', (e) => { if (SY.fail) { e.preventDefault(); e.returnValue = ''; } });
    if (L.kind === 'client') {
      setInterval(pull, 25000);
      // back to the tab: the library is refreshed at once, not up to 25 seconds later
      document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(pull, 300); });
      window.addEventListener('online', () => setTimeout(pull, 500));
    }
  }

  /* other users' changes come in quietly */
  const QUIET = ['wizard', 'docWiz', 'deckWiz', 'vidWiz', 'bulk', 'bulkGen', 'bulkReview', 'evWiz', 'onboard'];
  async function pull() {
    if (!SY.on || SY.busy || document.hidden || L.dead) return;
    let d;
    const sentSince = SY.since || null;
    try { d = await call('live.load', sentSince ? { since: sentSince } : {}); } catch (e) { return; }
    if (SY.busy) return;
    if (d.at) SY.since = d.at;
    // removals are judged only against a full list of ids (an incremental answer without one never deletes)
    const canDelete = Array.isArray(d.ids) || !sentSince;
    let changed = false;
    const local = new Map(items.map((i) => [i.id, i]));
    // an incremental answer lists only what changed; `ids` says what still exists on the server
    const seen = new Set(Array.isArray(d.ids) ? d.ids : []);
    for (const r of d.items || []) {
      const ui = r.ui;
      seen.add(ui.id);
      const sj = JSON.stringify(ui);
      const synced = SY.items.get(ui.id);
      const l = local.get(ui.id);
      if (!l) { if (synced === undefined) { items.unshift(ui); SY.items.set(ui.id, sj); changed = true; } }
      else if (JSON.stringify(l) === synced && sj !== synced) { replaceObj(l, ui); SY.items.set(ui.id, sj); changed = true; }
    }
    for (const [id, sj] of canDelete ? [...SY.items] : []) {
      if (seen.has(id)) continue;
      const l = local.get(id);
      if (l && JSON.stringify(l) === sj) { items.splice(items.indexOf(l), 1); SY.items.delete(id); changed = true; }
    }
    if (d.state && !d.state.fresh && SY.stateAt !== d.stateAt) {
      SY.stateAt = d.stateAt;
      const sj = JSON.stringify(Object.assign(clientState(), d.state));
      if (L.me && L.me.role === 'member') { const mp = JSON.stringify(L.memberPatch()); hydrateClient(d.state); if (mp === SY.mstate) SY.mstate = JSON.stringify(L.memberPatch()); changed = true; }
      else if (JSON.stringify(clientState()) === SY.state && sj !== SY.state) { hydrateClient(d.state); SY.state = JSON.stringify(clientState()); changed = true; }
    }
    const typing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    const overlay = $('#drawer').classList.contains('on') || !$('#modal').classList.contains('hidden');
    if (changed && !typing && !overlay && !QUIET.includes(S.route)) render();
  }

  /* ---------------- organisation name in every screen ---------------- */
  function fixNames(h) {
    if (typeof h !== 'string' || !L.org || L.kind !== 'client' || S.imp) return h;
    let out = h;
    if (L.org.name !== DEMO_NAME) {
      const sn = shortName(L.org.name);
      out = out.split(DEMO_NAME).join(L.org.name).split('נווה_הדר').join(sn.replace(/\s+/g, '_')).split('נווה הדר').join(sn);
    }
    if (L.me && L.me.name && L.me.name !== 'יעל כהן') out = out.replace('בוקר טוב, יעל', greet() + ', ' + esc(firstName(L.me.name)));
    else out = out.replace('בוקר טוב, יעל', greet() + ', יעל');
    return out;
  }
  function wrapNames() {
    Object.keys(SCREENS).forEach((k) => {
      const sc = SCREENS[k];
      if (!sc || typeof sc.render !== 'function' || sc.render.__live) return;
      const r = sc.render;
      sc.render = function () { return fixNames(r.apply(this, arguments)); };
      sc.render.__live = true;
    });
    const od = openDrawer, om = openModal;
    openDrawer = (h) => od(fixNames(h));
    openModal = (h) => om(fixNames(h));
  }

  /* ---------------- shell labels ---------------- */
  const _setShell = setShell;
  setShell = function () {
    _setShell();
    if (S.mode === 'admin') {
      if (L.admin) { $('#userNm').textContent = L.admin.name || 'מנהל מערכת'; $('#userAv').textContent = initials(L.admin.name) || 'מנ'; }
      const chip = $('#demoChip');
      if (chip) chip.style.display = 'none';
      return;
    }
    const chip = $('#demoChip');
    if (chip) chip.style.display = L.demo ? '' : 'none';
    if (!L.org || S.imp || isDept()) {
      if (L.org && isDept() && !S.imp) { $('#btnOrg .otx').textContent = L.org.name + ' · ' + S.dept; $('#userNm').textContent = S.dept; $('#userRl').textContent = (L.me && L.me.name) || 'מחלקה בארגון'; $('#userAv').textContent = initials(L.me && L.me.name) || S.dept.slice(0, 2); }
      return;
    }
    $('#btnOrg .otx').textContent = L.org.name + (isBasic() ? '' : ' · ' + (S.user.dept || 'דוברות'));
    $('#userNm').textContent = S.user.name;
    $('#userRl').textContent = S.user.role;
    $('#userAv').textContent = S.user.init;
  };

  /* ---------------- login screen (real) ---------------- */
  const _renderAuth = renderAuth;
  renderAuth = function (msg) {
    $('#app').classList.remove('on');
    _renderAuth();
    const ds = $('.demo-strip');
    if (ds) {
      if (msg) ds.innerHTML = ic('alert', 15) + '<span>' + esc(msg) + '</span>';
      else ds.remove();
    }
    const foot = $('.auth-foot');
    if (foot) foot.textContent = '© PrimeOS';
    const views = $('.auth-views');
    if (views) views.remove();
    const nw = $('#lNew');
    if (nw) nw.remove();
    // entry by e-mail code: only addresses registered on a user (or the master admins) get a code
    const pw = $('#lPass');
    if (pw) { const f = pw.closest('.field'); if (f) f.remove(); }
    const fg = $('#lForgot'); if (fg && fg.parentElement) fg.parentElement.remove();
    let adm = isAdminPath(), step = 'mail', email = '', wait = 0, timer = null;
    const card = $('.auth-card');
    const note = card && card.querySelector('.auth-note');
    // the brand column is hidden on narrow screens, so the card carries the logo there
    const lgSrc = (document.querySelector('.top-logo .logo-img') || {}).src;
    if (note) note.innerHTML = ic('shield', 15) + '<span>הכניסה רק לכתובות דוא״ל שרשומות במערכת. כל כניסה נרשמת.</span>';
    const box = document.createElement('div');
    box.id = 'authBox';
    const old = [card.querySelector('h2'), card.querySelector('.sub'), card.querySelector('.field'), $('#lIn')];
    old.forEach((x) => x && x.remove());
    const ds2 = card.querySelector('.demo-strip');
    if (ds2) ds2.after(box); else card.prepend(box);
    if (card && lgSrc && !card.querySelector('.auth-mlogo')) card.insertAdjacentHTML('afterbegin', '<div class="auth-mlogo"><img src="' + lgSrc + '" alt="PrimeOS"><b>PrimeOS</b></div>');
    const paint = () => {
      if (timer) { clearInterval(timer); timer = null; }
      if (step === 'mail') {
        box.innerHTML = '<h2>' + (adm ? 'כניסת מנהל מערכת' : 'כניסה למערכת') + '</h2>' +
          '<p class="sub">' + (adm ? 'הזינו את הדוא״ל של מנהל המערכת. קוד כניסה יישלח אליו.' : 'הזינו את כתובת הדוא״ל שרשומה עבורכם במערכת. קוד כניסה יישלח אליה.') + '</p>' +
          '<form id="aMailF" novalidate><div class="field" style="margin-bottom:16px"><label for="lEmail">כתובת דוא״ל</label>' +
          '<input type="email" id="lEmail" name="email" autocomplete="email" inputmode="email" dir="ltr" required aria-required="true" value="' + esc(email) + '"></div>' +
          '<button type="submit" class="btn btn-primary btn-lg btn-block" id="lIn">שליחת קוד כניסה</button></form>';
        const f = $('#aMailF');
        f.onsubmit = (e) => { e.preventDefault(); sendCode(); };
        setTimeout(() => { const i = $('#lEmail'); if (i) i.focus(); }, 30);
      } else {
        box.innerHTML = '<h2>הזנת קוד</h2>' +
          '<p class="sub">שלחנו קוד בן 6 ספרות אל <b dir="ltr">' + esc(email) + '</b>. אפשר גם ללחוץ במייל על „כניסה ישירה”.</p>' +
          '<form id="aCodeF" novalidate><div class="field" style="margin-bottom:16px"><label for="lCode">קוד כניסה</label>' +
          '<input type="text" id="lCode" name="code" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]*" maxlength="6" dir="ltr" required aria-required="true" aria-describedby="lCodeHelp" style="font-size:24px;letter-spacing:10px;text-align:center;font-weight:700">' +
          '<div id="lCodeHelp" class="t-sub" style="margin-top:6px">הקוד תקף ל-10 דקות.</div></div>' +
          '<button type="submit" class="btn btn-primary btn-lg btn-block" id="lIn">כניסה</button></form>' +
          '<div style="display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap;margin-top:12px">' +
          '<button type="button" class="btn btn-sm" id="aResend" disabled>שליחה חוזרת</button>' +
          '<button type="button" class="btn btn-sm" id="aBack">החלפת כתובת</button></div>';
        const c = $('#lCode');
        $('#aCodeF').onsubmit = (e) => { e.preventDefault(); verify(); };
        c.addEventListener('input', () => { c.value = c.value.replace(/\D/g, '').slice(0, 6); if (c.value.length === 6) verify(); });
        $('#aBack').onclick = () => { step = 'mail'; paint(); };
        const rs = $('#aResend');
        rs.onclick = () => sendCode(true);
        const tickR = () => { wait--; if (wait <= 0) { rs.disabled = false; rs.textContent = 'שליחה חוזרת'; clearInterval(timer); timer = null; } else rs.textContent = 'שליחה חוזרת (' + wait + ')'; };
        wait = 30; rs.textContent = 'שליחה חוזרת (30)'; timer = setInterval(tickR, 1000);
        setTimeout(() => c.focus(), 30);
      }
      const la = $('#lAdmin'); if (la) la.innerHTML = ic('shield', 14) + (adm ? ' כניסה לחשבון ארגון' : ' כניסת מנהל מערכת PrimeOS');
    };
    // errors appear next to the field too (read out by screen readers), not only in a toast
    const fieldErr = (id, msg) => {
      const i = document.getElementById(id); if (!i) return;
      const f = i.closest('.field'); let e = f && f.querySelector('.field-err');
      if (!msg) { i.removeAttribute('aria-invalid'); if (e) e.remove(); return; }
      if (!e && f) { e = document.createElement('div'); e.className = 'field-err'; e.id = id + 'Err'; e.setAttribute('role', 'alert'); e.style.cssText = 'color:#B00020;font-size:13.5px;font-weight:600;margin-top:6px'; f.appendChild(e); }
      if (e) e.textContent = msg;
      i.setAttribute('aria-invalid', 'true'); i.setAttribute('aria-describedby', (id === 'lCode' ? 'lCodeHelp ' : '') + id + 'Err');
    };
    const sendCode = async (again) => {
      const i = $('#lEmail');
      if (i) email = (i.value || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { fieldErr('lEmail', 'כתובת הדוא״ל לא תקינה. בדקו אותה ונסו שוב.'); if (i) i.focus(); return; }
      fieldErr('lEmail', '');
      const done = busyBtn(again ? '#aResend' : '#lIn', 'שולחים...');
      try {
        await post(API, { action: 'login.code', payload: { email, admin: adm } });
        done();
        step = 'code'; paint();
        toast('אם הכתובת רשומה במערכת, נשלח אליה קוד', 'בדקו את תיבת הדוא״ל (וגם את תיקיית הספאם).', '');
      } catch (e) { done(); toast('השליחה נכשלה', 'בעיית חיבור. נסו שוב בעוד רגע.', 'err'); }
    };
    let verifying = false;
    const verify = async () => {
      const c = $('#lCode'); const code = (c && c.value || '').replace(/\D/g, '');
      if (code.length !== 6) { fieldErr('lCode', 'הזינו את 6 הספרות שקיבלתם במייל.'); return; }
      if (verifying) return; verifying = true;
      const done = busyBtn('#lIn', 'נכנסים...');
      try {
        const r = await post(API, { action: 'login.verify', payload: { email, code, admin: adm } });
        ls.set(SLOT[r.kind], r.token);
        L.token = r.token;
        setPath(r.kind === 'admin' ? '/admin' : '/');
        $('#authRoot').innerHTML = '';
        await bootWithToken();
      } catch (e) {
        done(); verifying = false;
        const m = e.message;
        toast(m === 'bad_code' ? 'הקוד שגוי' : m === 'too_many_tries' ? 'יותר מדי ניסיונות' : m === 'code_expired' ? 'הקוד פג תוקף' : 'הכניסה נכשלה',
          m === 'bad_code' ? 'בדקו את הספרות ונסו שוב.' : m === 'too_many_tries' || m === 'code_expired' ? 'בקשו קוד חדש.' : 'נסו שוב בעוד רגע.', 'err');
        fieldErr('lCode', m === 'bad_code' ? 'הקוד שגוי. בדקו את הספרות ונסו שוב.' : m === 'too_many_tries' ? 'יותר מדי ניסיונות. בקשו קוד חדש.' : m === 'code_expired' ? 'הקוד פג תוקף. בקשו קוד חדש.' : 'הכניסה נכשלה. נסו שוב בעוד רגע.');
        if (c) { c.value = ''; c.focus(); }
      }
    };
    paint();
    $('#lAdmin').onclick = () => { adm = !adm; step = 'mail'; setPath(adm ? '/admin' : '/'); paint(); };
  };

  /* logout clears this interface's link */
  const _logout = ACT.logout;
  ACT.logout = async () => {
    try { await call('logout'); } catch (e) { /* the session ends locally anyway */ }
    ls.del(L.kind === 'admin' ? SLOT.admin : SLOT.client);
    location.href = L.kind === 'admin' ? '/admin' : '/';
  };

  /* ---------------- boot ---------------- */
  function loader(txt) {
    $('#authRoot').innerHTML = '<div style="min-height:100vh;display:grid;place-items:center;font-family:Heebo,sans-serif;color:var(--ink-3,#5A6386)"><div style="display:flex;align-items:center;gap:12px;font-size:15px"><span class="gm-spin"></span>' + esc(txt || 'טוען את PrimeOS...') + '</div></div>';
  }
  async function bootClient() {
    const d = await call('live.load');
    SY.since = d.at || null; SY.stateAt = d.stateAt || null;
    L.kind = 'client';
    L.org = d.org;
    L.me = d.me;
    L.demo = !!d.demo;
    L.srvHadItems = !!(d.items && d.items.length);
    L.srvHadState = !!(d.state && !d.state.fresh);
    const fresh = !d.state || d.state.fresh;
    // a real organisation never starts from the demo data: empty first, then whatever the server holds
    if (!L.demo) freshClient();
    if (d.state && !d.state.fresh) hydrateClient(d.state);
    if (d.items && d.items.length) items = d.items.map((r) => r.ui).sort((a, b) => b.id - a.id);
    else if (!L.demo || !fresh) items = [];
    S.seq = items.reduce((m, i) => Math.max(m, (+i.id || 0) < 2e9 ? +i.id || 0 : 0), 100); // ids from 2e9 up are made by the server (WhatsApp bot)
    S.org = L.org.name;
    if (Array.isArray(d.members) && d.members.length && L.applyMembers) L.applyMembers(d.members);
    if (L.memberSlices) L.memberSlices(d.state && !d.state.fresh ? d.state : null);
    if (L.me) {
      const demoUser = L.demo && L.me.name === 'יעל כהן';
      S.user = { name: L.me.name, role: demoUser ? 'מנהלת תקשורת' : (L.me.role === 'member' ? 'מחלקה בארגון' : 'הרשאת מנהל (גישה מלאה)'), init: initials(L.me.name), dept: L.me.dept || S.user.dept || DEPTS[0] };
      if (!L.members && !users.some((u) => u.n === L.me.name)) users.unshift({ n: L.me.name, r: S.user.role, d: S.user.dept, st: 'פעיל', last: 'עכשיו', i: S.user.init, direct: true });
    }
    if (!L.demo) {
      const v = (L.me && L.me.view) || (L.org.plan === 'basic' ? 'basic' : 'ext');
      S.view = ['ext', 'dept', 'basic'].includes(v) ? v : 'ext';
      if (S.view === 'dept' && L.me && L.me.dept) S.dept = L.me.dept;
    } else S.view = 'ext';
    wrapNames();
    setPath('/');
    enterApp('dashboard');
    startSync();
    L.ready = true;
    if (L.pubBoot) L.pubBoot();
    // event videos still rendering on the server: follow them so the cards fill in when ready
    if (L.evResumeAll) setTimeout(L.evResumeAll, 1200);
  }
  async function bootAdmin() {
    const d = await call('admin.load');
    L.kind = 'admin';
    L.admin = d.admin;
    L.srvHadState = !!d.state;
    if (d.state) hydrateAdmin(d.state);
    liveAdmin(d.realOrgs || []);
    setPath('/admin');
    enterAdmin();
    startSync();
    L.ready = true;
  }
  async function bootWithToken() {
    loader();
    const w = await call('whoami');
    L.kind = w.kind;
    ls.set(SLOT[w.kind], L.token);
    if (w.kind === 'admin') await bootAdmin();
    else await bootClient();
  }
  /* ---------------- /sign: the client reads the agreement and signs it inside PrimeOS ---------------- */
  async function bootSign(t) {
    const root = $('#authRoot');
    const wrap = (inner) => '<div style="position:relative;z-index:50;min-height:100vh;background:var(--bg,#F4F6FB);padding:28px 16px calc(40px + env(safe-area-inset-bottom));font-family:Heebo,sans-serif"><div style="max-width:760px;margin:0 auto">' + inner + '</div></div>';
    root.innerHTML = wrap('<div class="card card-pad">טוען את ההסכם...</div>');
    L.ready = true;
    let d;
    try { d = await call('sign.load', { t }); } catch (e) { root.innerHTML = wrap('<div class="card card-pad"><h2 style="margin:0 0 8px">הקישור אינו בתוקף</h2><p class="t-sub">פנו לנציג PrimeOS לקבלת קישור חדש.</p></div>'); return; }
    const a = d.agr || {};
    const basic = d.org.plan === 'basic';
    const fake = { n: d.org.name, type: d.org.type || '', plan: basic ? 'solo' : 'appr', uLim: a.uLim || (basic ? 1 : 5), dLim: a.dLim || (basic ? 0 : 5), ch: a.ch || 1, xch: 0, contact: d.org.contact || '', agr: a };
    const doc = () => agrDoc(fake, { start: a.start || (a.startIso ? heDate(a.startIso) : ''), startIso: a.startIso, term: 'שנתי', trial: !!a.trial, signed: !!a.signed, signedAt: a.signedAt, signer: a.signer || d.org.contact });
    const form = a.signed
      ? '<div class="note" style="margin-top:16px">' + ic('checkc', 16) + '<span><b>ההסכם נחתם</b> על ידי ' + esc(a.signer || '') + ' · ' + esc(a.signedAt || '') + '</span></div>'
      : '<div class="card card-pad" style="margin-top:16px"><h3 style="margin:0 0 6px">חתימה דיגיטלית</h3><p class="t-sub" style="margin:0 0 14px">הקלידו שם מלא ואשרו. החתימה נשמרת עם תאריך ושעה ומהווה הסכמה לתנאי ההסכם.</p>' +
        '<div class="field"><label for="sgName">שם מלא של החותם/ת</label><input type="text" id="sgName" autocomplete="name" value="' + esc(d.org.contact || '') + '"></div>' +
        '<label class="sg-ok" for="sgOk"><input type="checkbox" id="sgOk"><span>קראתי את ההסכם ואני מאשר/ת אותו בשם ' + esc(d.org.name) + '</span></label>' +
        '<div class="sg-acts"><button class="btn btn-primary btn-lg" id="sgBtn">' + ic('sign', 16) + ' חתימה על ההסכם</button><button class="btn btn-lg" id="sgPrint">' + ic('down', 16) + ' הדפסה / PDF</button></div></div>';
    document.body.classList.add('sign-mode');
    root.innerHTML = '<style>' +
      'body.sign-mode #aiFab,body.sign-mode .ai-fab{display:none!important}' +
      'body.sign-mode #toasts{bottom:max(16px,env(safe-area-inset-bottom));top:auto}' +
      '.agr-page{overflow-wrap:anywhere}.agr-page table{display:block;max-width:100%;overflow-x:auto}' +
      '.sg-ok{display:flex;align-items:flex-start;gap:12px;margin:14px 0;padding:14px;border:1.5px solid var(--line,#DDE3EC);border-radius:14px;cursor:pointer;line-height:1.5;font-weight:600;background:#fff}' +
      '.sg-ok:has(input:checked){border-color:var(--brand,#4A1BE8);background:#F3F0FF}' +
      '.sg-ok input{width:26px;height:26px;min-width:26px;margin:0;accent-color:#4A1BE8;cursor:pointer}' +
      '.sg-acts{display:flex;gap:10px;flex-wrap:wrap}.sg-acts .btn{min-height:52px}' +
      '#sgName{min-height:50px;font-size:17px}' +
      '@media(max-width:640px){.sg-acts{flex-direction:column}.sg-acts .btn{width:100%;justify-content:center}.agr-page{padding:16px!important}}' +
      '</style>' + wrap('<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px"><b style="font-size:22px;color:#4A1BE8">PrimeOS</b><span class="t-sub">הסכם מנוי · ' + esc(d.org.name) + '</span></div><div class="card card-pad agr-page">' + doc() + '</div>' + form);
    const pr = $('#sgPrint'); if (pr) pr.onclick = () => window.print();
    const btn = $('#sgBtn');
    if (btn) btn.onclick = async () => {
      const name = ($('#sgName').value || '').trim();
      if (name.length < 2) { toast('חסר שם', 'הקלידו שם מלא.', 'err'); return; }
      if (!$('#sgOk').checked) { toast('חסר אישור', 'סמנו שקראתם ואישרתם את ההסכם.', 'err'); return; }
      btn.disabled = true; btn.textContent = 'חותמים...';
      try { const r = await call('sign.submit', { t, name, accept: true }); Object.assign(a, r.agr || {}); bootSign(t); toast('ההסכם נחתם', 'תודה. עותק נשמר במערכת.'); }
      catch (e) { btn.disabled = false; btn.textContent = 'חתימה על ההסכם'; toast('החתימה נכשלה', 'נסו שוב בעוד רגע.', 'err'); }
    };
  }
  L.boot = async function () {
    const u = new URL(location.href);
    if (u.pathname.replace(/\/+$/, '') === '/sign') { $('#app').classList.remove('on'); bootSign(u.searchParams.get('t') || ''); return; }
    const lc = u.searchParams.get('lc');
    if (lc) {
      u.searchParams.delete('lc');
      history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
      loader('נכנסים...');
      try {
        const r = await post(API, { action: 'login.use', payload: { t: lc.trim() } });
        ls.set(SLOT[r.kind], r.token);
        L.token = r.token;
        if (r.kind === 'admin') setPath('/admin');
        await bootWithToken();
      } catch (e) {
        $('#authRoot').innerHTML = '';
        renderAuth(e.status === 400 || e.status === 500 || e.message === 'link_invalid' ? 'הקישור כבר נוצל או שפג תוקפו. הזינו את כתובת הדוא״ל וקבלו קוד כניסה.' : 'אין חיבור לשרת כרגע. רעננו את העמוד בעוד רגע.');
      }
      return;
    }
    const k = u.searchParams.get('k');
    if (k) {
      u.searchParams.delete('k');
      history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
      L.token = k.trim();
    } else {
      L.token = ls.get(isAdminPath() ? SLOT.admin : SLOT.client);
    }
    if (!L.token) { renderAuth(''); return; }
    try {
      await bootWithToken();
    } catch (e) {
      if (e.status === 401) {
        ls.del(isAdminPath() ? SLOT.admin : SLOT.client);
        renderAuth('פג תוקף הכניסה. הזינו את כתובת הדוא״ל וקבלו קוד כניסה.');
      } else {
        console.error('boot failed', e);
        $('#authRoot').innerHTML = '';
        renderAuth('אין חיבור לשרת כרגע. רעננו את העמוד בעוד רגע.');
      }
    }
  };

  /* ---------------- admin: real organisations behind the client list ---------------- */
  function linkRealOrgs(real) {
    ORGS.forEach((o) => {
      const r = real.find((x) => x.ui_id === o.id && x.token) || real.find((x) => !x.ui_id && x.name === o.n && x.token);
      if (r) o.live = { id: r.id, token: r.token };
    });
  }
  /* the console shows the real organisations only: the demo municipalities of the mockup never appear */
  const ROLE_A = { owner: 'הרשאת מנהל (גישה מלאה)', admin: 'הרשאת מנהל (גישה מלאה)', member: 'מחלקה בארגון' };
  function liveAdmin(real) {
    const keep = ['uLim', 'dLim', 'agr', 'add', 'c', 'type', 'ch', 'xch', 'xu', 'st'];
    const seen = new Set();
    const list = real.map((r) => {
      const ext = r.plan !== 'basic';
      let id = r.ui_id ? 'o' + r.ui_id : 'r' + String(r.id).slice(0, 8);
      if (seen.has(id)) id = 'r' + String(r.id).slice(0, 8); // two clients created with the same short id never share one card
      seen.add(id);
      const prev = ORGS.find((o) => o.id === id) || {};
      const cd = r.created ? new Date(r.created) : new Date();
      const o = { id, n: r.name, type: r.otype || 'רשות מקומית', st: r.status === 'active' ? 'active' : 'paused', since: String(cd.getMonth() + 1).padStart(2, '0') + '/' + cd.getFullYear(), plan: ext ? 'appr' : 'solo', rev: null,
        ch: 0, xch: 0, xu: 0, add: [], gfx: 0, docs: 0, decks: 0, vids: 0, ai: 0, logins: 0, items: r.items || 0, last: r.items ? 'פעיל' : '-', cost: PLANS[ext ? 'appr' : 'solo'].cost,
        contact: r.contact || ((r.members || [])[0] || {}).name || '', phone: r.phone || '', mail: r.mail || '', c: '#4A1BE8', uLim: ext ? 5 : 1, dLim: ext ? 5 : 0,
        agr: { start: String(cd.getDate()) + '.' + (cd.getMonth() + 1) + '.' + cd.getFullYear(), term: 'חודשי', signed: false, signedAt: '', signer: r.contact || '' } };
      keep.forEach((k) => { if (prev[k] !== undefined) o[k] = prev[k]; });
      o.live = { id: r.id, token: r.token, sign_token: r.agr && r.agr.sign_token || null };
      o.members = r.members || [];
      o.mainDept = r.main_dept || 'דוברות';
      o.role = r.role || '';
      if (r.agr) {
        const a = r.agr;
        o.agr = { start: a.start || (a.startIso ? heDate(a.startIso) : o.agr.start), startIso: a.startIso || '', endIso: a.endIso || '', term: 'שנתי', trial: !!a.trial, trialEnd: a.trialEnd || '', signed: !!a.signed, signedAt: a.signedAt || '', signer: a.signer || r.contact || '', sign: a.sign || 'digital' };
        const payIso = a.trial && a.trialEnd ? a.trialEnd : (a.startIso || '');
        if (payIso) o.payFrom = +payIso.slice(0, 7).replace('-', '');
        // the trial ends by the calendar unless the admin paused the account
        if (o.st !== 'paused') o.st = a.trial && a.trialEnd && new Date(a.trialEnd) > new Date() ? 'trial' : 'active';
      }
      o.use = r.use || null;
      o.useM = r.useM || {};
      return o;
    });
    replaceAll(ORGS, list);
    Object.keys(PLAN_OF).forEach((k) => delete PLAN_OF[k]);
    list.forEach((o) => { PLAN_OF[o.id] = o.plan; });
    const au = [];
    list.forEach((o) => o.members.forEach((m) => au.push({ id: au.length, org: o.id, use: m.use || null, n: m.name, r: (m.view === 'dept' ? ROLE_A.member : (o.role || ROLE_A[m.role])) || m.role, dept: m.dept || '', items: 0, logins: 0, last: '-', st: 'פעיל', gfx: 0, docs: 0, decks: 0, vids: 0, ai: 0 })));
    replaceAll(AUSERS, au);
    const ids = new Set(list.map((o) => o.id));
    replaceAll(PURCH, PURCH.filter((x) => ids.has(x.org)));
    replaceAll(REQS, REQS.filter((x) => x.liveOrg));
    replaceAll(MEETINGS, MEETINGS.filter((x) => x.liveOrg));
    if (L.admin && ADMINS[0]) { ADMINS[0].n = L.admin.name || ADMINS[0].n; ADMINS[0].mail = L.admin.email || ADMINS[0].mail; ADMINS[0].ph = ''; }
    // the demo's second admin is not part of a live system; admins added here (ids with a timestamp) stay
    replaceAll(ADMINS, ADMINS.filter((a, i) => i === 0 || a.id !== 'ad2'));
  }
  // the master admin's e-mail is saved on the server: it is the only address that gets an admin login link
  const _apSave = ACT.apSave;
  ACT.apSave = async () => {
    const m = ($('#apM') && $('#apM').value || '').trim().toLowerCase();
    if (m && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m)) { toast('דוא״ל לא תקין', 'בדקו את הכתובת.', 'err'); return; }
    const n = ($('#apN') && $('#apN').value || '').trim();
    _apSave();
    if (L.kind !== 'admin') return;
    try { await call('admin.profile.save', { name: n, email: m }); if (L.admin) { if (n) L.admin.name = n; if (m) L.admin.email = m; } toast('נשמר', 'קוד הכניסה לממשק הניהול יישלח לכתובת ' + (m || L.admin.email) + '.'); }
    catch (e) { if (e.message === 'email_not_allowed') toast('הכתובת לא מורשית', 'לממשק הניהול נכנסים רק מכתובות מנהלי PrimeOS.', 'err'); else toast('השמירה בשרת נכשלה', 'נסו שוב בעוד רגע.', 'err'); }
  };
  // links are made by the server when asked: a short entry for the admin, a one-time first-entry link for the client
  const enterLink = async (o, mid) => (await call('admin.enter', { org_id: o.live.id, member_id: mid || undefined })).link;
  const firstLink = async (o, mid) => (await call('admin.invite.link', { org_id: o.live.id, member_id: mid || undefined })).link;
  const copyText = (t, what) => (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast('הקישור הועתק', what || ''), () => openModal('<div class="mb"><h3>העתקה ידנית</h3><input type="text" readonly value="' + esc(t) + '" style="width:100%;direction:ltr" onclick="this.select()"></div><div class="modal-foot"><button class="btn" data-act="closeModal">סגירה</button></div>'));
  const signLinkOf = (o) => (o.live && o.live.sign_token ? location.origin + '/sign?t=' + encodeURIComponent(o.live.sign_token) : '');
  const waNum = (ph) => { let d = String(ph || '').replace(/\D/g, ''); if (d.startsWith('0')) d = '972' + d.slice(1); return d; };
  const waWhy = (st) => (st && st.startsWith('failed:whatsapp') ? (/24-hour|template/i.test(st) ? 'WhatsApp לא נשלח: הודעה יזומה דורשת תבנית מאושרת. שלחו דרך כפתור WhatsApp.' : 'WhatsApp נכשל. שלחו דרך כפתור WhatsApp.') : '');
  ACT.agrSend = async (id) => {
    const o = ORGS.find((x) => x.id === id);
    if (!o || !o.live) { toast('אין קישור', 'הלקוח עדיין לא נשמר בשרת.', 'err'); return; }
    const st = await call('admin.invite.send', { org_id: o.live.id, mail: true, wa: true }).catch(() => null);
    if (!st) { toast('השליחה נכשלה', 'נסו שוב בעוד רגע.', 'err'); return; }
    const ok = [st.mail === 'sent' ? 'מייל' : '', st.wa === 'sent' ? 'WhatsApp' : ''].filter(Boolean).join(' + ');
    toast(ok ? 'נשלח ב' + ok : 'לא נשלח', (ok ? 'קישור הכניסה וההסכם לחתימה נשלחו ל' + o.contact + '. ' : '') + (waWhy(st.wa) || (ok ? '' : 'חסרים דוא״ל או טלפון ללקוח, או שהשליחה נכשלה.')), ok ? '' : 'err');
  };
  ACT.agrLink = (id) => {
    const o = ORGS.find((x) => x.id === id);
    const l = o && signLinkOf(o);
    if (!l) { toast('אין קישור לחתימה', 'ההסכם כבר נחתם או שהלקוח לא נשמר בשרת.', 'err'); return; }
    navigator.clipboard.writeText(l).then(() => toast('הקישור הועתק', 'קישור החתימה של ' + o.n + '.'), () => prompt('קישור לחתימה', l));
  };
  // every user of the client: enter as that user, or copy a one-time first-entry link for them
  function memberLinks(o) {
    const ms = o.members || [];
    const dept = ms.filter((m) => m.role === 'member');
    const rows = ms.map((m) => '<div class="ml-row" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--line-2)">' +
      '<span style="flex:1;min-width:160px"><b>' + esc(m.name) + '</b> <span class="t-sub">' + (m.role === 'member' ? 'מחלקה בארגון' + (m.dept ? ' · ' + esc(m.dept) : '') : 'הרשאת מנהל (גישה מלאה)') + '</span>' + (m.email ? '<br><span class="t-sub" dir="ltr">' + esc(m.email) + '</span>' : '<br><span class="t-sub">אין דוא״ל: המשתמש לא יוכל להיכנס בקוד</span>') + '</span>' +
      '<button class="btn btn-sm" data-act="liveFirst:' + o.id + ':' + esc(m.id) + '">' + ic('copy', 14) + ' קישור כניסה ראשונה</button>' +
      '<button class="btn btn-sm" data-act="liveOpenM:' + o.id + ':' + esc(m.id) + '">' + ic('eye', 14) + ' כניסה כמשתמש</button></div>').join('');
    return '<div style="margin-top:14px"><b style="font-size:13.5px">משתמשים</b>' + rows +
      (dept.length ? '' : '<div class="note" style="margin-top:8px">' + ic('help', 14) + '<span>עדיין אין משתמשי מחלקה. משתמש הארגון פותח אותם מתוך הממשק שלו: צוות והרשאות -> הזמנת משתמש.</span></div>') + '</div>';
  }
  function linkBox(o) {
    return '<div class="card card-pad" style="margin-top:14px;text-align:start"><b style="font-size:13.5px">כניסה ללקוח</b>' +
      '<div class="t-sub" style="margin:4px 0 10px">הלקוח נכנס בכתובת הדוא״ל הרשומה (' + esc(o.mail || 'לא הוזנה') + ') ומקבל קוד. לכניסה הראשונה שולחים קישור חד-פעמי, בתוקף 7 ימים.</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="btn btn-sm btn-primary" data-act="agrSend:' + o.id + '">' + ic('send', 14) + ' שליחת הזמנה (מייל + WhatsApp)</button>' +
      '<button class="btn btn-sm" data-act="liveCopy:' + o.id + '">' + ic('copy', 14) + ' העתקת קישור כניסה ראשונה</button>' +
      '<button class="btn btn-sm" data-act="liveWa:' + o.id + '">' + ic('send', 14) + ' WhatsApp</button>' +
      '<button class="btn btn-sm" data-act="liveOpen:' + o.id + '">' + ic('eye', 14) + ' כניסה למערכת הלקוח</button></div>' +
      memberLinks(o) +
      '<div style="margin-top:14px;display:flex;justify-content:flex-end"><button class="btn btn-sm btn-quiet-bad" data-act="liveDelete:' + o.id + '">' + ic('x', 14) + ' מחיקת הלקוח לצמיתות</button></div></div>';
  }
  ACT.liveFirst = async (arg) => {
    const [id, mid] = String(arg).split(':'); const o = ORGS.find((x) => x.id === id); if (!o || !o.live) return;
    try { copyText(await firstLink(o, mid), 'קישור חד-פעמי, בתוקף 7 ימים'); } catch (e) { toast('לא הצלחנו ליצור קישור', 'נסו שוב בעוד רגע.', 'err'); }
  };
  ACT.liveOpenM = async (arg) => {
    const [id, mid] = String(arg).split(':'); const o = ORGS.find((x) => x.id === id); if (!o || !o.live) return;
    const w = window.open('about:blank', '_blank');
    try { const l = await enterLink(o, mid); if (w) w.location.href = l; else location.href = l; } catch (e) { if (w) w.close(); toast('הכניסה נכשלה', 'נסו שוב בעוד רגע.', 'err'); }
  };
  ACT.liveWa = async (id) => {
    const o = ORGS.find((x) => x.id === id); if (!o || !o.live) return;
    const w = window.open('about:blank', '_blank');
    try {
      const l = await firstLink(o);
      const txt = 'שלום ' + (o.contact || '') + ', נפתח עבור ' + o.n + ' חשבון במערכת PrimeOS.\nקישור לכניסה הראשונה (אישי, לכניסה אחת, בתוקף 7 ימים):\n' + l + (signLinkOf(o) && !(o.agr && o.agr.signed) ? '\n\nהסכם המנוי לחתימה דיגיטלית:\n' + signLinkOf(o) : '') + '\n\nבכניסות הבאות: app.primeos.co.il, מזינים את כתובת הדוא״ל ומקבלים קוד.';
      const u = 'https://wa.me/' + waNum(o.phone) + '?text=' + encodeURIComponent(txt);
      if (w) w.location.href = u; else location.href = u;
    } catch (e) { if (w) w.close(); toast('לא הצלחנו ליצור קישור', 'נסו שוב בעוד רגע.', 'err'); }
  };
  ACT.liveDelete = (id) => {
    const o = ORGS.find((x) => x.id === id);
    if (!o || !o.live) return;
    openModal('<div class="mb"><div class="m-ic bad">' + ic('x', 20) + '</div><h3>למחוק את „' + esc(o.n) + '”?</h3>' +
      '<p>כל התכנים, המשתמשים, הקבצים וקישורי הכניסה של הלקוח יימחקו לצמיתות. אין שחזור.</p>' +
      '<div class="field" style="margin-top:14px"><label for="delTxt">כתבו את שם הלקוח לאישור</label><input type="text" id="delTxt" placeholder="' + esc(o.n) + '"></div></div>' +
      '<div class="modal-foot"><button class="btn btn-quiet-bad is-disabled" id="delOk" disabled>מחיקה לצמיתות</button><button class="btn" id="delCancel">ביטול</button></div>');
    $('#delCancel').onclick = closeModal;
    $('#delTxt').addEventListener('input', (e) => { const ok = e.target.value.trim() === o.n; $('#delOk').classList.toggle('is-disabled', !ok); $('#delOk').disabled = !ok; });
    $('#delOk').onclick = async () => {
      const done = busyBtn('#delOk', 'מוחקים...');
      try {
        await call('admin.org.delete', { org_id: o.live.id });
        const i = ORGS.indexOf(o); if (i >= 0) ORGS.splice(i, 1);
        replaceAll(AUSERS, AUSERS.filter((u) => u.org !== o.id));
        delete PLAN_OF[o.id];
        closeModal(); S.orgId = null; go('a_orgs', { force: true }); flush();
        toast('הלקוח נמחק', o.n);
      } catch (e) { done(); toast('המחיקה נכשלה', e.message === 'demo_protected' ? 'ארגון ההדגמה מוגן.' : 'נסו שוב בעוד רגע.', 'err'); }
    };
  };
  ACT.liveCopy = async (id) => {
    const o = ORGS.find((x) => x.id === id);
    if (!o || !o.live) return;
    try { copyText(await firstLink(o), o.n + ' · קישור חד-פעמי, בתוקף 7 ימים'); } catch (e) { toast('לא הצלחנו ליצור קישור', 'נסו שוב בעוד רגע.', 'err'); }
  };
  ACT.liveOpen = async (id) => {
    const o = ORGS.find((x) => x.id === id); if (!o || !o.live) return;
    const w = window.open('about:blank', '_blank');
    try { const l = await enterLink(o); if (w) w.location.href = l; else location.href = l; } catch (e) { if (w) w.close(); toast('הכניסה נכשלה', 'נסו שוב בעוד רגע.', 'err'); }
  };

  const _imp = ACT.imp;
  ACT.imp = (id) => { const o = ORGS.find((x) => x.id === id); if (o && o.live) { ACT.liveOpen(id); return; } _imp(id); };
  const _impU = ACT.impU;
  ACT.impU = (id) => { const u = AUSERS[+id]; const o = u && ORGS.find((x) => x.id === u.org); if (o && o.live) { ACT.liveOpen(o.id); return; } _impU(id); };

  /* org profile shows the client's login link */
  if (SCREENS.a_org) {
    const _aorg = SCREENS.a_org.render;
    SCREENS.a_org.render = function () {
      const h = _aorg.apply(this, arguments);
      const o = ORGS.find((x) => x.id === S.orgId);
      if (!o || !o.live || (S.tab.aorg && S.tab.aorg !== 'over')) return h;
      return h + linkBox(o);
    };
  }

  /* new client from the setup wizard becomes a real organisation with its own link */
  const _nwNext = ACT.nwNext;
  ACT.nwNext = () => {
    const before = ORGS.length;
    const w0 = S.nw ? JSON.parse(JSON.stringify(S.nw)) : null;
    _nwNext();
    if (ORGS.length <= before || L.kind !== 'admin') return;
    const o = ORGS[ORGS.length - 1];
    o.mainDept = (w0 && w0.depts && w0.depts[0] && w0.depts[0].n.trim()) || 'דוברות';
    o.role = (w0 && w0.admin && w0.admin.role) || '';
    // a unique ui id: the mockup counts rows, live clients keep their own numbers
    const used = ORGS.map((x) => +String(x.id).replace(/^o/, '') || 0);
    const nid = 'o' + (Math.max(0, ...used.filter((n, i) => ORGS[i] !== o)) + 1);
    if (nid !== o.id) {
      const old = o.id; o.id = nid;
      AUSERS.forEach((u) => { if (u.org === old) u.org = nid; });
      PURCH.forEach((x) => { if (x.org === old) x.org = nid; });
      if (PLAN_OF[old] !== undefined) { PLAN_OF[nid] = PLAN_OF[old]; delete PLAN_OF[old]; }
      S.orgId = nid;
      const mb = $('#modalBox .mb');
      if (mb) document.querySelectorAll('#modalBox [data-act="agrView:' + old + '"]').forEach((b) => b.setAttribute('data-act', 'agrView:' + nid));
    }
    const d = new Date();
    o.since = String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
    if (o.agr && o.agr.signed) o.agr.signedAt = d.getDate() + '.' + (d.getMonth() + 1) + '.' + d.getFullYear();
    const agr = Object.assign({}, o.agr, { sign: w0 && w0.agr ? w0.agr.sign : 'digital', uLim: o.uLim, dLim: o.dLim, ch: o.ch, plan: o.plan });
    const depts = (w0 && w0.depts || []).filter((d, i) => i > 0 && d.n && d.n.trim()).map((d) => ({ n: d.n.trim(), ap: (d.ap || '').trim(), ph: (d.ph || '').trim() }));
    call('admin.org.create', { name: o.n, plan: o.plan === 'solo' ? 'basic' : 'extended', contact: o.contact, mail: o.mail, phone: o.phone, otype: o.type, ui_id: o.id, main_dept: o.mainDept, role: o.role, agr, depts })
      .then(async (r) => {
        o.live = { id: r.org_id, token: r.token, sign_token: r.sign_token || null };
        const mb = $('#modalBox .mb');
        if (mb) mb.insertAdjacentHTML('beforeend', linkBox(o));
        if (S.route === 'a_org') render();
        flush();
        const send = (w0 && w0.send) || {};
        if (send.mail || send.wa) {
          const st = await call('admin.invite.send', { org_id: r.org_id, mail: !!send.mail, wa: !!send.wa }).catch(() => ({ mail: 'failed', wa: 'failed' }));
          const line = (k, t) => (st[k] ? '<div>' + (st[k] === 'sent' ? ic('checkc', 14) + ' ' + t + ' נשלח' : st[k].startsWith('skipped') ? ic('alert', 14) + ' ' + t + ' לא נשלח: חסר ' + (k === 'mail' ? 'דוא״ל' : 'טלפון') : ic('alert', 14) + ' ' + (waWhy(st[k]) || t + ' נכשל')) + '</div>' : '');
          const box = $('#modalBox .mb');
          if (box) box.insertAdjacentHTML('beforeend', '<div class="note" style="margin-top:12px;flex-direction:column;align-items:flex-start;gap:4px">' + line('mail', 'המייל') + line('wa', 'ה-WhatsApp') + '</div>');
          else toast('ההזמנה', (st.mail === 'sent' ? 'מייל נשלח. ' : '') + (st.wa === 'sent' ? 'WhatsApp נשלח.' : ''));
        }
      })
      .catch((e) => toast(e && e.message === 'email_in_use_elsewhere' ? 'הלקוח לא נפתח בשרת' : 'הלקוח נשמר', e && e.message === 'email_in_use_elsewhere' ? 'כתובת הדוא״ל כבר משויכת ללקוח אחר. לכל לקוח צריכה להיות כתובת משלו.' : 'יצירת קישור הכניסה נכשלה. נסו שוב מעמוד הלקוח.', 'err'));
  };

  /* ---------------- Claude: shared context ---------------- */
  function aiCtx() {
    const r = (typeof BRAND !== 'undefined' && BRAND.rules) || {};
    return {
      org: L.org ? L.org.name : (S.imp ? S.imp.org : DEMO_NAME),
      dept: (S.wiz && S.wiz.brief && S.wiz.brief.dept) || (isDept() ? S.dept : S.user && S.user.dept) || '',
      tone: r.tone || '',
      good: r.good || [],
      bad: r.bad || [],
      facts: siteFacts(),
    };
  }
  // up-to-date details read from the organisation's website, passed to every generation
  function siteFacts() {
    const st = (typeof BRAND !== 'undefined' && BRAND.site) || null;
    const oi = (typeof BRAND !== 'undefined' && BRAND.orgInfo) || {};
    if (!st || !st.at) return [oi.phone && 'טלפון: ' + oi.phone, oi.email && 'דוא"ל: ' + oi.email, oi.address && 'כתובת: ' + oi.address].filter(Boolean).join('\n');
    const f = st.facts || {}, L2 = [];
    const add = (k, v) => { if (v && String(v).trim()) L2.push(k + ': ' + String(v).trim()); };
    add('שם רשמי', f.name); add('טלפון', f.phone); add('מוקד', f.hotline); add('דוא"ל', f.email); add('כתובת', f.address); add('שעות קבלת קהל', f.hours); add('ראש הארגון', f.mayor); add('אתר', f.site || st.url);
    (st.depts || []).slice(0, 12).forEach((d) => add('מחלקה ' + d.n, [d.phone, d.email].filter(Boolean).join(' · ') || 'קיימת'));
    if ((st.terms || []).length) L2.push('מונחים רשמיים: ' + st.terms.slice(0, 20).join(', '));
    return L2.join('\n');
  }
  const chNames = (list) => (list || []).map((k) => (CH[k] ? CH[k].t : k));

  /* graphic / video wizard: brief -> real text */
  ACT.wizNext = async () => {
    const w = S.wiz;
    collectWiz();
    if (w.step !== 0) { ACT.wizSend(); return; }
    if (!w.brief.title.trim() && !w.brief.free.trim()) { toast('חסר בריף', 'כותרת או בריף, לפחות אחד.', 'err'); return; }
    if (!w.ch.length) { toast('לא נבחרה פלטפורמה', 'בחרו לפחות פלטפורמה אחת.', 'err'); return; }
    const done = busyBtn('[data-act="wizNext"]', 'ה-AI כותב את התוכן...');
    try {
      const r = await gen({ mode: 'post', title: w.brief.title, brief: w.brief.free, dept: w.brief.dept, channels: chNames(w.ch), typeLabel: TYPES[w.type] ? TYPES[w.type].t : 'גרפיקה' });
      if (S.wiz !== w) return;
      w.step = 1;
      w.t = r.title || w.brief.title;
      w.body = r.body || '';
      const tags = (r.tags || []).slice(0, 6);
      w.sugg = [...new Set([...tags, ...suggestTags(w.t, w.brief.dept)])].slice(0, 7);
      w.tags = tags.slice(0, 4);
      w.ver = 1;
      render();
      window.scrollTo({ top: 0 });
    } catch (e) {
      done();
      aiFail(e);
    }
  };
  ACT.genAlt = async () => {
    const w = S.wiz;
    collectWiz();
    const done = busyBtn('[data-act="genAlt"]', 'כותב נוסח חלופי...');
    try {
      const r = await gen({ mode: 'alt', title: w.t, body: w.body, dept: w.brief.dept });
      if (S.wiz !== w) return;
      if (r.body) w.body = r.body;
      render();
      toast('נוסח חלופי', '');
    } catch (e) { done(); aiFail(e); }
  };

  /* AI assistant answers from the live data */
  function assistantContext() {
    if (S.mode === 'admin') {
      return JSON.stringify({
        today: new Date().toISOString().slice(0, 10),
        orgs: ORGS.map((o) => ({ n: o.n, st: OST[o.st] ? OST[o.st].t : o.st, plan: PLANS[o.plan] ? PLANS[o.plan].t : o.plan, cost: o.cost, items: o.items, gfx: o.gfx, docs: o.docs, last: o.last, contact: o.contact })),
        requests: REQS.map((x) => ({ org: (ORGS.find((o) => o.id === x.org) || {}).n || x.orgName, type: x.type, add: x.add, st: x.st, who: x.who, note: x.note })),
        meetings: MEETINGS.map((m) => ({ org: (ORGS.find((o) => o.id === m.org) || {}).n || m.orgName, date: m.date, time: m.time, topic: m.topic, st: m.st })),
      });
    }
    const scope = isDept() ? items.filter((i) => i.d === S.dept) : items;
    return JSON.stringify({
      today: new Date().toISOString().slice(0, 10),
      org: aiCtx().org,
      me: S.user && S.user.name,
      view: VIEW_T[S.view] + (isDept() ? ' · ' + S.dept : ''),
      items: scope.slice(0, 150).map((i) => ({ t: i.t, status: ST[i.s] ? ST[i.s].t : i.s, type: TYPES[i.ty] ? TYPES[i.ty].t : i.ty, dept: i.d, owner: i.o, when: i.pub || '', fix: i.fixnote || undefined, rejected: i.rej || undefined })),
      departments: DEPTS,
      channels: channels.map((c) => ({ ch: CH[c.k] ? CH[c.k].t : c.k, st: c.st, followers: c.fol })),
      users: users.map((u) => ({ n: u.n, role: u.r, dept: u.d, st: u.st })),
      holidays: HOLIDAYS,
      howto: 'הזמנת משתמש: צוות והרשאות. טלפון מורשה: הגדרות ← פרטי המחלקה. יצירת תוכן: יצירת תוכן חדש.',
    });
  }
  const safeHtml = (t) => esc(t).replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>').replace(/\n/g, '<br>');
  aiAsk = function (q) {
    q = (q || '').trim();
    if (!q) return;
    const key = aiKey();
    const log = S.aiLog[key];
    log.push({ a: 0, t: q });
    log.push({ a: 1, t: '<span class="ai-typing"><i></i><i></i><i></i></span>', tmp: 1 });
    aiRender();
    gen({ mode: 'assistant', question: q, context: assistantContext() })
      .then((r) => r.answer)
      .then((a) => safeHtml(a), () => aiAnswer(q))
      .then((html) => {
        const l = S.aiLog[key];
        if (l[l.length - 1] && l[l.length - 1].tmp) l.pop();
        l.push({ a: 1, t: html });
        if (aiKey() === key) aiRender();
      });
  };

  /* designed document: real text inside the approved page layouts */
  const DOC_STYLE_T = { formal: 'רשמי', data: 'גרפים וטבלאות', designed: 'מעוצב' };
  const BAR = /<p class="tl( s)?"><\/p>/g;
  const fill = (h, list, start) => { let i = start || 0; return h.replace(BAR, (m) => (i < list.length ? '<p class="live-tx">' + esc(list[i++]) + '</p>' : m)); };
  const _docPage = docPage;
  docPage = function (w, p) {
    const h = _docPage(w, p);
    if (!w.ai || !w.ai.paras || !w.ai.paras.length) return h;
    const off = p === 0 ? 0 : (_docPage(w, 0).match(BAR) || []).length;
    return fill(h, w.ai.paras, off);
  };
  const _dwGen = ACT.dwGen;
  ACT.dwGen = async () => {
    dwCollect();
    const w = S.dw;
    if (!w.style || w.src !== 'ai') { _dwGen(); return; }
    if (!w.title.trim() && !w.prompt.trim()) { toast('חסר תוכן', 'כתבו כותרת או תיאור חופשי למסמך.', 'err'); return; }
    w.gen = true;
    render();
    try {
      const r = await gen({ mode: 'doc', title: w.title, prompt: w.prompt, styleLabel: DOC_STYLE_T[w.style] || w.style });
      if (S.dw !== w) return;
      w.ai = { title: r.title, paras: r.paras || [] };
      if (!w.title.trim() && r.title) w.title = r.title;
      w.gen = false;
      w.step = 1;
      render();
      window.scrollTo({ top: 0 });
    } catch (e) { w.gen = false; render(); aiFail(e); }
  };
  const _dwSend = ACT.dwSend;
  ACT.dwSend = async () => {
    const w = S.dw;
    const t = $('#dwFix');
    const v = (t && t.value || '').trim();
    if (!w || !w.ai || w.fixKind !== 'content' || !v) { _dwSend(); return; }
    w.busy = true;
    render();
    try {
      const r = await gen({ mode: 'revise', content: { title: docTitle(w), paras: w.ai.paras }, instruction: v });
      if (S.dw !== w) return;
      if (r.content && Array.isArray(r.content.paras)) w.ai.paras = r.content.paras;
      if (r.content && r.content.title) w.title = r.content.title;
      w.busy = false;
      w.ver++;
      w.fixes.push({ k: 'content', t: v, v: w.ver });
      render();
      toast('המסמך עודכן', 'גרסה ' + w.ver);
    } catch (e) { w.busy = false; render(); aiFail(e); }
  };
  const _dwDone = ACT.dwDone;
  ACT.dwDone = (st) => {
    const w = S.dw;
    _dwDone(st);
    const it = items[0];
    if (w && w.ai && it && it.ty === 'doc') { it.body = (w.ai.paras || []).join('\n'); it.ai = w.ai; }
  };

  /* presentation: real slide titles and points */
  const _slideHtml = slideHtml;
  slideHtml = function (w, s, i, mini) {
    const h = _slideHtml(w, s, i, mini);
    return s.pts && s.pts.length && !mini ? fill(h, s.pts, 0) : h;
  };
  const _dkGen = ACT.dkGen;
  ACT.dkGen = async () => {
    dkCollect();
    const w = S.dk;
    if (w.src !== 'ai' || !w.style) { _dkGen(); return; }
    if (!w.title.trim() && !w.prompt.trim()) { toast('חסר תוכן', 'כתבו כותרת או תיאור חופשי למצגת.', 'err'); return; }
    w.slides = mkSlides(w.pages);
    w.cur = 0;
    w.fixKind = dkKinds(w)[0];
    w.gen = true;
    render();
    try {
      const r = await gen({ mode: 'deck', title: w.title, prompt: w.prompt, pages: w.pages });
      if (S.dk !== w) return;
      const sl = r.slides || [];
      w.slides.forEach((s, i) => { if (sl[i]) { if (i > 0 && sl[i].t) s.t = sl[i].t; s.pts = sl[i].pts || []; } });
      if (!w.title.trim() && r.title) w.title = r.title;
      w.ai = true;
      w.gen = false;
      w.step = 1;
      render();
      window.scrollTo({ top: 0 });
    } catch (e) { w.gen = false; render(); aiFail(e); }
  };
  const _dkSend = ACT.dkSend;
  ACT.dkSend = async () => {
    const w = S.dk;
    const s = w && w.slides[w.cur];
    const t = $('#dkFix');
    const v = (t && t.value || '').trim();
    if (!w || !w.ai || !s || w.fixKind !== 'content' || !v) { _dkSend(); return; }
    s.busy = true;
    render();
    try {
      const r = await gen({ mode: 'revise', content: { t: w.cur === 0 ? dkTitle(w) : s.t, pts: s.pts || [] }, instruction: v });
      if (S.dk !== w) return;
      if (r.content) { if (w.cur === 0 && r.content.t) w.title = r.content.t; else if (r.content.t) s.t = r.content.t; if (Array.isArray(r.content.pts)) s.pts = r.content.pts; }
      s.busy = false;
      s.ver++;
      s.fixes.push({ k: 'content', t: v, v: s.ver });
      render();
      toast('עמוד ' + (w.cur + 1) + ' עודכן', 'גרסה ' + s.ver);
    } catch (e) { s.busy = false; render(); aiFail(e); }
  };
  const _dkDone = ACT.dkDone;
  ACT.dkDone = (st) => {
    const w = S.dk;
    _dkDone(st);
    const it = items[0];
    if (w && w.ai && it && it.ty === 'deck') { it.body = w.slides.map((s, i) => (i === 0 ? dkTitle(w) : s.t) + ((s.pts || []).length ? ': ' + s.pts.join(' · ') : '')).join('\n'); it.slides = w.slides.map((s) => ({ t: s.t, pts: s.pts || [] })); }
  };

  /* =====================================================================
   * REAL PRODUCTION: AI images (ChatGPT) + the render engine (graphic / doc / deck / video)
   * ===================================================================== */
  // palette roles shared with the render service and the edge functions (filled by scripts/sync-design.mjs)
  const PAL = (() => {
/* @palette-start */
const hex = (s) => /^#[0-9a-f]{6}$/i.test(String(s || '')) ? String(s).toUpperCase() : null;
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (r, g, b) => '#' + [r, g, b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('').toUpperCase();
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = (h) => { const [r, g, b] = rgb(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const sat = (h) => { const [r, g, b] = rgb(h); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx ? (mx - mn) / mx : 0; };
const hue = (h) => { const [r, g, b] = rgb(h).map((x) => x / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; let hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return hh * 60; };
const hueDist = (a, b) => { const d = Math.abs(hue(a) - hue(b)) % 360; return d > 180 ? 360 - d : d; };
const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return toHex(...x.map((v, i) => v + (y[i] - v) * t)); };
const darken = (h, target) => { let c = h; for (let i = 0; i < 40 && lum(c) > target; i++) c = mix(c, '#06101F', 0.08); return c; };
const lighten = (h, target) => { let c = h; for (let i = 0; i < 40 && lum(c) < target; i++) c = mix(c, '#FFFFFF', 0.1); return c; };

/**
 * colors: array of hex strings or [name, hex] pairs (the organisation's list, logo colours first).
 * roles (optional): explicit overrides { base, secondary, accent, light } saved by the organisation.
 * Returns { base, deep, secondary, accent, light, ink, mode } - mode: 'light' ground by default.
 */
function paletteRoles(colors = [], roles = {}) {
  const list = [...new Set((Array.isArray(colors) ? colors : []).map((c) => hex(Array.isArray(c) ? c[1] : c)).filter(Boolean))];
  const R = {};
  for (const k of ['base', 'secondary', 'accent', 'light']) if (hex(roles && roles[k])) R[k] = hex(roles[k]);
  if (!list.length && !R.base) list.push('#0E3B6B', '#9A6B1F', '#1E6BA8');
  const chroma = list.filter((c) => sat(c) >= 0.25).sort((a, b) => sat(b) - sat(a));
  const dark = list.filter((c) => lum(c) < 0.12);
  // base: the darkest colour that still carries a hue; otherwise the most saturated colour taken down to a deep tone
  if (!R.base) {
    const cand = dark.filter((c) => sat(c) >= 0.2).sort((a, b) => lum(a) - lum(b));
    R.base = cand[0] ? (lum(cand[0]) < 0.02 ? mix(cand[0], '#FFFFFF', 0.12) : cand[0]) : chroma[0] ? darken(chroma[0], 0.06) : dark[0] || '#0E3B6B';
  }
  // accent: the most saturated colour far enough in hue (or in lightness) from the base
  if (!R.accent) {
    const cand = chroma.filter((c) => c !== R.base && (hueDist(c, R.base) > 25 || lum(c) > 0.2)).sort((a, b) => sat(b) * (0.5 + lum(b)) - sat(a) * (0.5 + lum(a)));
    R.accent = cand[0] || (chroma[0] && chroma[0] !== R.base ? chroma[0] : lighten(R.base, 0.3));
  }
  // secondary: another hue, else a mid tone of the base
  if (!R.secondary) {
    const cand = chroma.filter((c) => c !== R.base && c !== R.accent && hueDist(c, R.accent) > 25).sort((a, b) => Math.abs(lum(a) - 0.18) - Math.abs(lum(b) - 0.18));
    R.secondary = cand[0] || mix(R.base, '#FFFFFF', 0.35);
  }
  if (!R.light) {
    const cand = list.filter((c) => lum(c) > 0.85 && sat(c) < 0.25);
    R.light = cand[0] || mix(R.base, '#FFFFFF', 0.94);
  }
  // the accent must read against the light ground when used for type; otherwise type uses the base and the accent stays a shape colour
  const accentOnLight = contrast(R.accent, R.light) >= 3;
  return {
    base: R.base, deep: darken(R.base, Math.max(0.01, lum(R.base) * 0.55)), secondary: R.secondary, accent: R.accent, light: R.light,
    ink: mix(R.base, '#41506A', 0.6), accentText: accentOnLight ? R.accent : R.base, accentOnLight,
    // whether the organisation's own first colour is a light/neon one (a sign the logo is colourful; the base was derived)
    derivedBase: !(roles && hex(roles.base)) && !dark.some((c) => c === R.base),
  };
}

/** Colours for the video engine (Remotion plan.brand.colors): the dark base as main, its deep tone, one accent, a light tint. */
function videoColors(colors = [], roles = {}) {
  const r = paletteRoles(colors, roles);
  let accent = r.accent;
  if (lum(accent) < 0.12) accent = mix(accent, '#FFFFFF', 0.45);
  return { deep: r.deep, main: r.base, accent, light: mix(r.base, '#FFFFFF', 0.72) };
}

/**
 * Roles for printed matter (documents, decks). A vivid or neon brand colour is wrong as the main colour of a page:
 * the base becomes the strongest dark colour of the brand (dark blue preferred), structural accents are muted,
 * and the vivid colour survives only as `hot` for a few small highlights (rules, bullets, one number).
 */
function printRoles(colors = [], roles = {}) {
  const r = paletteRoles(colors, roles);
  const list = [...new Set((Array.isArray(colors) ? colors : []).map((c) => hex(Array.isArray(c) ? c[1] : c)).filter(Boolean))];
  const vivid = (c) => sat(c) > 0.55 && lum(c) > 0.35;
  const blueish = (c) => { const h = hue(c); return h >= 190 && h <= 262; };
  let base = hex(roles && roles.docBase) || null;
  if (!base) {
    // strong dark candidates: any saturated colour taken down to a deep tone; blues first, then the derived base
    const cand = list.filter((c) => sat(c) >= 0.35 && !vivid(c) || blueish(c) && sat(c) >= 0.5).map((c) => darken(c, 0.07));
    const blue = cand.find(blueish);
    base = blue || (vivid(r.base) ? darken(r.base, 0.07) : r.base);
  }
  const hot = r.accent;
  const accent = vivid(hot) ? (r.secondary && !vivid(r.secondary) && lum(r.secondary) < 0.35 ? r.secondary : mix(hot, base, 0.55)) : hot;
  // a light ground tinted toward the vivid colour (lime, pink) is wrong on a page: a near-white tint of the base instead
  const light = sat(r.light) > 0.04 && hueDist(r.light, base) > 40 ? mix(base, '#FFFFFF', 0.94) : r.light;
  return { base, deep: darken(base, Math.max(0.01, lum(base) * 0.55)), secondary: vivid(r.secondary) ? mix(r.secondary, base, 0.4) : r.secondary, accent, hot, light, ink: mix(base, '#41506A', 0.6), accentText: contrast(accent, light) >= 3 ? accent : base };
}
/* @palette-end */
    return { paletteRoles, videoColors, lum, mix, contrast };
  })();
  const FN_URL = 'https://tgropjisnheppsxejfdn.supabase.co/functions/v1/';
  const fx = (name, body, ms) => post(FN_URL + name, body, ms || 150000);
  // period content (many graphics at once) uses OpenAI's fast model; single graphics use the server default (the precision model)
  const FAST_IMG = 'gpt-image-2.5-flare';
  const FMT_K = { '1:1': '1x1', '4:5': '4x5', '9:16': '9x16', '16:9': '16x9', '1.91:1': '191x1' };
  const IMG_SIZE = (f) => (f === '4:5' || f === '9:16' ? 'portrait' : f === '16:9' || f === '1.91:1' ? 'landscape' : 'square');
  const LAY = [
    ['ai', 'עיצוב AI חופשי', 0],
    ['photo', 'תמונה מלאה', 1], ['frame', 'מסגרת ממלכתית', 1], ['split', 'תמונה ופאנל', 1], ['greeting', 'ברכה', 1],
    ['official', 'רשמי', 0], ['notice', 'הודעה דחופה', 0], ['stat', 'נתון מרכזי', 0], ['editorial', 'בהיר מערכתי', 0],
  ];
  const needsImg = (l) => !!(LAY.find((x) => x[0] === l) || [])[2];
  // the ten design styles (ids match supabase/functions/_shared/design.ts); PrimeOS picks one per graphic, the user may change it
  const STYLE_HE = { documentary: 'דוקומנטרי', official: 'רשמי וחד', comic: 'קומי', satire: 'סאטירי', marketing: 'שיווקי', info: 'אינפורמטיבי', representative: 'ייצוגי', light: 'קל וזורם', service: 'הודעת שירות', editorial: 'Editorial' };
  const styleHe = (id) => STYLE_HE[id] || STYLE_HE.official;
  const qaHtml = (qa) => (qa && typeof qa.score === 'number' ? '<span class="qa-pill' + (qa.score >= 80 ? ' ok' : qa.score >= 70 ? ' mid' : ' low') + '" title="' + esc((qa.issues || []).join(' · ')) + '">ציון איכות ' + qa.score + '</span>' : '');
  // 'ai' = free design in the brand colours; 'tpl:<id>' = the organisation's own template, only texts and imagery change
  const isAiLay = (l) => l === 'ai' || /^tpl:/.test(String(l || ''));
  const tplOf = (l) => { const id = /^tpl:(.+)$/.exec(String(l || '')); return id ? ((typeof BRAND !== 'undefined' && BRAND.tpls) || []).find((t) => t.url && String(t.id) === id[1]) || null : null; };
  function brandFor(dept) {
    const c = (typeof BRAND !== 'undefined' && BRAND.colors) || [];
    return { org: aiCtx().org, dept: dept || aiCtx().dept || '', colors: c.map((x) => (Array.isArray(x) ? x[1] : x)), roles: (typeof BRAND !== 'undefined' && BRAND.roles) || {} };
  }
  async function aiImage(o) {
    const r = await fx('image', { brief: o.brief || '', title: o.title || '', dept: o.dept || '', people: o.people || 'auto', style: o.style || 'photo', size: o.size || 'square', quality: o.quality || 'high', model: o.model || undefined, colors: brandFor(o.dept).colors, cutout: !!o.cutout }, 150000);
    return r.url;
  }
  /* a photo for every slide of a presentation (fast image model, medium quality); reused by slide title between re-renders */
  async function deckImages(w, m, d) {
    const sl = d.slides || [];
    m.imgBy = m.imgBy || {};
    // cover / end / quote get a wide atmosphere photo; content slides get a cutout figure (transparent PNG) that stands beside the text
    const full = (s, i) => i === 0 || s.kind === 'end' || s.kind === 'quote' || s.kind === 'cover';
    const keyOf = (s, i) => (s.kind || 'b') + '|' + (full(s, i) ? 'f' : 'c') + '|' + (i === 0 ? (d.title || s.t || '') : (s.t || '')) + '|' + ((s.pts || []).slice(0, 2).join(' '));
    const briefOf = (s, i) => ((m.imgNote && m.imgNote[i]) ? m.imgNote[i] + '\n' : '') + (i === 0 ? 'תמונת שער רחבה ואווירתית למצגת: ' + (d.title || w.title) : s.kind === 'end' ? 'תמונת סיום חמה ואופטימית למצגת: ' + (d.title || w.title) : 'תמונה שמלווה את השקף "' + (s.t || '') + '": ' + (s.pts || []).slice(0, 3).join('. ')) + '\n' + (w.prompt || '');
    const todo = sl.map((s, i) => [s, i]).filter(([s, i]) => !m.imgBy[keyOf(s, i)]);
    // up to 4 images at a time
    let at = 0;
    const worker = async () => { while (at < todo.length) { const [s, i] = todo[at++]; try { m.imgBy[keyOf(s, i)] = full(s, i) ? await aiImage({ title: w.title, brief: briefOf(s, i), size: 'landscape', quality: 'medium', model: FAST_IMG }) : await aiImage({ title: w.title, brief: 'דמות או אובייקט שממחישים את השקף "' + (s.t || '') + '": ' + (s.pts || []).slice(0, 3).join('. '), size: 'portrait', quality: 'medium', model: FAST_IMG, cutout: true }); } catch (e) { /* that slide stays without a photo */ } } };
    await Promise.all(Array.from({ length: Math.min(4, todo.length) }, worker));
    const out = {};
    sl.forEach((s, i) => { const u = m.imgBy[keyOf(s, i)]; if (u) out['s' + i] = u; });
    if (out.s0) out.cover = out.s0;
    return out;
  }
  async function produce(jobs, dept) {
    // the subscription quota counts one output per wizard: re-renders of the same draft (fixes) are free
    const w = S.wiz || S.dw || S.dk;
    if (w) { w._ref = w._ref || 'wiz:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); jobs.forEach((j) => { j.ref = j.ref || w._ref; }); }
    // the render service derives the colour roles itself (dark base, accent, light ground) from the brand list
    return fx('produce', { brand: brandFor(dept), jobs }, 150000);
  }
  // async renders (video): poll the result file until it exists
  function waitFile(url, maxMs) {
    const t0 = Date.now();
    return new Promise((res, rej) => {
      const tick = () => fetch(url + '?t=' + Date.now(), { method: 'HEAD', cache: 'no-store' })
        .then((r) => (r.ok ? res(url) : Date.now() - t0 > (maxMs || 300000) ? rej(new Error('timeout')) : setTimeout(tick, 5000)))
        .catch(() => (Date.now() - t0 > (maxMs || 300000) ? rej(new Error('timeout')) : setTimeout(tick, 5000)));
      setTimeout(tick, 15000);
    });
  }
  const css = document.createElement('style');
  css.textContent = `
.auth-mlogo{display:none;align-items:center;gap:10px;margin-bottom:18px}.auth-mlogo img{width:44px;height:auto}.auth-mlogo b{font-size:22px;font-weight:800;font-style:italic;color:#0124C7}
@media(max-width:900px){.auth-mlogo{display:flex}}
.chan-logo:has(>svg.chi){background:#fff!important;border:1px solid #E3E8F0;box-shadow:0 6px 14px -8px rgba(9,36,101,.35)}
.chan-logo>svg.chi{width:62%;height:62%;display:block}
.ch-dot>svg.chi{width:70%;height:70%;display:block}
.ch-dot:has(>svg.chi){background:#fff}
.ch-row.off .chan-logo:has(>svg.chi){filter:none}
.brief-grid{grid-template-columns:minmax(0,1fr)}.brief-grid>*{min-width:0}
@media (max-width:420px){#view .sup-meet,#view div:has(>[data-act^="apprAdd"]),#view div:has(>[data-act^="toastInfo:לכל מחלקה"]){flex-wrap:wrap}#view .sup-meet>.btn{margin-inline-start:0}}
@media (max-width:420px){.brief-card{padding:18px 14px}.plat-pick{grid-template-columns:repeat(2,minmax(0,1fr))!important}.plat-pick .plat{min-width:0;padding:0 8px;gap:6px;font-size:13px}.plat-pick .plat span:not(.chan-logo):not(.pk){overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.fmt-pick{grid-template-columns:repeat(2,minmax(0,1fr))!important}.fmt-pick .fmt{min-width:0}}
@media (max-width:1320px){.wa-grid{grid-template-columns:minmax(220px,280px) minmax(0,1fr)!important}.wa-grid>:nth-child(3){grid-column:1/-1}}
@media (max-width:900px){.wa-grid{grid-template-columns:1fr!important}}
.sp-img.has-real,.pimg.has-real{position:relative;overflow:hidden;background:#E6EBF2;padding:0}
.sp-img.has-real>*:not(.sp-real):not(.sp-mb),.pimg.has-real>*:not(.sp-real){display:none!important}
.sp-real{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
video.sp-real{object-fit:contain;background:#0A2C51}
.sp-mb{position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:rgba(10,44,81,.62);color:#fff;font-weight:700;font-size:14px;text-align:center;padding:16px}
.sp-mb .pth-orb{--s:68px}.sp-mb .pth-ph{color:#fff;font-size:14px;max-width:260px}
.g-style select{font:inherit;font-size:13px;padding:3px 8px;border:1px solid #DDE3EC;border-radius:8px;background:#fff}
.qa-pill{display:inline-block;font-size:11.5px;font-weight:700;padding:1px 8px;border-radius:999px;background:#E6EBF2;color:#41506A;vertical-align:middle}.qa-pill.ok{background:#E3F5EB;color:#0A6C43}.qa-pill.mid{background:#FFF3DD;color:#9A5B00}.qa-pill.low{background:#FDE8E8;color:#9B1C1C}
.lay-pick{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-bottom:10px}
.lay-pick button{border:1.5px solid var(--line,#DDE3EC);background:#fff;border-radius:10px;padding:8px 4px;font:inherit;font-size:12.5px;font-weight:600;color:var(--ink-2,#41506A);cursor:pointer;line-height:1.25}
.lay-pick button.on{border-color:var(--brand,#0E3B6B);background:var(--brand,#0E3B6B);color:#fff}
.lay-pick button:disabled{opacity:.5;cursor:default}
.real-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.real-acts a{text-decoration:none}
.thumb.has-real{background-size:cover!important;background-position:center!important}
.thumb.has-real .tt{display:none}
#modalBox{max-height:calc(100dvh - 32px);overflow-y:auto;overscroll-behavior:contain}
#modalBox .modal-foot{position:sticky;bottom:0;z-index:2;flex-wrap:wrap}
@media (max-width:560px){.modal{padding:10px!important}#modalBox .mb{padding:18px 16px 14px}#modalBox .modal-foot{padding:12px 14px}#modalBox .modal-foot .btn{flex:1 1 calc(50% - 6px);justify-content:center;min-height:46px}}
@media (max-width:520px){.lay-pick{grid-template-columns:repeat(2,minmax(0,1fr))}}`;
  document.head.appendChild(css);

  /* ---------- previews everywhere: the real file replaces the placeholder ---------- */
  const realThumb = (m) => (m && (m.thumb || (m.kind === 'graphic' ? m.url : ''))) || '';
  function realTag(m) {
    if (!m) return '';
    if (m.kind === 'video' && m.url && m.ready) return '<video class="sp-real" src="' + esc(m.url) + '"' + (m.thumb ? ' poster="' + esc(m.thumb) + '"' : '') + ' controls playsinline muted preload="metadata"></video>';
    const t = realThumb(m);
    return t ? '<img class="sp-real" src="' + esc(t) + '" alt="">' : '';
  }
  const _sp = studioPreview;
  studioPreview = function (o) {
    let h = _sp(o);
    const w = S.route === 'wizard' && S.wiz ? S.wiz : null;
    const m = o.media || (w && w.media) || (S.route === 'bulkReview' && typeof campMediaNow === 'function' ? campMediaNow() : null);
    if (!m || (!realTag(m) && !m.busy)) return h;
    const busy = m.busy ? '<span class="sp-mb">' + thinkBox() + '</span>' : '';
    return h.replace(/<div class="sp-img thumb([^"]*)" id="spImg">/, '<div class="sp-img thumb$1 has-real" id="spImg">' + realTag(m) + busy);
  };
  const _pp = postPreview;
  postPreview = function (it, ratio) {
    const h = _pp(it, ratio);
    const tag = realTag(it && it.media);
    if (!tag) return h;
    const ar = it.media.ar || '1/1', q = ar.split('/').map(Number), maxW = Math.round(470 * (q[0] / (q[1] || 1)));
    return h.replace('<div class="pimg">', '<div class="pimg has-real" style="aspect-ratio:' + ar + ';width:min(100%,' + maxW + 'px);margin-inline:auto">' + tag);
  };
  const _cc = ccCard;
  ccCard = function (i, first) {
    const h = _cc(i, first);
    const t = realThumb(i.media);
    return t ? h.replace('<div class="thumb ' + (i.th || '') + '">', '<div class="thumb ' + (i.th || '') + ' has-real" style="background:url(\'' + esc(t) + '\')">') : h;
  };
  const AR = { '1:1': '1/1', '4:5': '4/5', '9:16': '9/16', '16:9': '16/9', '1.91:1': '1.91/1', A4: '210/297' };

  /* ---------- graphic studio ---------- */
  const isGfx = (w) => w && w.type === 'graphic' && !w.vmeta;
  function gfxData(w) {
    const d = w.design || {};
    return { kicker: d.kicker || '', headline: w.t || d.headline || '', sub: d.sub || '', details: d.details || [], cta: d.cta || '', stat: d.stat, sign: d.sign, image: w.media && w.media.image };
  }
  async function gfxRun(w, opts) {
    opts = opts || {};
    const m = (w.media = w.media || { kind: 'graphic', layout: w.lay0 || 'photo' });
    if (opts.layout) m.layout = opts.layout;
    const fmt = w.fmt || (w.fmts && w.fmts[0]) || '1:1';
    const job = ++m.job || (m.job = 1);
    if (isAiLay(m.layout)) return aiDesignRun(w, m, fmt, job, opts);
    try {
      if (needsImg(m.layout) && (!m.image || opts.newImage || (m.imgSize && m.imgSize !== IMG_SIZE(fmt) && opts.fit))) {
        m.busy = 'ChatGPT יוצר תמונת אווירה...';
        render();
        const extra = opts.imageNote ? '\nבקשת שינוי לתמונה: ' + opts.imageNote : '';
        m.image = await aiImage({ title: w.t || w.brief.title, brief: (w.brief.free || '') + extra, dept: w.brief.dept, size: IMG_SIZE(fmt) });
        m.imgSize = IMG_SIZE(fmt);
        if (S.wiz !== w || m.job !== job) return;
      }
      m.busy = 'מעצבים את הגרפיקה...';
      render();
      const r = await produce([{ id: 'g', kind: 'graphic', layout: m.layout, format: FMT_K[fmt] || '1x1', data: gfxData(w), thumb: false }], w.brief.dept);
      if (S.wiz !== w || m.job !== job) return;
      const x = (r.results || [])[0];
      if (!x || !x.ok) throw new Error((x && x.error) || 'render_failed');
      m.url = x.urls.main;
      m.fmt = fmt;
      m.ar = AR[fmt] || '1/1';
      m.busy = '';
      w.ver = (w.ver || 1) + (opts.first ? 0 : 1);
      render();
    } catch (e) {
      if (S.wiz !== w || m.job !== job) return;
      m.busy = '';
      if (needsImg(m.layout) && !m.image) { m.layout = 'official'; render(); toast('לא התקבלה תמונה', 'עברנו לפריסה רשמית בלי תמונה. אפשר לבחור שוב פריסה עם תמונה.', 'err'); gfxRun(w); return; }
      render();
      toast('העיצוב לא הושלם', 'נסו שוב בעוד רגע.', 'err');
    }
  }
  // first layout: an image layout for events and calls, the alert layout for disruptions, the stat layout when a number leads
  function pickLayout(d, brief) {
    const w = S.wiz;
    if (w && w.tpl0 && tplOf('tpl:' + w.tpl0)) return 'tpl:' + w.tpl0;
    return 'ai';
  }
  function pickTemplate(d, brief) {
    const tx = [d.kicker, d.headline, d.sub, brief].join(' ');
    if (/הפסק|תקל|סגיר|חסימ|אזהר|דחוף|שיבוש/.test(tx)) return 'notice';
    if (/חג |חג$|ברכ|שנה טובה|חנוכה|פסח|סוכות|פורים|עצמאות/.test(tx)) return 'greeting';
    return 'photo';
  }
  ACT.wizNext = async () => {
    const w = S.wiz;
    collectWiz();
    if (w.step !== 0) { ACT.wizSend(); return; }
    if (!w.brief.title.trim() && !w.brief.free.trim()) { toast('חסר בריף', 'כותרת או בריף, לפחות אחד.', 'err'); return; }
    if (!w.ch.length) { toast('לא נבחרה פלטפורמה', 'בחרו לפחות פלטפורמה אחת.', 'err'); return; }
    const done = busyBtn('[data-act="wizNext"]', 'ה-AI כותב את התוכן...');
    try {
      const gfx = isGfx(w);
      const r = gfx && w.carousel
        ? await gen({ mode: 'carousel', slides: w.carousel, title: w.brief.title, brief: w.brief.free, dept: w.brief.dept, files: briefFiles(w) })
        : gfx
        ? await gen({ mode: 'graphic', title: w.brief.title, brief: w.brief.free, dept: w.brief.dept, files: briefFiles(w) })
        : await gen({ mode: 'post', title: w.brief.title, brief: w.brief.free, dept: w.brief.dept, channels: chNames(w.ch), typeLabel: TYPES[w.type] ? TYPES[w.type].t : 'גרפיקה' });
      if (S.wiz !== w) return;
      w.step = 1;
      if (gfx && w.carousel) { const s0 = (r.slides || [])[0] || {}; Object.assign(r, s0, { headline: s0.headline, caption: r.caption, tags: r.tags, style: r.style, palette: r.palette, styleWhy: r.styleWhy }); w.slides = r.slides || []; }
      w.t = (gfx ? r.headline : r.title) || w.brief.title;
      w.body = (gfx ? r.caption : r.body) || '';
      const tags = (r.tags || []).slice(0, 6);
      w.sugg = [...new Set([...tags, ...suggestTags(w.t, w.brief.dept)])].slice(0, 7);
      w.tags = tags.slice(0, 4);
      w.ver = 1;
      if (gfx) {
        w.design = { kicker: r.kicker || '', sub: r.sub || '', details: r.details || [], cta: r.cta || '', keyword: r.keyword || '', icons: Array.isArray(r.icons) ? r.icons.filter((x) => x && x.label).slice(0, 4) : [], style: r.style || 'official', palette: r.palette || '', styleWhy: r.styleWhy || '' };
        w.media = { kind: 'graphic', layout: pickLayout(r, w.brief.free) };
      }
      render();
      window.scrollTo({ top: 0 });
      if (gfx) gfxRun(w, { first: true });
    } catch (e) {
      done();
      aiFail(e);
    }
  };
  // design section: layouts, AI edit, new image, download
  const _aiBox = aiBox;
  aiBox = function (prefix) {
    const w = S.wiz;
    if (prefix !== 'w' || S.route !== 'wizard' || !isGfx(w) || !w.media) return _aiBox(prefix);
    const m = w.media, busy = !!m.busy;
    return '<div class="lay-pick" role="radiogroup" aria-label="פריסה">' + LAY.map((l) => '<button class="' + (m.layout === l[0] ? 'on' : '') + '" data-act="gLay:' + l[0] + '"' + (busy ? ' disabled' : '') + ' role="radio" aria-checked="' + (m.layout === l[0]) + '">' + l[1] + '</button>').join('') + '</div>' +
      _aiBox(prefix) +
      '<div class="real-acts">' + (needsImg(m.layout) ? '<button class="btn btn-sm" data-act="gImg"' + (busy ? ' disabled' : '') + '>' + ic('refresh', 14) + ' תמונה חדשה</button>' : '') +
      (m.url ? '<a class="btn btn-sm" href="' + esc(m.url) + '" target="_blank" rel="noopener">' + ic('down', 14) + ' הורדת הקובץ</a>' : '') + '</div>';
  };
  ACT.gLay = (l) => { const w = S.wiz; if (!isGfx(w) || !w.media || w.media.busy) return; collectWiz(); w.media.layout = l; gfxRun(w, { layout: l }); };
  ACT.gImg = () => { const w = S.wiz; if (!isGfx(w) || !w.media || w.media.busy) return; collectWiz(); gfxRun(w, { newImage: true }); };
  const IMG_WORDS = /תמונ|רקע|צילום|איור|דמו|אנשים|ילד|נוף|צבע/;
  async function gfxEdit(w, q) {
    const m = w.media;
    if (/פריסה אחרת/.test(q)) { const i = LAY.findIndex((l) => l[0] === m.layout); return gfxRun(w, { layout: LAY[(i + 1) % LAY.length][0] }); }
    if (/סגנון רשמי/.test(q)) return gfxRun(w, { layout: m.layout === 'official' ? 'frame' : 'official' });
    if (/צבעוני יותר/.test(q)) return gfxRun(w, { layout: needsImg(m.layout) ? m.layout : 'photo', newImage: needsImg(m.layout), imageNote: 'צבעים חמים ועשירים יותר, יותר אור' });
    m.busy = 'ה-AI מעדכן את הטקסטים...';
    render();
    try {
      const big = /כותרת גדולה/.test(q) ? 'קצר את הכותרת ל-2 או 3 מילים חזקות, כדי שתופיע גדולה יותר.' : q;
      const cur = { headline: w.t, kicker: w.design.kicker, sub: w.design.sub, details: w.design.details, cta: w.design.cta };
      const r = await gen({ mode: 'revise', content: cur, instruction: big + '\nאם הבקשה נוגעת רק לתמונה, החזר את הטקסטים בלי שינוי.' });
      if (S.wiz !== w) return;
      const c = r.content || {};
      if (c.headline) w.t = c.headline;
      ['kicker', 'sub', 'cta'].forEach((k) => { if (typeof c[k] === 'string') w.design[k] = c[k]; });
      if (Array.isArray(c.details)) w.design.details = c.details;
      m.busy = '';
      gfxRun(w, IMG_WORDS.test(q) && needsImg(m.layout) ? { newImage: true, imageNote: q } : {});
    } catch (e) { m.busy = ''; render(); aiFail(e); }
  }
  const _wAi = ACT.wAi, _wAiQ = ACT.wAiQ;
  ACT.wAi = () => {
    const w = S.wiz;
    if (!isGfx(w) || !w.media) return _wAi && _wAi();
    collectWiz();
    const el = $('#wAi'); const q = (el && el.value || '').trim();
    if (!q) { toast('מה לשנות?', 'כתבו בקשה קצרה, לדוגמה: כותרת קצרה יותר או תמונה של שקיעה.', 'err'); return; }
    if (w.media.busy) return;
    gfxEdit(w, q);
  };
  ACT.wAiQ = (q) => {
    const w = S.wiz;
    if (!isGfx(w) || !w.media) return _wAiQ && _wAiQ(q);
    collectWiz();
    if (w.media.busy) return;
    gfxEdit(w, q);
  };
  // size change and title edits re-render the real file
  const _wFmt = ACT.wFmt;
  ACT.wFmt = (k) => { _wFmt(k); const w = S.wiz; if (isGfx(w) && w.media && w.step === 1) gfxRun(w, { fit: true }); };
  let tmr = null;
  const _wizMountL = SCREENS.wizard.mount;
  SCREENS.wizard.mount = function () {
    _wizMountL && _wizMountL.call(this);
    const w = S.wiz;
    if (!isGfx(w) || w.step !== 1) return;
    const t = $('#sTitle');
    if (t) t.addEventListener('change', () => {
      if (!w.media || w.media.busy) return;
      if (isAiLay(w.media.layout)) { w.media.stale = true; w.media.staleWhy = ''; render(); return; }
      clearTimeout(tmr); tmr = setTimeout(() => gfxRun(w), 300);
    });
    const gs = $('#gStyle');
    if (gs) gs.addEventListener('change', () => {
      if (!w.media || w.media.busy || !w.design) return;
      w.design.style = gs.value; w.design.styleWhy = '';
      if (w.media.url) { w.media.stale = true; w.media.staleWhy = 'הסגנון השתנה'; }
      render();
    });
  };
  // the saved item keeps the real file
  const _wizItemL = wizItem;
  wizItem = function (st) {
    const w = S.wiz;
    const it = _wizItemL(st);
    if (w && w.media && w.media.url) it.media = { kind: w.media.kind, url: w.media.url, thumb: w.media.thumb || '', layout: w.media.layout, fmt: w.media.fmt, ar: w.media.ar, image: w.media.image || '', design: w.design || null, ready: w.media.ready !== false, slides: Array.isArray(w.media.slides) && w.media.slides.length > 1 ? w.media.slides.slice() : undefined };
    return it;
  };

  /* ---------- video: Claude script + ChatGPT scene images + rendered MP4 ---------- */
  const VFMT_K = { '9:16': '9x16', '1:1': '1x1', '4:5': '4x5', '16:9': '16x9' };
  const _vidR = SCREENS.vidWiz.render;
  SCREENS.vidWiz.render = function () {
    const h = _vidR.call(this);
    return h.replace('<span class="hint">לפחות 3 תמונות או קטעים</span>', '<span class="hint">אפשר לדלג: ה-AI ייצור תמונות אווירה לכל סצנה</span>');
  };
  function sceneImages(n, v) {
    const brief = v.desc + (v.aud || v.audQ.length ? '\nקהל: ' + [...v.audQ, v.aud].filter(Boolean).join(', ') : '');
    const size = IMG_SIZE(v.fmt);
    const angles = ['תמונת פתיחה רחבה של המקום והאווירה', 'אנשים נהנים מהפעילות, רגע אנושי', 'פרט קרוב ואווירתי מהפעילות'];
    return Promise.all(angles.slice(0, n).map((a) => aiImage({ title: v.name, brief: brief + '\nזווית: ' + a, size }).catch(() => '')));
  }
  async function videoRun(w, edl) {
    const m = w.media;
    const job = (m.job = (m.job || 0) + 1);
    m.busy = 'מרנדרים את הסרטון... (2-3 דקות)';
    m.ready = false;
    render();
    try {
      const first = (m.scenes || [])[0] || {};
      const r = await produce([m.edit
        ? { id: 'v', kind: 'edit', format: edl.format, clip: m.edit, data: { t: first.t || w.t, s: first.s || '', cta: m.cta || '' }, maxSec: 45 }
        : { id: 'v', kind: 'video', data: edl, fps: 24, stillsAt: [] }], w.brief.dept);
      const x = (r.results || [])[0];
      if (!x || !x.urls) throw new Error('render_failed');
      m.url = x.urls.main;
      await waitFile(m.url, 330000);
      if (m.job !== job) return;
      m.ready = true;
      m.busy = '';
      items.forEach((it) => { if (it.media && it.media.url === m.url) it.media.ready = true; });
      if (S.wiz === w) { w.ver = (w.ver || 1) + 1; render(); }
      toast('הסרטון מוכן', 'אפשר לצפות ולהוריד.');
    } catch (e) {
      if (m.job !== job) return;
      m.busy = '';
      if (S.wiz === w) render();
      toast('רינדור הסרטון לא הושלם', 'נסו שוב בעוד רגע.', 'err');
    }
  }
  function edlFrom(w) {
    const m = w.media;
    return { scenes: (m.scenes || []).map((sc, i) => ({ t: sc.t, s: sc.s || '', img: m.images[i % (m.images.length || 1)] || undefined })), cta: m.cta || '', details: m.details || [], format: VFMT_K[w.fmt] || '9x16' };
  }
  ACT.vdGen = async () => {
    const v = S.vd;
    if (!v.style) { toast('לא נבחר סגנון', 'בחרו: אנימציה, סרטון קיים או סרטון AI.', 'err'); return; }
    if (v.style === 'existing' && !(v.clip && v.clip.url)) { toast('לא הועלה סרטון', 'העלו את הסרטון לעריכה.', 'err'); return; }
    v.gen = true;
    render();
    try {
      const goal = ({ official: 'סרטון רשמי, ברור ומכובד', marketing: 'סרטון שיווקי שמניע לפעולה', event: 'סרטון הזמנה לאירוע, חגיגי ומזמין', showcase: 'סרטון ראווה שמציג עשייה ואווירה', greeting: 'סרטון ברכה חם ולבבי', memorial: 'סרטון ממלכתי, שקט ומכובד' })[v.goal] || 'סרטון שיווקי שמניע לפעולה';
      const brief = v.desc + '\nמטרה: ' + goal + '\nקהל יעד: ' + [...v.audQ, v.aud].filter(Boolean).join(', ');
      const [r, imgs] = await Promise.all([
        gen({ mode: 'video', title: v.name, brief }),
        v.style === 'ai' ? (v.imgs.some((m) => m.url && !m.v) ? Promise.resolve(v.imgs.filter((m) => m.url && !m.v).map((m) => m.url)) : sceneImages(3, v)) : Promise.resolve([]),
      ]);
      if (S.vd !== v) return;
      v.gen = false;
      S.vd = null;
      startWiz('video', { brief: { title: v.name, free: v.desc }, content: { title: v.name, body: r.caption || v.desc }, ch: [...v.ch] });
      const w = S.wiz;
      w.fmts = [v.fmt]; w.fmt = v.fmt; w.vmeta = v;
      const tags = (r.tags || []).slice(0, 6);
      w.sugg = [...new Set([...tags, ...suggestTags(w.t, w.brief.dept)])].slice(0, 7);
      w.tags = tags.slice(0, 4);
      w.media = { kind: 'video', scenes: r.scenes || [], cta: r.cta || '', details: [], images: imgs.filter(Boolean), thumb: imgs.filter(Boolean)[0] || '', fmt: v.fmt, ar: AR[v.fmt] || '9/16', edit: v.style === 'existing' ? v.clip.url : '' };
      render();
      videoRun(w, edlFrom(w));
    } catch (e) { v.gen = false; render(); aiFail(e); }
  };
  // studio edit box for videos: change the on-screen script, then re-render
  const _aiBoxV = aiBox;
  aiBox = function (prefix) {
    const w = S.wiz;
    if (prefix !== 'w' || S.route !== 'wizard' || !w || !w.vmeta || !w.media) return _aiBoxV(prefix);
    const m = w.media, busy = !!m.busy;
    return '<div class="t-sub" style="margin-bottom:8px">' + (m.scenes || []).map((sc, i) => (i + 1) + '. ' + esc(sc.t) + (sc.s ? ' - ' + esc(sc.s) : '')).join('<br>') + (m.cta ? '<br>סיום: ' + esc(m.cta) : '') + '</div>' +
      '<div class="ai-box"><span class="ai-ic">' + ic('spark', 16, 2) + '</span><input type="text" id="wAi" placeholder="מה לשנות בסרטון?"' + (busy ? ' disabled' : '') + '><button class="btn btn-primary btn-sm" data-act="wAi"' + (busy ? ' disabled' : '') + '>עדכון</button></div>' +
      '<div class="real-acts">' + (m.ready && m.url ? '<a class="btn btn-sm" href="' + esc(m.url) + '" target="_blank" rel="noopener">' + ic('down', 14) + ' הורדת הסרטון</a>' : '') + '</div>';
  };
  const _wAiV = ACT.wAi;
  ACT.wAi = () => {
    const w = S.wiz;
    if (!w || !w.vmeta || !w.media) return _wAiV();
    collectWiz();
    const el = $('#wAi'); const q = (el && el.value || '').trim();
    if (!q) { toast('מה לשנות?', 'לדוגמה: סצנה ראשונה קצרה יותר, או סיום עם ההרשמה.', 'err'); return; }
    if (w.media.busy) return;
    w.media.busy = 'ה-AI מעדכן את התסריט...';
    render();
    gen({ mode: 'revise', content: { scenes: w.media.scenes, cta: w.media.cta }, instruction: q })
      .then((r) => {
        const c = r.content || {};
        if (Array.isArray(c.scenes) && c.scenes.length) w.media.scenes = c.scenes;
        if (typeof c.cta === 'string') w.media.cta = c.cta;
        videoRun(w, edlFrom(w));
      })
      .catch((e) => { w.media.busy = ''; render(); aiFail(e); });
  };
  const _wFmtV = ACT.wFmt;
  ACT.wFmt = (k) => { _wFmtV(k); const w = S.wiz; if (w && w.vmeta && w.media && !w.media.busy) { w.media.fmt = w.fmt; w.media.ar = AR[w.fmt] || '9/16'; videoRun(w, edlFrom(w)); } };

  /* ---------- documents: 3 styles, real PDF ---------- */
  const flatDoc = (d) => [d.summary, ...(d.sections || []).flatMap((x) => [x.h + ':', ...(x.paras || []), ...(x.bullets || []).map((b) => '• ' + b)]), d.note].filter(Boolean);
  css.textContent += `
.fx-pages.real{display:block}
.real-doc{display:flex;flex-direction:column;gap:10px;align-items:center;width:100%}
.real-doc iframe{width:100%;max-width:720px;height:min(1000px,82vh);border:0;border-radius:12px;background:#fff;box-shadow:0 10px 30px rgba(14,59,107,.12)}
.real-doc img{display:none;width:100%;max-width:520px;border-radius:10px;box-shadow:0 10px 30px rgba(14,59,107,.12)}
.real-doc .rd-busy{position:relative;width:100%;max-width:720px;aspect-ratio:210/297;border-radius:12px;overflow:hidden;background:#E6EBF2}
@media (max-width:900px){.real-doc iframe{display:none}.real-doc img{display:block}}
.slide.real{position:relative;padding:0;overflow:hidden;background:#E6EBF2}.slide.real img{width:100%;height:100%;object-fit:cover;display:block}`;
  const docFiles = (w) => [...(w.file && w.file.url ? [{ url: w.file.url, name: w.file.n }] : [])];
  async function docRun(w, opts) {
    opts = opts || {};
    const m = (w.media = w.media || { kind: 'doc', ar: '210/297' });
    const job = (m.job = (m.job || 0) + 1);
    try {
      if (opts.regen || !w.doc) {
        m.busy = 'ה-AI כותב את המסמך...';
        render();
        const [d, img] = await Promise.all([
          gen({ mode: 'doc2', style: w.style, styleLabel: DOC_STYLE_T[w.style], title: w.title, files: docFiles(w),
            brief: (w.src === 'file' && w.file ? (w.useAs === 'asis' ? 'השתמש בתוכן הקובץ המצורף כמו שהוא, מילה במילה. רק לארגן אותו למבנה המסמך. ' : 'ערוך ושפר את תוכן הקובץ המצורף: ניסוח, קיצור וסדר, בלי להוסיף עובדות. ') : '') + (w.prompt || '') }),
          w.style === 'designed' && !m.image ? aiImage({ title: w.title, brief: w.prompt, size: 'landscape' }).catch(() => '') : Promise.resolve(m.image || ''),
        ]);
        if (S.dw !== w || m.job !== job) return;
        w.doc = d;
        if (img) m.image = img;
      }
      if (!w.title.trim() && w.doc.title) w.title = w.doc.title;
      w.ai = { title: w.doc.title || w.title, paras: flatDoc(w.doc) };
      m.busy = 'מעצבים את קובץ ה-PDF...';
      render();
      const r = await produce([{ id: 'd', kind: 'doc', style: w.style, data: w.doc, imageUrl: w.style === 'designed' ? m.image : undefined, thumb: false }]);
      if (S.dw !== w || m.job !== job) return;
      const x = (r.results || [])[0];
      if (!x || !x.ok) throw new Error((x && x.error) || 'render_failed');
      m.url = x.urls.main; m.docx = x.urls.docx; m.thumb = x.urls.p1; m.busy = '';
      render();
    } catch (e) {
      if (S.dw !== w || m.job !== job) return;
      m.busy = '';
      render();
      aiFail(e);
    }
  }
  const _docWizR = SCREENS.docWiz.render;
  SCREENS.docWiz.render = function () {
    let h = _docWizR.call(this);
    const w = S.dw;
    if (!w || w.step !== 1 || !w.media) return h;
    const m = w.media;
    const real = m.busy
      ? '<div class="rd-busy"><span class="sp-mb">' + thinkBox() + '</span></div>'
      : m.url ? '<iframe src="' + esc(m.url) + '#view=FitH&toolbar=0" title="' + esc(docTitle(w)) + '"></iframe><a href="' + esc(m.url) + '" target="_blank" rel="noopener"><img src="' + esc(m.thumb) + '" alt="עמוד ראשון"></a>' : '';
    h = h.replace(/<div class="fx-pages">[\s\S]*?<\/div><\/div><div class="studio-ed">/, '<div class="fx-pages real"><div class="real-doc">' + real + '</div></div></div><div class="studio-ed">');
    return h;
  };
  const _dwGenL = ACT.dwGen;
  ACT.dwGen = () => {
    dwCollect();
    const w = S.dw;
    const fromFile = w.src === 'file' && w.file && w.file.url;
    if (!w.style || (w.src !== 'ai' && !fromFile)) { _dwGenL(); return; }
    if (fromFile && !w.useAs) { toast('מה לעשות עם התוכן?', 'בחרו אם להשתמש בתוכן כמו שהוא או לערוך אותו עם AI.', 'err'); return; }
    if (!fromFile && !w.title.trim() && !w.prompt.trim()) { toast('חסר תוכן', 'כתבו כותרת או תיאור חופשי למסמך.', 'err'); return; }
    w.step = 1;
    w.doc = null;
    w.media = null;
    render();
    window.scrollTo({ top: 0 });
    docRun(w, { regen: true });
  };
  const _dwRestyle = ACT.dwRestyle;
  ACT.dwRestyle = (k) => {
    const w = S.dw;
    if (!w || !w.media) return _dwRestyle(k);
    if (w.style === k || w.media.busy) return;
    w.style = k; w.ver++;
    docRun(w, { regen: true });
  };
  const _dwSendL = ACT.dwSend;
  ACT.dwSend = () => {
    const w = S.dw;
    if (!w || !w.media || !w.doc) return _dwSendL();
    const t = $('#dwFix'); const v = (t && t.value || '').trim();
    if (!v) { toast('מה לתקן?', 'כתבו בחופשיות מה לשנות.', 'err'); return; }
    if (w.media.busy) return;
    w.media.busy = 'ה-AI מתקן את המסמך...';
    render();
    const pic = w.fixKind === 'visual' && /תמונ/.test(v) && w.style === 'designed';
    (pic ? aiImage({ title: w.title, brief: w.prompt + '\n' + v, size: 'landscape' }).then((u) => { w.media.image = u; return { content: w.doc }; })
      : gen({ mode: 'revise', content: w.doc, instruction: v }))
      .then((r) => {
        if (S.dw !== w) return;
        if (r.content && typeof r.content === 'object') w.doc = r.content;
        w.ver++;
        w.fixes.push({ k: w.fixKind, t: v, v: w.ver });
        docRun(w);
        toast('המסמך עודכן', 'גרסה ' + w.ver);
      })
      .catch((e) => { w.media.busy = ''; render(); aiFail(e); });
  };
  const _dwDl = ACT.dwDl;
  ACT.dwDl = () => { const w = S.dw; if (w && w.media && w.media.url) window.open(w.media.url, '_blank', 'noopener'); else if (w && w.media && w.media.busy) toast('הקובץ עדיין בהכנה', 'עוד כמה שניות.'); else _dwDl(); };
  const _dwDoneL = ACT.dwDone;
  ACT.dwDone = (st) => {
    const w = S.dw;
    const m = w && w.media;
    _dwDoneL(st);
    const it = items[0];
    if (m && m.url && it && it.ty === 'doc') { it.media = { kind: 'doc', url: m.url, docx: m.docx, thumb: m.thumb, ar: '210/297', style: w.style, qa: (w.doc && w.doc.qa) || null }; if (w.doc) it.doc = w.doc; flush(); }
  };

  /* ---------- presentations: 3 styles, real PDF + PowerPoint + slide previews ---------- */
  async function deckRun(w, opts) {
    opts = opts || {};
    const m = (w.media = w.media || { kind: 'deck', ar: '16/9' });
    const job = (m.job = (m.job || 0) + 1);
    try {
      if (opts.regen || !w.deck) {
        m.busy = 'ה-AI בונה ' + w.pages + ' שקפים...';
        render();
        const [d] = await Promise.all([
          gen({ mode: 'deck2', style: w.style, title: w.title, pages: w.pages, keep: !!(w.src === 'file' && w.file && w.file.url), files: w.file && w.file.url ? [{ url: w.file.url, name: w.file.n }] : [],
            brief: (w.src === 'file' && w.file ? ({ visual: 'שמור על הטקסט של המצגת המצורפת כמו שהוא, מילה במילה, שקף אחר שקף. ', text: 'שפר את הניסוח של המצגת המצורפת: קצר, ברור ומדויק, בלי להוסיף עובדות. שמור על סדר השקפים. ', both: 'ערוך את המצגת המצורפת: שפר ניסוח וסדר, בלי להוסיף עובדות. ' })[w.editKind] + 'מספר השקפים כמו במצגת המקורית. ' : '') + (w.prompt || '') }),
        ]);
        if (S.dk !== w || m.job !== job) return;
        w.deck = d;
        m.busy = 'ChatGPT מצלם תמונה לכל שקף...';
        render();
        m.images = await deckImages(w, m, d);
        if (S.dk !== w || m.job !== job) return;
        const sl = d.slides || [];
        w.slides = mkSlides(sl.length || w.pages);
        w.slides.forEach((s, i) => { if (sl[i]) { s.t = sl[i].t || s.t; s.pts = sl[i].pts || []; } });
        if (!w.title.trim() && d.title) w.title = d.title;
        w.ai = true;
        if (w.cur >= w.slides.length) w.cur = 0;
      }
      if (!opts.regen) { m.busy = 'ChatGPT מצלם תמונה לכל שקף...'; render(); m.images = await deckImages(w, m, w.deck); if (S.dk !== w || m.job !== job) return; }
      m.busy = 'מעצבים את המצגת...';
      render();
      const r = await produce([{ id: 'k', kind: 'deck', style: w.style, data: w.deck, images: m.images || {}, thumb: false }]);
      if (S.dk !== w || m.job !== job) return;
      const x = (r.results || [])[0];
      if (!x || !x.ok) throw new Error((x && x.error) || 'render_failed');
      m.url = x.urls.main; m.pptx = x.urls.pptx;
      m.slides = Array.from({ length: x.slides || w.slides.length }, (_, i) => x.urls['s' + (i + 1)]).filter(Boolean);
      m.thumb = m.slides[0] || '';
      m.rev = Date.now();
      m.busy = '';
      render();
    } catch (e) {
      if (S.dk !== w || m.job !== job) return;
      m.busy = '';
      render();
      aiFail(e);
    }
  }
  const _slideHtmlL = slideHtml;
  slideHtml = function (w, s, i, mini) {
    const m = S.route === 'deckWiz' && S.dk === w && w.media;
    if (m && m.busy && !mini) return '<div class="slide real"><span class="sp-mb">' + thinkBox() + '</span></div>';
    if (m && m.slides && m.slides[i]) return '<div class="slide real' + (mini ? ' mini' : '') + '"><img src="' + esc(m.slides[i]) + '" alt="שקף ' + (i + 1) + '" loading="lazy"></div>';
    return _slideHtmlL(w, s, i, mini);
  };
  const _dkGenL = ACT.dkGen;
  ACT.dkGen = () => {
    dkCollect();
    const w = S.dk;
    const fromFile = w.src === 'file' && w.file && w.file.url;
    if (fromFile) {
      if (!w.editKind) { toast('איזו עריכה דרושה?', 'בחרו: ויזואלית בלבד, טקסט בלבד או גם וגם.', 'err'); return; }
      if (w.editKind !== 'text' && !w.style) { toast('לא נבחר סגנון', 'בחרו סגנון לעיצוב מחדש.', 'err'); return; }
      if (!w.style) w.style = 'formal';
    } else {
      if (w.src !== 'ai' || !w.style) { _dkGenL(); return; }
      if (!w.title.trim() && !w.prompt.trim()) { toast('חסר תוכן', 'כתבו כותרת או תיאור חופשי למצגת.', 'err'); return; }
    }
    w.slides = mkSlides(w.pages);
    w.cur = 0;
    w.fixKind = dkKinds(w)[0];
    w.step = 1;
    w.deck = null;
    w.media = null;
    render();
    window.scrollTo({ top: 0 });
    deckRun(w, { regen: true });
  };
  const _dkSendL = ACT.dkSend;
  ACT.dkSend = () => {
    const w = S.dk;
    if (!w || !w.media || !w.deck) return _dkSendL();
    const s = w.slides[w.cur];
    const t = $('#dkFix'); const v = (t && t.value || '').trim();
    if (!v) { toast('מה לתקן בעמוד הזה?', 'כתבו בחופשיות מה לשנות.', 'err'); return; }
    if (w.media.busy) return;
    const cur = w.deck.slides[w.cur] || { t: s.t, pts: s.pts || [] };
    // a request about the picture: a new photo for this slide only, the text stays
    if (w.fixKind === 'visual' && /תמונ|צילום|רקע/.test(v)) {
      const m = w.media; m.imgBy = m.imgBy || {}; m.imgNote = m.imgNote || {};
      Object.keys(m.imgBy).forEach((k) => { if (k.includes('|' + (w.cur === 0 ? (w.deck.title || cur.t || '') : (cur.t || '')) + '|')) delete m.imgBy[k]; });
      m.imgNote[w.cur] = v;
      s.ver++; s.fixes.push({ k: w.fixKind, t: v, v: s.ver });
      deckRun(w);
      return;
    }
    w.media.busy = 'ה-AI מתקן את עמוד ' + (w.cur + 1) + '...';
    render();
    gen({ mode: 'revise', content: w.cur === 0 ? { title: w.deck.title, subtitle: w.deck.subtitle, slide: cur } : { slide: cur }, instruction: v })
      .then((r) => {
        if (S.dk !== w) return;
        const c = r.content || {};
        if (c.slide) { w.deck.slides[w.cur] = Object.assign({}, cur, c.slide); s.t = c.slide.t || s.t; s.pts = c.slide.pts || s.pts; }
        if (w.cur === 0) { if (c.title) { w.deck.title = c.title; w.title = c.title; } if (c.subtitle) w.deck.subtitle = c.subtitle; }
        s.ver++;
        s.fixes.push({ k: w.fixKind, t: v, v: s.ver });
        deckRun(w);
        toast('עמוד ' + (w.cur + 1) + ' עודכן', 'גרסה ' + s.ver);
      })
      .catch((e) => { w.media.busy = ''; render(); aiFail(e); });
  };
  const _dkDl = ACT.dkDl;
  ACT.dkDl = () => {
    const w = S.dk, m = w && w.media;
    if (!m || !m.url) { if (m && m.busy) toast('המצגת עדיין בהכנה', 'עוד כמה שניות.'); else _dkDl(); return; }
    openModal('<div class="mb"><div class="m-ic ok">' + ic('down', 20) + '</div><h3>הורדת המצגת</h3><p>„' + esc(dkTitle(w)) + '”</p></div>' +
      '<div class="modal-foot"><a class="btn btn-primary" href="' + esc(m.pptx) + '" target="_blank" rel="noopener">PowerPoint</a><a class="btn" href="' + esc(m.url) + '" target="_blank" rel="noopener">PDF</a></div>');
  };
  const _dkDoneL = ACT.dkDone;
  ACT.dkDone = (st) => {
    const w = S.dk;
    const m = w && w.media;
    _dkDoneL(st);
    const it = items[0];
    if (m && m.url && it && it.ty === 'deck') { it.media = { kind: 'deck', url: m.url, pptx: m.pptx, slides: m.slides, thumb: m.thumb, ar: '16/9', style: w.style, qa: (w.deck && w.deck.qa) || null }; if (w.deck) it.deck = w.deck; flush(); }
  };
  // item page: download links for every real file
  const _itemRL = SCREENS.item.render;
  SCREENS.item.render = function () {
    let h = _itemRL.call(this);
    const it = items.find((x) => x.id === S.itemId) || items[0];
    const m = it && it.media;
    if (!m || !m.url) return h;
    const links = [[m.kind === 'video' ? 'הורדת הסרטון' : m.kind === 'graphic' ? 'הורדת הגרפיקה' : 'PDF', m.url]];
    if (m.pptx) links.push(['PowerPoint', m.pptx]);
    if (m.docx) links.push(['Word', m.docx]);
    const box = '<div class="note">' + ic('down', 16) + '<span>הקובץ המקורי: ' + links.map((l) => '<a href="' + esc(l[1]) + '" target="_blank" rel="noopener" style="font-weight:700;color:var(--brand)">' + l[0] + '</a>').join(' · ') + (m.kind === 'video' && !m.ready ? ' (הסרטון עדיין ברינדור)' : '') + (m.qa ? ' ' + qaHtml(m.qa) + (m.qa.issues && m.qa.issues.length ? '<br><small>בודק התוכן: ' + esc(m.qa.issues.slice(0, 3).join(' · ')) + (m.qa.fixed ? ' (תוקן אוטומטית)' : '') + '</small>' : '') : '') + '</span></div>';
    return h.replace('<div class="note">' + ic('help', 16), box + '<div class="note">' + ic('help', 16));
  };

  /* =====================================================================
   * REAL UPLOADS: brand assets, photos, videos and documents go to storage,
   * and every flow uses them (Claude reads them, ChatGPT designs with them)
   * ===================================================================== */
  const MAXB = 50 * 1024 * 1024;
  const extOf = (n) => String(n || '').split('.').pop().toLowerCase();
  const isImg = (n) => /^(png|jpe?g|webp|gif|svg|heic)$/.test(extOf(n));
  const isVid = (n) => /^(mp4|mov|webm|m4v)$/.test(extOf(n));
  const readable = (n) => /^(png|jpe?g|webp|gif|pdf|docx|pptx|txt|csv)$/.test(extOf(n));
  let lastEl = null;
  document.addEventListener('click', (e) => { lastEl = e.target; }, true);
  function pickFiles(accept, multiple) {
    return new Promise((res) => {
      const i = document.createElement('input');
      i.type = 'file'; if (accept) i.accept = accept; i.multiple = !!multiple; i.style.display = 'none';
      i.addEventListener('change', () => { res([...(i.files || [])]); i.remove(); });
      document.body.appendChild(i);
      i.click();
    });
  }
  const MAXB_VIDEO = 300 * 1024 * 1024;
  const isClip = (n) => /\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/i.test(n || '');
  const isRawPhoto = (n) => /\.(heic|heif|avif|tiff?|bmp)$/i.test(n || '');
  // kind 'doc': an internal document (brand guide, work plan, source file) is kept in the private bucket; the
  // server hands back `pv:` instead of a public link, and openPv() exchanges it for a one-hour signed link on demand
  async function uploadFile(f, kind) {
    if (f.size > (isClip(f.name) ? MAXB_VIDEO : MAXB)) throw new Error('too_big');
    const s = await call('upload.sign', { name: f.name, kind: kind || undefined });
    const r = await fetch(s.upload, { method: 'PUT', headers: { 'content-type': f.type || 'application/octet-stream', 'x-upsert': 'true' }, body: f });
    if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(r.status === 413 || /EntityTooLarge|too large/i.test(t) ? 'too_big_server' : 'upload_failed'); }
    let out = { url: s.url, name: f.name, ext: s.ext, type: f.type, size: f.size };
    // phone clips (HEVC .mov/.mp4) and HEIC photos: re-encoded on the server into what the video engine plays
    if (isClip(f.name) || isRawPhoto(f.name)) {
      toast(isClip(f.name) ? 'מתאים את הסרטון למערכת...' : 'מתאים את התמונה...', f.name);
      try {
        const c = await post('/api/convert', { url: s.url, name: f.name }, 290000);
        if (c && c.url) out = Object.assign(out, { url: c.url, name: c.name || f.name, ext: (c.name || f.name).split('.').pop().toLowerCase(), converted: !!c.converted });
      } catch (e) { console.warn('convert', e && e.message); if (isRawPhoto(f.name)) throw new Error('photo_format'); }
    }
    return out;
  }
  const isPv = (u) => typeof u === 'string' && u.startsWith('pv:');
  async function openPv(u) {
    try { const r = await call('file.sign', { urls: [u] }); const su = r && r.urls && r.urls[u]; if (!su) throw new Error('no_link'); window.open(su, '_blank', 'noopener'); }
    catch (e) { toast('לא ניתן לפתוח את הקובץ', 'נסו שוב בעוד רגע.', 'err'); }
  }
  ACT.openPv = (u) => openPv(u);
  async function uploadPicked(accept, multiple, kind) {
    const fs = await pickFiles(accept, multiple);
    if (!fs.length) return [];
    toast('מעלה ' + (fs.length > 1 ? fs.length + ' קבצים' : 'את הקובץ') + '...', fs.map((f) => f.name).join(', '));
    const out = [];
    for (const f of fs) {
      try { out.push(await uploadFile(f, kind)); }
      catch (e) { toast('ההעלאה נכשלה', f.name + (e.message === 'too_big' ? (isClip(f.name) ? ' גדול מ-300MB.' : ' גדול מ-50MB.') : e.message === 'too_big_server' ? ' גדול ממגבלת האחסון.' : e.message === 'file_type_not_allowed' ? ': סוג קובץ שלא נתמך.' : e.message === 'photo_format' ? ': לא הצלחתי להמיר את התמונה. שמרו אותה כ-JPG ונסו שוב.' : '. נסו שוב.'), 'err'); }
    }
    return out;
  }
  const fileIcon = (n) => (isImg(n) ? 'img' : isVid(n) ? 'vid' : 'doc');
  const fileChips = (list, xAct) => (list || []).map((f, i) => '<span class="file-chip up-chip">' + (isImg(f.name) ? '<img src="' + esc(f.url) + '" alt="">' : '<span class="fi ' + esc(extOf(f.name)) + '">' + esc(extOf(f.name).toUpperCase()) + '</span>') + '<b>' + esc(f.name) + '</b><button class="icon-btn" data-act="' + xAct + ':' + i + '" aria-label="הסרה">' + ic('x', 14) + '</button></span>').join('');
  css.textContent += `
.up-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.up-chip{display:inline-flex;align-items:center;gap:8px;max-width:100%}.up-chip img{width:34px;height:34px;object-fit:cover;border-radius:6px}.up-chip b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px;font-size:13px}
.lc-img.has-logo{background:repeating-conic-gradient(#EEF1F6 0 25%,#fff 0 50%) 50%/18px 18px!important}.lc-img.has-logo{overflow:hidden}.lc-img.has-logo img{max-width:70%;max-height:96px;width:auto;height:auto;object-fit:contain}.avatar.has-logo{background:#fff!important;padding:3px;overflow:hidden}.avatar.has-logo img{width:100%;height:100%;object-fit:contain}
.raw.real{background-size:cover!important;background-position:center!important}
.ai-warn{margin-top:10px}`;

  /* ---- brand: logos ---- */
  const logoOf = () => { const l = (BRAND.logos || []).find((x) => x.url && !/הפוך|לבן/.test(x.n)) || (BRAND.logos || []).find((x) => x.url); return l ? l.url : ''; };
  const _brandFor = brandFor;
  brandFor = function (dept) { const b = _brandFor(dept); const l = logoOf(); if (l) b.logo = l; return b; };
  const _brandMount = SCREENS.brand.mount;
  SCREENS.brand.mount = function () {
    _brandMount && _brandMount.call(this);
    const b = S.brandEdit ? S.brandDraft : BRAND;
    $$('.logo-card').forEach((c, i) => { const l = b.logos[i]; if (l && l.url) { const box = c.querySelector('.lc-img'); if (box) { box.classList.add('has-logo'); box.innerHTML = '<img src="' + esc(l.url) + '" alt="' + esc(l.n) + '">'; } } });
    if (!S.brandEdit && (S.tab.brand || 'logos') === 'docs') $$('table tbody tr').forEach((tr, i) => { const d = b.docs[i]; const btn = tr.querySelector('[data-act^="toastInfo"]'); if (d && d.url && btn) { if (isPv(d.url)) { const b2 = document.createElement('button'); b2.className = 'btn btn-sm'; b2.textContent = 'צפייה'; b2.addEventListener('click', () => openPv(d.url)); btn.replaceWith(b2); } else { const a = document.createElement('a'); a.className = 'btn btn-sm'; a.href = d.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'צפייה'; btn.replaceWith(a); } } });
  };
  ACT.bAddLogo = async () => {
    const [f] = await uploadPicked('image/png,image/svg+xml,image/jpeg,image/webp');
    if (!f) return;
    if (!S.brandEdit) ACT.brandEdit();
    S.brandDraft.logos.push({ n: f.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' '), c: '#0E3B6B', url: f.url });
    render();
    toast('הלוגו הועלה', 'לחצו שמירה כדי שכל התוכן החדש ישתמש בו.');
  };
  /* ---- brand: reference documents (Claude reads them and updates the brand rules) ---- */
  async function learnBrand(files, target) {
    const rd = files.filter((f) => readable(f.name));
    if (!rd.length) return;
    toast('קלוד קורא את המסמכים...', 'מחלץ שפת מותג, כללים וצבעים.');
    try {
      const r = await gen({ mode: 'brand', files: rd.map((f) => ({ url: f.url, name: f.name })) });
      const t = target();
      const ch = [];
      if (r.tone) { t.rules.tone = r.tone; ch.push('טון הכתיבה'); }
      if ((r.good || []).length) { t.rules.good = [...new Set([...r.good, ...t.rules.good])].slice(0, 8); ch.push(r.good.length + ' ניסוחים מועדפים'); }
      if ((r.bad || []).length) { t.rules.bad = [...new Set([...r.bad, ...t.rules.bad])].slice(0, 8); ch.push(r.bad.length + ' כללי הימנעות'); }
      const cols = (r.colors || []).filter((c) => /^#[0-9a-f]{6}$/i.test(c.hex || ''));
      if (cols.length) { const pal = paletteFrom(cols.map((c) => c.hex.toUpperCase())); pal.forEach((x) => { x[0] = x[0].replace('(מהלוגו)', '(מהמסמך)'); }); if (cols[0] && cols[0].n) pal[0][0] = cols[0].n + ' (מהמסמך)'; t.colors = pal; ch.push(cols.length + ' צבעי מותג'); }
      if ((r.fonts || []).length && typeof FONTS !== 'undefined') { const f = r.fonts.find((x) => FONTS.includes(x)); if (f) { t.fonts.h = f; t.fonts.b = f; ch.push('גופן'); } }
      render();
      toast(ch.length ? 'המערכת למדה מהמסמכים' : 'המסמכים נקלטו', ch.length ? 'עודכנו: ' + ch.join(', ') + '.' : (r.summary || 'לא נמצאו בהם הנחיות מותג מפורשות.'));
      flush();
    } catch (e) { aiFail(e); }
  }
  ACT.bAddDoc = async () => {
    const fs = await uploadPicked('.pdf,.docx,.pptx,.txt,.csv,.xlsx,image/*', true, 'doc');
    if (!fs.length) return;
    if (!S.brandEdit) ACT.brandEdit();
    const by = curUser().n, dt = new Date().toLocaleDateString('he-IL');
    fs.forEach((f) => S.brandDraft.docs.unshift({ n: f.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' '), k: extOf(f.name).toUpperCase(), by, d: dt, cat: 'brand', url: f.url }));
    render();
    learnBrand(fs, () => S.brandDraft || BRAND);
  };
  const DQ = {};
  ACT.docqAdd = async () => {
    const q = DOCQ[S.docq.step];
    const fs = await uploadPicked('.pdf,.docx,.pptx,.txt,.csv,.xlsx,image/*', true, 'doc');
    if (!fs.length) return;
    fs.forEach((f) => { S.docq.files[q.k].push(f.name); DQ[f.name] = f; });
    $('#modalBox').innerHTML = docqHtml();
  };
  const _docqClose = ACT.docqClose;
  ACT.docqClose = () => {
    const names = Object.values(S.docq.files).flat();
    _docqClose();
    const ups = names.map((n) => DQ[n]).filter(Boolean);
    ups.forEach((f) => { const d = BRAND.docs.find((x) => !x.url && x.n === f.name.replace(/\.[a-z]+( \(\d+\))?$/, '').replace(/_/g, ' ')); if (d) d.url = f.url; });
    if (ups.length) learnBrand(ups, () => BRAND);
  };

  /* ---- generic upload buttons: what happens depends on where they sit ---- */
  ACT.fakeUpload = async () => {
    const el = lastEl && lastEl.closest ? lastEl : null;
    const row = el && el.closest('.ed-row, .row-acts, tr');
    const rm = row && row.querySelector('[data-act^="bRm:"]');
    // brand screen: replace a logo or a document
    if (S.route === 'brand' && rm) {
      const [k, i] = rm.dataset.act.slice(4).split('|');
      const [f] = await uploadPicked(k === 'logos' ? 'image/png,image/svg+xml,image/jpeg,image/webp' : '.pdf,.docx,.pptx,.txt,.csv,.xlsx,image/*');
      if (!f) return;
      const it = S.brandDraft[k][+i];
      it.url = f.url;
      if (k === 'docs') { it.k = extOf(f.name).toUpperCase(); it.d = new Date().toLocaleDateString('he-IL'); }
      render();
      toast('הקובץ הוחלף', 'לחצו שמירה כדי להחיל.');
      if (k === 'docs') learnBrand([f], () => S.brandDraft || BRAND);
      return;
    }
    // create wizard: material for the AI (photos are used in the design, documents are read by Claude)
    if (S.route === 'wizard' && S.wiz && S.wiz.step === 0) {
      collectWiz();
      const fs = await uploadPicked('image/*,video/*,.pdf,.docx,.pptx,.txt,.csv', true, 'doc');
      if (!fs.length || !S.wiz) return;
      S.wiz.brief.files = [...(S.wiz.brief.files || []), ...fs];
      render();
      return;
    }
    // library: an uploaded finished file becomes a draft item
    if (S.route === 'library') {
      const fs = await uploadPicked('image/*,video/*,.pdf,.pptx,.docx', true);
      fs.forEach((f) => {
        const ty = isImg(f.name) ? 'graphic' : isVid(f.name) ? 'video' : extOf(f.name) === 'pptx' ? 'deck' : 'doc';
        const it = mkItem({ t: f.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' '), ty, s: 'draft', body: '' });
        it.media = { kind: ty, url: f.url, thumb: isImg(f.name) ? f.url : '', ar: ty === 'doc' ? '210/297' : ty === 'deck' ? '16/9' : '1/1', ready: true, uploaded: true };
      });
      if (fs.length) { render(); toast('הקבצים נוספו לספרייה', fs.length + ' פריטים נשמרו כטיוטה.'); flush(); }
      return;
    }
    const fs = await uploadPicked('', true);
    if (fs.length) toast('הקובץ הועלה', fs.map((f) => f.name).join(', '));
  };
  // brief: show the attached files
  const _wizRU = SCREENS.wizard.render;
  SCREENS.wizard.render = function () {
    let h = _wizRU.call(this);
    const w = S.wiz;
    if (!w || w.step !== 0 || !(w.brief.files || []).length) return h;
    return h.replace(/(<div class="brief-tools">[\s\S]*?<\/div>)/, '$1<div class="up-chips">' + fileChips(w.brief.files, 'wFileX') + '</div>');
  };
  ACT.wFileX = (i) => { collectWiz(); S.wiz.brief.files.splice(+i, 1); render(); };
  const briefFiles = (w) => (w.brief.files || []).filter((f) => readable(f.name)).map((f) => ({ url: f.url, name: f.name }));
  const briefPhotos = (w) => (w.brief.files || []).filter((f) => /^(png|jpe?g|webp)$/.test(extOf(f.name))).map((f) => f.url);

  /* ---- video wizard: real photos and clips ---- */
  ACT.vdImg = async (v) => {
    const fs = await uploadPicked(v === '1' ? 'video/*' : 'image/*', true);
    if (!fs.length || !S.vd) return;
    fs.forEach((f) => S.vd.imgs.push({ v: isVid(f.name), url: f.url, name: f.name }));
    render();
  };
  const _vidM = SCREENS.vidWiz.mount;
  SCREENS.vidWiz.mount = function () {
    _vidM && _vidM.call(this);
    const w = S.vd;
    if (!w || !w.imgs) return;
    $$('.raw.thumb').forEach((el, i) => { const m = w.imgs[i]; if (m && m.url && !m.v) { el.classList.add('real'); el.style.backgroundImage = "url('" + m.url + "')"; } });
  };
  ACT.vdClip = async () => {
    const [f] = await uploadPicked('video/*');
    if (!f || !S.vd) return;
    S.vd.clip = { k: extOf(f.name), n: f.name, sub: Math.round(f.size / 1048576) + 'MB', url: f.url };
    render();
    toast('הסרטון הועלה', f.name);
  };
  /* ---- documents and decks from an uploaded file: Claude reads it ---- */
  ACT.dwFile = async () => {
    dwCollect();
    const [f] = await uploadPicked('.pdf,.docx,.txt,.pptx', false, 'doc');
    if (!f || !S.dw) return;
    S.dw.file = { k: extOf(f.name), n: f.name, url: f.url };
    render();
    toast('הקובץ הועלה', f.name);
  };
  ACT.dkFile = async () => {
    dkCollect();
    const [f] = await uploadPicked('.pptx,.pdf,.docx', false, 'doc');
    if (!f || !S.dk) return;
    S.dk.file = { k: extOf(f.name), n: f.name, sub: '', url: f.url };
    render();
    toast('המצגת הועלתה', f.name);
  };

  /* ---------- ChatGPT designs the whole graphic from the brand palette ---------- */
  const DESIGN_AR = { square: '1/1', portrait: '2/3', landscape: '3/2' };
  async function aiDesignRun(w, m, fmt, job, opts) {
    const tpl = tplOf(m.layout);
    if (/^tpl:/.test(m.layout) && !tpl) m.layout = 'ai';
    const size = tpl ? IMG_SIZE(tpl.r || fmt) : IMG_SIZE(fmt);
    const logo = logoOf();
    const photos = briefPhotos(w);
    try {
      let url = '', check = { ok: true }, want = [];
      if (opts.fixOnly && m.design) {
        url = m.design; check = { ok: false, issues: m.warn || [], fixes: m.fixes || [] }; want = m.want || [];
      } else if (opts.fit && m.design && m.dsize === size && m.dlay === m.layout && !opts.note) {
        url = m.design; check = { ok: !m.warn, issues: m.warn || [] }; want = m.want || [];
        if (m.warn) check.ok = true; // keep the existing warning, no new fix round on a resize
      } else {
        m.busy = tpl ? 'ממלאים את התבנית „' + tpl.n + '” בתוכן החדש... (כדקה)' : 'ChatGPT מעצב את הגרפיקה... (כדקה)';
        m.warn = null;
        render();
        const kit = !tpl && logo ? await ensureKit() : null;
        if (S.wiz !== w || m.job !== job) return;
        const r = await fx('image', {
          action: 'design', org: aiCtx().org, dept: w.brief.dept, size, brief: (w.brief.title || '') + '\n' + (w.brief.free || ''),
          colors: brandFor(w.brief.dept).colors, roles: brandFor(w.brief.dept).roles, style: w.design.style || 'official', palette: w.design.palette || '', kit: kit || undefined, texts: { kicker: w.design.kicker, headline: w.t, sub: w.design.sub, details: w.design.details, cta: w.design.cta, icons: w.design.icons || [], keyword: w.design.keyword || '' },
          refs: [...(logo && !tpl ? [logo] : []), ...photos].slice(0, tpl ? 3 : 4), logo: !!logo && !tpl, note: opts.note || '', quality: 'high', n: 2,
          // a small change request edits the current design instead of designing again
          base: opts.note && !opts.fresh && m.design ? m.design : undefined, font: BRAND.font && BRAND.font !== 'auto' ? BRAND.font : undefined,
          template: tpl ? { url: tpl.url, desc: tpl.desc || '', slots: tpl.slots || [] } : undefined,
        }, 150000);
        if (S.wiz !== w || m.job !== job) return;
        url = r.url; check = r.check || { ok: true }; want = r.want || []; m.model = r.model || ''; m.qa = r.qa || null; m.style = r.style || w.design.style; m.edited = !!r.edited;
      }
      // a fix round can break another line: keep the version with the fewest text errors
      const nIss = (c) => (c && !c.ok ? (c.issues || []).length || 1 : 0);
      let best = { url, check };
      for (let round = 1; round <= 2 && !check.ok && (check.issues || []).length; round++) {
        m.busy = 'מתקנים את הטקסט בגרפיקה' + (round > 1 ? ' (סבב ' + round + ')' : '') + '...';
        m.design = url;
        render();
        try {
          const f = await fx('image', { action: 'fixtext', url, issues: check.issues, fixes: check.fixes || [], want, size }, 150000);
          if (S.wiz !== w || m.job !== job) return;
          url = f.url; check = f.check || { ok: true };
          if (nIss(check) < nIss(best.check)) best = { url, check };
        } catch (e) { break; /* keep the best version and show the issues */ }
      }
      url = best.url; check = best.check;
      const keepWarn = opts.fit && m.dsize === size && !opts.note ? m.warn : null;
      m.design = url; m.want = want; m.dsize = size; m.dlay = m.layout; m.stale = false; m.fixes = check.fixes || [];
      m.warn = keepWarn || (!check.ok && (check.issues || []).length ? check.issues : null);
      // exact platform size: the design is placed into the format without cropping
      if (size === 'square' && fmt === '1:1') { m.url = url; }
      else {
        m.busy = 'מתאימים לגודל ' + fmt + '...';
        render();
        const r2 = await produce([{ id: 'g', kind: 'graphic', layout: 'fit', format: FMT_K[fmt] || '1x1', data: { image: url }, thumb: false }], w.brief.dept);
        if (S.wiz !== w || m.job !== job) return;
        const x = (r2.results || [])[0];
        m.url = x && x.ok ? x.urls.main : url;
      }
      m.image = '';
      m.fmt = fmt;
      m.ar = AR[fmt] || '1/1';
      m.busy = '';
      w.ver = (w.ver || 1) + (opts.first ? 0 : 1);
      render();
      if (m.warn) toast('בדקו את הטקסט בגרפיקה', 'הבדיקה מצאה שגיאות שלא תוקנו עד הסוף. אפשר ללחוץ "תיקון הטקסט" או לבחור תבנית מותג.', 'err');
    } catch (e) {
      if (S.wiz !== w || m.job !== job) return;
      m.busy = '';
      m.layout = pickTemplate(w.design || {}, w.brief.free);
      render();
      toast(tpl ? 'מילוי התבנית לא הושלם' : 'העיצוב החופשי לא הושלם', 'עברנו לעיצוב גיבוי. אפשר לנסות שוב מהבחירה למעלה.', 'err');
      gfxRun(w);
    }
  }
  // studio: AI design controls
  const _aiBoxD = aiBox;
  aiBox = function (prefix) {
    let h = _aiBoxD(prefix);
    const w = S.wiz;
    if (prefix !== 'w' || S.route !== 'wizard' || !isGfx(w) || !w.media) return h;
    const m = w.media, busy = !!m.busy;
    h = h.replace(/<div class="lay-pick" role="radiogroup" aria-label="פריסה">[\s\S]*?<\/div>/, layPickHtml(m, busy));
    if (isAiLay(m.layout)) {
      h = h.replace('<div class="real-acts">', '<div class="real-acts"><button class="btn btn-sm" data-act="gNew"' + (busy ? ' disabled' : '') + '>' + ic('refresh', 14) + ' עיצוב חדש</button>' + (m.warn ? '<button class="btn btn-sm" data-act="gFix"' + (busy ? ' disabled' : '') + '>' + ic('edit', 14) + ' תיקון הטקסט</button>' : ''));
      if (isAiLay(m.layout) && w.design) h += '<label class="t-sub g-style" style="margin-top:8px;display:flex;align-items:center;gap:8px">סגנון העיצוב <select id="gStyle"' + (busy ? ' disabled' : '') + '>' + Object.keys(STYLE_HE).map((k) => '<option value="' + k + '"' + (k === (w.design.style || 'official') ? ' selected' : '') + '>' + esc(STYLE_HE[k]) + '</option>').join('') + '</select>' + (w.design.styleWhy ? '<span class="t-sub">' + esc(w.design.styleWhy) + '</span>' : '') + '</label>';
      if (m.stale) h += '<div class="note ai-warn">' + ic('edit', 15) + '<span>' + (m.staleWhy || 'הכותרת השתנתה') + '. לחצו "עיצוב חדש" כדי לעדכן את הגרפיקה.</span></div>';
      if (m.warn) h += '<div class="note ai-warn">' + ic('alert', 15) + '<span>בדיקת הטקסט מצאה: ' + m.warn.map(esc).join(' · ') + '</span></div>';
      if (m.model && m.url) h += '<div class="t-sub" style="margin-top:8px">' + ic('img', 13) + ' סגנון: ' + esc(styleHe(m.style)) + ' ' + qaHtml(m.qa) + ' · מודל <span dir="ltr">' + esc(m.model) + '</span> · <a href="' + esc(m.design || m.url) + '" target="_blank" rel="noopener">הקובץ המקורי</a></div>';
      if (briefPhotos(w).length || logoOf()) h += '<div class="t-sub" style="margin-top:8px">בעיצוב משולבים: ' + [logoOf() ? 'הלוגו מנכסי המותג' : '', briefPhotos(w).length ? briefPhotos(w).length + ' תמונות שהעליתם' : ''].filter(Boolean).join(' ו') + '.</div>';
    }
    return h;
  };
  ACT.gNew = () => { const w = S.wiz; if (!isGfx(w) || !w.media || w.media.busy) return; collectWiz(); gfxRun(w, { note: 'קומפוזיציה ועיצוב שונים לגמרי מהגרסה הקודמת', fresh: true }); };
  ACT.gFix = () => { const w = S.wiz; if (!isGfx(w) || !w.media || w.media.busy) return; gfxRun(w, { fixOnly: true }); };
  // edit requests on an AI design: Claude updates the texts, ChatGPT redesigns with the request
  const _wAiD = ACT.wAi, _wAiQD = ACT.wAiQ;
  // a request about words goes through Claude first (the texts change); a request about the look leaves the texts alone
  const TEXT_WORDS = /כותרת|טקסט|מיל[הים]|כתוב|תאריך|שעה|שם |מספר|טלפון|נוסח|משפט|"|״|'|כותר/;
  async function aiDesignEdit(w, q) {
    const m = w.media;
    m.busy = 'ה-AI מעדכן...';
    render();
    try {
      if (TEXT_WORDS.test(q)) {
        const cur = { headline: w.t, kicker: w.design.kicker, sub: w.design.sub, details: w.design.details, cta: w.design.cta };
        const r = await gen({ mode: 'revise', content: cur, instruction: q + '\nאם הבקשה נוגעת רק לעיצוב או לתמונה, החזר את הטקסטים בלי שינוי.' });
        if (S.wiz !== w) return;
        const c = r.content || {};
        if (c.headline) w.t = c.headline;
        ['kicker', 'sub', 'cta'].forEach((k) => { if (typeof c[k] === 'string') w.design[k] = c[k]; });
        if (Array.isArray(c.details)) w.design.details = c.details;
      }
      m.busy = '';
      gfxRun(w, { note: q });
    } catch (e) { m.busy = ''; render(); aiFail(e); }
  }
  ACT.wAi = () => {
    const w = S.wiz;
    if (!isGfx(w) || !w.media || !isAiLay(w.media.layout)) return _wAiD();
    collectWiz();
    const el = $('#wAi'); const q = (el && el.value || '').trim();
    if (!q) { toast('מה לשנות?', 'לדוגמה: רקע בהיר יותר, להדגיש את התאריך, או תמונה של משפחה בפארק.', 'err'); return; }
    if (w.media.busy) return;
    aiDesignEdit(w, q);
  };
  ACT.wAiQ = (q) => {
    const w = S.wiz;
    if (!isGfx(w) || !w.media || !isAiLay(w.media.layout)) return _wAiQD(q);
    collectWiz();
    if (w.media.busy) return;
    gfxRun(w, { note: ({ 'צבעוני יותר': 'יותר צבע ואנרגיה, עדיין בפלטת המותג', 'פריסה אחרת': 'קומפוזיציה שונה לגמרי', 'כותרת גדולה': 'כותרת גדולה ובולטת הרבה יותר', 'סגנון רשמי': 'סגנון רשמי, שמרני ונקי יותר' })[q] || q });
  };

  // the uploaded logo is the page avatar in every post preview
  const withLogo = (h) => { const l = logoOf(); return l ? h.replace(/<span class="avatar" style="background:var\(--(?:p-navy|brand)\);color:#fff">נה<\/span>/g, '<span class="avatar has-logo"><img src="' + esc(l) + '" alt=""></span>') : h; };
  const _spL = studioPreview; studioPreview = function (o) { return withLogo(_spL(o)); };
  const _ppL = postPreview; postPreview = function (it, r) { return withLogo(_ppL(it, r)); };

  /* =====================================================================
   * ONE LOGO: upload once; the system makes it transparent, trims it,
   * creates a white version for dark backgrounds and derives the brand palette from it
   * ===================================================================== */
  const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
  const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lum = (h) => { const c = rgbOf(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const mix = (a, b, t) => { const x = rgbOf(a), y = rgbOf(b); return hex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t); };
  function hsl(h) { let [r, g, b] = rgbOf(h).map((v) => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); const l = (mx + mn) / 2; let hh = 0, ss = 0;
    if (mx !== mn) { const d = mx - mn; ss = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hh *= 60; }
    return { h: hh, s: ss, l }; }
  const canvasOf = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const blobOf = (c) => new Promise((r) => c.toBlob(r, 'image/png'));
  // an SVG without width/height draws as nothing on a canvas: give it a real size from its viewBox
  async function svgSized(file) {
    if (!/svg/i.test(file.type || '') && !/\.svg$/i.test(file.name || '')) return file;
    const t = await file.text(), m = t.match(/<svg[^>]*>/i);
    if (!m) return file;
    const vb = /viewBox=["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(m[0]);
    // vector: drawn large so the result stays sharp everywhere
    let W = 2400, H = 2400;
    if (vb && +vb[1] && +vb[2]) { const a = +vb[1], b = +vb[2]; if (a >= b) H = Math.round(2400 * b / a); else W = Math.round(2400 * a / b); }
    const tag = m[0].replace(/\s(width|height)=["'][^"']*["']/gi, '').replace(/<svg/i, '<svg width="' + W + '" height="' + H + '"');
    return new Blob([t.replace(m[0], tag)], { type: 'image/svg+xml' });
  }
  async function processLogo(file) {
    const src = URL.createObjectURL(await svgSized(file));
    try {
      const img = await loadImg(src);
      let w = img.naturalWidth || 1000, h = img.naturalHeight || 1000;
      // never enlarge a raster (enlarging only blurs it); very large files come down to 2400px
      const k = Math.max(w, h) > 2400 ? 2400 / Math.max(w, h) : 1;
      w = Math.round(w * k); h = Math.round(h * k);
      const c = canvasOf(w, h), x = c.getContext('2d', { willReadFrequently: true });
      x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
      x.drawImage(img, 0, 0, w, h);
      const im = x.getImageData(0, 0, w, h), d = im.data, N = w * h;
      let clear = 0; for (let i = 3; i < d.length; i += 4) if (d[i] < 245) clear++;
      const hadAlpha = clear > N * 0.01;
      let removed = false;
      if (!hadAlpha) {
        // background = dominant colour of the border; remove it from the edges inwards (keeps white details inside the logo)
        const border = [];
        for (let i = 0; i < w; i++) border.push(i, (h - 1) * w + i);
        for (let j = 0; j < h; j++) border.push(j * w, j * w + w - 1);
        const cnt = new Map();
        for (const p of border) { const q = p * 4, key = (d[q] >> 4) + ',' + (d[q + 1] >> 4) + ',' + (d[q + 2] >> 4); cnt.set(key, (cnt.get(key) || 0) + 1); }
        const [topKey, topN] = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0];
        if (topN / border.length > 0.55) {
          const sel = border.filter((p) => { const q = p * 4; return (d[q] >> 4) + ',' + (d[q + 1] >> 4) + ',' + (d[q + 2] >> 4) === topKey; });
          let br = 0, bg = 0, bb = 0; sel.forEach((p) => { br += d[p * 4]; bg += d[p * 4 + 1]; bb += d[p * 4 + 2]; });
          br /= sel.length; bg /= sel.length; bb /= sel.length;
          const T = 42, dist = (q) => Math.hypot(d[q] - br, d[q + 1] - bg, d[q + 2] - bb);
          const seen = new Uint8Array(N), queue = new Int32Array(N); let qh = 0, qt = 0;
          for (const p of border) if (!seen[p] && dist(p * 4) < T) { seen[p] = 1; queue[qt++] = p; }
          while (qh < qt) {
            const p = queue[qh++], q = p * 4; d[q + 3] = 0;
            const px = p % w, nb = [px > 0 ? p - 1 : -1, px < w - 1 ? p + 1 : -1, p - w, p + w];
            for (const n of nb) {
              if (n < 0 || n >= N || seen[n]) continue;
              seen[n] = 1;
              const dn = dist(n * 4);
              if (dn < T) queue[qt++] = n;
              else if (dn < T * 2) d[n * 4 + 3] = Math.min(d[n * 4 + 3], Math.round(255 * (dn - T) / T)); // soft edge
            }
          }
          removed = qt > N * 0.02;
          x.putImageData(im, 0, 0);
        }
      }
      // trim empty margins
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (d[(j * w + i) * 4 + 3] > 12) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
      if (x1 < 0) { x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1; }
      const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.03), tw = x1 - x0 + 1 + pad * 2, th = y1 - y0 + 1 + pad * 2;
      const out = canvasOf(tw, th); out.getContext('2d').drawImage(c, x0, y0, x1 - x0 + 1, y1 - y0 + 1, pad, pad, x1 - x0 + 1, y1 - y0 + 1);
      // white version for dark backgrounds
      const lt = canvasOf(tw, th), lx = lt.getContext('2d');
      lx.drawImage(out, 0, 0); lx.globalCompositeOperation = 'source-in'; lx.fillStyle = '#FFFFFF'; lx.fillRect(0, 0, tw, th);
      // colours of the logo: opaque pixels, near-white ignored, similar shades merged
      const buckets = new Map(); let tot = 0;
      const od = out.getContext('2d').getImageData(0, 0, tw, th).data;
      for (let i = 0; i < od.length; i += 4) {
        if (od[i + 3] < 200) continue;
        const r = od[i], g = od[i + 1], b = od[i + 2];
        if (r > 236 && g > 236 && b > 236) continue;
        tot++;
        const key = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4), e = buckets.get(key) || [0, 0, 0, 0];
        e[0] += r; e[1] += g; e[2] += b; e[3]++; buckets.set(key, e);
      }
      const clusters = [];
      [...buckets.values()].sort((a, b) => b[3] - a[3]).forEach((e) => {
        const col = [e[0] / e[3], e[1] / e[3], e[2] / e[3]];
        const hit = clusters.find((cl) => Math.hypot(cl.c[0] - col[0], cl.c[1] - col[1], cl.c[2] - col[2]) < 62);
        if (hit) { hit.n += e[3]; } else clusters.push({ c: col, n: e[3] });
      });
      const colors = clusters.filter((cl) => cl.n > tot * 0.015).slice(0, 6).map((cl) => hex(...cl.c));
      // a logo smaller than ~600px on its long side cannot look sharp in graphics and videos
      const low = Math.max(x1 - x0 + 1, y1 - y0 + 1) < 600 && !/svg/i.test(file.type || '') && !/\.svg$/i.test(file.name || '');
      return { png: await blobOf(out), light: await blobOf(lt), colors, removed, hadAlpha, w: tw, h: th, low };
    } finally { URL.revokeObjectURL(src); }
  }
  // brand palette from the logo colours (white text must stay readable on the main colour)
  function paletteFrom(cols) {
    const chroma = cols.filter((c) => { const q = hsl(c); return q.s > 0.18 && q.l > 0.08 && q.l < 0.9; });
    const darks = cols.filter((c) => !chroma.includes(c));
    let primary = chroma[0] || darks[0] || '#0E3B6B';
    let accent = chroma.find((c) => c !== primary && Math.min(Math.abs(hsl(c).h - hsl(primary).h), 360 - Math.abs(hsl(c).h - hsl(primary).h)) > 25) || null;
    // the logo's own colours stay exact; only the helper shades are derived
    const accentOwn = !!accent;
    if (!accent) accent = chroma.find((c) => c !== primary) || mix(primary, '#FFFFFF', 0.35);
    const third = chroma.find((c) => c !== accent && c !== primary);
    const second = third || mix(primary, '#FFFFFF', 0.28);
    let dark = mix(primary, '#000000', 0.32); for (let t = 0; lum(dark) > 0.06 && t < 10; t++) dark = mix(dark, '#000000', 0.15);
    return [['ראשי (מהלוגו)', primary], ['כהה', dark], [accentOwn || chroma.includes(accent) ? 'הדגשה (מהלוגו)' : 'הדגשה', accent], [third ? 'משני (מהלוגו)' : 'משני', second],
      ['טקסט', mix(primary, '#4A5568', 0.78)], ['רקע בהיר', mix(primary, '#FFFFFF', 0.92)], ['ירוק אישור', '#0A6C43'], ['אדום התראה', '#9B1C1C']];
  }
  async function uploadBlob(blob, name) {
    const s = await call('upload.sign', { name });
    const r = await fetch(s.upload, { method: 'PUT', headers: { 'content-type': 'image/png', 'x-upsert': 'true' }, body: blob });
    if (!r.ok) throw new Error('upload_failed');
    return s.url;
  }
  S.logoBusy = '';
  ACT.logoUp = async () => {
    const [file] = await pickFiles('image/png,image/jpeg,image/webp,image/svg+xml');
    if (!file) return;
    if (file.size > MAXB) { toast('הקובץ גדול מדי', 'עד 50MB.', 'err'); return; }
    return logoApply(file);
  };
  async function logoApply(file, quiet) {
    S.logoBusy = 'מעבד את הלוגו: רקע, חיתוך וצבעים...';
    render();
    try {
      const r = await processLogo(file);
      S.logoBusy = 'מעלה את הלוגו...';
      render();
      const [url, light] = await Promise.all([uploadBlob(r.png, 'logo.png'), uploadBlob(r.light, 'logo-white.png')]);
      const pal = paletteFrom(r.colors);
      const apply = (b) => {
        b.logos = [{ n: 'לוגו הארגון', c: pal[0][1], url }];
        b.logoLight = light;
        b.logoInfo = { colors: r.colors, removed: r.removed, hadAlpha: r.hadAlpha, name: file.name, at: new Date().toLocaleDateString('he-IL'), w: r.w, h: r.h, low: !!r.low };
        b.colors = pal;
      };
      apply(BRAND);
      if (S.brandEdit && S.brandDraft) apply(S.brandDraft);
      S.logoBusy = '';
      S.logoFresh = Date.now();
      render();
      flush();
      if (r.low) toast('הלוגו ברזולוציה נמוכה (' + r.w + '×' + r.h + ')', 'כדי שיופיע חד בגרפיקות ובסרטונים, העלו קובץ גדול יותר (לפחות 1000 פיקסלים ברוחב) או קובץ SVG.', 'err');
      else if (r.colors.length) toast('הלוגו עודכן וצבעי המותג הוחלפו', (r.removed ? 'הרקע הוסר אוטומטית. ' : '') + r.colors.length + ' צבעים זוהו בלוגו. הצבע הראשי החדש: \u200E' + pal[0][1]);
      else toast('הלוגו עודכן', 'לא זוהו בלוגו צבעים ברורים, נשארו צבעי ברירת המחדל. אפשר לשנות אותם בלשונית צבעים ופונטים.', 'err');
    } catch (e) {
      S.logoBusy = '';
      render();
      toast('עיבוד הלוגו נכשל', 'נסו קובץ PNG, JPG או SVG אחר.', 'err');
    }
  }
  /* ---------- brand kit: the graphic language derived from the logo (motif, template, logo position, icon style, hot colour) ---------- */
  const KIT_HE = { template: { panel: 'פאנל בהיר + תמונה בצד', fullbleed: 'תמונה מלאה, טקסט על שמיים', bands: 'כותרת על פסי צבע מוטים' }, logoPos: { 'top-center': 'מרכז-עליון', 'top-right': 'ימין-עליון', 'top-left': 'שמאל-עליון' }, icons: { 'line-circle': 'קו דק בעיגול בהיר', 'solid-circle': 'מלא בעיגול צבעוני', solid: 'מלא, בלי עיגול' } };
  let kitBusy = null;
  async function ensureKit(force) {
    if (!force && BRAND.kit && BRAND.kit.logo === logoOf()) return BRAND.kit;
    if (kitBusy) return kitBusy;
    const logo = logoOf();
    if (!logo) return null;
    kitBusy = (async () => {
      try {
        const r = await fx('image', { action: 'brandkit', org: aiCtx().org, logo, colors: brandFor().colors }, 60000);
        if (!r || !r.kit) return BRAND.kit || null;
        const kit = Object.assign({}, r.kit, { logo });
        if (BRAND.kit && BRAND.kit.pin) ['template', 'logoPos', 'icons', 'headline'].forEach((k) => { if (BRAND.kit[k]) kit[k] = BRAND.kit[k]; });
        if (kit.template !== 'bands') kit.headline = 'colored';
        if (BRAND.kit && BRAND.kit.pin) kit.pin = BRAND.kit.pin;
        BRAND.kit = kit; if (S.brandDraft) S.brandDraft.kit = kit;
        flush(); render();
        return kit;
      } catch (e) { return BRAND.kit || null; }
      finally { kitBusy = null; }
    })();
    return kitBusy;
  }
  ACT.kitRedo = async () => { S.kitBusy = true; render(); await ensureKit(true); S.kitBusy = false; render(); toast('השפה הגרפית זוהתה מחדש', (BRAND.kit && BRAND.kit.summary) || ''); };
  ACT.kitSet = (k, v) => { if (!BRAND.kit) return; BRAND.kit[k] = v; if (k === 'template' && v !== 'bands') BRAND.kit.headline = 'colored'; if (k === 'template' && v === 'bands') BRAND.kit.headline = 'bands'; BRAND.kit.pin = true; if (S.brandDraft) S.brandDraft.kit = BRAND.kit; flush(); render(); };
  const _logoApply = logoApply;
  logoApply = async function (file, quiet) { await _logoApply(file, quiet); if (logoOf()) { BRAND.kit = null; ensureKit(true); } };
  function kitCard() {
    const k = BRAND.kit, busy = S.kitBusy || !!kitBusy;
    if (!logoOf()) return '';
    const sel = (key, opts) => '<select data-kit="' + key + '"' + (busy ? ' disabled' : '') + '>' + Object.keys(opts).map((o) => '<option value="' + o + '"' + (k && k[key] === o ? ' selected' : '') + '>' + esc(opts[o]) + '</option>').join('') + '</select>';
    return '<div class="card card-pad" style="margin-bottom:16px"><h3>השפה הגרפית של הארגון</h3><span class="t-sub">נגזרת מהלוגו פעם אחת. כל גרפיקה בנויה על אותו שלד קבוע: לוגו, תגית, כותרת, שורת משנה, קו מוטיב, פרטים ואייקונים, כפתור, תמונה. ככה כל הפוסטים נראים כסדרה אחת.</span>' +
      (busy ? '<div class="lo-busy" style="margin-top:10px">' + thinkBox(1) + '</div>' : k ? '<div class="kit-grid">' +
        '<div><b>מוטיב</b><span>' + esc(k.motif && k.motif.he || '') + '</span></div>' +
        '<div><b>צבע הדגשה</b><span dir="ltr" style="display:flex;gap:6px;align-items:center;justify-content:flex-end"><i style="display:inline-block;width:16px;height:16px;border-radius:5px;background:' + esc(k.hot || '#999') + '"></i>' + esc(k.hot || '') + '</span></div>' +
        '<div><b>תבנית</b>' + sel('template', KIT_HE.template) + '</div>' +
        '<div><b>מיקום הלוגו</b>' + sel('logoPos', KIT_HE.logoPos) + '</div>' +
        '<div><b>אייקונים</b>' + sel('icons', KIT_HE.icons) + '</div>' +
        '</div><div class="t-sub" style="margin-top:8px">' + esc(k.summary || '') + (k.at ? ' · זוהה ' + esc(k.at) : '') + '</div>' : '<div class="t-sub" style="margin-top:10px">עוד לא זוהתה. תזוהה אוטומטית בגרפיקה הראשונה.</div>') +
      '<div style="margin-top:10px"><button class="btn btn-sm" data-act="kitRedo"' + (busy ? ' disabled' : '') + '>' + ic('refresh', 14) + ' זיהוי מחדש מהלוגו</button></div></div>';
  }
  document.addEventListener('change', (e) => { const t = e.target; if (t && t.dataset && t.dataset.kit) ACT.kitSet(t.dataset.kit, t.value); });
  css.textContent += `
.kit-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:12px}.kit-grid>div{display:flex;flex-direction:column;gap:4px;min-width:0}.kit-grid b{font-size:12.5px;color:var(--ink-3,#5A6386)}.kit-grid select{font:inherit;padding:6px 8px;border:1px solid var(--line,#DDE3EC);border-radius:8px;background:var(--surface,#fff)}`;
  // a logo saved before the automatic processing existed: process it once, so the brand colours come from it
  let logoMigrating = false;
  async function migrateLogo() {
    if (logoMigrating || S.logoBusy || BRAND.logoInfo) return;
    const l = (BRAND.logos || []).find((x) => x.url && !/הפוך|לבן/.test(x.n)) || (BRAND.logos || []).find((x) => x.url);
    if (!l) return;
    logoMigrating = true;
    try {
      const res = await fetch(l.url, { cache: 'no-store' });
      if (!res.ok) throw new Error('fetch');
      const blob = await res.blob();
      const name = (l.url.split('/').pop() || 'logo.png').split('?')[0];
      const file = new File([blob], name, { type: blob.type || 'image/png' });
      await logoApply(file);
    } catch (e) { /* keep the existing logo as is */ }
    finally { logoMigrating = false; }
  }
  (function waitReady() { if (L.ready) { if (L.kind !== 'admin') setTimeout(migrateLogo, 1200); } else setTimeout(waitReady, 500); })();
  ACT.bAddLogo = () => ACT.logoUp();
  const _brandFor2 = brandFor;
  brandFor = function (dept) { const b = _brandFor2(dept); if (BRAND.logoLight && b.logo) b.logoLight = BRAND.logoLight; return b; };
  css.textContent += `
.logo-one{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:22px;align-items:center;margin-bottom:16px}
.lo-prev{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;min-width:0}
.lo-prev>div{position:relative;aspect-ratio:4/3;min-width:0;overflow:hidden;border-radius:14px;display:grid;place-items:center;padding:18px;border:1px solid var(--line,#DDE3EC)}
.lo-prev .lo-l{background:repeating-conic-gradient(#EEF1F6 0 25%,#fff 0 50%) 50%/18px 18px}
.lo-prev img{position:absolute;inset:14%;width:72%;height:72%;object-fit:contain}
.lo-prev small{display:block;text-align:center;font-size:12px;color:var(--ink-3,#5A6386);margin-top:6px}
.lo-info{display:flex;flex-direction:column;gap:10px}.lo-info h3{margin:0;font-size:17px}
.lo-chips{display:flex;flex-wrap:wrap;gap:8px}.lo-chips span{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;direction:ltr;border:1px solid var(--line,#DDE3EC);border-radius:999px;padding:4px 10px 4px 5px}
.lo-chips i{width:20px;height:20px;border-radius:50%;display:block;box-shadow:inset 0 0 0 1px rgba(0,0,0,.08)}
.lo-busy{display:flex;align-items:center;gap:10px;font-weight:700;color:var(--brand,#0E3B6B)}
.lo-pal{border:1px solid var(--line,#DDE3EC);border-radius:12px;padding:10px 12px}.lo-pal.fresh{animation:loFresh 2.4s ease-out 2}
@keyframes loFresh{0%{box-shadow:0 0 0 0 rgba(14,59,107,.45)}100%{box-shadow:0 0 0 12px rgba(14,59,107,0)}}
.lo-sw{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin-top:8px}.lo-sw span{display:flex;flex-direction:column;gap:3px;min-width:0}
.lo-sw i{display:block;height:34px;border-radius:8px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.08)}.lo-sw em{font-style:normal;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.lo-sw small{font-size:11px;color:var(--ink-3,#5A6386);text-align:right}
@media (max-width:520px){.lo-sw{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:760px){.logo-one{grid-template-columns:1fr}}`;
  const _brandR = SCREENS.brand.render;
  SCREENS.brand.render = function () {
    let h = _brandR.call(this);
    if ((S.tab.brand || 'logos') !== 'logos') return h;
    const b = S.brandEdit && S.brandDraft ? S.brandDraft : BRAND;
    const l = (b.logos || []).find((x) => x.url), info = b.logoInfo || {};
    if (l && !BRAND.logoInfo && !S.logoBusy) setTimeout(migrateLogo, 0);
    const prev = l
      ? '<div class="lo-prev"><div class="lo-l"><img src="' + esc(l.url) + '" alt="הלוגו" onload="if(Math.max(this.naturalWidth,this.naturalHeight)<600){var n=document.getElementById(\'loLow\');if(n)n.hidden=false}"></div><div class="lo-d" style="background:' + esc((b.colors[0] || [])[1] || '#0E3B6B') + '"><img src="' + esc(b.logoLight || l.url) + '" alt="הלוגו על רקע כהה"></div></div>'
      : '<div class="lo-prev"><div class="lo-l" style="background:var(--surface-2,#F3F5F9)"><span class="t-sub">עוד לא הועלה לוגו</span></div><div class="lo-d" style="background:#0E3B6B"><span style="color:#fff;font-size:13px">גרסה לרקע כהה</span></div></div>';
    const panel = '<div class="card card-pad logo-one">' + prev + '<div class="lo-info"><h3>הלוגו של הארגון</h3>' +
      '<span class="t-sub">מעלים לוגו אחד. המערכת מסירה רקע אם צריך, חותכת שוליים, יוצרת גרסה לבנה לרקע כהה ומחלצת ממנו את צבעי המותג.</span>' +
      (S.logoBusy ? '<div class="lo-busy">' + thinkBox(1) + '</div>' : '') +
      (l && info.colors ? '<div class="lo-pal' + (S.logoFresh && Date.now() - S.logoFresh < 8000 ? ' fresh' : '') + '"><b style="font-size:13.5px">צבעי המותג, נשלפו מהלוגו</b><div class="lo-sw">' + (b.colors || []).slice(0, 6).map((c) => '<span title="' + esc(c[0]) + '"><i style="background:' + esc(c[1]) + '"></i><em>' + esc(c[0].replace(/ \(מהלוגו\)/, '')) + '</em><small dir="ltr">' + esc(c[1]) + '</small></span>').join('') + '</div></div>' : '') +
      (l && info.colors ? '<div><b style="font-size:13.5px">הצבעים שזוהו בלוגו</b><div class="lo-chips" style="margin-top:6px">' + info.colors.map((c) => '<span><i style="background:' + c + '"></i>' + c + '</span>').join('') + '</div></div>' +
        '<div class="note">' + ic('palette', 15) + '<span>הוחלו על צבעי המותג' + (info.removed ? ' · הרקע הוסר אוטומטית' : info.hadAlpha ? ' · הלוגו הגיע שקוף' : '') + '. <button class="link-btn" data-act="tab:brand:colors" style="background:none;border:0;padding:0;font:inherit;color:var(--brand);font-weight:700;cursor:pointer">לצבעים ופונטים</button></span></div>' : '') +
      (l ? '<div class="note warn" id="loLow" role="status"' + (info.low ? '' : ' hidden') + '>' + ic('alert', 15) + '<span><b>הלוגו ברזולוציה נמוכה</b> ולכן עלול להיראות מטושטש בגרפיקות ובסרטונים. העלו את קובץ המקור: SVG, או PNG ברוחב 1000 פיקסלים לפחות.</span></div>' : '') +
      '<div><button class="btn btn-primary" data-act="logoUp"' + (S.logoBusy ? ' disabled' : '') + '>' + ic('upload', 16) + ' ' + (l ? 'החלפת לוגו' : 'העלאת לוגו') + '</button></div>' +
      '<span class="t-sub">מומלץ SVG, או PNG ברוחב 1000 פיקסלים לפחות. רקע אחיד מוסר אוטומטית.</span></div></div>';
    return h.replace(/<div class="grid g-4">[\s\S]*?(<div class="card card-pad lp-card">)/, panel + kitCard() + '$1');
  };
  // the logo position preview shows the real logo
  const _lpp = logoPosPreview;
  logoPosPreview = function (pos, size, bg) {
    const bc = BRAND.colors || [];
    const h = _lpp(pos, size, bg || (bc[0] && bc[1] ? 'linear-gradient(140deg,' + bc[1][1] + ',' + bc[0][1] + ')' : bg));
    const l = BRAND.logoLight || logoOf();
    return l ? h.replace(/<span class="sp-logo([^"]*)"><i>נה<\/i>נווה הדר<\/span>/, '<span class="sp-logo$1" style="background:none;padding:0"><img src="' + esc(l) + '" alt="" style="height:30px;width:auto;max-width:120px;object-fit:contain;display:block"></span>') : h;
  };
  /* ---------- personal templates: the organisation's own design; the system keeps its structure and changes only texts and imagery ---------- */
  const tplsMine = (b) => ((b || BRAND).tpls || []).filter((t) => t && t.url);
  const stripBuiltIn = () => { BRAND.tpls = tplsMine(BRAND); if (S.brandDraft && S.brandDraft.tpls) S.brandDraft.tpls = tplsMine(S.brandDraft); };
  stripBuiltIn();
  const RATIO_LIST = [['1:1', 1], ['4:5', 0.8], ['9:16', 0.5625], ['16:9', 16 / 9], ['1.91:1', 1.91]];
  const ratioOf = (w, h) => RATIO_LIST.reduce((a, x) => (Math.abs(Math.log(w / h / x[1])) < Math.abs(Math.log(w / h / a[1])) ? x : a))[0];
  function layPickHtml(m, busy) {
    const opts = [['ai', 'עיצוב AI חופשי']].concat(tplsMine().map((t) => ['tpl:' + t.id, t.n]));
    if (!opts.some((o) => o[0] === m.layout)) { const b = LAY.find((x) => x[0] === m.layout); if (b) opts.push([b[0], b[1] + ' (גיבוי)']); }
    return '<div class="t-sub" style="margin-bottom:6px">' + (tplsMine().length ? 'עיצוב חופשי בצבעי המותג, או תבנית אישית של הארגון:' : 'עיצוב חופשי בצבעי המותג. <button class="link-btn tpl-link" data-act="tplGo">להעלאת תבנית אישית</button>') + '</div>' +
      '<div class="lay-pick" role="radiogroup" aria-label="פריסה">' + opts.map((o) => '<button class="' + (m.layout === o[0] ? 'on' : '') + '" data-act="gLay:' + esc(o[0]) + '"' + (busy ? ' disabled' : '') + ' role="radio" aria-checked="' + (m.layout === o[0]) + '">' + esc(o[1]) + '</button>').join('') + '</div>';
  }
  ACT.tplGo = () => { S.tab.brand = 'templates'; go('brand'); };
  // upload drawer
  function tplUpDrawer() {
    const u = S.tplU || {};
    const prev = u.url
      ? '<div class="tplu-prev"><img src="' + esc(u.url) + '" alt="התבנית"></div>'
      : '<button class="upload" data-act="tplPick" style="width:100%"' + (u.busy ? ' disabled' : '') + '><div class="ui">' + ic('upload', 18) + '</div><div style="font-weight:600;font-size:13.5px">העלאת העיצוב של התבנית</div><div class="t-sub">PNG או JPG של העיצוב המלא, כמו שהוא אמור להתפרסם</div></button>';
    return '<div class="drawer-head"><div><h3>תבנית אישית חדשה</h3><p>מעלים עיצוב שנבנה לארגון. המערכת שומרת על המבנה ומחליפה רק טקסטים ותמונה לפי כל בקשה.</p></div><button class="icon-btn" style="margin-inline-start:auto" data-act="closeDrawer" aria-label="סגירה">' + ic('x', 17) + '</button></div>' +
      '<div class="drawer-body">' + prev +
      (u.busy ? '<div class="lo-busy" style="margin-top:12px">' + thinkBox(1) + '</div>' : '') +
      (u.url && !u.busy ? '<div class="real-acts" style="margin-top:10px"><button class="btn btn-sm" data-act="tplPick">' + ic('upload', 14) + ' החלפת הקובץ</button></div>' : '') +
      (u.scan ? '<div class="note" style="margin-top:12px">' + ic('checkc', 15) + '<span>' + esc(u.scan.summary || 'התבנית נקראה.') + '</span></div>' +
        ((u.scan.slots || []).length ? '<div class="field" style="margin-top:12px"><label>אזורי הטקסט שזוהו</label><div class="tplu-slots">' + u.scan.slots.map((x) => '<span class="chip">' + esc(x.he || x.role) + (x.fixed ? ' · קבוע' : ' · מתחלף') + '</span>').join('') + '</div></div>' : '') : '') +
      (u.err ? '<div class="note ai-warn">' + ic('alert', 15) + '<span>' + esc(u.err) + '</span></div>' : '') +
      '<div class="field" style="margin-top:14px"><label for="tuN">שם התבנית</label><input type="text" id="tuN" value="' + esc(u.n || '') + '" placeholder="לדוגמה: הודעה לתושבים"></div>' +
      (u.r ? '<div class="t-sub">יחס התבנית: <span dir="ltr">' + esc(u.r) + '</span>. בפורמטים אחרים העיצוב מותאם לגודל בלי חיתוך.</div>' : '') +
      '</div><div class="drawer-foot"><button class="btn btn-primary" data-act="tplUpSave"' + (!u.url || u.busy ? ' disabled' : '') + '>' + ic('save', 16) + ' שמירת התבנית</button><button class="btn" data-act="closeDrawer">ביטול</button></div>';
  }
  const tplRedraw = () => { const n = $('#tuN'); if (n && S.tplU) S.tplU.n = n.value; const d = $('#drawer'); if (d && d.classList.contains('on') && S.tplU) d.innerHTML = tplUpDrawer(); };
  ACT.tplNew = () => { S.tplU = { n: '' }; openDrawer(tplUpDrawer()); };
  ACT.tplPick = async () => {
    const u = S.tplU; if (!u) return;
    const nEl = $('#tuN'); if (nEl) u.n = nEl.value;
    const [f] = await pickFiles('image/png,image/jpeg,image/webp');
    if (!f || S.tplU !== u) return;
    u.err = ''; u.scan = null; u.busy = 'מעלה את העיצוב...'; tplRedraw();
    try {
      const src = URL.createObjectURL(f); const img = await loadImg(src); URL.revokeObjectURL(src);
      u.w = img.naturalWidth; u.h = img.naturalHeight; u.r = ratioOf(u.w, u.h);
      const up = await uploadFile(f);
      u.url = up.url;
      if (!u.n) u.n = f.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ');
      u.busy = 'Claude קורא את מבנה התבנית: אזורי טקסט, תמונה ולוגו...'; tplRedraw();
      try { u.scan = await fx('image', { action: 'tplscan', url: u.url }, 90000); }
      catch (e) { u.err = 'קריאת המבנה לא הושלמה. אפשר לשמור בכל זאת, המבנה ייקרא בזמן העיצוב.'; }
    } catch (e) { u.err = e && e.message === 'too_big' ? 'הקובץ גדול מ-50MB.' : 'ההעלאה נכשלה. נסו שוב.'; }
    u.busy = ''; tplRedraw();
  };
  ACT.tplUpSave = () => {
    const u = S.tplU; if (!u || !u.url || u.busy) return;
    const nEl = $('#tuN'); if (nEl) u.n = nEl.value;
    if (!(u.n || '').trim()) { toast('חסר שם לתבנית', 'תנו לתבנית שם כדי לשמור.', 'err'); return; }
    const sc = u.scan || {};
    const rec = { id: Date.now().toString(36), n: u.n.trim(), ty: 'graphic', r: u.r || '1:1', url: u.url, w: u.w, h: u.h, desc: sc.desc || '', slots: sc.slots || [], image: sc.image || '', summary: sc.summary || '', mine: true, by: curUser().n, at: new Date().toLocaleDateString('he-IL'), lay: 0, bg: 0 };
    BRAND.tpls = [rec, ...tplsMine(BRAND)];
    if (S.brandEdit && S.brandDraft) S.brandDraft.tpls = [rec, ...tplsMine(S.brandDraft)];
    S.tplU = null; closeDrawer(); S.tab.brand = 'templates'; render(); flush();
    toast('התבנית נשמרה', '„' + rec.n + '” זמינה ביצירת גרפיקה.');
  };
  ACT.tplDel = (id) => {
    confirmModal({ title: 'למחוק את התבנית?', body: 'התבנית תוסר מנכסי המותג. תכנים שכבר נוצרו ממנה לא ישתנו.', ok: 'מחיקה', cancel: 'ביטול', onOk: () => {
      BRAND.tpls = tplsMine(BRAND).filter((t) => String(t.id) !== String(id));
      if (S.brandDraft && S.brandDraft.tpls) S.brandDraft.tpls = tplsMine(S.brandDraft).filter((t) => String(t.id) !== String(id));
      render(); flush(); toast('התבנית נמחקה', '');
    } });
  };
  ACT.tplUse = (id) => {
    const t = tplsMine().find((x) => String(x.id) === String(id)); if (!t) return;
    ACT.wiz('graphic');
    if (S.wiz) { S.wiz.tpl0 = t.id; if (t.r) { S.wiz.fmts = [t.r]; S.wiz.fmt = t.r; } render(); toast('התבנית „' + t.n + '” נבחרה', 'כתבו בריף. המערכת תשמור על המבנה ותחליף טקסטים ותמונה.'); }
  };
  ACT.tplEdit = (i) => { const t = tplsMine((S.brandEdit && S.brandDraft) || BRAND)[+i]; if (t) ACT.tplUse(t.id); };
  css.textContent += `
.tplu-prev{border:1px solid var(--line,#DDE3EC);border-radius:12px;background:repeating-conic-gradient(#EEF1F6 0 25%,#fff 0 50%) 50%/18px 18px;padding:10px;display:grid;place-items:center}
.tplu-prev img{max-width:100%;max-height:340px;object-fit:contain;display:block;border-radius:6px}
.tplu-slots{display:flex;flex-wrap:wrap;gap:6px}
.tpl-link{background:none;border:0;padding:0;font:inherit;color:var(--brand,#0E3B6B);font-weight:700;cursor:pointer}
.cc .thumb.tpl-img{background:repeating-conic-gradient(#EEF1F6 0 25%,#fff 0 50%) 50%/16px 16px!important;padding:8px;height:230px;display:flex;align-items:center;justify-content:center}.cc .thumb.tpl-img::before,.cc .thumb.tpl-img::after{display:none!important}.cc .thumb.tpl-img img{height:100%;width:auto;max-width:100%;object-fit:contain;display:block;border-radius:6px;box-shadow:0 2px 10px rgba(14,30,60,.15)}
.tpl-empty{grid-column:1/-1}`;
  // brand screen, templates tab: only the add button and the organisation's own templates
  /* ---- brand: the typeface used on AI graphics (by style, or one fixed family for the organisation) ---- */
  const GFX_FONTS = ['Heebo', 'Assistant', 'Rubik', 'Secular One', 'Alef', 'Karantina', 'Suez One', 'Miriam Libre'];
  const GFX_FONT_HE = { Heebo: 'Heebo (נקי, רשמי)', Assistant: 'Assistant (קל, קריא)', Rubik: 'Rubik (עגול, ידידותי)', 'Secular One': 'Secular One (כותרות בולטות)', Alef: 'Alef (הומני, דוקומנטרי)', Karantina: 'Karantina (צר, פוסטרי)', 'Suez One': 'Suez One (כבד, יוקרתי)', 'Miriam Libre': 'Miriam Libre (קלאסי)' };
  const _brandRF = SCREENS.brand.render;
  SCREENS.brand.render = function () {
    let h = _brandRF.apply(this, arguments);
    if ((S.tab.brand || 'logos') !== 'colors') return h;
    const b = S.brandEdit ? S.brandDraft : BRAND;
    const cur = b.font && GFX_FONTS.includes(b.font) ? b.font : 'auto';
    const field = S.brandEdit
      ? '<div class="field"><label>פונט לגרפיקות AI</label><select data-bk="font"><option value="auto"' + (cur === 'auto' ? ' selected' : '') + '>לפי סגנון הגרפיקה (מומלץ)</option>' + GFX_FONTS.map((f) => '<option value="' + f + '"' + (f === cur ? ' selected' : '') + '>' + esc(GFX_FONT_HE[f]) + '</option>').join('') + '</select></div>'
      : '<div style="font-size:15px;margin-top:6px">פונט לגרפיקות AI: ' + (cur === 'auto' ? 'לפי סגנון הגרפיקה' : esc(GFX_FONT_HE[cur])) + '</div>';
    // the field joins the existing fonts card, right after the body font
    const i = h.indexOf('data-bk="fonts.b"');
    if (i < 0) { const j = h.indexOf('גוף טקסט לפרסומים'); if (j < 0) return h; const k = h.indexOf('</div>', j); return h.slice(0, k + 6) + field + h.slice(k + 6); }
    const k = h.indexOf('</select></div>', i);
    return k < 0 ? h : h.slice(0, k + 15) + field + h.slice(k + 15);
  };
  const _brandRT = SCREENS.brand.render;
  SCREENS.brand.render = function () {
    stripBuiltIn();
    if ((S.tab.brand || 'logos') === 'colors') return _brandRT.call(this).replace(/<div class="t-sub">(#[0-9A-Fa-f]{6})<\/div>/g, '<div class="t-sub" dir="ltr" style="text-align:right">$1</div>');
    if ((S.tab.brand || 'logos') !== 'templates') return _brandRT.call(this);
    const keepB = BRAND.tpls, keepD = S.brandDraft && S.brandDraft.tpls;
    BRAND.tpls = []; if (S.brandDraft) S.brandDraft.tpls = [];
    let h;
    try { h = _brandRT.call(this); } finally { BRAND.tpls = keepB; if (S.brandDraft) S.brandDraft.tpls = keepD; }
    const list = tplsMine(S.brandEdit && S.brandDraft ? S.brandDraft : BRAND);
    const cards = list.map((t) => '<div class="cc"><div class="thumb tpl-img"><img src="' + esc(t.url) + '" alt="' + esc(t.n) + '" loading="lazy"></div>' +
      '<div class="cc-body"><span class="cc-title">' + esc(t.n) + '</span><span class="cc-meta">גרפיקה · <span dir="ltr">' + esc(t.r) + '</span>' + (t.by ? ' · הועלתה על ידי ' + esc(t.by) : '') + '</span>' + (t.summary ? '<span class="t-sub" style="font-size:12.5px">' + esc(t.summary) + '</span>' : '') + '</div>' +
      '<div class="cc-foot"><button class="btn btn-sm" data-act="tplUse:' + esc(t.id) + '">שימוש בתבנית</button><button class="icon-btn" style="margin-inline-start:auto" data-act="tplDel:' + esc(t.id) + '" aria-label="מחיקת התבנית">' + ic('x', 15) + '</button></div></div>').join('');
    const empty = list.length ? '' : '<div class="note tpl-empty">' + ic('palette', 15) + '<span>עוד אין תבניות. מעלים עיצוב אישי שנבנה לארגון, והמערכת תעבוד לפיו: תשמור על המבנה ותחליף רק את הטקסטים והתמונה לפי כל בקשה.</span></div>';
    return h.replace(/(<button class="card add-card tall" data-act="tplNew">)[\s\S]*?(<\/button>)/, '$1' + ic('create', 24) + '<b>יצירת תבנית אישית</b><span class="t-sub">העלאת עיצוב שנבנה לארגון</span>$2' + cards + empty);
  };
  // the brief shows which template will be filled
  const _wizRT = SCREENS.wizard.render;
  SCREENS.wizard.render = function () {
    const h = _wizRT.call(this), w = S.wiz, t = w && w.step === 0 && w.tpl0 ? tplOf('tpl:' + w.tpl0) : null;
    if (!t) return h;
    return h.replace('<div class="brief-tools">', '<div class="note tpl-on"><img src="' + esc(t.url) + '" alt=""><span>התוכן ייבנה בתבנית <b>„' + esc(t.n) + '”</b>: המבנה נשמר, הטקסטים והתמונה מתחלפים לפי הבריף.</span><button class="icon-btn" data-act="tplOff" aria-label="ביטול התבנית">' + ic('x', 14) + '</button></div><div class="brief-tools">');
  };
  ACT.tplOff = () => { if (S.wiz) { S.wiz.tpl0 = null; render(); } };
  css.textContent += `.tpl-on{display:flex;align-items:center;gap:10px;margin:10px 0}.tpl-on img{width:40px;height:40px;object-fit:cover;border-radius:6px;flex:0 0 auto}.tpl-on span{flex:1}`;

  /* ---------- onboarding, brand step: the real logo, colours pulled from it, documents read by Claude ---------- */
  const _obR = SCREENS.onboard.render;
  SCREENS.onboard.render = function () {
    let h = _obR.call(this);
    if (S.onboardStep !== 1) return h;
    const l = (BRAND.logos || []).find((x) => x.url), info = BRAND.logoInfo || {};
    const cols = (BRAND.colors || []).slice(0, 4);
    const logoField = '<div class="field"><label>לוגו הארגון</label>' + (l
      ? '<div class="ob-logo"><div class="lo-l"><img src="' + esc(l.url) + '" alt="הלוגו"></div><div><b style="font-size:13.5px">הלוגו נקלט</b><div class="t-sub">' + (info.removed ? 'הרקע הוסר אוטומטית. ' : '') + (info.colors && info.colors.length ? 'צבעי המותג נשלפו מהלוגו.' : '') + '</div><button class="btn btn-sm" data-act="logoUp" style="margin-top:8px"' + (S.logoBusy ? ' disabled' : '') + '>' + ic('upload', 14) + ' החלפת לוגו</button></div></div>'
      : '<button class="upload" data-act="logoUp" style="width:100%"' + (S.logoBusy ? ' disabled' : '') + '><div class="ui">' + ic('upload', 18) + '</div><div style="font-weight:600;font-size:13.5px">העלאת קובץ לוגו</div><div class="t-sub">קובץ אחד מספיק. הרקע מוסר אוטומטית וצבעי המותג נשלפים מהלוגו.</div></button>') +
      (S.logoBusy ? '<div class="lo-busy" style="margin-top:8px">' + thinkBox(1) + '</div>' : '') + '</div>';
    h = h.replace(/<div class="field"><label>לוגו הארגון<\/label><div class="upload" data-act="fakeUpload">[\s\S]*?ברקע שקוף<\/div><\/div><\/div>/, logoField);
    h = h.replace(/(<div class="field"><label>צבעי המותג<\/label><div class="grid g-4" style="gap:10px">)[\s\S]*?(<\/div><\/div><div class="field"><label>סגנון השפה)/,
      '$1' + cols.map((c) => '<div><div class="swatch" style="background:' + esc(c[1]) + '"></div><div style="font-size:12.5px;font-weight:600;margin-top:5px">' + esc(c[0]) + '</div><div class="t-sub" dir="ltr" style="text-align:right">' + esc(c[1]) + '</div></div>').join('') + '$2');
    const p0 = (cols[0] || [])[1] || '#0E3B6B';
    h = h.replace('<div style="background:#0E3B6B;color:#fff;padding:18px">', '<div style="background:' + esc(p0) + ';color:#fff;padding:18px;display:flex;align-items:center;gap:12px">' + (BRAND.logoLight ? '<img src="' + esc(BRAND.logoLight) + '" alt="" style="height:40px;width:auto;max-width:110px;object-fit:contain">' : '') + '<div>');
    h = h.replace(/(שפה רשמית · Heebo<\/div>)<\/div>/, '$1</div></div>');
    h = h.replace(/(<span style="flex:1;height:24px;border-radius:5px;background:#[0-9A-Fa-f]{6}"><\/span>)+/, (BRAND.colors || []).slice(0, 6).map((c) => '<span style="flex:1;height:24px;border-radius:5px;background:' + esc(c[1]) + '"></span>').join(''));
    return h;
  };
  css.textContent += `
.ob-logo{display:flex;gap:14px;align-items:center;border:1px solid var(--line,#DDE3EC);border-radius:12px;padding:10px}
.ob-logo .lo-l{width:120px;aspect-ratio:4/3;border-radius:10px;display:grid;place-items:center;padding:10px;background:repeating-conic-gradient(#EEF1F6 0 25%,#fff 0 50%) 50%/16px 16px;flex:0 0 auto}
.ob-logo img{max-width:100%;max-height:100%;object-fit:contain}`;
  // onboarding "previous content" upload: Claude learns the brand from it
  const _fakeUpT = ACT.fakeUpload;
  ACT.fakeUpload = async () => {
    if (S.route === 'onboard') {
      const fs = await uploadPicked('.pdf,.docx,.pptx,.txt,.csv,image/*', true);
      if (fs.length) { learnBrand(fs, () => BRAND); toast('המסמכים הועלו', 'המערכת לומדת מהם את שפת הארגון.'); }
      return;
    }
    return _fakeUpT();
  };
  /* ---------- the organisation's website: up-to-date details and the writing rules come from it ---------- */
  S.siteBusy = '';
  const normUrl = (u) => String(u || '').trim().replace(/\s+/g, '');
  async function siteScan(url, quiet) {
    url = normUrl(url);
    if (!url || S.siteBusy) return;
    S.siteBusy = 'קורא את האתר: דף הבית, צור קשר, מחלקות וחדשות... (עד שתי דקות)';
    if (!quiet) render();
    try {
      const r = await fx('generate', Object.assign(aiCtx(), { mode: 'site', url }), 175000);
      const t = BRAND, ch = [];
      t.site = { url: r.url || url, title: r.title || '', summary: r.summary || '', facts: r.facts || {}, depts: r.depts || [], news: r.news || [], terms: r.terms || [], pages: r.pages || [], at: Date.now() };
      t.rules = t.rules || { tone: '', good: [], bad: [] };
      if (r.tone) { t.rules.tone = r.tone; ch.push('טון הכתיבה'); }
      if ((r.good || []).length) { t.rules.good = [...new Set([...r.good, ...(t.rules.good || [])])].slice(0, 10); ch.push(r.good.length + ' כללים מועדפים'); }
      if ((r.bad || []).length) { t.rules.bad = [...new Set([...r.bad, ...(t.rules.bad || [])])].slice(0, 8); ch.push(r.bad.length + ' כללי הימנעות'); }
      if (S.brandEdit && S.brandDraft) { S.brandDraft.site = t.site; S.brandDraft.rules = JSON.parse(JSON.stringify(t.rules)); }
      S.siteBusy = '';
      render(); flush();
      if (!quiet) toast('האתר נקרא וכללי הכתיבה עודכנו', ((r.pages || []).length ? r.pages.length + ' עמודים נקראו. ' : '') + 'עודכנו: ' + (ch.join(', ') || 'פרטי הארגון') + '.');
    } catch (e) {
      S.siteBusy = '';
      if (BRAND.site) BRAND.site.err = e && e.message;
      render();
      if (!quiet) toast('לא הצלחנו לקרוא את האתר', e && /unreachable|bad_url/.test(e.message || '') ? 'בדקו את הכתובת. ייתכן שהאתר חוסם קריאה אוטומטית.' : 'נסו שוב בעוד רגע.', 'err');
    }
  }
  ACT.siteScan = () => { const i = $('#siteUrl'); const u = normUrl(i ? i.value : (BRAND.site && BRAND.site.url)); if (!u) { toast('חסרה כתובת אתר', 'הזינו את כתובת האתר הרשמי.', 'err'); return; } BRAND.site = Object.assign(BRAND.site || {}, { url: u }); siteScan(u); };
  const ago = (t) => { const d = Math.floor((Date.now() - t) / 86400000); return d <= 0 ? 'היום' : d === 1 ? 'אתמול' : 'לפני ' + d + ' ימים'; };
  function siteCard() {
    const st = BRAND.site || {}, f = st.facts || {};
    const rows = [['טלפון', f.phone], ['מוקד', f.hotline], ['דוא"ל', f.email], ['כתובת', f.address], ['קבלת קהל', f.hours], ['ראש הארגון', f.mayor]].filter((x) => x[1]);
    return '<div class="card card-pad site-card"><div class="sc-head"><div><h3>אתר הארגון</h3><span class="t-sub">המערכת קוראת את האתר הרשמי, בונה ממנו את כללי הכתיבה ומשתמשת בפרטים המעודכנים שבו בכל תוכן. נקרא מחדש אוטומטית כל יומיים.</span></div></div>' +
      '<div class="sc-row"><input type="text" inputmode="url" autocomplete="url" id="siteUrl" dir="ltr" placeholder="www.example.muni.il" value="' + esc(st.url || '') + '"' + (S.siteBusy ? ' disabled' : '') + '><button class="btn btn-primary" data-act="siteScan"' + (S.siteBusy ? ' disabled' : '') + '>' + ic('refresh', 15) + ' ' + (st.at ? 'קריאה מחדש' : 'קריאת האתר') + '</button></div>' +
      (S.siteBusy ? '<div class="lo-busy">' + thinkBox(1) + '</div>' : '') +
      (st.at ? '<div class="note">' + ic('checkc', 15) + '<span>נקרא ' + ago(st.at) + ((st.pages || []).length ? ' · ' + st.pages.length + ' עמודים' : '') + (st.summary ? ' · ' + esc(st.summary) : '') + '</span></div>' : '') +
      (st.err && !st.at ? '<div class="note ai-warn">' + ic('alert', 15) + '<span>הקריאה האחרונה נכשלה. בדקו את הכתובת ונסו שוב.</span></div>' : '') +
      (rows.length ? '<div class="sc-facts">' + rows.map((x) => '<div><small>' + x[0] + '</small><b>' + esc(x[1]) + '</b></div>').join('') + '</div>' : '') +
      ((st.depts || []).length ? '<div><b style="font-size:13.5px">מחלקות שזוהו באתר</b><div class="tplu-slots" style="margin-top:6px">' + st.depts.slice(0, 12).map((d) => '<span class="chip">' + esc(d.n) + '</span>').join('') + '</div></div>' : '') +
      ((st.terms || []).length ? '<div><b style="font-size:13.5px">מונחים רשמיים</b><div class="tplu-slots" style="margin-top:6px">' + st.terms.slice(0, 16).map((x) => '<span class="chip">' + esc(x) + '</span>').join('') + '</div></div>' : '') +
      '</div>';
  }
  css.textContent += `
.card-pad > h3 + p[style*="line-height:1.7"]{display:block!important}
@media(max-width:900px){.rv-strip{padding-bottom:170px}}
.site-card{display:flex;flex-direction:column;gap:12px;margin-bottom:16px}.site-card h3{margin:0 0 4px;font-size:15.5px}
.sc-row{display:flex;gap:8px}.sc-row input{flex:1;min-width:0;border:1px solid var(--line,#DDE3EC);border-radius:10px;padding:10px 12px;font:inherit;background:#fff;text-align:left}
.sc-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.sc-facts>div{border:1px solid var(--line,#DDE3EC);border-radius:10px;padding:8px 10px;display:flex;flex-direction:column;gap:2px;min-width:0}
.sc-facts small{font-size:11.5px;color:var(--ink-3,#5A6386)}.sc-facts b{font-size:13px;font-weight:600;overflow-wrap:anywhere}
@media (max-width:640px){.sc-row{flex-direction:column}.sc-facts{grid-template-columns:1fr 1fr}}`;
  const _brandRS = SCREENS.brand.render;
  SCREENS.brand.render = function () {
    const h = _brandRS.call(this);
    if ((S.tab.brand || 'logos') !== 'rules') return h;
    return h.replace('<div class="card card-pad"><h3 style="margin:0 0 12px;font-size:15.5px">טון הכתיבה</h3>', siteCard() + '<div class="card card-pad"><h3 style="margin:0 0 12px;font-size:15.5px">טון הכתיבה</h3>');
  };
  // onboarding, organisation step: the website address is read in the background
  const _obRS = SCREENS.onboard.render;
  SCREENS.onboard.render = function () {
    const h = _obRS.call(this);
    if (S.onboardStep !== 0) return h;
    return h.replace(/(<label>אתר אינטרנט<\/label>)<input type="text" value="[^"]*">/, '$1<input type="text" inputmode="url" autocomplete="url" id="obSite" dir="ltr" style="text-align:left" placeholder="www.example.muni.il" value="' + esc((BRAND.site && BRAND.site.url) || '') + '"><span class="t-sub" style="margin-top:4px">המערכת תקרא את האתר ותבנה ממנו את כללי הכתיבה.</span>');
  };
  const _obNextS = ACT.obNext;
  ACT.obNext = () => {
    if (S.onboardStep === 0) { const i = $('#obSite'); const u = normUrl(i && i.value); if (u && (!BRAND.site || BRAND.site.url !== u || !BRAND.site.at)) { BRAND.site = Object.assign(BRAND.site || {}, { url: u }); siteScan(u, true).then(() => { if (BRAND.site && BRAND.site.at) toast('האתר נקרא', 'כללי הכתיבה נבנו מהאתר. אפשר לראות אותם בנכסי מותג.'); }); } }
    return _obNextS();
  };
  // keep it current: read again when the last read is older than two days
  (function siteAuto() { if (!L.ready) { setTimeout(siteAuto, 700); return; } if (L.kind === 'admin') return; setTimeout(() => { const st = BRAND.site; if (st && st.url && (!st.at || Date.now() - st.at > 2 * 86400000)) siteScan(st.url, true); }, 4000); })();
  /* ---------- settings, organisation profile: phone, e-mail, website and address are saved; a new website is read at once ---------- */
  const _setR = SCREENS.settings.render;
  SCREENS.settings.render = function () {
    let h = _setR.call(this);
    if ((S.tab.settings || 'org') !== 'org' || !/<label>אתר אינטרנט<\/label>/.test(h)) return h;
    const o = BRAND.orgInfo || {}, st = BRAND.site || {};
    const val = (v, d) => esc(v != null ? v : d);
    h = h.replace(/(<label>טלפון<\/label><input type="text")([^>]*?) value="[^"]*">/, '$1 id="setPhone"$2 value="' + val(o.phone, '') + '" placeholder="08-0000000">');
    h = h.replace(/(<label>דוא״ל<\/label><input type="email")([^>]*?) value="[^"]*">/, '$1 id="setMail"$2 value="' + val(o.email, '') + '" placeholder="name@example.muni.il">');
    h = h.replace(/(<label>כתובת<\/label><input type="text") value="[^"]*">/, '$1 id="setAddr" value="' + val(o.address, '') + '">');
    const note = S.siteBusy ? '<span class="t-sub site-st"><span class="gm-spin" style="width:13px;height:13px;border-width:2px;display:inline-block;vertical-align:middle"></span> המערכת קוראת את האתר...</span>'
      : st.at ? '<span class="t-sub site-st">' + ic('checkc', 13) + ' נקרא ' + ago(st.at) + '. כללי הכתיבה נבנו ממנו. <button class="tpl-link" data-act="siteRules">לכללי הכתיבה</button></span>'
      : st.err ? '<span class="t-sub site-st" style="color:var(--bad,#9B1C1C)">' + ic('alert', 13) + ' הקריאה נכשלה. בדקו את הכתובת ושמרו שוב.</span>'
      : '<span class="t-sub site-st">בשמירה המערכת תקרא את האתר ותבנה ממנו את כללי הכתיבה.</span>';
    h = h.replace(/(<label>אתר אינטרנט<\/label>)<input type="text" value="[^"]*">/, '$1<input type="text" inputmode="url" autocomplete="url" id="setSite" dir="ltr" style="text-align:left" placeholder="www.example.muni.il" value="' + val(st.url, '') + '">' + note);
    return h;
  };
  ACT.siteRules = () => { S.tab.brand = 'rules'; go('brand'); };
  const _saveSet = ACT.saveSettings;
  ACT.saveSettings = () => {
    const g = (id) => { const e = $('#' + id); return e ? e.value.trim() : null; };
    const site = g('setSite');
    if (site === null) return _saveSet();
    BRAND.orgInfo = Object.assign(BRAND.orgInfo || {}, { phone: g('setPhone') || '', email: g('setMail') || '', address: g('setAddr') || '' });
    const u = normUrl(site), cur = BRAND.site || {};
    if (u && (u !== cur.url || !cur.at)) {
      BRAND.site = Object.assign({}, cur, { url: u, err: '' });
      if (cur.url !== u) { BRAND.site.at = 0; }
      render(); flush();
      toast('ההגדרות נשמרו', 'המערכת קוראת עכשיו את האתר ובונה ממנו את כללי הכתיבה. זה לוקח עד שתי דקות.');
      siteScan(u);
      return;
    }
    if (!u && cur.url) BRAND.site = null;
    render(); flush();
    _saveSet();
  };
  css.textContent += `.site-st{display:flex;align-items:center;gap:6px;margin-top:6px;flex-wrap:wrap}`;
  /* =====================================================================
   * PERIOD CONTENT (bulk): Claude writes every post, ChatGPT designs every graphic
   * ===================================================================== */
  // the next holidays (post goes out the day before); past ones are not offered
  HOLIDAYS.splice(0, HOLIDAYS.length, ['חנוכה', '2026-12-05'], ['ט״ו בשבט', '2027-01-23'], ['פורים', '2027-03-23'], ['פסח', '2027-04-22'], ['יום העצמאות', '2027-05-12'], ['שבועות', '2027-06-11'], ['ראש השנה', '2027-10-02']);
  if (S.bulk) S.bulk.hol = HOLIDAYS.slice(0, 4).map((h) => h[0]);
  const isoDay = (d) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
  const plusDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoDay(d); };
  const todayIso = () => isoDay(new Date());
  // the series starts from the coming week, never in the past
  function startIso() { const d = new Date(); d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7)); return isoDay(d); }
  bulkCount = function (b) {
    const weeks = Math.round(b.months * 52 / 12), st = startIso(), end = plusDays(st, b.months * 30);
    const hol = b.holidays ? HOLIDAYS.filter((h) => b.hol.includes(h[0]) && h[1] >= todayIso() && h[1] <= end).length : 0;
    return { weeks, base: weeks * b.perWeek, hol, total: weeks * b.perWeek + hol };
  };
  buildCamp = function (b, owner) {
    const c = bulkCount(b), st = startIso(), off = [[2], [0, 3], [0, 2, 4]][b.perWeek - 1];
    const list = [];
    for (let w = 0; w < c.weeks; w++) off.forEach((o) => list.push({ t: '', body: '', date: plusDays(st, w * 7 + o), time: ['10:00', '18:00', '20:00'][list.length % 3], g: list.length % GV.length, lay: 0, ver: 1, ch: [...b.ch], flag: null, edited: false, hol: false }));
    if (b.holidays) HOLIDAYS.filter((h) => b.hol.includes(h[0]) && h[1] >= todayIso() && h[1] <= plusDays(st, b.months * 30)).forEach((h) =>
      list.push({ t: h[0], body: '', date: plusDays(h[1], -1), time: '12:00', g: 1, lay: 1, ver: 1, ch: [...b.ch], flag: null, edited: false, hol: h[0] }));
    list.sort((a, x) => (a.date < x.date ? -1 : 1));
    list.forEach((x, i) => { x.i = i; x.tags = []; x.sugg = []; });
    const last = list.length ? list[list.length - 1].date : st;
    return { id: 'c' + Date.now().toString(36), name: (b.files && b.files[0] ? b.files[0].name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]/g, ' ') : 'סדרת ' + b.dept) + ' · ' + b.months + ' ' + (b.months === 1 ? 'חודש' : 'חודשים'),
      dept: b.dept, owner, status: 'draft', type: b.type, items: list, range: fmtD(list[0] ? list[0].date : st) + ' - ' + fmtD(last), cur: 0, filter: 'all', fmt: (b.fmts || ['1:1'])[0] };
  };
  // source material: real uploads (documents are read by Claude)
  const _bulkR = SCREENS.bulk.render;
  SCREENS.bulk.render = function () {
    const h = _bulkR.call(this), b = S.bulk;
    const files = b.files || [];
    const up = '<div class="up-row"><button class="up-opt" data-act="bUpload"><span class="fi pdf">' + ic('upload', 14) + '</span>העלאת קובץ</button></div>' + (files.length ? '<div class="up-chips">' + fileChips(files, 'bFileX2') + '</div>' : '') +
      '<span class="t-sub" style="display:block;margin:4px 0 8px">תוכנית עבודה, לוח אירועים או כל מסמך. PrimeOS קורא אותו ובונה ממנו את הסדרה.</span>';
    return h.replace(/<div class="up-row">[\s\S]*?<\/button><\/div>(?=<textarea id="bBrief")/, up).replace(/<div class="file-chip">[\s\S]*?<\/button><\/div>(?=<textarea id="bBrief")/, up)
      .replace('<span>טקסט + גרפיקה לכל תוכן</span>', '<span>טקסט ב-Claude, גרפיקה ב-ChatGPT</span>');
  };
  ACT.bUpload = async () => { const fs = await uploadPicked('.pdf,.docx,.pptx,.txt,.csv,image/*', true, 'doc'); if (!fs.length) return; S.bulk.files = [...(S.bulk.files || []), ...fs]; render(); };
  ACT.bFileX2 = (i) => { (S.bulk.files || []).splice(+i, 1); render(); };
  // generation: texts first (Claude, in batches), then the graphics fill in one by one
  const GQ = { list: [], run: 0, max: 2 };
  function campOf(x) { return (S.camps || []).find((c) => c.items.includes(x)); }
  L.queueGraphic = (c, x, note) => queueGraphic(c, x, note);
  function queueGraphic(c, x, note) { x.media = Object.assign(x.media || {}, { kind: 'graphic', busy: 'ממתין לעיצוב...', err: '' }); GQ.list.push({ c, x, note }); pumpG(); }
  function pumpG() {
    while (GQ.run < GQ.max && GQ.list.length) { const j = GQ.list.shift(); GQ.run++; designItem(j.c, j.x, j.note).finally(() => { GQ.run--; pumpG(); }); }
  }
  async function designItem(c, x, note) {
    const fmt = c.fmt || '1:1', size = IMG_SIZE(fmt), logo = logoOf();
    const m = x.media;
    try {
      m.busy = 'ChatGPT מעצב את הגרפיקה...'; rerenderCamp();
      const tx = { kicker: x.kicker || '', headline: x.t, sub: x.sub || '', details: [], cta: '' };
      const kitS = logoOf() ? await ensureKit() : null;
      let r = await fx('image', { action: 'design', org: aiCtx().org, dept: c.dept, size, brief: x.t + '\n' + (x.body || ''), colors: brandFor(c.dept).colors, roles: brandFor(c.dept).roles, style: x.style || 'official', kit: kitS || undefined, texts: tx,
        refs: logo ? [logo] : [], logo: !!logo, note: note || '', quality: 'high', n: 1, model: FAST_IMG }, 150000);
      let url = r.url, check = r.check || { ok: true }; m.model = r.model || ''; m.qa = r.qa || null; m.style = r.style || x.style;
      // up to two masked fix rounds; the version with the fewest text errors is kept
      const nI = (c) => (c && !c.ok ? (c.issues || []).length || 1 : 0);
      for (let round = 1; round <= 2 && !check.ok && (check.fixes || []).length; round++) {
        m.busy = 'מתקנים את הטקסט בגרפיקה' + (round > 1 ? ' (סבב 2)' : '') + '...'; rerenderCamp();
        try { const f = await fx('image', { action: 'fixtext', url, issues: check.issues, fixes: check.fixes, want: r.want || [], size }, 150000); const fc = f.check || { ok: true };
          if (nI(fc) <= nI(check)) { url = f.url; check = fc; } else break; } catch (e) { break; }
      }
      m.design = url; m.warn = !check.ok && (check.issues || []).length ? check.issues : null;
      if (size === 'square' && fmt === '1:1') m.url = url;
      else {
        m.busy = 'מתאימים לגודל ' + fmt + '...'; rerenderCamp();
        const r2 = await produce([{ id: 'g', kind: 'graphic', layout: 'fit', format: FMT_K[fmt] || '1x1', data: { image: url }, thumb: false }], c.dept);
        const z = (r2.results || [])[0]; m.url = z && z.ok ? z.urls.main : url;
      }
      m.fmt = fmt; m.ar = AR[fmt] || '1/1'; m.ready = true; m.busy = ''; m.stale = false; x.ver = (x.ver || 1) + 1;
    } catch (e) { m.busy = ''; m.err = 'העיצוב לא הושלם'; }
    rerenderCamp(); flush();
  }
  let rrT = 0;
  function rerenderCamp() { if (S.route !== 'bulkReview' && S.route !== 'bulkGen') return; clearTimeout(rrT); rrT = setTimeout(() => { const t = document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName); if (!t) render(); else paintStrip(); }, 120); }
  window.campMediaNow = () => { const c = campById(S.campId); const x = c && c.items[c.cur]; return x && x.media ? x.media : null; };
  var campMediaNow = window.campMediaNow;
  // after a reload, graphics that were still in progress are marked so they can be designed again
  (function clearStale() { if (!L.ready) { setTimeout(clearStale, 800); return; } (S.camps || []).forEach((c) => c.items.forEach((x) => { if (x.media && x.media.busy && !GQ.list.some((j) => j.x === x)) { x.media.busy = ''; if (!x.media.url) x.media.err = 'העיצוב נעצר כשהדף נסגר'; } })); })();
  ACT.bGen = async () => {
    const b = S.bulk;
    const bb = $('#bBrief'); if (bb) b.brief = bb.value;
    if (!b.ch.length) { toast('לא נבחרה פלטפורמה', 'בחרו לפחות פלטפורמה אחת.', 'err'); return; }
    const camp = buildCamp(b, curUser().n);
    if (!camp.items.length) { toast('אין מועדים בתקופה', 'הגדילו את התקופה או את מספר התכנים בשבוע.', 'err'); return; }
    S.camps.unshift(camp); S.genCamp = camp; S.genP = 0; S.genStage = 'text'; go('bulkGen');
    const files = (b.files || []).map((f) => ({ url: f.url, name: f.name }));
    const chunks = []; for (let i = 0; i < camp.items.length; i += 10) chunks.push(camp.items.slice(i, i + 10));
    let done = 0; const avoid = [];
    try {
      for (const part of chunks) {
        const r = await fx('generate', Object.assign(aiCtx(), { mode: 'series', dept: camp.dept, brief: b.brief, files: b.plan ? [] : files, avoid: avoid.slice(-30), slots: part.map((x) => ({ i: x.i, date: x.date, hol: x.hol || '', hint: x.hint || '', text: x.text || '' })) }), 150000);
        (r.items || []).forEach((y) => { const x = camp.items[+y.i]; if (!x) return; x.t = y.title || x.t; x.kicker = y.kicker || ''; x.sub = y.sub || ''; x.body = y.caption || ''; x.tags = (y.tags || []).slice(0, 5); x.sugg = x.tags.slice(); avoid.push(x.t); });
        done += part.length; S.genP = Math.round(done / camp.items.length * 100);
        const bar = $('#genBar'), num = $('#genNum'); if (bar) bar.style.width = S.genP + '%'; if (num) num.textContent = done;
      }
    } catch (e) {
      if (!camp.items.some((x) => x.body)) { S.camps.splice(S.camps.indexOf(camp), 1); go('bulk'); aiFail(e); return; }
    }
    camp.items.forEach((x) => { if (!x.t) x.t = x.hol ? x.hol + ' שמח' : 'עדכון לתושבים'; });
    flush();
    S.campId = camp.id; S.campMode = 'edit'; go('bulkReview');
    const first = camp.gfxUntil ? camp.items.filter((x) => x.date <= camp.gfxUntil) : camp.items;
    first.forEach((x) => queueGraphic(camp, x));
    toast('הטקסטים מוכנים', 'מעצבים עכשיו את הגרפיקות של החודש הראשון, שתיים במקביל. אפשר לעבור על הפוסטים בינתיים.');
  };
  // review: real thumbnails in the strip, design status and actions in the graphic box
  function paintStrip() {
    const c = campById(S.campId); if (!c) return;
    c.items.forEach((x) => { const el = document.querySelector('#rvStrip [data-act="cGo:' + x.i + '"] .thumb'); if (el && x.media && x.media.url) { el.style.backgroundImage = 'url("' + x.media.url + '")'; el.classList.add('real'); } });
  }
  const _rvRL = SCREENS.bulkReview.render;
  SCREENS.bulkReview.render = function () {
    let h = _rvRL.call(this);
    const c = campById(S.campId); if (!c) return h;
    c.items.forEach((x) => {
      const m = x.media; if (!m) return;
      const re = new RegExp('(data-act="cGo:' + x.i + '"><span class="thumb [^"]*")>');
      if (m.url) h = h.replace(re, '$1 style="background-image:url(&quot;' + esc(m.url) + '&quot;)" data-real="1">');
      else if (m.busy) h = h.replace(re, '$1 data-busy="1">');
    });
    const n = c.items.filter((x) => x.media && x.media.url).length, busy = c.items.filter((x) => x.media && x.media.busy).length;
    if (busy) h = h.replace('<div class="rv">', '<div class="note camp-prog">' + '<span class="pth-orb" style="--s:22px;padding:2px" aria-hidden="true"><i></i></span><span>מעצבים את הגרפיקות: ' + n + ' מתוך ' + c.items.length + ' מוכנות.</span></div><div class="rv">');
    return h;
  };
  const _rvMount = SCREENS.bulkReview.mount;
  SCREENS.bulkReview.mount = function () { _rvMount && _rvMount.call(this); paintStrip(); };
  const _aiBoxC = aiBox;
  aiBox = function (prefix) {
    const h = _aiBoxC(prefix);
    if (prefix !== 'c' || S.route !== 'bulkReview') return h;
    const c = campById(S.campId), x = c && c.items[c.cur]; if (!x) return h;
    const m = x.media || {}, busy = !!m.busy;
    return '<div class="real-acts" style="margin-bottom:10px"><button class="btn btn-sm" data-act="cRedo"' + (busy ? ' disabled' : '') + '>' + ic('refresh', 14) + ' עיצוב חדש</button>' +
      (m.url ? '<a class="btn btn-sm" href="' + esc(m.url) + '" target="_blank" rel="noopener">' + ic('down', 14) + ' הורדת הקובץ</a>' : '') + '</div>' +
      (m.err ? '<div class="note ai-warn">' + ic('alert', 15) + '<span>' + esc(m.err) + '. לחצו "עיצוב חדש".</span></div>' : '') +
      (m.warn ? '<div class="note ai-warn">' + ic('alert', 15) + '<span>בדיקת הטקסט מצאה: ' + m.warn.map(esc).join(' · ') + '</span></div>' : '') +
      (m.model && m.url ? '<div class="t-sub" style="margin-bottom:8px">' + ic('img', 13) + ' סגנון: ' + esc(styleHe(m.style)) + ' ' + qaHtml(m.qa) + ' · מודל <span dir="ltr">' + esc(m.model) + '</span> · <a href="' + esc(m.design || m.url) + '" target="_blank" rel="noopener">הקובץ המקורי</a></div>' : '') +
      (m.stale ? '<div class="note ai-warn">' + ic('edit', 15) + '<span>הכותרת השתנתה. לחצו "עיצוב חדש" כדי לעדכן את הגרפיקה.</span></div>' : '') + h;
  };
  ACT.cRedo = () => { const [c, x] = CX(); if (!x || (x.media && x.media.busy)) return; const t = $('#cT'); if (t) x.t = t.value; queueGraphic(c, x, 'קומפוזיציה ועיצוב שונים מהגרסה הקודמת'); render(); };
  ACT.cAi = () => { const [c, x] = CX(); const el = $('#cAi'); const q = (el && el.value || '').trim(); if (!q) { toast('מה לשנות?', 'כתבו בקשה קצרה.', 'err'); return; } x.edited = true; queueGraphic(c, x, q); render(); };
  ACT.cAiQ = (q) => { const [c, x] = CX(); x.edited = true; queueGraphic(c, x, q); render(); };
  // a title edit makes the graphic stale (the text is inside the image)
  const _rvMount2 = SCREENS.bulkReview.mount;
  SCREENS.bulkReview.mount = function () {
    _rvMount2.call(this);
    const t = $('#cT'); if (t) t.addEventListener('change', () => { const [c, x] = CX(); if (x && x.media && x.media.url) { x.media.stale = true; render(); } });
  };
  // approved series become real items with the real graphic
  campToItems = function (c, st) {
    c.items.forEach((x) => {
      const it = { id: ++S.seq, t: x.t, ty: c.type, d: c.dept, s: st, o: c.owner, u: 'עכשיו', pub: x.date + ' ' + x.time, ch: [...x.ch], th: GV[x.g % GV.length], body: x.body, tags: x.tags, camp: c.id };
      if (x.media && x.media.url) it.media = { kind: 'graphic', url: x.media.url, thumb: '', ar: x.media.ar || '1/1', fmt: x.media.fmt, ready: true, layout: 'ai', design: { kicker: x.kicker, sub: x.sub } };
      items.unshift(it);
    });
    flush();
  };
  css.textContent += `
.rs-it .thumb[data-real]{background-size:cover!important;background-position:center!important}.rs-it .thumb[data-real] .tt{display:none}
.rs-it .thumb[data-busy]{opacity:.55;animation:campPulse 1.4s ease-in-out infinite}@keyframes campPulse{50%{opacity:.85}}
.rs-it .thumb.real{background-size:cover!important;background-position:center!important}.rs-it .thumb.real .tt{display:none}
.camp-prog{display:flex;align-items:center;gap:10px;margin-bottom:12px}`;

  /* ---------------- live dates and guards: the mockup's demo dates (September 2026) never reach a real organisation ---------------- */
  (function () {
    const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return isoDay(d); };
    const DEMO_DAYS = ['2026-09-08', '2026-09-10'];
    const _sw = startWiz;
    startWiz = function () {
      _sw.apply(this, arguments);
      const w = S.wiz;
      if (w && DEMO_DAYS.includes(w.date)) w.date = tomorrow();
      if (w && w.dist && DEMO_DAYS.includes(w.dist.date)) w.dist.date = tomorrow();
    };
    const _sched = ACT.sched;
    ACT.sched = (id) => { const it = itemById(id); if (it && !it.pub) it.pub = tomorrow() + ' 18:00'; _sched(id); };
    // an item that no longer exists (deleted on another device, stale link) opens the library instead of a blank error
    const _itemG = SCREENS.item.render;
    SCREENS.item.render = function () {
      if (!items.some((x) => x.id === S.itemId)) { setTimeout(() => go('library', { force: true }), 0); return '<div class="card card-pad"><p class="t-sub">הפריט לא נמצא. עוברים לספריית התוכן...</p></div>'; }
      return _itemG.apply(this, arguments);
    };
  })();

  /* ---------------- team: real members with their own login links ----------------
   * The spokesperson (owner/admin) opens users here. A department user gets a link that opens the department interface only. */
  (function () {
    const ROLE_T = { owner: 'הרשאת מנהל (גישה מלאה)', admin: 'הרשאת מנהל (גישה מלאה)', member: 'מחלקה בארגון' };
    const waText = (name, link) => 'שלום ' + name + ', נפתח לך משתמש במערכת PrimeOS של ' + (L.org ? L.org.name : '') + '.\nקישור לכניסה הראשונה (אישי, לכניסה אחת, בתוקף 7 ימים):\n' + link + '\n\nבכניסות הבאות: app.primeos.co.il, מזינים את כתובת הדוא״ל ומקבלים קוד.';
    const inviteLink = async (mid) => (await call('members.invite.link', { id: mid })).link;
    function rowOf(m) {
      return { n: m.name, r: ROLE_T[m.role] || m.role, d: m.view === 'dept' ? (m.dept || '') : 'דוברות', st: 'פעיל', last: m.id === (L.me && L.me.id) ? 'עכשיו' : '-', i: initials(m.name), mid: m.id, view: m.view || 'ext', tok: m.token || '', phone: m.phone || '', mail: m.email || '', role: m.role, direct: m.role !== 'member' || !!(m.perms && m.perms.direct) };
    }
    L.applyMembers = function (list) {
      if (!Array.isArray(list)) return;
      L.members = list;
      replaceAll(users, list.map(rowOf));
    };
    const canManage = () => !L.me || L.me.role === 'owner' || L.me.role === 'admin';
    function usersTable() {
      const me = L.me && L.me.id;
      return '<div class="tbl-wrap"><table class="responsive"><thead><tr><th>שם</th><th>תפקיד</th><th>מחלקה</th><th>פרסום</th><th>כניסה</th><th></th></tr></thead><tbody>' +
        users.map((u) => '<tr><td data-l="שם"><span style="display:flex;align-items:center;gap:9px"><span class="avatar">' + esc(u.i) + '</span><span><b>' + esc(u.n) + '</b>' + (u.phone ? '<div class="t-sub" dir="ltr" style="text-align:start">' + esc(u.phone) + '</div>' : '') + '</span></span></td>' +
          '<td data-l="תפקיד">' + esc(u.r) + (u.mid === me ? ' <span class="badge s-approved">את/ה</span>' : '') + '</td><td data-l="מחלקה">' + esc(u.d) + '</td>' +
          '<td data-l="פרסום">' + (u.role === 'member' ? '<button class="chip" data-act="userDirect:' + esc(u.mid) + '" title="לחיצה משנה">' + (u.direct ? ic('checkc', 13) + ' פרסום ישיר' : ic('clock', 13) + ' דרוש אישור') + '</button>' : '<span class="t-sub">ישיר</span>') + '</td>' +
          '<td data-l="כניסה">' + (u.mail ? '<div class="t-sub" dir="ltr" style="text-align:start;margin-bottom:6px">' + esc(u.mail) + '</div>' : '<div class="t-sub" style="margin-bottom:6px">אין דוא״ל: לא יוכל להיכנס</div>') +
            (u.mid && u.mid !== me && canManage() ? '<span style="display:inline-flex;gap:6px;flex-wrap:wrap">' + (u.mail ? '<button class="btn btn-sm" data-act="userSend:' + esc(u.mid) + '">' + ic('send', 14) + ' שליחת הזמנה</button>' : '') + '<button class="btn btn-sm" data-act="userLink:' + esc(u.mid) + '">' + ic('copy', 14) + ' קישור כניסה ראשונה</button><button class="btn btn-sm" data-act="userWa:' + esc(u.mid) + '">' + ic('send', 14) + ' WhatsApp</button></span>' : '') + '</td>' +
          '<td>' + (u.mid && u.mid !== me && u.role !== 'owner' && canManage() ? '<span style="display:inline-flex;gap:6px;flex-wrap:wrap"><button class="btn btn-sm" data-act="userRelink:' + esc(u.mid) + '">ניתוק כניסות</button><button class="btn btn-sm btn-quiet-bad" data-act="userRemove:' + esc(u.mid) + '">הסרה</button></span>' : '') + '</td></tr>').join('') +
        '</tbody></table></div>' +
        (users.length <= 1 ? '<div class="note" style="margin-top:14px">' + ic('users', 15) + '<span>עדיין אין משתמשים נוספים. בלחיצה על „הזמנת משתמש” נפתח משתמש, והוא מקבל במייל קישור לכניסה הראשונה. בכניסות הבאות הוא מזין את הדוא״ל ומקבל קוד.</span></div>' : '');
    }
    if (SCREENS.team) {
      const _teamR = SCREENS.team.render;
      SCREENS.team.render = function () {
        let h = _teamR.apply(this, arguments);
        if (!L.members || (S.tab.team || 'users') !== 'users') return h;
        return h.replace(/<div class="filters">[\s\S]*?<\/div><div class="tbl-wrap">[\s\S]*?<\/table><\/div>/, usersTable());
      };
    }
    const _invite = ACT.inviteUser;
    ACT.inviteUser = () => {
      if (!L.members) return _invite();
      if (!canManage()) { toast('אין הרשאה', 'רק מנהל המערכת או הדובר פותחים משתמשים.', 'err'); return; }
      if (L.org && L.org.plan === 'basic') { toast('המסלול הבסיסי כולל משתמש אחד', 'למחלקות ולמשתמשים נוספים עוברים למסלול המורחב.', ''); return; }
      openDrawer('<div class="drawer-head"><div><h3>הזמנת משתמש</h3><p>המשתמש נכנס עם כתובת הדוא״ל שלו וקוד שנשלח אליה. בלי סיסמה.</p></div>' +
        '<button class="icon-btn" style="margin-inline-start:auto" data-act="closeDrawer" aria-label="סגירה">' + ic('x', 17) + '</button></div>' +
        '<div class="drawer-body">' +
        '<div class="field"><label for="ivName">שם מלא</label><input type="text" id="ivName" placeholder="לדוגמה: דנה לוי"></div>' +
        '<div class="field"><label for="ivKind">סוג משתמש</label><select id="ivKind"><option value="dept">משתמש יחיד (המחלקה שלו בלבד)</option><option value="ext">משתמש ארגון (כל המערכת, מחלקות ואישורים)</option></select></div>' +
        '<div class="field" id="ivDeptWrap"><label for="ivDept">מחלקה</label><select id="ivDept">' + DEPTS.map((d) => '<option>' + esc(d) + '</option>').join('') + '</select></div>' +
        '<div class="field"><label for="ivPhone">טלפון נייד (לבוט ה-WhatsApp)</label><input type="text" id="ivPhone" inputmode="tel" dir="ltr" placeholder="050-0000000"></div>' +
        '<div class="field"><label for="ivMail">דוא״ל (לכניסה למערכת)</label><input type="email" id="ivMail" inputmode="email" autocomplete="off" dir="ltr" required aria-required="true" placeholder="name@example.muni.il"></div>' +
        '<label class="chk" id="ivDirectWrap" style="display:flex;gap:8px;align-items:center;margin:4px 0 10px"><input type="checkbox" id="ivDirect"> רשאי לפרסם ישירות, בלי אישור של משתמש הארגון</label>' +
        '<div class="note">' + ic('shield', 16) + '<span>משתמש יחיד רואה רק את התוכן של המחלקה שלו. בלי ההרשאה שלמעלה, כל תוכן שלו עובר אישור של משתמש הארגון לפני פרסום.</span></div></div>' +
        '<div class="drawer-foot"><button class="btn btn-primary" data-act="doInvite">פתיחת משתמש ושליחת הזמנה</button><button class="btn" data-act="closeDrawer">ביטול</button></div>');
      const k = $('#ivKind'), w = $('#ivDeptWrap');
      const dw = $('#ivDirectWrap');
      if (k && w) k.onchange = () => { w.style.display = k.value === 'dept' ? '' : 'none'; if (dw) dw.style.display = k.value === 'dept' ? '' : 'none'; };
    };
    const _doInvite = ACT.doInvite;
    ACT.doInvite = async () => {
      if (!L.members) return _doInvite();
      const name = ($('#ivName') && $('#ivName').value || '').trim();
      if (!name) { toast('חסר שם', 'כתבו את שם המשתמש.', 'err'); return; }
      const em0 = ($('#ivMail') && $('#ivMail').value || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em0)) { toast('חסר דוא״ל', 'הכניסה למערכת היא לפי כתובת הדוא״ל. הזינו כתובת תקינה.', 'err'); return; }
      if ((L.members || []).some((x) => (x.email || '').toLowerCase() === em0)) { toast('הכתובת כבר רשומה', 'לכל משתמש כתובת דוא״ל משלו.', 'err'); return; }
      const view = $('#ivKind') ? $('#ivKind').value : 'dept';
      const dept = $('#ivDept') ? $('#ivDept').value : '';
      const phone = ($('#ivPhone') && $('#ivPhone').value || '').trim();
      const email = ($('#ivMail') && $('#ivMail').value || '').trim();
      const direct = view !== 'dept' || !!($('#ivDirect') && $('#ivDirect').checked);
      const done = busyBtn('[data-act="doInvite"]', 'פותחים...');
      try {
        const r = await call('members.create', { name, view, dept, phone, email, direct });
        const m = { id: r.id, name, role: view === 'dept' ? 'member' : 'admin', dept: view === 'dept' ? dept : null, view, phone, email: email.toLowerCase(), perms: { direct }, token: null };
        L.applyMembers([...(L.members || []), m]);
        closeDrawer();
        render();
        linkModal(m);
        call('members.send', { id: r.id, mail: true, wa: false }).then((st) => {
          const box = $('#modalBox .mb');
          if (box) box.insertAdjacentHTML('beforeend', '<div class="note" style="margin-top:12px">' + ic(st.mail === 'sent' ? 'checkc' : 'alert', 14) + '<span>' + (st.mail === 'sent' ? 'ההזמנה נשלחה אל ' + esc(email) + '.' : 'שליחת המייל נכשלה. אפשר להעתיק קישור ולשלוח ידנית.') + '</span></div>');
        }).catch(() => {});
      } catch (e) { done(); toast('הפתיחה נכשלה', e.message === 'forbidden' ? 'אין לך הרשאה לפתוח משתמשים.' : e.message === 'email_in_use_elsewhere' ? 'כתובת הדוא״ל כבר משויכת לארגון אחר. לכל משתמש צריכה להיות כתובת משלו.' : 'נסו שוב בעוד רגע.', 'err'); }
    };
    function linkModal(m) {
      openModal('<div class="mb"><div class="m-ic ok">' + ic('checkc', 20) + '</div><h3>המשתמש נפתח</h3><p>„' + esc(m.name) + '” · ' + esc(ROLE_T[m.role] || '') + (m.dept ? ' · ' + esc(m.dept) : '') + '</p>' +
        '<p class="t-sub" style="margin-top:10px">הכניסה לפי הדוא״ל <b dir="ltr">' + esc(m.email || '') + '</b>. לכניסה הראשונה נשלח קישור חד-פעמי (בתוקף 7 ימים). אחר כך: מזינים את הדוא״ל באתר ומקבלים קוד.</p></div>' +
        '<div class="modal-foot"><button class="btn btn-primary" data-act="userWa:' + esc(m.id) + '">' + ic('send', 16) + ' שליחת קישור ב-WhatsApp</button><button class="btn" data-act="userLink:' + esc(m.id) + '">' + ic('copy', 16) + ' העתקת קישור</button><button class="btn" data-act="closeModal">סגירה</button></div>');
    }
    ACT.closeModal = ACT.closeModal || (() => closeModal());
    const copyT = (t, what) => (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast('הקישור הועתק', what || ''), () => openModal('<div class="mb"><h3>העתקה ידנית</h3><input type="text" readonly value="' + esc(t) + '" style="width:100%;direction:ltr" onclick="this.select()"></div><div class="modal-foot"><button class="btn" data-act="closeModal">סגירה</button></div>'));
    ACT.userLink = async (mid) => {
      const u = users.find((x) => x.mid === mid) || (L.members || []).map(rowOf).find((x) => x.mid === mid); if (!u) return;
      try { copyT(await inviteLink(mid), u.n + ' · לכניסה אחת, בתוקף 7 ימים'); } catch (e) { toast('לא הצלחנו ליצור קישור', 'נסו שוב בעוד רגע.', 'err'); }
    };
    ACT.userWa = async (mid) => {
      const u = users.find((x) => x.mid === mid) || (L.members || []).map(rowOf).find((x) => x.mid === mid); if (!u) return;
      const w = window.open('about:blank', '_blank');
      try { const l = await inviteLink(mid); const url = 'https://wa.me/' + (u.phone ? String(u.phone).replace(/\D/g, '').replace(/^0/, '972') : '') + '?text=' + encodeURIComponent(waText(u.n, l)); if (w) w.location.href = url; else location.href = url; }
      catch (e) { if (w) w.close(); toast('לא הצלחנו ליצור קישור', 'נסו שוב בעוד רגע.', 'err'); }
    };
    ACT.userSend = async (mid) => {
      const u = users.find((x) => x.mid === mid); if (!u) return;
      try { const st = await call('members.send', { id: mid, mail: true, wa: false }); toast(st.mail === 'sent' ? 'ההזמנה נשלחה' : 'השליחה נכשלה', st.mail === 'sent' ? u.mail : 'נסו שוב או העתיקו קישור.', st.mail === 'sent' ? '' : 'err'); }
      catch (e) { toast('השליחה נכשלה', 'נסו שוב בעוד רגע.', 'err'); }
    };
    ACT.userDirect = async (mid) => {
      const m = (L.members || []).find((x) => x.id === mid); if (!m || !canManage()) return;
      const direct = !(m.perms && m.perms.direct);
      try { await call('members.update', { id: mid, perms: { direct } }); m.perms = Object.assign({}, m.perms, { direct }); L.applyMembers(L.members); render(); toast(direct ? 'פרסום ישיר הופעל' : 'הפרסום דורש אישור', m.name); }
      catch (e) { toast('העדכון נכשל', 'נסו שוב בעוד רגע.', 'err'); }
    };
    ACT.userRelink = (mid) => {
      const u = users.find((x) => x.mid === mid); if (!u) return;
      confirmModal({ title: 'לנתק את „' + u.n + '” מכל המכשירים?', body: 'כל הכניסות הפעילות שלו ייסגרו מיד. כדי להיכנס שוב הוא יזין את הדוא״ל ויקבל קוד.', ok: 'ניתוק כניסות', tone: 'warn', icon: 'alert',
        onOk: async () => { try { await call('members.relink', { id: mid }); toast('הכניסות נותקו', u.n); } catch (e) { toast('הניתוק נכשל', 'נסו שוב בעוד רגע.', 'err'); } } });
    };
    ACT.userRemove = (mid) => {
      const u = users.find((x) => x.mid === mid); if (!u) return;
      confirmModal({ title: 'להסיר את „' + u.n + '”?', body: 'הקישור שלו יפסיק לעבוד. התכנים שיצר נשארים בספרייה.', ok: 'הסרת המשתמש', tone: 'warn', icon: 'alert',
        onOk: async () => { try { await call('members.remove', { id: mid }); L.applyMembers((L.members || []).filter((x) => x.id !== mid)); render(); toast('המשתמש הוסר', u.n); } catch (e) { toast('ההסרה נכשלה', e.message === 'owner_protected' ? 'את מנהל המערכת הראשי אי אפשר להסיר.' : 'נסו שוב בעוד רגע.', 'err'); } } });
    };
    // the demo "edit user" drawer makes no sense for real members: open the link actions instead
    const _userEdit = ACT.userEdit;
    ACT.userEdit = (i) => { if (!L.members) return _userEdit(i); const u = users[+i]; if (u && u.mid) ACT.userLink(u.mid); };
  })();

  /* ---------------- calendar on real dates: month / week / list, navigation, filters; dashboard week = this week ---------------- */
  (function () {
    const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
    const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
    const pad = (n) => String(n).padStart(2, '0');
    const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const dayOf = (it) => (typeof it.pub === 'string' && /^\d{4}-\d{2}-\d{2}/.test(it.pub) ? it.pub.slice(0, 10) : '');
    const timeOf = (it) => (it.pub || '').slice(11, 16);
    const sunday = (d) => { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); x.setHours(12, 0, 0, 0); return x; };
    const heb = (isoDay) => { const [y, m, d] = isoDay.split('-').map(Number); return d + '.' + m + '.' + y; };
    const F = () => (S.calF = S.calF || { dept: '', ch: '', st: '' });
    const chName = (c) => (typeof CH !== 'undefined' && CH[c] ? CH[c].t : c);
    function visible() {
      const f = F();
      return items.filter((i) => dayOf(i) && (!f.dept || i.d === f.dept) && (!f.st || (ST[i.s] && ST[i.s].t === f.st)) && (!f.ch || (i.ch || []).some((c) => chName(c) === f.ch)));
    }
    const pill = (i, extra) => '<button class="cal-ev ' + (ST[i.s] ? ST[i.s].e : '') + '"' + (extra || '') + ' data-act="peek:' + i.id + '">' + esc(i.t.slice(0, 26)) + '</button>';
    function monthHtml(y, m, today) {
      const first = new Date(y, m, 1), start = first.getDay(), dim = new Date(y, m + 1, 0).getDate();
      const byDay = {}; visible().forEach((i) => { const k = dayOf(i); (byDay[k] = byDay[k] || []).push(i); });
      const cells = Math.ceil((start + dim) / 7) * 7;
      let h = '';
      for (let c = 0; c < cells; c++) {
        const dn = c - start + 1, off = dn < 1 || dn > dim;
        const k = off ? '' : y + '-' + pad(m + 1) + '-' + pad(dn);
        h += '<div class="cal-cell ' + (off ? 'off' : '') + ' ' + (k === today ? 'today' : '') + '"><span class="dn">' + (off ? '' : dn) + '</span>' + (byDay[k] || []).sort((a, b) => timeOf(a).localeCompare(timeOf(b))).map((i) => pill(i)).join('') + '</div>';
      }
      return '<div class="cal"><div class="cal-head">' + DAYS.map((d) => '<div>' + d + '</div>').join('') + '</div><div class="cal-grid">' + h + '</div></div>';
    }
    function weekHtml(ws, today) {
      const byDay = {}; visible().forEach((i) => { const k = dayOf(i); (byDay[k] = byDay[k] || []).push(i); });
      return '<div class="cal"><div class="cal-head">' + DAYS.map((d, i) => { const x = new Date(ws); x.setDate(ws.getDate() + i); return '<div>' + d + ' ' + x.getDate() + '</div>'; }).join('') + '</div>' +
        '<div class="cal-grid">' + DAYS.map((d, i) => { const x = new Date(ws); x.setDate(ws.getDate() + i); const k = iso(x);
          return '<div class="cal-cell ' + (k === today ? 'today' : '') + '" style="min-height:220px">' + (byDay[k] || []).sort((a, b) => timeOf(a).localeCompare(timeOf(b))).map((i) => '<button class="cal-ev ' + (ST[i.s] ? ST[i.s].e : '') + '" style="padding:8px" data-act="peek:' + i.id + '"><span style="display:block">' + esc(i.t) + '</span><span style="font-weight:500;opacity:.85">' + esc(timeOf(i)) + '</span></button>').join('') + '</div>'; }).join('') + '</div></div>';
    }
    function listHtml(today) {
      const list = visible().filter((i) => ['scheduled', 'approved', 'pending', 'published'].includes(i.s)).sort((a, b) => (a.pub || '').localeCompare(b.pub || ''));
      const up = list.filter((i) => dayOf(i) >= today), past = list.filter((i) => dayOf(i) < today).reverse();
      const row = (i) => '<tr><td data-l="מועד"><b>' + esc(heb(dayOf(i)) + (timeOf(i) ? ' · ' + timeOf(i) : '')) + '</b></td><td data-l="כותרת"><span class="row-title" data-act="open:' + i.id + '">' + esc(i.t) + '</span></td><td data-l="מחלקה">' + esc(i.d) + '</td><td data-l="ערוצים">' + (i.ch || []).map(chName).join(', ') + '</td><td data-l="סטטוס">' + badge(i.s) + '</td><td><button class="btn btn-sm" data-act="peek:' + i.id + '">תצוגה מהירה</button></td></tr>';
      if (!list.length) return '<div class="card card-pad" style="text-align:center;padding:40px"><p class="t-sub" style="margin:0">אין תכנים עם מועד פרסום. תכנים שנשלחים לאישור או מתוזמנים יופיעו כאן לפי התאריך.</p></div>';
      return '<div class="tbl-wrap"><table class="responsive"><thead><tr><th>מועד</th><th>כותרת</th><th>מחלקה</th><th>ערוצים</th><th>סטטוס</th><th></th></tr></thead><tbody>' + up.map(row).join('') + (past.length ? '<tr><td colspan="6" class="t-sub" style="padding-top:18px">פורסמו / חלפו</td></tr>' + past.map(row).join('') : '') + '</tbody></table></div>';
    }
    if (SCREENS.calendar) {
      const _calR = SCREENS.calendar.render;
      SCREENS.calendar.render = function () {
        if (L.demo && !L.org) return _calR.apply(this, arguments);
        const now = new Date(), today = iso(now);
        S.calM = S.calM || { y: now.getFullYear(), m: now.getMonth() };
        S.calW = S.calW || iso(sunday(now));
        const v = S.calView || 'month', f = F();
        const ws = new Date(S.calW + 'T12:00:00');
        const we = new Date(ws); we.setDate(ws.getDate() + 6);
        const label = v === 'week' ? ws.getDate() + '.' + (ws.getMonth() + 1) + ' - ' + we.getDate() + '.' + (we.getMonth() + 1) : v === 'list' ? 'לפי תאריך' : MONTHS[S.calM.m] + ' ' + S.calM.y;
        const body = v === 'month' ? monthHtml(S.calM.y, S.calM.m, today) : v === 'week' ? weekHtml(ws, today) : listHtml(today);
        const n = visible().length;
        return pageHead({ title: 'לוח התוכן', desc: MONTHS[now.getMonth()] + ' ' + now.getFullYear() + ' · ' + (n ? n + ' תכנים עם מועד' : 'עדיין אין תכנים עם מועד') + ' · מתוזמנים, מאושרים וממתינים, לפי מחלקה וערוץ.', actions: '<button class="btn btn-primary" data-nav="create">' + ic('create', 16) + ' תוכן חדש</button>' }) +
          '<div class="filters">' +
          (v !== 'list' ? '<button class="icon-btn" data-act="calNav:-1" aria-label="הקודם">' + ic('chevR', 17) + '</button><b style="font-size:14.5px;min-width:110px;text-align:center">' + label + '</b><button class="icon-btn" data-act="calNav:1" aria-label="הבא">' + ic('chevL', 17) + '</button><button class="btn btn-sm" data-act="calNav:0">היום</button>' : '') +
          (isDept() || isBasic() ? '' : '<select id="calDept"><option value="">כל המחלקות</option>' + DEPTS.map((d) => '<option' + (f.dept === d ? ' selected' : '') + '>' + esc(d) + '</option>').join('') + '</select>') +
          '<select id="calCh"><option value="">כל הערוצים</option>' + Object.values(CH).map((c) => '<option' + (f.ch === c.t ? ' selected' : '') + '>' + c.t + '</option>').join('') + '</select>' +
          '<select id="calSt"><option value="">כל הסטטוסים</option>' + Object.values(ST).map((x) => '<option' + (f.st === x.t ? ' selected' : '') + '>' + x.t + '</option>').join('') + '</select>' +
          '<div class="seg" style="margin-inline-start:auto">' + [['month', 'חודש'], ['week', 'שבוע'], ['list', 'רשימה']].map((x) => '<button class="' + (v === x[0] ? 'on' : '') + '" data-act="calview:' + x[0] + '">' + x[1] + '</button>').join('') + '</div></div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">' + ['draft', 'pending', 'approved', 'scheduled', 'published'].map((k) => badge(k)).join('') + '</div>' + body;
      };
      const _calM = SCREENS.calendar.mount;
      SCREENS.calendar.mount = function () {
        if (_calM) _calM.apply(this, arguments);
        [['calDept', 'dept'], ['calCh', 'ch'], ['calSt', 'st']].forEach(([id, k]) => { const el = $('#' + id); if (el) el.onchange = () => { F()[k] = el.value; render(); }; });
      };
    }
    ACT.calNav = (d) => {
      d = +d; const now = new Date();
      if ((S.calView || 'month') === 'week') { if (!d) S.calW = iso(sunday(now)); else { const x = new Date(S.calW + 'T12:00:00'); x.setDate(x.getDate() + 7 * d); S.calW = iso(x); } }
      else { if (!d) S.calM = { y: now.getFullYear(), m: now.getMonth() }; else { let m = S.calM.m + d, y = S.calM.y; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } S.calM = { y, m }; } }
      render();
    };
    // dashboard: "this week" is really this week
    if (SCREENS.dashboard) {
      const _dashR = SCREENS.dashboard.render;
      SCREENS.dashboard.render = function () {
        let h = _dashR.apply(this, arguments);
        if (L.demo && !L.org) return h;
        const ws = sunday(new Date()), today = iso(new Date());
        const wk = DAYS.map((d, i) => { const x = new Date(ws); x.setDate(ws.getDate() + i); const k = iso(x); return { d, n: x.getDate(), k, its: items.filter((it) => dayOf(it) === k) }; });
        const strip = '<div class="week-mini">' + wk.map((w) => '<div class="wm-day' + (w.k === today ? ' today' : '') + '"><span class="h">' + w.d + '<br><span style="font-size:13px;color:var(--ink)">' + w.n + '</span></span>' + w.its.map((it) => '<button class="wm-pill ' + (ST[it.s] ? ST[it.s].e : '') + '" data-act="open:' + it.id + '">' + esc(it.t.slice(0, 22)) + '</button>').join('') + '</div>').join('') + '</div>';
        return h.replace(/<div class="week-mini">[\s\S]*?<\/div><\/div>(?=<\/div>)/, strip);
      };
    }
  })();

  /* ---------------- item log: real history, versions and notes ----------------
   * every item carries log[] = { k, w, t, x }: what happened, who, when (ms), text. */
  (function () {
    const who = () => (S.user && S.user.name) || (L.me && L.me.name) || '';
    const now = () => Date.now();
    const fmt = (t) => { const d = new Date(t); return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' }) + ' ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }); };
    const rel = (t) => {
      const m = Math.round((now() - t) / 60000);
      if (m < 1) return 'עכשיו';
      if (m < 60) return 'לפני ' + m + ' דק׳';
      const h = Math.round(m / 60);
      if (h < 24) return 'לפני ' + h + ' שע׳';
      const d = Math.round(h / 24);
      return d === 1 ? 'אתמול' : d < 7 ? 'לפני ' + d + ' ימים' : fmt(t);
    };
    const LBL = { created: 'נוצר', draft: 'נשמר כטיוטה', pending: 'נשלח לאישור', fix: 'הוחזר לתיקון', rejected: 'נדחה', approved: 'אושר', scheduled: 'תוזמן', published: 'פורסם', failed: 'הפרסום נכשל', archived: 'הועבר לארכיון', edit: 'עודכן', note: 'הערה' };
    const ICON = { created: 'edit', edit: 'edit', pending: 'send', fix: 'undo', rejected: 'x', approved: 'check', scheduled: 'cal', published: 'send', failed: 'alert', note: 'msg' };
    const TONE = { pending: 'warn', fix: 'warn', rejected: 'bad', approved: 'ok', scheduled: 'ok', published: 'ok', failed: 'bad' };
    const logOf = (it) => (Array.isArray(it.log) ? it.log : (it.log = []));
    const add = (it, k, x) => { logOf(it).push({ k, w: who(), t: now(), x: x || '' }); it.at = now(); };
    L.itemLog = add;
    // called by the sync engine before every save: status changes and edits become log lines
    L.trackItems = function (prev) {
      for (const it of items) {
        if (typeof it.id !== 'number') continue;
        const pj = prev.get(it.id);
        if (!pj) { if (!logOf(it).length) add(it, 'created', it.t); continue; }
        let p = null; try { p = JSON.parse(pj); } catch (e) { continue; }
        if (p.s !== it.s) add(it, it.s, it.s === 'fix' ? it.fixnote : it.s === 'rejected' ? it.rej : it.s === 'failed' ? it.err : (it.s === 'scheduled' ? it.pub : ''));
        else if (p.t !== it.t || p.body !== it.body || p.cta !== it.cta || p.pub !== it.pub) add(it, 'edit', '');
      }
    };
    // "updated" shown everywhere is relative to the real time
    const _render = render;
    render = function () { for (const it of items) if (it.at) it.u = rel(it.at); return _render.apply(this, arguments); };
    // the item screen tabs are built from the log
    const _itemR = SCREENS.item.render;
    SCREENS.item.render = function () {
      let h = _itemR.apply(this, arguments);
      const it = items.find((x) => x.id === S.itemId) || items[0];
      if (!it) return h;
      const tab = S.tab.item || 'content';
      const log = logOf(it);
      if (tab === 'history') {
        const rows = (log.length ? log : [{ k: 'created', w: it.o || '', t: it.at || now(), x: '' }]).slice().reverse().map((e) => '<div class="tl-i"><span class="tl-dot ' + (TONE[e.k] || '') + '">' + ic(ICON[e.k] || 'edit', 13, 2) + '</span><span class="tl-tx"><b>' + esc(LBL[e.k] || e.k) + (e.x && e.k !== 'created' ? ' · ' + esc(e.x) : '') + '</b><br><span class="tl-time">' + esc(e.w) + ' · ' + esc(fmt(e.t)) + '</span></span></div>').join('');
        h = h.replace(/(<div class="tl" style="padding:14px 18px">)[\s\S]*?(<\/div><\/div>)/, '$1' + rows + '$2');
      } else if (tab === 'versions') {
        const ed = log.filter((e) => e.k === 'created' || e.k === 'edit');
        const rows = ed.length ? ed.slice().reverse().map((e, i) => '<tr><td data-l="גרסה"><b>' + (ed.length - i) + (i === 0 ? ' (נוכחית)' : '') + '</b></td><td data-l="שינוי">' + (e.k === 'created' ? 'נוסח ראשוני' : 'עדכון תוכן') + '</td><td data-l="מי">' + esc(e.w) + '</td><td data-l="מתי" class="t-sub">' + esc(fmt(e.t)) + '</td><td>' + (i ? '' : '<span class="chip">מוצגת עכשיו</span>') + '</td></tr>').join('')
          : '<tr><td colspan="5" class="t-sub">עדיין אין גרסאות קודמות.</td></tr>';
        h = h.replace(/<tbody>[\s\S]*?<\/tbody>/, '<tbody>' + rows + '</tbody>');
      } else if (tab === 'notes') {
        const ns = log.filter((e) => e.k === 'note' || ((e.k === 'fix' || e.k === 'rejected') && e.x));
        const cards = ns.length ? ns.map((n) => '<div class="card card-pad" style="box-shadow:none;padding:14px 16px"><div style="display:flex;gap:10px;align-items:center;margin-bottom:7px"><span class="avatar">' + esc(initials(n.w)) + '</span><span><b style="font-size:13.5px">' + esc(n.w) + '</b> <span class="t-sub">' + esc(n.k === 'note' ? 'הערה' : LBL[n.k]) + ' · ' + esc(fmt(n.t)) + '</span></span></div><div style="font-size:14px;line-height:1.6">' + esc(n.x) + '</div></div>').join('')
          : '<div class="note">' + ic('msg', 15) + '<span>עדיין אין הערות על הפריט.</span></div>';
        h = h.replace(/(<div style="display:flex;flex-direction:column;gap:12px;max-width:760px">)[\s\S]*?(<div class="card card-pad" style="box-shadow:none;padding:14px 16px"><div class="field"><label for="noteIn">)/, '$1' + cards + '$2');
      }
      return h;
    };
    ACT.addNote = () => {
      const t = $('#noteIn');
      const x = t ? t.value.trim() : '';
      if (!x) { toast('ההערה ריקה', 'יש לכתוב טקסט לפני השליחה.', 'err'); return; }
      const it = items.find((i) => i.id === S.itemId);
      if (!it) return;
      add(it, 'note', x);
      render();
      flush();
      toast('ההערה נוספה', 'ההערה נשמרה בפריט.');
    };
  })();

  /* ---------------- live polish: no mockup-only notes, archive works, no dead routes ---------------- */
  (function () {
    // onboarding: there is no demo to skip to
    if (SCREENS.onboard) { const _o = SCREENS.onboard.render; SCREENS.onboard.render = function () { return _o.apply(this, arguments).replace('>דילוג להדגמה<', '>דילוג בינתיים<'); }; }
    // item: archiving is a real action
    const _it = SCREENS.item.render;
    SCREENS.item.render = function () {
      const it = items.find((x) => x.id === S.itemId) || items[0];
      let h = _it.apply(this, arguments);
      if (!it) return h;
      const btn = it.s === 'archived'
        ? '<button class="btn btn-sm btn-block" data-act="unarchiveItem:' + it.id + '">' + ic('undo', 15) + ' החזרה מהארכיון</button>'
        : '<button class="btn btn-sm btn-block" data-act="archiveItem:' + it.id + '">' + ic('arch', 15) + ' העברה לארכיון</button>';
      return h.replace(/<button class="btn btn-sm btn-block is-disabled" disabled>[\s\S]*?<\/button>\s*<div class="t-sub" style="margin-top:7px">[^<]*<\/div>/, btn + '<div class="t-sub" style="margin-top:7px">פריט בארכיון יורד מהלוח ומהספרייה הפעילה ונשמר להיסטוריה.</div>');
    };
    ACT.archiveItem = (id) => {
      const it = items.find((i) => i.id === +id); if (!it) return;
      confirmModal({ title: 'להעביר לארכיון?', body: 'הפריט „' + esc(it.t) + '” יועבר לארכיון. אפשר להחזיר אותו בכל רגע.', ok: 'העברה לארכיון', icon: 'arch',
        onOk: () => { it.prevS = it.s; it.s = 'archived'; it.at = Date.now(); toast('הועבר לארכיון', esc(it.t)); go('library'); } });
    };
    ACT.unarchiveItem = (id) => { const it = items.find((i) => i.id === +id); if (!it) return; it.s = it.prevS && it.prevS !== 'archived' ? it.prevS : 'draft'; delete it.prevS; it.at = Date.now(); toast('הוחזר מהארכיון', esc(it.t)); render(); };
    // the bulk screens need a campaign in progress
    ['bulkGen', 'bulkReview'].forEach((k) => {
      if (!SCREENS[k]) return;
      const _r = SCREENS[k].render;
      SCREENS[k].render = function () { if (k === 'bulkGen' ? !S.genCamp : !S.bulk) { setTimeout(() => go('bulk', { force: true }), 0); return '<div class="note">' + ic('help', 15) + '<span>אין סדרת תוכן פתוחה. חוזרים ליצירת סדרה.</span></div>'; } return _r.apply(this, arguments); };
    });
  })();

  /* ---------------- live polish, both sides: no "(הדגמה)" labels, real exports and dates ---------------- */
  (function () {
    const today = () => new Date().toISOString().slice(0, 10);
    const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
    const monthT = () => { const d = new Date(); return MONTHS[d.getMonth()] + ' ' + d.getFullYear(); };
    // toasts never say "demo"
    const _toast = toast;
    toast = function (t, sub, type) { const cl = (x) => (typeof x === 'string' ? x.replace(/\s*\(הדגמה\)\.?/g, (m) => (m.endsWith('.') ? '.' : '')) : x); return _toast(cl(t), cl(sub), type); };
    // CSV of the table on screen (Excel-friendly, UTF-8 BOM)
    ACT.exportCsv = () => {
      const tb = $('#view table');
      if (!tb) { toast('אין טבלה לייצוא', '', 'err'); return; }
      const rows = [...tb.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('th,td')].map((c) => '"' + c.innerText.replace(/\s+/g, ' ').trim().replace(/"/g, '""') + '"').join(','));
      const blob = new Blob(['\ufeff' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'primeos-' + (S.route || 'export') + '-' + today() + '.csv'; document.body.appendChild(a); a.click(); a.remove();
      toast('הקובץ ירד', 'CSV עם ' + Math.max(0, rows.length - 1) + ' שורות.');
    };
    // the agreement opens for printing / saving as PDF
    ACT.agrPrint = () => {
      const mb = $('#modalBox .mb');
      if (!mb) return;
      const w = window.open('', '_blank');
      if (!w) { toast('החלון נחסם', 'יש לאפשר חלונות קופצים לאתר.', 'err'); return; }
      w.document.write('<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>הסכם מנוי</title><style>body{font-family:Heebo,Arial,sans-serif;padding:32px;max-width:800px;margin:auto;line-height:1.6}</style></head><body>' + mb.innerHTML + '<script>setTimeout(()=>print(),300)</script></body></html>');
      w.document.close();
    };
    // the mockup's fixed action labels become real actions after every render
    const fixActs = () => {
      try {
        document.querySelectorAll('[data-act^="toastInfo:הקובץ ירד בפורמט CSV"]').forEach((e) => e.setAttribute('data-act', 'exportCsv'));
        document.querySelectorAll('[data-act^="toastInfo:ההסכם ירד כ־PDF"]').forEach((e) => { e.setAttribute('data-act', 'agrPrint'); e.textContent = 'הדפסה / שמירה כ־PDF'; });
      } catch (e) { /* no DOM yet */ }
    };
    const _render = render;
    render = function () { const r = _render.apply(this, arguments); fixActs(); return r; };
    const _openModal = openModal;
    openModal = function () { const r = _openModal.apply(this, arguments); fixActs(); return r; };
    {
      // purchases: the current month, not the demo's September
      if (SCREENS.a_purch) {
        const _pu = SCREENS.a_purch.render;
        SCREENS.a_purch.render = function () {
          let h = _pu.apply(this, arguments).replace(/ספטמבר 2026/g, monthT());
          const cur = today().slice(0, 7), tm = PURCH.filter((x) => String(x.date || '').slice(0, 7) === cur);
          const fix = (label, n) => { h = h.replace(new RegExp('(' + label + '</span><span class="num">)[^<]*'), '$1' + n); };
          fix('מנויים חדשים החודש', tm.filter((x) => x.type === 'new' || x.type === 'trial').length);
          fix('רכישות החודש', tm.length);
          fix('הכנסה חדשה החודש', usd(tm.reduce((a, x) => a + (+x.cost || 0), 0)));
          return h;
        };
      }
      const stampNew = (f) => (...a) => { const r = f(...a); const x = PURCH[0]; if (x && typeof x.id === 'number' && Date.now() - x.id < 5000) x.date = today(); return r; };
      ['nwNext', 'reqOk'].forEach((k) => { if (ACT[k]) ACT[k] = stampNew(ACT[k]); });
      // a client page without a client goes back to the list
      if (SCREENS.a_org) { const _ao = SCREENS.a_org.render; SCREENS.a_org.render = function () { if (!ORGS.find((x) => x.id === S.orgId)) { setTimeout(() => go('a_orgs', { force: true }), 0); return ''; } return _ao.apply(this, arguments); }; }
    }
  })();

  /* ---------------- reports: live figures, never the demo's ---------------- */
  (function () {
    const conn = () => channels.filter((c) => c.st === 'מחובר').length;
    const chTxt = (n) => (n === 0 ? 'אין ערוצים מחוברים' : n === 1 ? 'בערוץ מחובר אחד' : 'ב־' + n + ' ערוצים מחוברים');
    if (SCREENS.reports) {
      const _r = SCREENS.reports.render;
      SCREENS.reports.render = function () {
        let h = _r.apply(this, arguments);
        const pend = items.filter((i) => i.s === 'pending').length;
        const byD = {};
        items.forEach((i) => { if (i.d) byD[i.d] = (byD[i.d] || 0) + 1; });
        const active = Object.keys(byD).length;
        const top = Object.keys(byD).sort((a, b) => byD[b] - byD[a])[0];
        h = h.replace('זמן ממוצע לאישור', 'ממתינים לאישור').replace('3.4 שעות', String(pend)).replace('ירידה מ־5.1 בחודש שעבר', pend ? 'תכנים שמחכים להחלטה' : 'אין תכנים בהמתנה');
        h = h.replace('>5<', '>' + active + '<').replace('דוברות מובילה ב־4 פריטים', top ? esc(top) + ' מובילה ב־' + byD[top] + ' פריטים' : 'עדיין אין פעילות');
        h = h.replace('בארבעה ערוצים', chTxt(conn()));
        return h;
      };
    }
    if (SCREENS.dashboard) {
      const _d = SCREENS.dashboard.render;
      SCREENS.dashboard.render = function () { return _d.apply(this, arguments).replace('בארבעה ערוצים מחוברים', chTxt(conn())); };
    }
  })();

  /* ---------------- "משתמש יחיד": a department user ----------------
   * Sees only its department. Own channels. Brand: the organisation's (read-only) or a brand of its own.
   * Approvals: view and edit only; publishing needs the organisation user's approval unless allowed directly. */
  (function () {
    const isSingle = () => !!(L.me && L.me.role === 'member');
    NAV_V.dept = ['dashboard', 'create', 'library', 'calendar', 'approvals', 'channels', 'brand', 'reports', 'settings'];
    const deepCopy = (o) => JSON.parse(JSON.stringify(o));
    const emptyChannels = () => (L.orgChannels || channels).map((c) => ({ k: c.k, st: 'לא מחובר', acc: '-', sync: '-', fol: '-' }));
    // direct publishing is a permission the organisation user grants; the mockup's department view had none
    const _canDirect = canDirect, _curUser = curUser;
    canDirect = function () { return isSingle() ? !!(L.me.perms && L.me.perms.direct) : _canDirect(); };
    curUser = function () { return isSingle() ? { n: L.me.name, direct: canDirect() } : _curUser(); };
    // the member's department always exists locally, even if the organisation renamed its departments
    function ensureDept() {
      const d = L.me.dept || S.dept;
      if (!d) return;
      if (!DEPTS.includes(d)) DEPTS.push(d);
      if (!DEPT_C[d]) DEPT_C[d] = DEPT_COLORS[(DEPTS.length - 1) % DEPT_COLORS.length];
      if (!DEPT_INFO[d]) DEPT_INFO[d] = { lead: L.me.name, route: 'full', phones: [], mails: [], appr: null };
      else if (!DEPT_INFO[d].lead) DEPT_INFO[d].lead = L.me.name;
      S.dept = d;
    }
    // the member's slices come from the organisation state, under its own id
    L.memberSlices = function (st) {
      if (!isSingle()) return;
      ensureDept();
      const mid = L.me.id;
      if (!L.orgBrand) L.orgBrand = deepCopy(BRAND);
      if (!L.orgChannels) L.orgChannels = deepCopy(channels);
      const mb = st && st.memberBrand && st.memberBrand[mid];
      const mc = st && st.memberChannels && st.memberChannels[mid];
      S.ownBrand = !!(mb && mb.own && mb.brand);
      replaceObj(BRAND, S.ownBrand ? mb.brand : L.orgBrand);
      // saved slice by channel key, so channels added to the system later still appear
      const base = emptyChannels();
      if (Array.isArray(mc)) for (const c of mc) { const i = base.findIndex((b) => b.k === c.k); if (i >= 0) base[i] = { ...base[i], ...c }; }
      replaceAll(channels, base);
    };
    L.memberPatch = function () {
      if (!isSingle()) return null;
      const mid = L.me.id;
      return { memberBrand: { [mid]: { own: !!S.ownBrand, brand: S.ownBrand ? BRAND : null } }, memberChannels: { [mid]: channels } };
    };
    // when the organisation state arrives from the server, the member keeps its own slices
    const _hyd = hydrateClient;
    hydrateClient = function (st) { _hyd(st); if (isSingle()) L.memberSlices(st); };

    // the brand screen: the organisation's brand, or the member's own
    if (SCREENS.brand) {
      const _bR = SCREENS.brand.render;
      SCREENS.brand.render = function () {
        const h = _bR.apply(this, arguments);
        if (!isSingle()) return h;
        const bar = S.ownBrand
          ? '<div class="note" style="margin-bottom:14px;align-items:center">' + ic('palette', 16) + '<span><b>נכסי מותג משלך.</b> הגרפיקות של המחלקה נבנות לפי המותג הזה.</span><button class="btn btn-sm" style="margin-inline-start:auto" data-act="brandUseOrg">חזרה למותג הארגון</button></div>'
          : '<div class="note" style="margin-bottom:14px;align-items:center">' + ic('shield', 16) + '<span><b>שימוש במותג הראשי של הארגון.</b> המיתוג מנוהל על ידי משתמש הארגון ואינו ניתן לשינוי מכאן.</span><button class="btn btn-sm btn-primary" style="margin-inline-start:auto" data-act="brandOwn">בניית נכסי מותג משלי</button></div>';
        if (S.ownBrand) return bar + h;
        return bar + '<div class="brand-locked" style="pointer-events:none;opacity:.72">' + h + '</div>';
      };
    }
    ACT.brandOwn = () => {
      confirmModal({ title: 'לבנות נכסי מותג משלך?', body: 'המחלקה תקבל מותג משלה, בנפרד מהמותג הראשי. מתחילים מעותק של מותג הארגון ומשנים מה שרוצים. אפשר לחזור למותג הארגון בכל רגע.', ok: 'בניית נכסי מותג משלי', icon: 'palette',
        onOk: () => { S.ownBrand = true; replaceObj(BRAND, deepCopy(L.orgBrand || BRAND)); render(); flush(); toast('נכסי מותג משלך', 'כל שינוי כאן נשמר למחלקה בלבד.'); } });
    };
    ACT.brandUseOrg = () => {
      confirmModal({ title: 'לחזור למותג הארגון?', body: 'נכסי המותג שלך יימחקו והמחלקה תשתמש שוב במותג הראשי.', ok: 'חזרה למותג הארגון', tone: 'warn', icon: 'alert',
        onOk: () => { S.ownBrand = false; replaceObj(BRAND, deepCopy(L.orgBrand || BRAND)); render(); flush(); toast('מותג הארגון', 'המחלקה משתמשת במותג הראשי.'); } });
    };

    // approvals and the item screen: view and edit only, no approve / reject
    const strip = (h) => h.replace(/<button[^>]*data-act="(approve|askfix|reject|cApproveAll|cReturn):[^"]*"[^>]*>[\s\S]*?<\/button>/g, '').replace(/<button[^>]*data-act="(cApproveAll|cReturn)"[^>]*>[\s\S]*?<\/button>/g, '');
    ['approvals', 'item'].forEach((k) => {
      if (!SCREENS[k]) return;
      const _r = SCREENS[k].render;
      SCREENS[k].render = function () { const h = _r.apply(this, arguments); return isSingle() ? strip(h) : h; };
    });
    const _od = openDrawer;
    openDrawer = function (h) { return _od(isSingle() && typeof h === 'string' ? strip(h) : h); };
    ['approve', 'askfix', 'reject', 'cApproveAll'].forEach((k) => { const f = ACT[k]; ACT[k] = (...a) => { if (isSingle()) { toast('אישור תוכן', 'את התוכן מאשר משתמש הארגון.', ''); return; } return f.apply(null, a); }; });
    // publishing without the direct-publish permission: the content goes to approval instead
    ['wizPublish', 'sched', 'cPublish', 'publish'].forEach((k) => { const f = ACT[k]; if (!f) return; ACT[k] = (...a) => { if (isSingle() && !canDirect()) { toast('הפרסום דורש אישור', 'התוכן נשלח לאישור של הרשאת מנהל.', ''); if (k === 'cPublish') return ACT.cSend(); return S.wiz && ACT.wizSend ? ACT.wizSend() : undefined; } return f.apply(null, a); }; });
  })();
  /* ---------------- publishing: real channels and real posts through the provider layer ----------------
   * The server talks to the publishing provider (Zernio today, replaceable). The UI only knows:
   * ch.list / ch.connect / ch.disconnect, and that a scheduled or published item goes out by itself. */
  (function () {
    const CHK = ['fb', 'ig', 'x', 'yt', 'li', 'tk', 'th', 'gb', 'tg', 'wa'];
    // networks added on top of the mockup's six
    Object.assign(CH, { th: { t: 'Threads', b: '#101010', s: 'TH' }, gb: { t: 'גוגל לעסקים', b: '#4285F4', s: 'G' }, tg: { t: 'Telegram', b: '#229ED9', s: 'TG' }, wa: { t: 'WhatsApp', b: '#25A244', s: 'WA' } });
    /* official brand marks for every channel (simple-icons paths, brand colours) */
    const CH_ICON = {"fb": "<svg class=\"chi\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\"><path fill=\"#0866FF\" d=\"M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z\"/></svg>", "ig": "<svg class=\"chi\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\"><path fill=\"url(#chiIg)\" d=\"M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077\"/></svg>", "x": "<svg class=\"chi\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\"><path fill=\"#000\" d=\"M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z\"/></svg>", "yt": "<svg class=\"chi\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\"><path fill=\"#fff\" d=\"M9 7.5h6.5v9H9z\"/><path fill=\"#FF0000\" d=\"M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z\"/></svg>", "li": "<svg class=\"chi\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\"><path fill=\"#fff\" d=\"M3 3h18v18H3z\"/><path fill=\"#0A66C2\" d=\"M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z\"/></svg>", "tk": "<svg class=\"chi\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\"><path fill=\"#25F4EE\" transform=\"translate(-.7 -.6)\" d=\"M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z\"/><path fill=\"#FE2C55\" transform=\"translate(.7 .6)\" d=\"M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z\"/><path fill=\"#000\" d=\"M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z\"/></svg>", "th": "<svg class=\"chi\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\"><path fill=\"#000\" d=\"M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291a13.853 13.853 0 0 1 3.02.142c-.126-.742-.375-1.332-.75-1.757-.513-.586-1.308-.883-2.359-.89h-.029c-.844 0-1.992.232-2.721 1.32L7.734 7.847c.98-1.454 2.568-2.256 4.478-2.256h.044c3.194.02 5.097 1.975 5.287 5.388.108.046.216.094.321.142 1.49.7 2.58 1.761 3.154 3.07.797 1.82.871 4.79-1.548 7.158-1.85 1.81-4.094 2.628-7.277 2.65Zm1.003-11.69c-.242 0-.487.007-.739.021-1.836.103-2.98.946-2.916 2.143.067 1.256 1.452 1.839 2.784 1.767 1.224-.065 2.818-.543 3.086-3.71a10.5 10.5 0 0 0-2.215-.221z\"/></svg>", "tg": "<svg class=\"chi\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\"><path fill=\"#26A5E4\" d=\"M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z\"/></svg>", "wa": "<svg class=\"chi\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\"><path fill=\"#25D366\" d=\"M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z\"/></svg>", "gb": "<svg class=\"chi\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\"><path fill=\"#4285F4\" d=\"M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z\"/><path fill=\"#34A853\" d=\"M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z\"/><path fill=\"#FBBC05\" d=\"M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z\"/><path fill=\"#EA4335\" d=\"M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z\"/></svg>", "web": "<svg class=\"chi\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\"><circle cx=\"12\" cy=\"12\" r=\"9.2\" fill=\"none\" stroke=\"#0E3B6B\" stroke-width=\"1.8\"/><path fill=\"none\" stroke=\"#0E3B6B\" stroke-width=\"1.6\" d=\"M2.8 12h18.4M12 2.8c2.6 2.6 3.8 5.6 3.8 9.2s-1.2 6.6-3.8 9.2c-2.6-2.6-3.8-5.6-3.8-9.2s1.2-6.6 3.8-9.2z\"/></svg>"};
    Object.keys(CH_ICON).forEach((k) => { if (CH[k]) { CH[k].s = CH_ICON[k]; CH[k].mark = 1; } });
    if (!document.getElementById('chiDefs')) {
      const g = document.createElement('div');
      g.innerHTML = '<svg id="chiDefs" width="0" height="0" style="position:absolute" aria-hidden="true"><defs><radialGradient id="chiIg" cx="30%" cy="107%" r="150%"><stop offset="0" stop-color="#fdf497"/><stop offset=".05" stop-color="#fdf497"/><stop offset=".45" stop-color="#fd5949"/><stop offset=".6" stop-color="#d6249f"/><stop offset=".9" stop-color="#285AEB"/></radialGradient></defs></svg>';
      document.body.appendChild(g.firstChild);
    }
    const NO_POST = ['wa'];
    CHK.forEach((k) => { if (!channels.some((c) => c.k === k)) channels.push({ k, acc: '-', st: 'לא מחובר', sync: '-', fol: '-' }); });
    // the content wizards offer the networks the organisation actually connected
    const DEF_ON = CH_ON.slice();
    L.syncChOn = function () {
      if (!L.pub.on) return;
      const on = channels.filter((c) => c.st === 'מחובר' && !NO_POST.includes(c.k)).map((c) => c.k);
      CH_ON.splice(0, CH_ON.length, ...(on.length ? on : DEF_ON.filter((k) => k !== 'web')));
    };
    L.pub = { on: null, acc: [] };
    const hm = () => new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    const chName = (k) => (CH[k] ? CH[k].t : k);
    function applyAcc(list) {
      CHK.forEach((k) => {
        let c = channels.find((x) => x.k === k);
        const a = list.find((x) => x.ch === k);
        if (!c) { if (!a) return; c = { k, acc: '-', st: 'לא מחובר', sync: '-', fol: '-' }; channels.push(c); }
        if (a) Object.assign(c, { st: a.active ? 'מחובר' : 'דורש חידוש הרשאה', acc: a.name || chName(k), accId: a.id, sync: 'היום, ' + hm(), fol: a.followers != null ? Number(a.followers).toLocaleString('he-IL') : '-' });
        else Object.assign(c, { st: 'לא מחובר', acc: '-', accId: null, sync: '-', fol: '-' });
      });
    }
    async function refresh(quiet) {
      try {
        const r = await call('ch.list');
        L.pub.on = !!r.configured;
        if (r.configured) { L.pub.acc = r.accounts || []; CHK.forEach((k) => { if (!channels.some((c) => c.k === k)) channels.push({ k, acc: '-', st: 'לא מחובר', sync: '-', fol: '-' }); }); applyAcc(L.pub.acc); L.syncChOn(); }
      } catch (e) {
        // a server without the publishing layer yet answers unknown_action: same as not configured
        if (/unknown_action|publishing_not_configured/.test(String(e.message || ''))) { L.pub.on = false; if (S.route === 'channels') render(); return true; }
        if (!quiet) toast('בדיקת הערוצים נכשלה', 'נסו שוב בעוד רגע.', 'err'); return false;
      }
      if (S.route === 'channels' && !$('#drawer').classList.contains('on')) render();
      return true;
    }
    L.pubRefresh = refresh;
    const CB_KEYS = ['chcb', 'connected', 'profileId', 'accountId', 'username', 'request_id', 'stage', 'error', 'error_message', 'platform', 'is_user_fixable', 'error_reason', 'platform_error', 'platform_error_reason', 'platform_error_description', 'step', 'tempToken', 'userProfile', 'connect_token'];
    L.pubBoot = async function () {
      const u = new URL(location.href);
      const cb = u.searchParams.get('chcb');
      if (!cb) { refresh(true); return; }
      const err = u.searchParams.get('error'), em = u.searchParams.get('error_message');
      CB_KEYS.forEach((k) => u.searchParams.delete(k));
      history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
      go('channels');
      await refresh(true);
      const c = channels.find((x) => x.k === cb);
      if (err) toast('החיבור לא הושלם', chName(cb) + (em ? ': ' + em : '. אפשר לנסות שוב.'), 'err');
      else if (c && c.st === 'מחובר') toast('הערוץ חובר', chName(cb) + ' מחובר. פרסומים מתוזמנים יוצאים אליו מעכשיו.');
      else toast('החיבור בבדיקה', 'אם הערוץ לא מופיע כמחובר, לחצו על „בדיקת חיבור” בעוד רגע.');
    };
    const notReady = () => openModal('<div class="mb"><div class="m-ic warn">' + ic('plug', 20) + '</div><h3>חיבור ערוצים</h3><p>חיבור הרשתות ייפתח ברגע שמנהל המערכת ישלים את הגדרת ספק הפרסום. עד אז התוכן נשמר ומתוזמן במערכת.</p></div><div class="modal-foot"><button class="btn btn-primary" data-act="closeModal">הבנתי</button></div>');
    ACT.tgConnect = async () => {
      const v = ($('#tgChat') || {}).value || '';
      if (!v.trim()) { toast('חסר שם ערוץ', 'כתבו את שם הערוץ, למשל @nave_hadar', 'err'); return; }
      const b = $('#tgGo'); if (b) { b.disabled = true; b.textContent = 'מחברים...'; }
      try {
        await call('ch.connect', { ch: 'tg', chat: v.trim() });
        closeModal(); await refresh(true);
        toast('הערוץ חובר', 'Telegram מחובר. פרסומים יוצאים אליו מעכשיו.');
      } catch (e) {
        if (b) { b.disabled = false; b.textContent = 'חיבור הערוץ'; }
        toast('החיבור לא הושלם', 'בדקו שהבוט נוסף כמנהל עם הרשאת פרסום, ושהשם נכון.', 'err');
      }
    };
    const tgModal = () => openModal('<div class="mb"><div class="m-ic">' + ic('link', 20) + '</div><h3>חיבור ערוץ Telegram</h3>' +
      '<p>בטלגרם החיבור הוא דרך בוט, בלי חלון הרשאות:</p>' +
      '<ol style="margin:8px 0 12px;padding-inline-start:20px;line-height:1.9;font-size:14px"><li>פותחים את הערוץ בטלגרם ונכנסים לניהול הערוץ ולמנהלים.</li><li>מוסיפים כמנהל את הבוט הזה, עם הרשאה לפרסם הודעות:<div dir="ltr" style="text-align:left;font-weight:700;margin:4px 0">@ZernioScheduleBot</div></li><li>כותבים כאן את שם הערוץ ולוחצים על חיבור.</li></ol>' +
      '<div class="field"><label for="tgChat">שם הערוץ או הקישור אליו</label><input type="text" id="tgChat" dir="ltr" placeholder="@channel_name"></div></div>' +
      '<div class="modal-foot"><button class="btn btn-primary" id="tgGo" data-act="tgConnect">חיבור הערוץ</button><button class="btn" data-act="closeModal">ביטול</button></div>');
    ACT.chGo = async (k) => {
      if (L.pub.on === false) { notReady(); return; }
      // a modal already on screen (the network picker) closes first, then the next one opens
      const after = (fn) => { if ($('#modal').classList.contains('hidden')) fn(); else { closeModal(); setTimeout(fn, 230); } };
      if (k === 'tg') { after(tgModal); return; }
      if (k === 'wa' && !ACT.chGo.waOk) {
        after(() => confirmModal({ title: 'חיבור WhatsApp', icon: 'link', body: 'החיבור דורש חשבון WhatsApp Business בתוך חשבון עסקי של מטא. בוואטסאפ לא מפרסמים פוסטים: הוא משמש לשליחת הודעות תפוצה מאושרות לאנשי קשר. להמשיך לחלון החיבור?', ok: 'המשך לחיבור',
          onOk: () => { ACT.chGo.waOk = true; ACT.chGo('wa'); ACT.chGo.waOk = false; } }));
        return;
      }
      try {
        toast('פותחים את חלון ההרשאות', chName(k) + '. אחרי האישור חוזרים לכאן.');
        const r = await call('ch.connect', { ch: k });
        location.href = r.url;
      } catch (e) {
        if (/publishing_not_configured|unknown_action/.test(String(e.message || ''))) { L.pub.on = false; notReady(); }
        else toast('החיבור לא נפתח', 'נסו שוב בעוד רגע.', 'err');
      }
    };
    ACT.connectCh = (k) => {
      closeDrawer();
      if (k) { ACT.chGo(k); return; }
      if (L.pub.on === false) { notReady(); return; }
      const free = CHK.filter((x) => CH[x] && !channels.some((c) => c.k === x && c.st === 'מחובר'));
      openModal('<div class="mb"><div class="m-ic">' + ic('link', 20) + '</div><h3>חיבור ערוץ</h3><p>בוחרים רשת. נפתח חלון ההרשאות שלה, ואחרי האישור חוזרים לכאן.</p>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-top:12px">' +
        (free.length ? free.map((x) => '<button class="btn" style="justify-content:flex-start;gap:10px" data-act="chGo:' + x + '"><span class="chan-logo" style="background:' + CH[x].b + ';width:28px;height:28px;font-size:12px">' + CH[x].s + '</span>' + CH[x].t + '</button>').join('') : '<span class="t-sub">כל הערוצים כבר מחוברים.</span>') +
        '</div></div><div class="modal-foot"><button class="btn" data-act="closeModal">סגירה</button></div>');
    };
    ACT.reauth = (k) => ACT.chGo(k);
    ACT.testCh = async (k) => {
      if (L.pub.on === false) { notReady(); return; }
      if (!(await refresh())) return;
      const c = channels.find((x) => x.k === k);
      if (c && c.st === 'מחובר') toast('החיבור תקין', chName(k) + ' · ' + c.acc);
      else toast('הערוץ לא מחובר', 'יש לחבר את ' + chName(k) + ' מחדש.', 'err');
    };
    ACT.chDisc = (k) => {
      closeDrawer();
      confirmModal({ title: 'לנתק את ' + chName(k) + '?', body: 'פרסומים מתוזמנים לערוץ הזה לא ייצאו עד שיחובר שוב.', ok: 'ניתוק', tone: 'bad', icon: 'x',
        onOk: async () => { try { await call('ch.disconnect', { ch: k }); await refresh(true); toast('הערוץ נותק', chName(k)); } catch (e) { toast('הניתוק נכשל', 'נסו שוב בעוד רגע.', 'err'); } } });
    };
    ACT.chManage = (k) => {
      const c = channels.find((x) => x.k === k); if (!c) return;
      openDrawer('<div class="drawer-head"><span class="chan-logo" style="background:' + CH[k].b + ';width:40px;height:40px">' + CH[k].s + '</span><div><h3>' + CH[k].t + '</h3><p>' + esc(c.acc) + '</p></div><button class="icon-btn" style="margin-inline-start:auto" data-act="closeDrawer" aria-label="סגירה">' + ic('x', 17) + '</button></div>' +
        '<div class="drawer-body"><div class="kv">' + [['סטטוס', c.st], ['בדיקה אחרונה', c.sync], ['עוקבים', c.fol]].map((r) => '<div class="r"><span class="k">' + r[0] + '</span><span class="v">' + esc(r[1]) + '</span></div>').join('') + '</div>' +
        '<button class="btn btn-block" style="justify-content:flex-start" data-act="testCh:' + k + '">' + ic('refresh', 16) + ' בדיקת חיבור</button>' +
        '<button class="btn btn-block" style="justify-content:flex-start" data-act="chGo:' + k + '">' + ic('link', 16) + ' חיבור מחדש</button>' +
        '<button class="btn btn-block btn-quiet-bad" style="justify-content:flex-start" data-act="chDisc:' + k + '">' + ic('x', 16) + ' ניתוק הערוץ</button></div>');
    };
    // "חיבור" on a row opens that network directly
    const _chR = SCREENS.channels.render;
    SCREENS.channels.render = function () {
      let h = _chR.apply(this, arguments);
      const free = channels.filter((c) => !(c.st === 'מחובר' || c.st === 'דורש חידוש הרשאה'));
      let i = 0;
      h = h.replace(/<button class="btn btn-sm btn-primary" data-act="connectCh">חיבור<\/button>/g, (m) => { const c = free[i++]; return c ? m.replace('data-act="connectCh"', 'data-act="chGo:' + c.k + '"') : m; });
      if (L.pub.on === false) h = h.replace('<div class="ch-list">', '<div class="note" style="margin-bottom:14px">' + ic('plug', 16) + '<span>חיבור הרשתות ייפתח אחרי הגדרת ספק הפרסום. התוכן נשמר ומתוזמן במערכת בינתיים.</span></div><div class="ch-list">');
      return h;
    };
    // a failed post goes out again
    ACT.retry = (id) => {
      const it = itemById(id); if (!it) return;
      if (L.pub.on === false) { notReady(); return; }
      const fut = it.pub && Date.parse(it.pub.replace(' ', 'T') + ':00+03:00') > Date.now() + 60000;
      it.s = fut ? 'scheduled' : 'published'; delete it.err;
      render(); flush();
      toast('נשלח שוב לפרסום', fut ? 'יוצא במועד ' + it.pub : 'יוצא עכשיו. הסטטוס יתעדכן כאן.');
    };
    // where the post went: links per network, and a warning when part of it did not go out
    const _itR = SCREENS.item.render;
    SCREENS.item.render = function () {
      let h = _itR.apply(this, arguments);
      const it = items.find((x) => x.id === S.itemId) || items[0];
      if (!it) return h;
      const ln = it.links ? Object.keys(it.links).filter((k) => /^https:\/\//.test(it.links[k])) : [];
      const extra = (ln.length ? '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:-6px 0 16px"><span class="t-sub">צפייה בפוסט:</span>' + ln.map((k) => '<a class="chip" href="' + esc(it.links[k]) + '" target="_blank" rel="noopener">' + ic('link', 13) + ' ' + esc(chName(k)) + '</a>').join('') + '</div>' : '') +
        (it.pubWarn ? '<div class="note" style="margin:-6px 0 16px">' + ic('alert', 15) + '<span>' + esc(it.pubWarn) + '</span></div>' : '');
      return extra ? h.replace('<div class="split-wide">', extra + '<div class="split-wide">') : h;
    };
  })();
  /* ---------------- channel insights from the connected accounts ---------------- */
  (function () {
    const C = {};
    const fmtN = (v) => (v == null ? '-' : v >= 10000 ? (v / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : Number(v).toLocaleString('he-IL'));
    const key = () => S.insCh + ':' + S.insPer;
    async function load(force) {
      const k = key();
      if (C[k] && !force && (C[k].loading || Date.now() - C[k].at < 10 * 60000)) return;
      C[k] = { loading: true, at: Date.now(), data: C[k] && C[k].data };
      if (S.route === 'insights') render();
      try { C[k] = { at: Date.now(), data: await call('ch.stats', { ch: S.insCh, days: S.insPer === 90 ? 89 : S.insPer }) }; }
      catch (e) { C[k] = { at: Date.now(), err: true, data: C[k].data }; }
      if (S.route === 'insights' && key() === k) render();
    }
    const _insR = SCREENS.insights.render;
    SCREENS.insights.render = function () {
      if (!L.pub || !L.pub.on) return _insR.apply(this, arguments);
      const live = channels.filter((c) => c.st !== 'לא מחובר');
      if (!live.find((c) => c.k === S.insCh)) S.insCh = (live[0] || {}).k;
      const picker = '<div class="ins-pick">' + channels.map((x) => { const on = x.st !== 'לא מחובר'; return '<button class="ins-ch' + (x.k === S.insCh ? ' on' : '') + (on ? '' : ' off') + '" data-act="' + (on ? 'insCh:' + x.k : 'nav:channels') + '"><span class="chan-logo" style="background:' + CH[x.k].b + '">' + CH[x.k].s + '</span><span>' + CH[x.k].t + '</span>' + (on ? '' : '<small>לא מחובר</small>') + '</button>'; }).join('') + '</div>';
      const head = pageHead({ title: 'נתוני ערוצים', desc: 'הנתונים שכל רשת מאפשרת למשוך, ישירות מהחשבון המחובר.' });
      const c = channels.find((x) => x.k === S.insCh);
      if (!c || c.st === 'לא מחובר') return head + picker + emptyState({ i: 'plug', t: 'אין ערוצים מחוברים', d: 'חברו ערוץ בעמוד „ערוצים מחוברים” כדי לראות כאן את הנתונים שלו.' });
      const st = C[key()];
      if (!st || (st.loading && !st.data)) { load(); return head + picker + '<div class="card card-pad" style="padding:48px 20px">' + thinkBox() + '</div>'; }
      const d = st.data || {};
      if (st.err && !st.data) return head + picker + '<div class="note">' + ic('alert', 15) + '<span>הנתונים לא נטענו כרגע. <button class="lnk" data-act="insRefresh">ניסיון נוסף</button></span></div>';
      if (d.connected === false) return head + picker + emptyState({ i: 'plug', t: 'הערוץ לא מחובר', d: 'חברו מחדש את ' + CH[c.k].t + ' בעמוד „ערוצים מחוברים”.' });
      const t = d.totals || {};
      const vid = c.k === 'tk' || c.k === 'yt';
      const reachV = vid ? (t.views || t.impressions) : (t.impressions || t.views);
      const gr = d.growth != null && d.growth !== 0 ? (d.growth > 0 ? '+' : '') + fmtN(d.growth) + ' בתקופה' : 'ללא שינוי בתקופה';
      const kpi = [['עוקבים', fmtN(d.followers != null ? d.followers : (d.account || {}).followers), gr], [vid ? 'צפיות' : 'חשיפה לתוכן', fmtN(reachV), S.insPer + ' הימים האחרונים'], ['מעורבות', fmtN(t.engagement), 'לייקים, תגובות, שיתופים ושמירות'], ['פרסומים בתקופה', fmtN(t.posts), 'שיצאו לחשבון']];
      const ser = (d.reachSeries && d.reachSeries.some((p) => p.value)) ? { s: d.reachSeries, l: d.reachLabel || (vid ? 'צפיות' : 'חשיפה') } : (d.followSeries && d.followSeries.length > 1 ? { s: d.followSeries, l: 'עוקבים' } : null);
      const chart = ser ? lineChart(ser.s.map((p) => p.value).reverse(), 1100, 230, CH[c.k].b) : '<div class="note">' + ic('clock', 15) + '<span>אין עדיין מגמה יומית להצגה. הנתונים נאספים פעם ביום ויופיעו כאן אחרי הימים הראשונים.</span></div>';
      const top = (d.top || []).length ? d.top.map((p) => '<div class="rowi">' + (p.thumb ? '<span class="thumb ins-th" style="background-image:url(&quot;' + esc(p.thumb) + '&quot;);background-size:cover"></span>' : '<span class="thumb ins-th"></span>') +
        '<span class="grow"><span class="nm">' + esc((p.text || 'פרסום').slice(0, 70)) + '</span><br><span class="mt">' + esc(p.at ? new Date(p.at).toLocaleDateString('he-IL') : '') + (p.url ? ' · <a href="' + esc(p.url) + '" target="_blank" rel="noopener">לפוסט</a>' : '') + '</span></span>' +
        '<span class="ins-m"><b>' + fmtN(vid ? (p.views || p.impressions) : (p.impressions || p.views)) + '</b><span>' + (vid ? 'צפיות' : 'חשיפה') + '</span></span><span class="ins-m"><b>' + fmtN(p.engagement) + '</b><span>מעורבות</span></span></div>').join('')
        : '<div class="card-pad"><div class="note">' + ic('send', 15) + '<span>אין פרסומים בתקופה הזו. פרסומים שיוצאים מהמערכת יופיעו כאן עם הנתונים שלהם.</span></div></div>';
      const when = st.loading ? 'מתעדכן...' : 'עודכן ' + new Date(st.at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
      return head + picker +
        '<div class="card ins-head"><span class="chan-logo" style="background:' + CH[c.k].b + '">' + CH[c.k].s + '</span><div><h2>' + CH[c.k].t + '</h2><span class="t-sub">' + esc(c.acc) + '</span></div>' +
        '<span class="live"><i></i>' + when + '</span>' +
        '<div class="seg" style="margin-inline-start:auto">' + [[7, '7 ימים'], [28, '28 ימים'], [90, '90 ימים']].map((p) => '<button class="' + (S.insPer === p[0] ? 'on' : '') + '" data-act="insPer:' + p[0] + '">' + p[1] + '</button>').join('') + '</div>' +
        '<button class="icon-btn" data-act="insRefresh" aria-label="רענון">' + ic('refresh', 17) + '</button></div>' +
        (d.locked ? '<div class="note" style="margin:12px 0">' + ic('alert', 15) + '<span>חלק מהנתונים לא זמינים בחשבון הפרסום הנוכחי.</span></div>' : '') +
        '<div class="grid g-4" style="margin:16px 0">' + kpi.map((k) => '<div class="card card-pad kpi"><span class="t-sub">' + k[0] + '</span><b>' + k[1] + '</b><span class="t-sub">' + k[2] + '</span></div>').join('') + '</div>' +
        '<div class="card" style="margin-bottom:16px"><div class="card-head">' + ic('pulse', 18) + '<h3>' + (ser ? esc(ser.l) : 'מגמה יומית') + '</h3><span class="t-sub" style="margin-inline-start:auto">' + S.insPer + ' הימים האחרונים</span></div><div class="card-pad" style="padding-top:10px">' + chart + '</div></div>' +
        '<div class="card"><div class="card-head">' + ic('send', 18) + '<h3>הפרסומים המובילים</h3></div><div class="row-list">' + top + '</div></div>' +
        '<div class="note" style="margin-top:16px">' + ic('shield', 15) + '<span>הנתונים נמשכים ישירות מהחשבון המחובר. חלק מהנתונים מתעדכנים ברשת באיחור של עד יממה.</span></div>';
    };
    const _pc = ACT.insPer;
    ACT.insPer = (p) => { S.insPer = +p; render(); };
    ACT.insRefresh = () => { if (L.pub && L.pub.on) { load(true); toast('מרעננים את הנתונים', CH[S.insCh] ? CH[S.insCh].t : ''); } else if (_pc) render(); };
  })();

  /* ---------- video v3: director brief -> approval -> production (Remotion in a sandbox) ----------
   * Step 0 details (+ length, narration, music, voice), step 1 style, step 2 the director's brief
   * for approval or change, step 3 production: visuals, narration, music, render. */
  (function () {
    const VID = '/api/video';
    const STEPS4 = ['פרטי הסרטון', 'סגנון', 'בריף', 'הפקה'];
    const TS_HE = { headline: 'כותרת עולה', pop: 'מילים קופצות', box: 'פסי צבע', typewriter: 'מכונת כתיבה', stamp: 'חותמת', lowerThird: 'פס שם', stat: 'מספר רץ', quote: 'ציטוט', list: 'רשימה', cinematic: 'קולנועי', outline: 'מתאר מתמלא', split: 'חשיפה', neon: 'ניאון' };
    const TR_HE = { cut: 'חיתוך', fade: 'עמעום', slide: 'החלקה', wipe: 'מחיקה', push: 'דחיפה', iris: 'עדשה', clockWipe: 'שעון', flip: 'היפוך', flash: 'הבזק', zoom: 'זום', whip: 'סחרור' };
    const MOOD_HE = { energetic: 'אנרגטי', emotional: 'רגשי', informative: 'מידעי', festive: 'חגיגי', solemn: 'ממלכתי', calm: 'רגוע', luxury: 'יוקרתי' };
    let CAPS = null;
    // director, narration and music calls can run past the default 95s client limit
    const genLong = (payload) => post(GEN, Object.assign(aiCtx(), payload), 170000);
    const capsLoad = () => CAPS ? Promise.resolve(CAPS) : gen({ mode: 'vcaps' }).then((r) => (CAPS = r)).catch(() => (CAPS = { caps: {}, voices: [] }));
    const ttsOn = () => !!(CAPS && CAPS.caps && (CAPS.caps.eleven || CAPS.caps.google));
    const musicOn = () => !!(CAPS && CAPS.caps && CAPS.caps.eleven);
    css.textContent += `
.vd-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.vd-dur{display:flex;align-items:center;gap:14px}.vd-dur input{flex:1;accent-color:var(--brand,#0E3B6B)}.vd-dur b{min-width:64px;text-align:center;font-size:18px}
.vd-tg{display:grid;grid-template-columns:1fr 1fr;gap:10px}.vd-tg .checkline{border:1.5px solid var(--line,#DDE3EC);border-radius:14px;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px}
.vd-tg small{display:block;color:var(--ink-3,#6B7890);font-size:12.5px;font-weight:500}
.vd-voices{display:flex;flex-wrap:wrap;gap:8px}.vd-voices .tagc small{opacity:.7;font-weight:500}
.vb-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:16px}
.vb-cell{background:var(--bg-2,#F4F6FA);border-radius:14px;padding:12px 14px}.vb-cell span{display:block;font-size:12.5px;color:var(--ink-3,#6B7890);margin-bottom:3px}.vb-cell b{font-size:14.5px;line-height:1.45;font-weight:600}
.vb-idea{font-size:17px;font-weight:700;line-height:1.5;margin:0 0 14px}
.vb-sc{width:100%;border-collapse:collapse;font-size:13.5px}.vb-sc th{text-align:start;font-weight:700;color:var(--ink-3,#6B7890);padding:8px 6px;border-bottom:1.5px solid var(--line,#DDE3EC);font-size:12.5px}
.vb-sc td{padding:10px 6px;border-bottom:1px solid var(--line,#E6EAF1);vertical-align:top;line-height:1.45}.vb-sc td small{display:block;color:var(--ink-3,#6B7890)}
.vb-wrap{overflow-x:auto}
.vb-chg{display:flex;gap:8px;margin-top:14px}.vb-chg input{flex:1}
.vp-list{list-style:none;padding:0;margin:18px auto 0;max-width:420px;display:grid;gap:8px}.vp-list li{display:flex;align-items:center;gap:10px;font-weight:600;color:var(--ink-3,#6B7890)}.vp-list li.done{color:var(--ok,#1F8A4C)}.vp-list li.on{color:var(--ink,#13213A)}
.vp-bar{height:8px;border-radius:99px;background:var(--bg-2,#EEF1F6);overflow:hidden;max-width:420px;margin:14px auto 0}.vp-bar i{display:block;height:100%;background:var(--brand,#0E3B6B);transition:width .6s}
@media(max-width:640px){.vd-tg,.vb-grid{grid-template-columns:1fr}.vb-sc th:nth-child(5),.vb-sc td:nth-child(5){display:none}}`;

    // brand palette -> engine colours, by role (same code as the render service: api/_render/palette.mjs)
    function vidBrand() {
      const b = brandFor(S.vd && S.vd.dept);
      return { org: b.org || aiCtx().org || '', dept: b.dept || '', logo: b.logo || undefined, colors: PAL.videoColors(b.colors || [], b.roles || {}) };
    }
    const fmtK = (f) => ({ '9:16': '9x16', '1:1': '1x1', '4:5': '4x5', '16:9': '16x9' }[f] || '9x16');
    const tsec = (n) => (Math.round(n * 10) / 10).toString().replace(/\.0$/, '');

    // ---- step 0 additions: length, narration, music, voice ----
    function extras(w) {
      const vs = (CAPS && CAPS.voices) || [];
      const vbtn = (v) => '<button class="tagc ' + (w.voiceId === v.id ? 'on' : '') + '" data-act="vdVoice:' + v.id + '" title="' + esc(v.tone) + '">' + (w.voiceId === v.id ? ic('check', 13, 2.4) : '') + esc(v.n) + ' <small>' + esc(v.tone.split(',')[0]) + '</small></button>';
      return '<div class="field full"><label for="vdDur">אורך הסרטון <span class="hint">עד 90 שניות</span></label><div class="vd-dur"><input type="range" id="vdDur" min="10" max="90" step="5" value="' + w.dur + '" aria-label="אורך בשניות"><b><span id="vdDurV">' + w.dur + '</span> שנ׳</b></div></div>' +
        '<div class="field full"><label>שמע</label><div class="vd-tg">' +
        '<div class="checkline"><span>קריינות בעברית<small>' + (ttsOn() ? 'קול מקצועי שמקריא את התסריט' : 'יופעל כשיחובר ספק קריינות') + '</small></span><button class="sw ' + (w.voice ? 'on' : '') + '" data-act="vdTg:voice" role="switch" aria-checked="' + w.voice + '" aria-label="קריינות"></button></div>' +
        '<div class="checkline"><span>מוזיקת רקע<small>' + (musicOn() ? 'מוזיקה מקורית שמותאמת לתוכן ולאורך' : 'תופעל כשיחובר ספק מוזיקה') + '</small></span><button class="sw ' + (w.music ? 'on' : '') + '" data-act="vdTg:music" role="switch" aria-checked="' + w.music + '" aria-label="מוזיקת רקע"></button></div>' +
        '</div></div>' +
        (w.voice && vs.length ? '<div class="field full"><label>קול הקריין</label><div class="vd-voices"><button class="tagc ' + (w.voiceId === 'auto' ? 'on' : '') + '" data-act="vdVoice:auto">' + (w.voiceId === 'auto' ? ic('check', 13, 2.4) : ic('spark', 13, 2)) + 'PrimeOS יבחר</button>' +
          vs.filter((v) => v.g === 'm').map(vbtn).join('') + vs.filter((v) => v.g === 'f').map(vbtn).join('') + '</div></div>' : '');
    }
    const _r0 = SCREENS.vidWiz.render;
    SCREENS.vidWiz.render = function () {
      const w = S.vd;
      if (!w) return _r0.call(this);
      if (w.dur == null) { w.dur = 30; w.voice = true; w.music = true; w.voiceId = 'auto'; capsLoad().then(() => { if (S.vd === w && S.route === 'vidWiz') render(); }); }
      let h = _r0.call(this);
      h = h.replace(/<div class="flow-steps">[\s\S]*?<\/div>/, stepsBar(STEPS4, w.prod ? 3 : w.step));
      if (w.prod) return headOnly(h) + prodView(w);
      if (w.step === 2 && w.brief) return headOnly(h) + briefView(w);
      if (w.step === 0) h = h.replace('<div class="field full"><label>פלטפורמות לפרסום</label>', extras(w) + '<div class="field full"><label>פלטפורמות לפרסום</label>');
      if (w.step === 1) h = h.replace(/data-act="vdGen">[\s\S]*?<\/button>/, 'data-act="vdGen">' + ic('spark', 17) + ' בניית בריף לסרטון</button>');
      return h;
    };
    const headOnly = (h) => { const i = h.indexOf('<div class="card'); return i > 0 ? h.slice(0, i) : h; };
    const _m0 = SCREENS.vidWiz.mount;
    SCREENS.vidWiz.mount = function () {
      _m0 && _m0.call(this);
      const r = $('#vdDur');
      if (r) r.addEventListener('input', () => { const v = $('#vdDurV'); if (v) v.textContent = r.value; if (S.vd) S.vd.dur = +r.value; });
    };
    ACT.vdTg = (k) => { vdCollect(); S.vd[k] = !S.vd[k]; render(); };
    ACT.vdVoice = (id) => { vdCollect(); S.vd.voiceId = id; render(); };

    // ---- the director ----
    function briefReq(v, change) {
      const media = (v.imgs || []).filter((m) => m.url).map((m) => ({ url: m.url, name: m.name || '', v: !!m.v }));
      return {
        mode: 'vbrief', title: v.name, desc: v.desc, goal: v.goal, aud: [...(v.audQ || []), v.aud].filter(Boolean).join(', '), format: fmtK(v.fmt), duration: v.dur,
        style: v.style, voice: v.voice, music: v.music, voiceId: v.voiceId, media, clipSec: v.clip && v.clip.sec, dept: v.dept,
        change: change || undefined, prev: change ? v.brief : undefined,
      };
    }
    async function runBrief(v, change) {
      v.gen = true; render();
      try {
        await capsLoad();
        const r = await genLong(briefReq(v, change));
        if (S.vd !== v) return;
        v.brief = r; v.step = 2; v.gen = false; render(); window.scrollTo({ top: 0 });
      } catch (e) { v.gen = false; render(); aiFail(e); }
    }
    ACT.vdGen = () => {
      const v = S.vd;
      if (!v.style) { toast('לא נבחר סגנון', 'בחרו: אנימציה, סרטון קיים או סרטון מחומרי גלם.', 'err'); return; }
      if (v.style === 'existing' && !(v.clip && v.clip.url)) { toast('לא הועלה סרטון', 'העלו את הסרטון לעריכה.', 'err'); return; }
      runBrief(v);
    };
    ACT.vbChange = () => { const el = $('#vbChg'); const q = (el && el.value || '').trim(); if (!q) { toast('מה לשנות?', 'לדוגמה: קצב רגוע יותר, קול של אישה, פחות טקסט על המסך.', 'err'); return; } runBrief(S.vd, q); };
    ACT.vbBack = () => { S.vd.step = 1; render(); };

    function visDesc(src, v) {
      const s = String(src || '');
      if (/^upload:(\d+)/.test(s)) { const m = (v.imgs || [])[+RegExp.$1]; return (m && m.v ? 'קטע שהעליתם' : 'תמונה שהעליתם') + (m && m.name ? '<small>' + esc(m.name) + '</small>' : ''); }
      if (/^clip:/.test(s)) return 'מהסרטון שלכם<small>משנייה ' + esc(s.slice(5)) + '</small>';
      if (/^ai:/.test(s)) return 'תמונת AI<small dir="ltr">' + esc(s.slice(3, 90)) + '</small>';
      if (/^stockv:/.test(s)) return 'וידאו סטוק<small dir="ltr">' + esc(s.slice(7, 60)) + '</small>';
      if (/^stock:/.test(s)) return 'צילום סטוק<small dir="ltr">' + esc(s.slice(6, 60)) + '</small>';
      return s === 'color' ? 'רקע צבע' : 'רקע מונפש';
    }
    // narration line in the brief: direction tags shown as a small Hebrew label, not as raw English
    const EMO_HE = { calm: 'רגוע', confident: 'בטוח', serious: 'רציני', clearly: 'ברור', excited: 'נלהב', inviting: 'מזמין', energetic: 'אנרגטי', cheerful: 'עליז', warmly: 'חם', proud: 'גאה', inspired: 'מעורר השראה', softly: 'רך', gently: 'עדין', solemnly: 'מכובד', slowly: 'איטי', quietly: 'שקט' };
    const sayView = (t) => {
      const tags = []; const txt = String(t).replace(/\[([a-z ]+)\]/g, (_, k) => { if (EMO_HE[k]) tags.push(EMO_HE[k]); return ' '; }).replace(/\s{2,}/g, ' ').trim();
      return esc(txt) + (tags.length ? '<small>טון: ' + esc(tags.join(', ')) + '</small>' : '');
    };
    function briefView(v) {
      const b = v.brief, x = b.brief || {};
      let t = 0;
      const rows = (b.scenes || []).map((s, i) => {
        const a = t; t += s.dur;
        const tx = s.text ? '<b>' + esc((s.text.lines || []).join(' / ')) + '</b><small>' + (TS_HE[s.text.style] || s.text.style) + '</small>' : '<small>בלי טקסט</small>';
        return '<tr><td>' + (i + 1) + '<small>' + tsec(a) + '-' + tsec(t) + '</small></td><td>' + visDesc(s.visual && s.visual.src, v) + '</td><td>' + tx + '</td><td>' + (s.say ? sayView(s.say) : '<small>-</small>') + '</td><td>' + (s.transition ? (TR_HE[s.transition.kind] || s.transition.kind) : '-') + '</td></tr>';
      }).join('');
      const total = t + 3;
      const warn = [];
      if (v.voice && !ttsOn()) warn.push('קריינות: ספק הקריינות עוד לא מחובר, הסרטון ייצא עם כתוביות בלבד.');
      if (v.music && !musicOn()) warn.push('מוזיקה: ספק המוזיקה עוד לא מחובר, הסרטון ייצא בלי מוזיקה.');
      return '<div class="card brief-card">' +
        '<p class="vb-idea">' + esc(x.idea || '') + '</p>' +
        '<div class="vb-grid">' +
        '<div class="vb-cell"><span>סוג וסגנון</span><b>' + ({ official: 'רשמי', marketing: 'שיווקי', event: 'אירוע', showcase: 'ראווה', greeting: 'ברכה וחג', memorial: 'ממלכתי וזיכרון' }[b.kind] || '') + (b.kind ? ' · ' : '') + esc(x.style || '') + (b.mood ? ' · ' + (MOOD_HE[b.mood] || '') : '') + '</b></div>' +
        '<div class="vb-cell"><span>אורך ופורמט</span><b>' + Math.round(total) + ' שניות · ' + esc(v.fmt) + '</b></div>' +
        '<div class="vb-cell"><span>שפה חזותית</span><b>' + esc(x.look || '') + '</b></div>' +
        '<div class="vb-cell"><span>קצב</span><b>' + esc(x.pace || '') + '</b></div>' +
        '<div class="vb-cell"><span>מוזיקה</span><b>' + (v.music ? esc(x.music || '') : 'בלי מוזיקה') + '</b></div>' +
        '<div class="vb-cell"><span>קריינות</span><b>' + (v.voice && b.voice ? esc(b.voice.n) + ' (' + (b.voice.g === 'm' ? 'גבר' : 'אישה') + ') - ' + esc(x.delivery || x.voiceWhy || b.voice.tone) : 'בלי קריינות') + '</b></div>' +
        '</div>' +
        '<div class="field full"><label>תסריט סצנה אחר סצנה</label><div class="vb-wrap"><table class="vb-sc"><thead><tr><th>#</th><th>ויזואל</th><th>טקסט על המסך</th><th>קריינות</th><th>מעבר</th></tr></thead><tbody>' + rows +
        '<tr><td>סיום<small>' + tsec(t) + '-' + tsec(total) + '</small></td><td>כרטיס לוגו</td><td><b>' + esc((b.outro && b.outro.cta) || '') + '</b><small>' + esc(((b.outro && b.outro.details) || []).map((d) => d.text).join(' · ')) + '</small></td><td></td><td></td></tr></tbody></table></div></div>' +
        (warn.length ? '<div class="note">' + ic('info', 15) + '<span>' + warn.join('<br>') + '</span></div>' : '') +
        '<div class="vb-chg"><input type="text" id="vbChg" placeholder="רוצים לשנות משהו בבריף? כתבו כאן"><button class="btn" data-act="vbChange">' + ic('spark', 15) + ' עדכון הבריף</button></div>' +
        '<div class="brief-foot"><button class="btn" data-act="vbBack">' + ic('fwd', 16) + ' לסגנון</button><button class="btn btn-primary btn-lg" data-act="vbGo">' + ic('check', 17, 2.4) + ' אישור ויצירת הסרטון</button></div></div>';
    }

    // ---- production ----
    const PSTAGES = [['vis', 'מכינים תמונות וקטעים'], ['voice', 'מקליטים קריינות'], ['music', 'מלחינים מוזיקה'], ['render', 'מרנדרים את הסרטון']];
    function prodView(v) {
      const p = v.prod;
      return '<div class="card gen-mini">' + thinkBox() + '<div class="vp-bar"><i style="width:' + Math.round((p.pct || 0) * 100) + '%"></i></div><ul class="vp-list">' +
        PSTAGES.filter((s) => !p.skip || !p.skip.includes(s[0])).map((s) => '<li class="' + (p.done.includes(s[0]) ? 'done' : p.on.includes(s[0]) ? 'on' : '') + '">' + ic(p.done.includes(s[0]) ? 'check' : 'clock', 15, 2.2) + s[1] + (s[0] === 'render' && p.on.includes('render') && p.rp ? ' ' + Math.round(p.rp * 100) + '%' : '') + '</li>').join('') + '</ul></div>';
    }
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    async function resolveVisuals(v, scenes, fmt) {
      const media = (v.imgs || []).filter((m) => m.url);
      const out = scenes.map(() => ({ kind: 'gradient' }));
      const stockQ = [];
      const ai = [];
      scenes.forEach((s, i) => {
        const src = String((s.visual && s.visual.src) || 'gradient');
        const base = { motion: s.visual && s.visual.motion, tint: s.visual && s.visual.tint != null ? Math.min(0.25, s.visual.tint) : 0.12 };
        let m;
        if (src === 'studio') out[i] = Object.assign(base, { kind: 'studio' });
        else if ((m = /^mockup:(phone|app)/.exec(src))) out[i] = Object.assign(base, { kind: 'mockup', mock: m[1] });
        else if ((m = /^upload:(\d+)/.exec(src)) && media[+m[1]]) { const u = media[+m[1]]; out[i] = Object.assign(base, { kind: u.v ? 'video' : 'image', src: u.url }); }
        else if ((m = /^clip:([\d.]+)/.exec(src)) && v.clip && v.clip.url) out[i] = Object.assign(base, { kind: 'video', src: v.clip.url, trimStart: +m[1] });
        else if (/^stockv?:/.test(src)) stockQ.push({ i, q: src.replace(/^stockv?:/, ''), v: /^stockv:/.test(src), base });
        else if (/^ai:/.test(src)) ai.push({ i, q: src.slice(3), base });
        else out[i] = Object.assign(base, { kind: src === 'color' ? 'color' : 'gradient' });
      });
      const jobs = [];
      if (stockQ.length) jobs.push(gen({ mode: 'vstock', format: fmt, queries: stockQ.map((x) => ({ q: x.q, v: x.v })) }).then((r) => {
        stockQ.forEach((x, k) => { const it = (r.items || [])[k]; if (it && it.src) out[x.i] = Object.assign(x.base, { kind: it.v ? 'video' : 'image', src: it.src }); else ai.push({ i: x.i, q: x.q, base: x.base }); });
      }).catch(() => stockQ.forEach((x) => ai.push({ i: x.i, q: x.q, base: x.base }))));
      await Promise.all(jobs);
      let at = 0;
      const size = IMG_SIZE(v.fmt);
      const worker = async () => { while (at < ai.length) { const x = ai[at++]; try { const u = await aiImage({ title: v.name, brief: x.q + '\nהקשר: ' + v.desc, size, quality: 'high' }); if (u) out[x.i] = Object.assign(x.base, { kind: 'image', src: u }); } catch (e) { /* that scene keeps the animated background */ } } };
      await Promise.all(Array.from({ length: Math.min(4, ai.length) }, worker));
      return out;
    }
    async function renderPlan(plan, onP) {
      const slot = await call('upload.sign', { name: 'video.mp4' });
      const st = await post(VID, { action: 'start', plan, upload: slot.upload, url: slot.url }, 295000);
      const t0 = Date.now();
      for (;;) {
        await sleep(6000);
        let r;
        try { r = await post(VID, { action: 'status', sandboxId: st.sandboxId, cmdId: st.cmdId, upload: slot.upload, url: slot.url }, 120000); } catch (e) { if (Date.now() - t0 > 25 * 60000) throw e; continue; }
        if (r.stage === 'done') { gen({ mode: 'vrender', sec: Math.round((Date.now() - t0) / 1000) + 20 }).catch(() => {}); return r.url; }
        if (r.stage === 'error' || r.stage === 'expired') throw new Error('render_' + r.stage);
        onP(r.progress || 0);
        if (Date.now() - t0 > 25 * 60000) throw new Error('render_timeout');
      }
    }
    ACT.vbGo = async () => {
      const v = S.vd, b = v.brief;
      if (!b || v.prod) return;
      const fmt = fmtK(v.fmt);
      const wantVoice = v.voice && b.voice && ttsOn() && (b.scenes || []).some((s) => s.say);
      const wantMusic = v.music && musicOn() && b.musicPrompt;
      const p = (v.prod = { on: ['vis'], done: [], pct: 0.04, skip: [] });
      if (!wantVoice) p.skip.push('voice'); if (!wantMusic) p.skip.push('music');
      if (wantVoice) p.on.push('voice'); if (wantMusic) p.on.push('music');
      render();
      const tick = () => { if (S.vd === v && S.route === 'vidWiz') render(); };
      const fin = (k, pct) => { p.on = p.on.filter((x) => x !== k); p.done.push(k); p.pct = Math.max(p.pct, pct); tick(); };
      try {
        const est = (b.scenes || []).reduce((a, s) => a + s.dur, 0) + 3;
        const [vis, voice, music] = await Promise.all([
          resolveVisuals(v, b.scenes, fmt).then((r) => (fin('vis', 0.35), r)),
          wantVoice ? genLong({ mode: 'vvoice', voiceId: b.voice.id, stab: b.stab, says: b.scenes.map((s) => s.say || '') }).then((r) => (fin('voice', 0.3), r.clips || [])).catch(() => (fin('voice', 0.3), [])) : Promise.resolve([]),
          wantMusic ? genLong({ mode: 'vmusic', prompt: b.musicPrompt, seconds: Math.min(95, est + 4) }).then((r) => (fin('music', 0.3), r)).catch(() => (fin('music', 0.3), null)) : Promise.resolve(null),
        ]);
        const scenes = b.scenes.map((s, i) => {
          const c = voice[i];
          const sc = { dur: c ? Math.max(s.dur, c.sec + 0.55) : s.dur, visual: vis[i], text: s.text, transition: s.transition, fx: s.fx };
          if (c) sc.voice = { src: c.src, words: c.words, at: 0.25 };
          return sc;
        });
        // memorial videos never use bright brand colours: dark slate and muted gold, the org name and logo stay
        const brand = b.kind === 'memorial' ? Object.assign(vidBrand(), { colors: { deep: '#0A0F1A', main: '#2B3445', accent: '#C9B37E', light: '#D9D4C7' } }) : vidBrand();
        const plan = { format: fmt, fps: 30, brand, font: b.font, mood: b.mood, fx: b.fx, scenes, outro: Object.assign({ dur: 3.2 }, b.outro), captions: { style: b.captions || 'karaoke', words: [] }, audio: music && music.src ? { music: { src: music.src } } : {}, showLogo: true };
        p.on = ['render']; p.pct = Math.max(p.pct, 0.4); tick();
        const url = await renderPlan(plan, (x) => { p.rp = x; p.pct = 0.4 + 0.58 * x; tick(); });
        fin('render', 1);
        openStudio(v, url, vis.find((x) => x.kind === 'image') ? vis.find((x) => x.kind === 'image').src : '');
      } catch (e) {
        v.prod = null; render();
        toast('יצירת הסרטון לא הושלמה', 'הבריף נשמר. נסו שוב בעוד רגע.', 'err');
      }
    };
    function openStudio(v, url, thumb) {
      if (S.vd !== v) return;
      const b = v.brief;
      v.prod = null; S.vd = null;
      startWiz('video', { brief: { title: v.name, free: v.desc }, content: { title: v.name, body: b.caption || v.desc }, ch: [...v.ch] });
      const w = S.wiz;
      w.fmts = [v.fmt]; w.fmt = v.fmt; w.vmeta = v;
      const tags = (b.tags || []).slice(0, 6);
      w.sugg = [...new Set([...tags, ...suggestTags(w.t, w.brief.dept)])].slice(0, 7);
      w.tags = tags.slice(0, 4);
      w.media = { kind: 'video', eng: 'v3', url, ready: true, thumb, scenes: (b.scenes || []).map((s) => ({ t: (s.text && s.text.lines || []).join(' '), s: s.say || '' })), cta: (b.outro && b.outro.cta) || '', details: [], images: thumb ? [thumb] : [], fmt: v.fmt, ar: AR[v.fmt] || '9/16' };
      render();
      toast('הסרטון מוכן', 'אפשר לצפות, להוריד ולפרסם.');
    }
    // studio: changes to a v3 video go back to the brief with the request
    const _aiBox3 = aiBox;
    aiBox = function (prefix) {
      const w = S.wiz;
      if (prefix !== 'w' || S.route !== 'wizard' || !w || !w.media || w.media.eng !== 'v3') return _aiBox3(prefix);
      const m = w.media;
      return '<div class="ai-box"><span class="ai-ic">' + ic('spark', 16, 2) + '</span><input type="text" id="wAi" placeholder="מה לשנות בסרטון?"><button class="btn btn-primary btn-sm" data-act="wAi">לבריף מעודכן</button></div>' +
        '<div class="real-acts">' + (m.url ? '<a class="btn btn-sm" href="' + esc(m.url) + '" target="_blank" rel="noopener" download>' + ic('down', 14) + ' הורדת הסרטון</a>' : '') + '</div>';
    };
    const _wAi3 = ACT.wAi;
    ACT.wAi = () => {
      const w = S.wiz;
      if (!w || !w.media || w.media.eng !== 'v3' || !w.vmeta) return _wAi3();
      const el = $('#wAi'); const q = (el && el.value || '').trim();
      if (!q) { toast('מה לשנות?', 'לדוגמה: סיום עם קריאה להרשמה, או קצב מהיר יותר.', 'err'); return; }
      const v = w.vmeta;
      S.dirty = false; S.wiz = null; S.vd = v; v.step = 2; go('vidWiz');
      runBrief(v, q);
    };
    const _wFmt3 = ACT.wFmt;
    ACT.wFmt = (k) => { const w = S.wiz; if (w && w.media && w.media.eng === 'v3') { toast('הגודל נקבע בבריף', 'כדי לשנות גודל חזרו לבריף ובקשו פורמט אחר.'); return; } _wFmt3(k); };

    // ---- poster: a frame from the finished mp4 when no scene had an image ----
    function posterOf(url) {
      return new Promise((res) => {
        const vd = document.createElement('video');
        let done = false;
        const end = (u) => { if (done) return; done = true; clearTimeout(tm); vd.removeAttribute('src'); try { vd.load(); } catch (e) { /* ignore */ } res(u || ''); };
        const tm = setTimeout(() => end(''), 25000);
        vd.crossOrigin = 'anonymous'; vd.muted = true; vd.preload = 'auto'; vd.playsInline = true;
        vd.addEventListener('loadedmetadata', () => { vd.currentTime = Math.min(2.2, Math.max(0.1, (vd.duration || 4) * 0.12)); });
        vd.addEventListener('seeked', () => {
          try {
            const W = vd.videoWidth, H = vd.videoHeight; if (!W || !H) return end('');
            const k = Math.min(1, 720 / Math.max(W, H));
            const c = document.createElement('canvas'); c.width = Math.round(W * k); c.height = Math.round(H * k);
            c.getContext('2d').drawImage(vd, 0, 0, c.width, c.height);
            c.toBlob(async (b) => {
              if (!b) return end('');
              try { const s = await call('upload.sign', { name: 'poster.jpg' }); const r = await fetch(s.upload, { method: 'PUT', headers: { 'content-type': 'image/jpeg', 'x-upsert': 'true' }, body: b }); end(r.ok ? s.url : ''); } catch (e) { end(''); }
            }, 'image/jpeg', 0.82);
          } catch (e) { end(''); }
        });
        vd.addEventListener('error', () => end(''));
        vd.src = url;
      });
    }
    // when a poster arrives later, put it on the studio and on any saved item with that video
    function setPoster(url, thumb) {
      if (!thumb) return;
      const w = S.wiz;
      if (w && w.media && w.media.url === url) { w.media.thumb = thumb; if (!w.media.images || !w.media.images.length) w.media.images = [thumb]; }
      items.forEach((it) => { if (it.media && it.media.url === url && !it.media.thumb) it.media.thumb = thumb; });
      evAll().forEach((m) => { if (m.url === url && !m.thumb) m.thumb = thumb; });
      if (['wizard', 'library', 'item', 'eventKit'].includes(S.route)) render();
    }
    const evAll = () => [].concat(...((S.events || []).concat(S.ev && !(S.events || []).includes(S.ev) ? [S.ev] : []).map((e) => [].concat(...(e.posts || []).map((p) => [p.mg, p.mv]), e.after ? [e.after.vm] : []).filter(Boolean))));
    window.__vPoster = (url) => posterOf(url).then((t) => (setPoster(url, t), t));
    const _openStudio = openStudio;
    openStudio = function (v, url, thumb) {
      const rep = v.replaces;
      _openStudio(v, url, thumb);
      const w = S.wiz;
      if (w && w.media && w.media.url === url && rep) w.replaces = rep;
      if (!thumb) window.__vPoster(url);
    };

    // ---- saved video keeps its brief so it can be re-edited later ----
    const slimV = (v) => { const o = {}; ['name', 'desc', 'goal', 'aud', 'audQ', 'fmt', 'ch', 'style', 'clip', 'imgs', 'dur', 'voice', 'music', 'voiceId', 'dept', 'brief', 'kitRef'].forEach((k) => { if (v[k] !== undefined) o[k] = v[k]; }); return JSON.parse(JSON.stringify(o)); };
    const _wizItemV = wizItem;
    wizItem = function (st) {
      const w = S.wiz;
      const it = _wizItemV(st);
      if (w && w.media && w.media.eng === 'v3') {
        it.media.eng = 'v3';
        if (w.vmeta) it.media.vmeta = slimV(w.vmeta);
      }
      if (w && w.replaces) {
        const old = items.findIndex((x) => x !== it && x.id === w.replaces);
        if (old >= 0) { const prev = items[old]; items.splice(items.indexOf(it), 1); it.id = w.replaces; items.splice(items.indexOf(prev), 1, it); }
      }
      return it;
    };
    // "עריכה" on a saved video: back to its brief (a change request re-renders), or the studio with the file
    const _edit = ACT.edit;
    ACT.edit = (id) => {
      const it = itemById(id);
      const m = it && it.media;
      if (!m || m.kind !== 'video' || !m.url) return _edit(id);
      if (m.eng === 'v3' && m.vmeta && m.vmeta.brief) {
        const v = Object.assign(JSON.parse(JSON.stringify(m.vmeta)), { step: 2, replaces: it.id });
        S.dirty = false; S.wiz = null; S.vd = v; go('vidWiz');
        toast('הבריף של הסרטון נפתח', 'כתבו מה לשנות ולחצו "עדכון הבריף", או אשרו ליצירה מחדש.');
        return;
      }
      _edit(id);
      const w = S.wiz;
      if (w) { w.media = JSON.parse(JSON.stringify(m)); w.replaces = it.id; w.fmt = m.fmt || w.fmt; render(); }
    };

    /* =================== event kit: real texts, graphics, videos and uploads =================== */
    // headless production of a brief into an mp4 (same steps as the wizard, without the screens)
    async function produceV(v, b, onP, outro) {
      const fmt = fmtK(v.fmt);
      const wantVoice = v.voice && b.voice && ttsOn() && (b.scenes || []).some((s) => s.say);
      const wantMusic = v.music && musicOn() && b.musicPrompt;
      const est = (b.scenes || []).reduce((a, s) => a + s.dur, 0) + 3;
      onP(0.05, 'מכינים תמונות, קריינות ומוזיקה');
      const [vis, voice, music] = await Promise.all([
        resolveVisuals(v, b.scenes, fmt),
        wantVoice ? genLong({ mode: 'vvoice', voiceId: b.voice.id, stab: b.stab, says: b.scenes.map((s) => s.say || '') }).then((r) => r.clips || []).catch(() => []) : Promise.resolve([]),
        wantMusic ? genLong({ mode: 'vmusic', prompt: b.musicPrompt, seconds: Math.min(95, est + 4) }).catch(() => null) : Promise.resolve(null),
      ]);
      const scenes = b.scenes.map((s, i) => {
        const c = voice[i];
        const sc = { dur: c ? Math.max(s.dur, c.sec + 0.55) : s.dur, visual: vis[i], text: s.text, transition: s.transition, fx: s.fx };
        if (c) sc.voice = { src: c.src, words: c.words, at: 0.25 };
        return sc;
      });
      const brand = b.kind === 'memorial' ? Object.assign(vidBrand(), { colors: { deep: '#0A0F1A', main: '#2B3445', accent: '#C9B37E', light: '#D9D4C7' } }) : vidBrand();
      const plan = { format: fmt, fps: 30, brand, font: b.font, mood: b.mood, fx: b.fx, scenes, outro: Object.assign({ dur: 3.6 }, b.outro, outro || {}), captions: { style: b.captions || 'karaoke', words: [] }, audio: music && music.src ? { music: { src: music.src } } : {}, showLogo: true };
      onP(0.4, 'מרנדרים את הסרטון');
      const url = await renderPlan(plan, (x) => onP(0.4 + 0.58 * x, 'מרנדרים את הסרטון'));
      const img = vis.find((x) => x.kind === 'image');
      return { url, thumb: img ? img.src : '' };
    }
    const todayIso = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    evDays = function (e) { return Math.round((new Date(e.date + 'T12:00') - new Date(todayIso() + 'T12:00')) / 864e5); };
    const _evPosts = evPosts;
    evPosts = function (e) {
      const ps = _evPosts(e);
      const soon = ps.find((p) => p.k === 'soon');
      if (soon) soon.date = evDays(e) >= 8 ? addDays(e.date, -7) : addDays(todayIso(), 1);
      ps.forEach((p) => { p.mg = null; p.mv = null; });
      return ps;
    };
    const _evNew = evNew;
    evNew = function () { const e = _evNew(); e.date = addDays(todayIso(), 10); e.logo = null; return e; };
    const pm = (p) => (p.kind === 'video' ? p.mv : p.mg);
    const orgName = () => (aiCtx().org || '');
    const stingBg = (e) => { const c = (typeof BRAND !== 'undefined' && BRAND.colors && BRAND.colors[e.sting.bg]) ? BRAND.colors[e.sting.bg][1] : ''; return /^#[0-9a-f]{6}$/i.test(c || '') ? c : undefined; };
    const evRedraw = (e) => { if (S.ev === e && S.route === 'eventKit') { evCollect(); if ($('#drawer .ev-th') && S.evCur != null && e.posts[S.evCur]) { const th = $('#drawer .ev-th'); th.outerHTML = evThumb(e.posts[S.evCur], e, true); } render(); } };
    const evInfo = (e) => e.desc + '\nתאריך: ' + fmtD(e.date) + ', שעה ' + e.start + '\nמקום: ' + e.place;
    const evImgs = (e, list) => (list || e.media || []).filter((m) => m.url).map((m) => ({ url: m.url, name: m.name || '', v: !!m.v }));

    // a post's media changed: keep the scheduled item in step
    function evSyncItem(p) {
      if (!p.item) return;
      const it = itemById(p.item);
      const m = pm(p);
      if (it && m && m.url && !m.busy) { it.media = JSON.parse(JSON.stringify(m)); delete it.pubWarn; }
    }
    // graphic: the event's own photo (or an AI photo) under the designed texts
    async function evGraphic(e, p, change) {
      const m = (p.mg = Object.assign(p.mg || { kind: 'graphic' }, { busy: change ? 'מעדכנים את הגרפיקה...' : 'מעצבים את הגרפיקה...', err: false }));
      evRedraw(e);
      try {
        let d = p.design || { kicker: e.name, headline: p.t, sub: '', details: [], cta: '' };
        if (change) { const r = await gen({ mode: 'revise', content: d, instruction: change }); if (r.content && r.content.headline) d = r.content; }
        p.design = d;
        const photos = (e.media || []).filter((x) => x.url && !x.v).map((x) => x.url);
        const logo = logoOf(); const evLogo = e.logo && e.logo.url && !e.logo.auto ? e.logo.url : '';
        const kitS = logo ? await ensureKit() : null;
        const stage = { soon: 'הכרזה ראשונה: שריינו את התאריך', d2: 'עוד יומיים לאירוע', day: 'היום! האירוע מתחיל' }[p.k] || p.l;
        const rr = await fx('image', {
          action: 'design', org: aiCtx().org, dept: e.dept, size: 'square', brief: 'פוסטר לאירוע. ' + stage + '\n' + evInfo(e) + '\n' + (p.body || '') + (change ? '\nבקשת שינוי: ' + change : ''),
          colors: brandFor(e.dept).colors, roles: brandFor(e.dept).roles, style: 'marketing', kit: kitS || undefined, event: true, eventLogo: evLogo || undefined,
          texts: { kicker: d.kicker || '', headline: d.headline || p.t, sub: d.sub || '', details: d.details || [], cta: d.cta || '', icons: d.icons || [], keyword: d.keyword || '' },
          refs: [...(logo ? [logo] : []), ...photos.slice(0, 2)].slice(0, 3), logo: !!logo, note: change || '', quality: 'high', n: 2,
        }, 150000);
        if (!rr || !rr.url) throw new Error('design_failed');
        p.mg = { kind: 'graphic', url: rr.url, layout: 'ai', fmt: '1:1', ar: '1/1', image: rr.url, design: d, ready: true, qa: rr.qa || null, model: rr.model || '', warn: rr.check && !rr.check.ok ? rr.check.issues : null };
        p.ver = (p.ver || 1) + (change ? 1 : 0);
        evSyncItem(p);
      } catch (err) { m.busy = ''; m.err = true; toast('הגרפיקה לא נוצרה', p.l + '. אפשר לנסות שוב מהכרטיס.', 'err'); }
      evRedraw(e);
    }
    // video: the director builds an event brief from the details and uploads, the logo sting closes it
    async function evVideo(e, holder, key, o) {
      const prev = holder[key];
      const m = (holder[key] = { kind: 'video', busy: 'Claude כותב את הבריף...', pct: 0.02, err: false });
      evRedraw(e);
      try {
        await capsLoad();
        const v = (prev && prev.vmeta && o.change) ? JSON.parse(JSON.stringify(prev.vmeta)) : { name: o.name, desc: o.desc, goal: o.goal, aud: '', audQ: [], fmt: '9:16', ch: [...e.ch], style: 'ai', clip: null, imgs: o.imgs, dur: o.dur, voice: true, music: true, voiceId: 'auto', dept: e.dept };
        const b = await genLong(briefReq(v, o.change));
        v.brief = b;
        // the render runs on the server: the window can close, the card picks the job up again on return
        const sting = e.sting.skip ? null : { logo: e.logo && e.logo.url, motion: e.sting.style, bg: stingBg(e) };
        const j = await call('job.create', { brief: b, title: o.name, desc: o.desc, goal: o.goal, dur: o.dur, imgs: o.imgs, dept: e.dept, outro: sting ? { sting } : undefined });
        Object.assign(m, { job: j.id, busy: 'מכינים תמונות, קריינות ומוזיקה', pct: 0.08, vmeta: slimV(v), cta: (b.outro && b.outro.cta) || '', name: o.name });
        evSave();
        await evWatch(e, holder, key, o.done);
        return;
      } catch (err) { holder[key] = prev && prev.url ? prev : Object.assign(m, { busy: '', err: true }); toast('הסרטון לא נוצר', o.name + '. אפשר לנסות שוב מהכרטיס.', 'err'); }
      evRedraw(e);
    }
    // follows a server video job until the file is ready (also after a reload: the job id is saved on the card)
    const evWatching = {};
    const evSave = () => setTimeout(flush, 300); // the sync engine saves events with the organisation state
    async function evWatch(e, holder, key, done) {
      const m = holder[key];
      if (!m || !m.job || evWatching[m.job]) return;
      evWatching[m.job] = true;
      try {
        for (let n = 0; n < 200; n++) {
          await new Promise((r) => setTimeout(r, n ? 8000 : 2500));
          let r;
          try { r = await call('job.get', { id: m.job }); } catch (x) { continue; }
          if (holder[key] !== m) return; // replaced meanwhile
          if (r.state === 'done' && r.result && r.result.url) {
            holder[key] = { kind: 'video', eng: 'v3', url: r.result.url, thumb: r.result.thumb || '', ready: true, fmt: '9:16', ar: '9/16', vmeta: m.vmeta, cta: m.cta || '' };
            if (!r.result.thumb) window.__vPoster(r.result.url);
            if (done) done(); else evSyncAll(e);
            evSave();
            toast('הסרטון מוכן', m.name || e.name);
            evRedraw(e);
            return;
          }
          if (r.state === 'error' || r.state === 'missing') throw new Error('job_' + r.state);
          m.pct = Math.max(m.pct || 0, r.progress || 0);
          m.busy = r.step === 'status' || r.step === 'start' ? 'מרנדרים את הסרטון' : 'מכינים תמונות, קריינות ומוזיקה';
          evRedraw(e);
        }
        throw new Error('job_timeout');
      } catch (err) {
        if (holder[key] === m) { Object.assign(m, { busy: '', err: true }); evSave(); toast('הסרטון לא נוצר', (m.name || e.name) + '. אפשר לנסות שוב מהכרטיס.', 'err'); evRedraw(e); }
      } finally { delete evWatching[m.job]; }
    }
    L.evResumeAll = () => (S.events || []).forEach((e) => evResume(e));
    function evSyncAll(e) {
      (e.posts || []).forEach((p) => evSyncItem(p));
      const a = e.after;
      if (a && a.vItem && a.vm && a.vm.url) { const it = itemById(a.vItem); if (it) it.media = JSON.parse(JSON.stringify(a.vm)); }
    }
    // cards still rendering on the server when the screen opens are followed again
    function evResume(e) {
      if (!e) return;
      (e.posts || []).forEach((p) => { if (p.mv && p.mv.job && p.mv.busy) evWatch(e, p, 'mv'); });
      if (e.after && e.after.vm && e.after.vm.job && e.after.vm.busy) evWatch(e, e.after, 'vm');
    }
    function evPostVideo(e, p, change) {
      return evVideo(e, p, 'mv', {
        name: p.t || e.name, goal: 'event', dur: 25, imgs: evImgs(e), change,
        desc: 'סרטון הזמנה לאירוע, שלב: ' + p.l + ' (' + p.sub + ').\n' + evInfo(e) + '\nטקסט הפוסט: ' + p.body,
        done: () => evSyncItem(p),
      });
    }
    const evMake = (e, p, change) => (p.kind === 'video' ? evPostVideo(e, p, change) : evGraphic(e, p, change));

    // thumbnails: the real file, or the progress of its production
    const _evThumb = evThumb;
    evThumb = function (p, e, big) {
      const m = p.after ? p.media : pm(p);
      if (!m) return _evThumb(p, e, big);
      const cls = 'ev-th thumb ' + GV[(p.g || 0) % GV.length] + (big ? ' big' : '') + ' ev-real';
      const idx = e && e.posts ? e.posts.indexOf(p) : -1;
      if (m.busy) return '<div class="' + cls + ' ev-busy"><span class="ev-prog"><span class="gm-spin"></span><b>' + esc(m.busy) + '</b>' + (m.pct ? '<i><u style="width:' + Math.round(m.pct * 100) + '%"></u></i>' : '') + '</span></div>';
      if (m.err) return '<div class="' + cls + ' ev-busy"><span class="ev-prog"><b>' + (p.kind === 'video' ? 'הסרטון לא נוצר' : 'הגרפיקה לא נוצרה') + '</b><button class="btn btn-sm" data-act="' + (p.after ? 'evAfRe' : 'evRe:' + idx) + '">' + ic('refresh', 13) + ' ניסיון חוזר</button></span></div>';
      if (m.kind === 'video' && m.url) return big ? '<div class="' + cls + '"><video src="' + esc(m.url) + '"' + (m.thumb ? ' poster="' + esc(m.thumb) + '"' : '') + ' controls playsinline preload="metadata"></video></div>'
        : '<div class="' + cls + '"' + (m.thumb ? ' style="background-image:url(\'' + esc(m.thumb) + '\')"' : '') + '><span class="sp-play">' + ic('play', 16, 2) + '</span><span class="ev-sting">' + ic('spark', 11, 2) + ' סיומת לוגו</span></div>';
      if (m.url) return '<div class="' + cls + '" style="background-image:url(\'' + esc(m.url) + '\')"></div>';
      return _evThumb(p, e, big);
    };
    stingHtml = function (e) {
      const c = stingBg(e) || '#0124C7';
      const lg = e.logo && e.logo.url;
      return '<div class="sting" style="background:' + c + '"><div class="st-in a-' + e.sting.style + '" data-k="' + e.sting.play + '"><span class="st-logo">' + (lg ? '<img src="' + esc(lg) + '" alt="">' : esc((e.name || orgName()).split(' ').slice(0, 2).map((w) => w[0] || '').join(''))) + '</span><b>' + esc(e.name || 'שם האירוע') + '</b><small>' + esc(orgName()) + '</small></div><span class="st-dur">3 שנ׳</span></div>';
    };
    // the screen: real uploads in the grids, no demo-only controls
    const _evR = SCREENS.eventKit.render;
    SCREENS.eventKit.render = function () {
      const e = S.ev;
      if (e && e.st === 'scheduled' && evDays(e) < 0) e.st = 'after';
      evResume(e);
      let h = _evR.call(this);
      if (!e) return h;
      const tile = (m) => m && m.url ? (m.v ? ' ev-vid" style="background:#0A2C51' : ' has-real" style="background-image:url(\'' + esc(m.url) + '\')') : '';
      h = h.replace(/<span class="raw thumb ([^"]*)">([\s\S]*?)<button class="icon-btn" data-act="(evMediaX|evAfX):(\d+)"/g, (all, g, inner, act, i) => {
        const m = act === 'evMediaX' ? e.media[+i] : e.after.files[+i];
        return '<span class="raw thumb ' + g + tile(m) + '">' + (m && m.v ? ic('play', 16, 2) : '') + '<button class="icon-btn" data-act="' + act + ':' + i + '"';
      });
      h = h.replace(/<div class="field"><label for="evStFix">[\s\S]*?<\/div><\/div><\/div><\/div>/, '</div></div>');
      h = h.replace(/<button class="chip demo-chip" data-act="evSim">[\s\S]*?<\/button>/, '<button class="chip" data-act="evSim">' + ic('upload', 12) + ' מעבר לסיכום האירוע</button>');
      h = h.replace('אפשר גם תמונות מאירועים קודמים', 'התמונות ישמשו לגרפיקות ולסרטון');
      h = h.replace(/\d+ פרסומים: 3 לפני האירוע, סרטון סיכום ופוסט מלווה\./, (e.posts.length + 1) + ' פרסומים: ' + e.posts.length + ' לפני האירוע וסרטון סיכום עם פוסט מלווה.');
      if (e.step === 2 && e.st === 'setup' && e.posts.some((p) => { const m = pm(p); return m && m.busy; })) h = h.replace('<div class="ev-tl">', '<div class="note">' + ic('info', 15) + '<span>התכנים נוצרים עכשיו. סרטון לוקח כ-6 דקות. השאירו את החלון פתוח עד שהכל מוכן.</span></div><div class="ev-tl">');
      return h;
    };
    // logo and media: real files
    ACT.evLogo = async (val) => {
      evCollect();
      const e = S.ev;
      if (/^org/.test(val)) { const u = logoOf(); if (!u) { toast('אין לוגו בנכסי המותג', 'העלו לוגו לאירוע, או הוסיפו לוגו בנכסי המותג.', 'err'); return; } e.logo = { k: 'png', n: 'לוגו ' + (orgName() || 'הארגון'), url: u }; render(); toast('הלוגו נקלט', e.logo.n); return; }
      const [f] = await uploadPicked('image/png,image/svg+xml,image/jpeg,image/webp');
      if (!f || S.ev !== e) return;
      e.logo = { k: /svg/i.test(f.ext || f.name) ? 'svg' : 'png', n: f.name, url: f.url };
      render(); toast('הלוגו נקלט', f.name);
    };
    const pickMedia = async (vid, list) => { const fs = await uploadPicked(vid ? 'video/mp4,video/quicktime,video/webm' : 'image/png,image/jpeg,image/webp', true); fs.forEach((f) => list.push({ v: vid, url: f.url, name: f.name })); return fs.length; };
    ACT.evMedia = async (v) => { evCollect(); const e = S.ev; if (await pickMedia(v === '1', e.media)) render(); };
    ACT.evAf = async (v) => { evCollect(); const e = S.ev; if (await pickMedia(v === '1', e.after.files)) render(); };
    ACT.evNext0 = () => {
      evCollect(); const e = S.ev;
      if (!e.name.trim()) { toast('חסר שם אירוע', '', 'err'); return; }
      if (!e.date || !e.start) { toast('חסרים תאריך ושעה', '', 'err'); return; }
      if (evDays(e) < 3) { toast('האירוע קרוב מדי', 'צריך לפחות 3 ימים עד האירוע כדי לבנות את רצף הפרסומים.', 'err'); return; }
      if (!e.place.trim()) { toast('חסר מקום', '', 'err'); return; }
      if (!e.ch.length) { toast('לא נבחרה פלטפורמה', '', 'err'); return; }
      if (!e.logo || !e.logo.url) { toast('חסר לוגו', 'העלו לוגו לאירוע או בחרו את לוגו הארגון.', 'err'); return; }
      if (e.media.length < 3) { toast('חסרים חומרים', 'העלו לפחות 3 תמונות או סרטונים.', 'err'); return; }
      e.step = 1; render(); window.scrollTo({ top: 0 });
    };
    // texts from Claude, then every post gets its graphic or video
    ACT.evNext1 = async () => {
      const e = S.ev; e.sting.ok = true; e.gen = 'Claude כותב את פרסומי האירוע...'; render();
      const ps = evPosts(e);
      try {
        const r = await gen({ mode: 'event', dept: e.dept, name: e.name, date: fmtD(e.date), start: e.start, place: e.place, desc: e.desc, slots: ps.map((p) => ({ l: p.l, sub: p.sub, kind: p.kind, date: fmtD(p.date), time: p.time })) });
        (r.posts || []).forEach((x, k) => { const p = ps[(+x.i || k + 1) - 1]; if (!p) return; if (x.title) p.t = x.title; if (x.body) p.body = x.body; p.tags = x.tags || []; p.design = { kicker: x.kicker || '', headline: x.headline || x.title || p.t, sub: x.sub || '', details: x.details || [], cta: x.cta || '', keyword: x.keyword || '', icons: Array.isArray(x.icons) ? x.icons.filter((y) => y && y.label).slice(0, 3) : [] }; });
      } catch (err) { aiFail(err); }
      if (S.ev !== e) return;
      e.gen = null; e.posts = ps; e.step = 2; render(); window.scrollTo({ top: 0 });
      ps.forEach((p) => evMake(e, p));
    };
    ACT.evRe = (i) => { const e = S.ev, p = e.posts[+i]; if (p) evMake(e, p); };
    ACT.evKind = (val) => {
      const [i, k] = val.split('|'); const e = S.ev, p = e.posts[+i];
      if (k === 'graphic' && p.kind === 'video' && e.posts.filter((x) => x.kind === 'video').length === 1) { toast('צריך לפחות סרטון אחד', 'לפחות אחד מהפרסומים שלפני האירוע הוא סרטון. הפכו קודם פרסום אחר לסרטון.', 'err'); return; }
      if (p.kind === k) return;
      p.kind = k; p.ok = false; render();
      const m = pm(p); if (!m || (!m.url && !m.busy)) evMake(e, p);
    };
    ACT.epAi = () => {
      const el = $('#epAi'), v = (el && el.value || '').trim();
      if (!v) { toast('מה לשנות?', '', 'err'); return; }
      const e = S.ev, p = e.posts[S.evCur]; const m = pm(p);
      if (m && m.busy) { toast('עוד בהכנה', 'אפשר לבקש שינוי כשהגרסה הנוכחית תסתיים.', 'err'); return; }
      el.value = ''; evMake(e, p, v); toast(p.kind === 'video' ? 'הסרטון נבנה מחדש' : 'הגרפיקה מתעדכנת', '„' + v + '”');
    };
    // scheduling: each post becomes an item with its file; a video still in production joins when it is ready
    ACT.evSched = () => {
      const e = S.ev;
      if (canDirect() && e.posts.some((p) => !p.ok)) { toast('יש פרסומים שלא אושרו', 'אשרו את כל הפרסומים, או לחצו "אישור הכל".', 'err'); return; }
      if (e.posts.some((p) => { const m = pm(p); return m && m.busy && p.kind === 'graphic'; })) { toast('הגרפיקות עוד בעיצוב', 'עוד כמה שניות והן מוכנות.', 'err'); return; }
      if (e.posts.some((p) => { const m = pm(p); return !m || m.err; })) { toast('יש פרסום בלי קובץ', 'נסו שוב ליצור את הגרפיקה או הסרטון שלא נוצרו.', 'err'); return; }
      const st = canDirect() ? 'scheduled' : 'pending';
      e.posts.forEach((p) => {
        const it = mkItem({ t: p.t, ty: p.kind, s: st, pub: p.date + ' ' + p.time, ch: [...e.ch], g: p.g, body: p.body, d: e.dept, tags: p.tags || [], fmts: [p.kind === 'video' ? '9:16' : '1:1'] });
        const m = pm(p);
        it.media = m && m.url && !m.busy ? JSON.parse(JSON.stringify(m)) : { kind: p.kind, ready: false };
        p.item = it.id;
      });
      e.st = 'scheduled'; if (!S.events.includes(e)) S.events.unshift(e); render(); window.scrollTo({ top: 0 });
      const wait = e.posts.some((p) => { const m = pm(p); return m && m.busy; });
      toast(canDirect() ? 'הפרסומים תוזמנו' : 'נשלח לאישור', e.posts.length + ' פרסומים' + (wait ? ' · סרטון שעוד בהכנה יצטרף לפרסום כשיהיה מוכן' : ''));
    };
    ACT.evSim = () => { S.ev.st = 'after'; render(); };
    // after the event: summary video from the uploads (showcase) and the companion post
    function evAfVideo(e, change) {
      const a = e.after;
      return evVideo(e, a, 'vm', {
        name: 'סיכום: ' + e.name, goal: 'showcase', dur: 30, imgs: evImgs(e, a.files), change,
        desc: 'סרטון סיכום לאירוע שהתקיים, מתוך החומרים שצולמו בו. להציג את האווירה, הקהל והרגעים החזקים ולהודות לתושבים.\n' + evInfo(e) + (a.note ? '\nלהדגיש: ' + a.note : ''),
        done: () => { if (a.vItem) { const it = itemById(a.vItem); if (it) it.media = JSON.parse(JSON.stringify(a.vm)); } },
      });
    }
    ACT.evAfGen = async () => {
      const e = S.ev, a = e.after;
      if (a.files.length < 3) { toast('חסרים חומרים', 'העלו לפחות 3 תמונות או סרטונים מהאירוע.', 'err'); return; }
      a.note = ($('#evAfN') || {}).value || '';
      e.gen = 'Claude כותב את פוסט הסיכום...'; render();
      let post = { t: 'תודה שהייתם איתנו: ' + e.name, body: 'תודה לכל מי שהגיע ל' + e.name + (a.note ? '. ' + a.note : '') + '. נתראה באירוע הבא.', tags: [] };
      try { const r = await gen({ mode: 'event', after: true, dept: e.dept, name: e.name, date: fmtD(e.date), start: e.start, place: e.place, desc: e.desc, note: a.note }); if (r.body) post = { t: r.title || post.t, body: r.body, tags: r.tags || [] }; } catch (err) { /* the default text stays, it can be edited */ }
      if (S.ev !== e) return;
      e.gen = null; a.ready = true;
      a.video = { t: 'סיכום: ' + e.name, kind: 'video', g: 4, ver: 1, after: true };
      a.post = Object.assign(post, { date: addDays(e.date, 1) < todayIso() ? addDays(todayIso(), 1) : addDays(e.date, 1), time: '18:00' });
      render();
      evAfVideo(e);
    };
    // the summary card reads the video from after.vm
    const _evAfter = evAfter;
    evAfter = function (e) {
      const a = e.after;
      if (a.video) a.video.media = a.vm || null;
      return _evAfter(e);
    };
    ACT.evAfRe = () => evAfVideo(S.ev);
    ACT.evVAi = () => {
      const el = $('#evVFix'), v = (el && el.value || '').trim();
      if (!v) { toast('מה לתקן?', '', 'err'); return; }
      evCollect(); const e = S.ev;
      if (e.after.vm && e.after.vm.busy) { toast('עוד בהכנה', 'אפשר לבקש שינוי כשהסרטון יהיה מוכן.', 'err'); return; }
      evAfVideo(e, v); toast('הסרטון נבנה מחדש', '„' + v + '”');
    };
    ACT.evAfOk = () => {
      evCollect(); const e = S.ev, a = e.after, p = a.post;
      if (!a.vm || a.vm.err) { toast('אין סרטון סיכום', 'צרו את סרטון הסיכום לפני התזמון.', 'err'); return; }
      const st = canDirect() ? 'scheduled' : 'pending';
      const it = mkItem({ t: a.video.t, ty: 'video', s: st, pub: p.date + ' ' + p.time, ch: [...e.ch], g: 4, body: p.body, d: e.dept, tags: p.tags || [], fmts: ['9:16'] });
      it.media = a.vm.url && !a.vm.busy ? JSON.parse(JSON.stringify(a.vm)) : { kind: 'video', ready: false };
      a.vItem = it.id;
      e.st = 'done'; render();
      toast(canDirect() ? 'סרטון הסיכום תוזמן' : 'נשלח לאישור', fmtD(p.date) + ' · ' + p.time + (a.vm.busy ? ' · יצא לפרסום כשהסרטון יהיה מוכן' : ''));
    };
    // a reload in the middle of a production: that file is marked for a retry
    (function fixBusy() {
      if (!L.ready) { setTimeout(fixBusy, 700); return; }
      (S.events || []).forEach((e) => {
        // work that lived in the closed window is lost; a server job keeps going and is followed again
        const mark = (m) => { if (m && m.busy && !m.job) { m.busy = ''; m.err = true; } };
        (e.posts || []).forEach((p) => { mark(p.mg); mark(p.mv); });
        if (e.after) mark(e.after.vm);
      });
    })();
    css.textContent += `
.ev-th.ev-real{background-size:cover;background-position:center;position:relative;overflow:hidden}
.ev-th.ev-real .tt{display:none}
.ev-th.ev-real video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#0A2C51}
.ev-th.ev-busy{display:grid;place-items:center;background:var(--bg-2,#EEF1F6)!important;color:var(--ink,#13213A)}
.ev-prog{display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;font-size:12.5px;padding:6px}
.ev-prog i{display:block;width:80%;height:5px;border-radius:9px;background:#fff;overflow:hidden}.ev-prog i u{display:block;height:100%;background:var(--brand,#0E3B6B);text-decoration:none}
.raw.has-real,.raw.ev-vid{background-size:cover;background-position:center;color:#fff}
.st-logo img{width:78%;height:78%;object-fit:contain}`;
  })();

  /* =================== WhatsApp requests: the real conversations of the bot =================== */
  (function () {
    if (!SCREENS.whatsapp) return;
    // back in the menu now that it shows the bot's real requests (under "ערוצים")
    const addNav = (list, after) => { if (list && !list.includes('whatsapp')) { const i = list.indexOf(after); list.splice(i >= 0 ? i + 1 : list.length - 2, 0, 'whatsapp'); } };
    addNav(NAV_V.ext, 'insights'); addNav(NAV_V.basic, 'insights'); addNav(NAV_V.dept, 'channels');
    const W = { list: [], at: 0, busy: false, sel: null };
    const ago = (iso) => {
      const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
      if (s < 90) return 'עכשיו';
      if (s < 3600) return 'לפני ' + Math.round(s / 60) + ' דקות';
      if (s < 86400) return 'לפני ' + Math.round(s / 3600) + ' שעות';
      const d = new Date(iso);
      return d.getDate() + '.' + (d.getMonth() + 1) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    };
    async function waLoad(force) {
      if (W.busy || (!force && Date.now() - W.at < 20000)) return;
      W.busy = true;
      try { const r = await call('wa.list'); W.list = r.requests || []; W.at = Date.now(); } catch (e) { W.at = Date.now(); }
      W.busy = false;
      if (S.route === 'whatsapp') render();
    }
    const stCls = { 'בעבודה': 's-draft', 'ממתין לאישור בריף': 's-pending', 'נכשל': 's-pending', 'טיוטה נוצרה': 's-scheduled', 'ממתין לאישור': 's-pending', 'תוזמן': 's-scheduled', 'פורסם': 's-published' };
    const _r = SCREENS.whatsapp.render;
    SCREENS.whatsapp.nav.count = () => (L.demo ? waRequests.filter((r) => r.st === 'חדש').length : W.list.filter((r) => r.st === 'ממתין לאישור בריף' || r.st === 'ממתין לאישור').length);
    SCREENS.whatsapp.render = function () {
      if (L.demo) return _r.call(this);
      waLoad(false);
      const head = pageHead({ title: 'בקשות WhatsApp', desc: 'בקשות שהגיעו לבוט ב-WhatsApp: גרפיקות, סרטונים ותזמונים. כל משתמש שהטלפון שלו רשום במערכת יכול לכתוב לבוט.' });
      if (!W.at) return head + '<div class="card card-pad" style="display:flex;gap:10px;align-items:center"><span class="gm-spin"></span> טוען את הבקשות...</div>';
      if (!W.list.length) return head + '<div class="card card-pad" style="display:flex;flex-direction:column;gap:8px"><b>עוד אין בקשות מהבוט</b><span style="color:var(--ink-3)">משתמשים כותבים למספר הבוט, 050-646-7554, מהטלפון הרשום אצלם במערכת. הטלפון של כל משתמש נקבע במסך המשתמשים.</span></div>';
      const sel = W.list.find((r) => r.id === W.sel) || W.list[0];
      const it = sel.ui != null ? itemById(sel.ui) : null;
      const prev = sel.url ? (sel.kind === 'video'
        ? '<video src="' + esc(sel.url) + '" controls playsinline preload="metadata" style="width:100%;max-height:360px;border-radius:12px;background:#0A2C51"></video>'
        : '<img src="' + esc(sel.url) + '" alt="" style="width:100%;border-radius:12px;display:block">') : '';
      return head +
        '<div style="display:grid;grid-template-columns:minmax(220px,300px) minmax(0,1fr) minmax(220px,300px);gap:16px;align-items:start" class="wa-grid">' +
          '<div class="card"><div class="card-head"><h3>בקשות</h3><span class="chip" style="margin-inline-start:auto">' + W.list.length + '</span>' +
            '<button class="icon-btn" data-act="waRefresh" title="רענון">' + ic('refresh', 15) + '</button></div>' +
            '<div class="row-list">' + W.list.map((r) =>
              '<button class="rowi" style="width:100%;text-align:start;border:none;background:' + (r.id === sel.id ? 'var(--brand-100)' : 'transparent') + '" data-act="waSel:' + r.id + '">' +
              '<span class="ic-box">' + ic(r.voice ? 'mic' : r.kind === 'video' ? 'play' : 'msg', 16) + '</span>' +
              '<span class="grow" style="min-width:0"><span class="nm">' + esc(r.from || 'משתמש') + '</span><br><span class="mt">' + esc((r.kind === 'video' ? 'סרטון' : 'גרפיקה') + (r.dept ? ' · ' + r.dept : '') + ' · ' + ago(r.at)) + '</span></span>' +
              '<span class="badge ' + (stCls[r.st] || 's-draft') + '" style="height:20px;font-size:11.5px">' + esc(r.st) + '</span></button>').join('') +
            '</div></div>' +
          '<div class="card" style="min-width:0"><div class="card-head">' + ic('msg', 17) + '<h3>' + esc(sel.title || (sel.kind === 'video' ? 'סרטון' : 'גרפיקה')) + '</h3>' +
            '<span class="badge ' + (stCls[sel.st] || 's-draft') + '" style="margin-inline-start:auto">' + esc(sel.st) + '</span></div>' +
            '<div style="padding:18px;display:flex;flex-direction:column;gap:10px;max-height:520px;overflow:auto">' +
              (sel.conv.length ? sel.conv.map((m) => '<div class="msg ' + (m.dir === 'in' ? 'in' : 'out') + '" style="white-space:pre-wrap">' + (m.media && !m.body ? '<span style="color:var(--ink-3)">' + ic('mic', 13) + ' קובץ מצורף</span>' : esc(m.body)) + '</div>').join('')
                : '<div class="msg in" style="white-space:pre-wrap">' + esc(sel.text) + '</div>') +
            '</div>' +
            '<div style="padding:14px 18px;border-top:1px solid var(--line-2);display:flex;gap:8px;flex-wrap:wrap">' +
              (it ? '<button class="btn btn-primary" data-act="open:' + it.id + '">' + ic('eye', 16) + ' פתיחת הפריט במערכת</button>' : '') +
              (sel.st === 'נכשל' ? '<button class="btn" data-act="waRetry:' + sel.id + '">' + ic('refresh', 16) + ' ניסיון חוזר</button>' : '') +
            '</div></div>' +
          '<div class="card" style="min-width:0"><div class="card-head"><h3>פרטים</h3></div>' +
            (prev ? '<div style="padding:14px 14px 0">' + prev + '</div>' : '') +
            '<div class="card-pad kv">' +
            [['שולח', sel.from], ['מחלקה', sel.dept || '-'], ['טלפון', sel.ph || '-'], ['סוג', sel.kind === 'video' ? 'סרטון' : 'גרפיקה'], ['התקבל', ago(sel.at)], ['בקשה', sel.text]]
              .map((x) => '<div class="r"><span class="k">' + esc(x[0]) + '</span><span class="v" style="white-space:pre-wrap">' + esc(x[1] || '') + '</span></div>').join('') +
            '</div></div>' +
        '</div>';
    };
    ACT.waSel = (id) => { W.sel = id; render(); };
    ACT.waRefresh = () => { waLoad(true); toast('מרענן', ''); };
    ACT.waRetry = async (id) => {
      try { const r = await call('job.retry', { id }); toast(r.ok ? 'נשלח לניסיון חוזר' : 'הבקשה כבר בטיפול', ''); } catch (e) { toast('הניסיון החוזר נכשל', '', 'err'); }
      setTimeout(() => waLoad(true), 1500);
    };
    // the count in the menu stays fresh while the app is open
    setInterval(() => { if (L.ready && L.kind === 'client' && !L.demo) waLoad(false); }, 60000);
  })();
  /* ---------------- corrections 21.10: team wording, two brands, channel pages, compact approvals, own media ---------------- */
  (function () {
    const isMember = () => !!(L.me && L.me.role === 'member');
    const deepCopy = (o) => JSON.parse(JSON.stringify(o));
    const chName = (k) => (CH[k] ? CH[k].t : k);

    /* ===== 1. team: user types, free-text department, access details saved on the new user ===== */
    const ROLE_HE = { owner: 'הרשאת מנהל (גישה מלאה)', admin: 'הרשאת מנהל (גישה מלאה)', member: 'מחלקה בארגון' };
    const relabel = (h) => String(h).replace(/משתמש ארגון \(גישה חלקית\)/g, ROLE_HE.admin).replace(/משתמש ארגון(?! ·)/g, ROLE_HE.admin).replace(/משתמש יחיד/g, ROLE_HE.member);
    if (SCREENS.team) {
      const _tR = SCREENS.team.render;
      SCREENS.team.render = function () { return relabel(_tR.apply(this, arguments)); };
    }
    function seedDept(n) {
      n = String(n || '').trim();
      if (!n) return '';
      if (!DEPTS.includes(n)) {
        DEPTS.push(n);
        DEPT_C[n] = DEPT_COLORS[(DEPTS.length - 1) % DEPT_COLORS.length];
        if (typeof TOPICS !== 'undefined' && !TOPICS[n]) TOPICS[n] = TOPICS[DEPTS[0]] || [];
        if (typeof TAG_BANK !== 'undefined' && !TAG_BANK[n]) TAG_BANK[n] = ['עדכון_לתושבים'];
      }
      if (!DEPT_INFO[n]) DEPT_INFO[n] = { lead: '', route: 'full', phones: [], mails: [], appr: null };
      return n;
    }
    const _inviteUser = ACT.inviteUser;
    ACT.inviteUser = () => {
      _inviteUser();
      const k = $('#ivKind'), w = $('#ivDeptWrap');
      if (!k || !w) return;
      k.innerHTML = '<option value="dept">מחלקה בארגון (רואה את המחלקה שלה בלבד)</option><option value="ext">הרשאת מנהל (גישה מלאה: כל המערכת, מחלקות ואישורים)</option>';
      w.innerHTML = '<label for="ivDept">מחלקה</label><input type="text" id="ivDept" list="ivDeptList" placeholder="שם המחלקה, למשל: תרבות ופנאי" autocomplete="off"><datalist id="ivDeptList">' + DEPTS.map((d) => '<option value="' + esc(d) + '">').join('') + '</datalist>';
      const note = $('#drawer .note');
      if (note) note.innerHTML = ic('shield', 16) + '<span>מחלקה בארגון רואה רק את התוכן שלה; בלי ההרשאה שלמעלה כל תוכן שלה עובר אישור. הרשאת מנהל פותחת גם מחלקות ומשתמשים, ומגבלת המחלקות של המנוי חלה על כולם יחד.</span>';
    };
    const _doInvite = ACT.doInvite;
    ACT.doInvite = async () => {
      const kind = $('#ivKind') ? $('#ivKind').value : 'dept';
      const dept = kind === 'dept' ? seedDept($('#ivDept') && $('#ivDept').value) : '';
      if (kind === 'dept' && !dept) { toast('חסר שם מחלקה', 'כתבו את שם המחלקה.', 'err'); return; }
      const phone = ($('#ivPhone') && $('#ivPhone').value || '').trim();
      const email = ($('#ivMail') && $('#ivMail').value || '').trim().toLowerCase();
      const before = (L.members || []).length;
      await _doInvite();
      if ((L.members || []).length === before) return; // not created
      // the phone and the e-mail given at creation are the new user's access details
      if (dept && DEPT_INFO[dept]) {
        const di = DEPT_INFO[dept];
        if (phone && !di.phones.includes(phone)) di.phones.push(phone);
        if (email && !di.mails.includes(email)) di.mails.push(email);
        const nm = ($('#ivName') && $('#ivName').value || '').trim();
        if (!di.lead && nm) di.lead = nm;
      }
      render(); flush();
    };
    // a department user sees its own phone and e-mail under settings > access
    if (SCREENS.settings) {
      const _sR = SCREENS.settings.render;
      SCREENS.settings.render = function () {
        if (isMember()) { const d = S.dept; const di = d && DEPT_INFO[d]; if (di) { if (L.me.phone && !di.phones.includes(L.me.phone)) di.phones.push(L.me.phone); if (L.me.email && !di.mails.includes(L.me.email)) di.mails.push(L.me.email); } }
        return _sR.apply(this, arguments);
      };
    }

    /* ===== 2. two brands: the organisation's and a second one, with a switch ===== */
    // BRAND is always the active brand; the inactive one sleeps in BRAND.alt (name in BRAND.altName). Switching swaps them.
    const brandCore = (b) => { const c = Object.assign({}, b); delete c.alt; delete c.which; return c; };
    function swapBrand() {
      const alt = BRAND.alt; if (!alt) return;
      const cur = brandCore(BRAND);
      const which = BRAND.which === 'second' ? 'main' : 'second';
      replaceObj(BRAND, Object.assign(deepCopy(alt), { alt: cur, which }));
      S.brandEdit = false; S.brandDraft = null;
    }
    const name2Of = () => (BRAND.which === 'second' ? BRAND.name2 : BRAND.alt && BRAND.alt.name2) || 'מותג שני';
    ACT.brandSwitch = () => { if (!BRAND.alt) return; swapBrand(); render(); flush(); toast('המותג הפעיל הוחלף', BRAND.which === 'second' ? (BRAND.name2 || 'המותג השני') + ' פעיל עכשיו.' : 'מותג הארגון פעיל עכשיו.'); };
    ACT.brandSecond = () => {
      if (BRAND.alt) return;
      openModal('<div class="mb"><div class="m-ic">' + ic('palette', 20) + '</div><h3>הקמת מותג שני</h3><p>הארגון יעבוד עם שני מותגים במקביל, ואפשר לעבור ביניהם במתג. המותג השני מתחיל מעותק של מותג הארגון: לוגו, צבעים וכללי כתיבה משלו.</p>' +
        '<div class="field" style="margin-top:14px"><label for="b2Name">שם המותג השני</label><input type="text" id="b2Name" placeholder="לדוגמה: החברה הכלכלית"></div></div>' +
        '<div class="modal-foot"><button class="btn btn-primary" data-act="brandSecondGo">הקמה ומעבר למותג השני</button><button class="btn" data-act="closeModal">ביטול</button></div>');
    };
    ACT.brandSecondGo = () => {
      const n = ($('#b2Name') && $('#b2Name').value || '').trim() || 'מותג שני';
      const main = brandCore(BRAND);
      const second = deepCopy(main); second.kit = null; second.tpls = []; second.docs = []; second.name2 = n;
      replaceObj(BRAND, Object.assign(second, { alt: main, which: 'second' }));
      S.brandEdit = false; S.brandDraft = null;
      closeModal(); render(); flush();
      toast('המותג השני הוקם', n + ' פעיל עכשיו. העלו לו לוגו משלו בלשונית לוגו.');
    };
    ACT.brandSecondDel = () => {
      confirmModal({ title: 'למחוק את המותג השני?', body: 'נכסי המותג השני יימחקו והארגון יחזור לעבוד עם מותג אחד.', ok: 'מחיקת המותג השני', tone: 'bad', icon: 'x',
        onOk: () => { if (BRAND.which === 'second') swapBrand(); delete BRAND.alt; delete BRAND.which; render(); flush(); toast('המותג השני נמחק', ''); } });
    };
    function brandBar() {
      const two = !!BRAND.alt;
      const second = BRAND.which === 'second';
      const n2 = name2Of();
      return '<div class="note bsw" style="margin-bottom:14px;align-items:center;gap:12px">' + ic('palette', 16) +
        (two
          ? '<span><b>שני מותגים.</b> המתג קובע איזה מותג פעיל בגרפיקות, במסמכים ובסרטונים.</span>' +
            '<span class="bsw-tg" style="margin-inline-start:auto;display:inline-flex;align-items:center;gap:10px"><span class="' + (second ? 't-sub' : '') + '" style="font-weight:700">מותג הארגון</span><button class="sw ' + (second ? 'on' : '') + '" data-act="brandSwitch" role="switch" aria-checked="' + second + '" aria-label="מעבר בין המותגים"></button><span class="' + (second ? '' : 't-sub') + '" style="font-weight:700">' + esc(n2) + '</span>' + (canManageBrand() ? '<button class="btn btn-sm btn-quiet-bad" data-act="brandSecondDel" title="מחיקת המותג השני">' + ic('x', 13) + '</button>' : '') + '</span>'
          : '<span><b>מותג אחד.</b> ארגון שעובד תחת שני מותגים יכול להקים מותג שני ולעבור ביניהם במתג.</span>' + (canManageBrand() ? '<button class="btn btn-sm" style="margin-inline-start:auto" data-act="brandSecond">' + ic('plus', 14) + ' הקמת מותג שני</button>' : '')) +
        '</div>';
    }
    const canManageBrand = () => !isMember();
    // a department user: the organisation's two brands, or a brand of its own; nothing is deleted when switching
    {
      const _hydC = hydrateClient;
      hydrateClient = function (st) { S.campsBefore = Array.isArray(S.camps) ? S.camps : []; return _hydC.apply(this, arguments); };
      const _slices = L.memberSlices;
      L.memberSlices = function (st) {
        _slices(st);
        if (!isMember()) return;
        // a department's series live under its own id (the organisation state holds only the organisation's)
        const srv = st && st.memberCamps && Array.isArray(st.memberCamps[L.me.id]) ? st.memberCamps[L.me.id] : null;
        S.camps = S.campsBefore; // the organisation's series were just hydrated over ours; ours come back
        if (!SY.mstate) S.camps = srv || [];
        else {
          // a pull never overwrites series that changed locally and were not saved yet (a generation in progress)
          let synced = []; try { synced = (JSON.parse(SY.mstate).memberCamps || {})[L.me.id] || []; } catch (e) { /* none */ }
          const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)) ? Object.keys(x).sort().reduce((o, kk) => { o[kk] = x[kk]; return o; }, {}) : x);
          const dirty = canon(S.camps || []) !== canon(synced);
          // the database reorders keys: only a real content change on the server replaces the local series
          if (!dirty && srv && canon(srv) !== canon(S.camps || [])) S.camps = srv;
          if (!Array.isArray(S.camps)) S.camps = srv || [];
        }
        const mb = st && st.memberBrand && st.memberBrand[L.me.id];
        S.ownBrandKeep = mb && mb.brand ? mb.brand : null;
        if (!S.ownBrand && mb && mb.which === 'second' && BRAND.alt && BRAND.which !== 'second') swapBrand();
        S.brandWhich = BRAND.which === 'second' ? 'second' : 'main';
      };
      L.memberPatch = function () {
        if (!isMember()) return null;
        const mid = L.me.id;
        return { memberBrand: { [mid]: { own: !!S.ownBrand, brand: S.ownBrand ? BRAND : (S.ownBrandKeep || null), which: S.ownBrand ? null : (BRAND.which === 'second' ? 'second' : 'main') } }, memberChannels: { [mid]: channels }, memberCamps: { [mid]: (S.camps || []).slice(0, 12) } };
      };
      ACT.brandOwn = () => {
        const go2 = () => { S.ownBrandKeep = S.ownBrandKeep || deepCopy(brandCore(BRAND)); S.ownBrand = true; replaceObj(BRAND, deepCopy(S.ownBrandKeep)); render(); flush(); toast('נכסי מותג משלך', 'המחלקה עובדת עכשיו עם המותג שלה. אפשר לחזור למותג הארגון במתג.'); };
        if (S.ownBrandKeep) { go2(); return; }
        confirmModal({ title: 'לבנות נכסי מותג משלך?', body: 'המחלקה תקבל מותג משלה, בנפרד ממותג הארגון. מתחילים מעותק של מותג הארגון ומשנים מה שרוצים. המתג מחליף בין השניים בכל רגע.', ok: 'בניית נכסי מותג משלי', icon: 'palette', onOk: go2 });
      };
      ACT.brandUseOrg = () => { S.ownBrandKeep = deepCopy(BRAND); S.ownBrand = false; replaceObj(BRAND, deepCopy(L.orgBrand || BRAND)); if (S.brandWhich === 'second' && BRAND.alt && BRAND.which !== 'second') swapBrand(); render(); flush(); toast('מותג הארגון', 'המחלקה משתמשת במותג הארגון. המותג שלך נשמר.'); };
      ACT.brandOwnToggle = () => (S.ownBrand ? ACT.brandUseOrg() : ACT.brandOwn());
      ACT.brandSwitchM = () => { if (S.ownBrand || !BRAND.alt) return; swapBrand(); S.brandWhich = BRAND.which === 'second' ? 'second' : 'main'; render(); flush(); toast('המותג הפעיל הוחלף', ''); };
      const _bR2 = SCREENS.brand.render;
      SCREENS.brand.render = function () {
        let h = _bR2.apply(this, arguments);
        if (!isMember()) return h.replace(/(<div class="tabs">)/, brandBar() + '$1');
        const own = !!S.ownBrand, has2 = !own && !!BRAND.alt, second = BRAND.which === 'second';
        const bar = '<div class="note bsw" style="margin-bottom:14px;align-items:center;gap:12px">' + ic('palette', 16) +
          '<span><b>' + (own ? 'נכסי מותג משלך.' : 'מותג הארגון.') + '</b> ' + (own ? 'הגרפיקות של המחלקה נבנות לפי המותג הזה.' : 'מנוהל על ידי הרשאת מנהל ואינו ניתן לשינוי מכאן.') + '</span>' +
          '<span class="bsw-tg" style="margin-inline-start:auto;display:inline-flex;align-items:center;gap:10px;flex-wrap:wrap">' +
          (has2 ? '<span class="' + (second ? 't-sub' : '') + '" style="font-weight:700">מותג הארגון</span><button class="sw ' + (second ? 'on' : '') + '" data-act="brandSwitchM" role="switch" aria-checked="' + second + '" aria-label="מעבר בין מותגי הארגון"></button><span class="' + (second ? '' : 't-sub') + '" style="font-weight:700">' + esc(BRAND.name2 || (BRAND.alt && BRAND.alt.name2) || 'מותג שני') + '</span><span class="t-sub">·</span>' : '') +
          '<span class="' + (own ? 't-sub' : '') + '" style="font-weight:700">הארגון</span><button class="sw ' + (own ? 'on' : '') + '" data-act="brandOwnToggle" role="switch" aria-checked="' + own + '" aria-label="מותג משלי"></button><span class="' + (own ? '' : 't-sub') + '" style="font-weight:700">מותג משלי</span></span></div>';
        h = h.replace(/<div class="note" style="margin-bottom:14px;align-items:center">[\s\S]*?<\/div>/, bar);
        return h;
      };
    }

    /* ===== 3. channels: the page's own picture and name next to the network mark ===== */
    const picOf = (k) => { const a = (L.pub && L.pub.acc || []).find((x) => x.ch === k); return a && a.pic && /^https:\/\//.test(a.pic) ? a.pic : ''; };
    if (SCREENS.channels) {
      const _cR = SCREENS.channels.render;
      SCREENS.channels.render = function () {
        let h = _cR.apply(this, arguments);
        channels.forEach((c) => {
          if (!(c.st === 'מחובר' || c.st === 'דורש חידוש הרשאה')) return;
          const pic = picOf(c.k);
          const nm = '<span class="ch-main"><b>' + CH[c.k].t + '</b><span class="t-sub">' + esc(c.acc) + '</span></span>';
          if (!h.includes(nm)) return;
          h = h.replace(nm, '<span class="ch-main ch-page"><b>' + CH[c.k].t + '</b><span class="ch-acc">' + (pic ? '<img class="ch-pic" src="' + esc(pic) + '" alt="">' : '<span class="ch-pic ch-pic-i">' + esc(initials(c.acc)) + '</span>') + '<span class="t-sub" style="font-weight:700;color:var(--ink)">' + esc(c.acc) + '</span>' + (c.fol && c.fol !== '-' ? '<span class="t-sub">· ' + esc(c.fol) + ' עוקבים</span>' : '') + '</span></span>');
        });
        return h;
      };
    }
    css.textContent += `
.ch-acc{display:inline-flex;align-items:center;gap:8px;min-width:0}.ch-pic{width:26px;height:26px;border-radius:50%;object-fit:cover;flex:none;border:1px solid var(--line,#DDE3EC);background:#fff}
.ch-pic-i{display:inline-grid;place-items:center;font-size:10px;font-weight:800;color:var(--ink-2)}
.bsw .sw{margin:0}`;

    /* ===== 4-7. approvals: compact rows, view, fix note, self fix, approve = scheduled or published ===== */
    const thumbOf = (it) => { const m = it && it.media; if (!m) return ''; if (m.thumb) return m.thumb; if (m.kind === 'graphic' && m.url) return m.url; if (m.image) return m.image; return ''; };
    const approvedOf = (it) => Array.isArray(it.log) && it.log.some((e) => e.k === 'approved' || (e.k === 'scheduled' && it.log.some((x) => x.k === 'pending')));
    const stLabel = (it) => (it.s === 'scheduled' && approvedOf(it) ? '<span class="badge s-scheduled">' + ic('checkc', 13, 2) + 'אושר ותוזמן</span>' : it.s === 'published' && approvedOf(it) ? '<span class="badge s-published">' + ic('checkc', 13, 2) + 'אושר ופורסם</span>' : badge(it.s));
    const me = () => curUser().n;
    const apList = () => {
      const f = S.apF || {};
      return items.filter((i) => i.s === 'pending' && i.o !== me() && (!f.dept || i.d === f.dept) && (!f.who || i.o === f.who) && (!f.src || (i.src || 'system') === f.src));
    };
    function apRow(x) {
      const th = thumbOf(x);
      const vid = x.media && x.media.kind === 'video';
      return '<div class="ap-row card" data-id="' + x.id + '">' +
        '<div class="ap-info"><div class="ap-t"><b>' + esc(x.t) + '</b>' + (typeof srcChip === 'function' ? srcChip(x) : '') + '</div>' +
        '<div class="ap-m t-sub">' + esc(x.o) + ' · ' + esc(x.d) + ' · ' + (x.ch || []).map(chName).join(', ') + ' · ' + (x.pub ? 'מתוזמן ל-' + esc(x.pub) : 'פרסום מיידי עם האישור') + (x.wait ? ' · ממתין ' + esc(x.wait) : '') + '</div>' +
        (x.body ? '<div class="ap-b t-sub">' + esc(String(x.body).slice(0, 140)) + (x.body.length > 140 ? '…' : '') + '</div>' : '') +
        '<div class="ap-acts"><button class="btn btn-sm btn-ok" data-act="approve:' + x.id + '">' + ic('check', 14) + ' אישור</button><button class="btn btn-sm" data-act="askfix:' + x.id + '">' + ic('undo', 14) + ' תיקון</button><button class="btn btn-sm" data-act="apView:' + x.id + '">' + ic('eye', 14) + ' צפייה</button><button class="btn btn-sm btn-quiet-bad" data-act="reject:' + x.id + '">' + ic('x', 14) + ' דחייה</button></div></div>' +
        '<div class="ap-th" data-act="apView:' + x.id + '" role="button" tabindex="0" aria-label="צפייה">' + (th ? '<img src="' + esc(th) + '" alt="">' + (vid ? '<span class="ap-play">' + ic('play', 16) + '</span>' : '') : '<span class="ap-noimg">' + ic(x.ty === 'video' ? 'vid' : x.ty === 'doc' ? 'doc' : 'img', 20) + '</span>') + '</div></div>';
    }
    function fixRow(x) {
      const th = thumbOf(x);
      const vid = x.media && x.media.kind === 'video';
      return '<div class="ap-row card" data-id="' + x.id + '">' +
        '<div class="ap-info"><div class="ap-t"><b>' + esc(x.t) + '</b><span class="badge s-fix">' + ic('undo', 13, 2) + 'נדרש תיקון</span></div>' +
        '<div class="ap-m t-sub">' + (x.ch || []).map(chName).join(', ') + ' · ' + (x.pub ? 'מתוזמן ל-' + esc(x.pub) : 'פרסום מיידי עם האישור') + ' · עודכן ' + esc(x.u || '') + '</div>' +
        '<div class="ap-note">' + ic('msg', 13) + ' ' + esc(x.fixnote || 'נדרש עדכון לפני האישור.') + '</div>' +
        '<div class="ap-acts"><button class="btn btn-sm btn-primary" data-act="fixGo:' + x.id + '">' + ic('edit', 14) + ' תיקון הטקסט או העיצוב</button><button class="btn btn-sm" data-act="apView:' + x.id + '">' + ic('eye', 14) + ' צפייה</button><button class="btn btn-sm" data-act="open:' + x.id + '">פתיחה</button></div></div>' +
        '<div class="ap-th" data-act="apView:' + x.id + '" role="button" tabindex="0" aria-label="צפייה">' + (th ? '<img src="' + esc(th) + '" alt="">' + (vid ? '<span class="ap-play">' + ic('play', 16) + '</span>' : '') : '<span class="ap-noimg">' + ic(x.ty === 'video' ? 'vid' : x.ty === 'doc' ? 'doc' : 'img', 20) + '</span>') + '</div></div>';
    }
    if (SCREENS.approvals) {
      const _aR = SCREENS.approvals.render;
      SCREENS.approvals.render = function () {
        let h = _aR.apply(this, arguments);
        const tab = S.tab.approvals || 'mine';
        if (isMember()) {
          const nFix = items.filter((i) => i.s === 'fix').length;
          h = h.replace(/(data-act="tab:approvals:sent">)נשלחו וטופלו<span class="cnt">\d+<\/span>/, '$1דרוש תיקון<span class="cnt">' + nFix + '</span>');
        }
        if (tab === 'mine') {
          if (isMember()) return h;
          const list = apList();
          if (!list.length) return h;
          h = h.replace(/<div class="grid" style="grid-template-columns:1fr;gap:10px;margin-bottom:18px">[\s\S]*$/, '<div class="ap-list">' + list.map(apRow).join('') + '</div>');
          return h;
        }
        if (isMember() && tab === 'sent') {
          // a department: the returned items, as compact rows with the reviewer's note and a fix button
          const f = S.apF || {};
          const list = items.filter((i) => i.s === 'fix' && (!f.dept || i.d === f.dept) && (!f.who || i.o === f.who) && (!f.src || (i.src || 'system') === f.src));
          const body = list.length ? '<div class="ap-list">' + list.map(fixRow).join('') + '</div>'
            : emptyState({ i: 'checkc', t: 'אין פריטים שדורשים תיקון', d: 'פריט שיוחזר לתיקון יופיע כאן עם ההערה של המאשר.' });
          if (/<div class="tbl-wrap">/.test(h)) h = h.replace(/<div class="tbl-wrap">[\s\S]*$/, body);
          else if (/<div class="empty">/.test(h)) h = h.replace(/<div class="empty">[\s\S]*$/, body);
          else h += body;
          return h;
        }
        // sent / history: the requester sees "approved and scheduled / published", and a fix button on items returned to it
        items.forEach((x) => {
          const row = new RegExp('<tr><td data-l="כותרת"><span class="row-title" data-act="open:' + x.id + '">[\\s\\S]*?<\\/tr>');
          const m = h.match(row); if (!m) return;
          let r = m[0];
          if (approvedOf(x) && (x.s === 'scheduled' || x.s === 'published')) r = r.replace(/<td data-l="סטטוס">[\s\S]*?<\/td>/, '<td data-l="סטטוס">' + stLabel(x) + '</td>');
          if (x.s === 'fix' && x.o === me()) r = r.replace('<button class="btn btn-sm" data-act="open:' + x.id + '">פתיחה</button>', '<button class="btn btn-sm btn-primary" data-act="fixGo:' + x.id + '">' + ic('edit', 14) + ' תיקון</button> <button class="btn btn-sm" data-act="open:' + x.id + '">פתיחה</button>');
          h = h.replace(m[0], r);
        });
        return h;
      };
    }
    css.textContent += `
.ap-list{display:flex;flex-direction:column;gap:6px;max-width:1100px}
.ap-row{display:flex;gap:12px;align-items:center;padding:7px 12px;min-height:0}
.ap-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;justify-content:center}
.ap-t{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:14.5px}.ap-t b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.ap-m{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ap-b{display:none}
.ap-acts{display:flex;gap:5px;flex-wrap:wrap;margin-top:3px}.ap-acts .btn-sm{padding:3px 9px;font-size:12px;min-height:0}
.ap-th{width:66px;height:66px;flex:none;border-radius:12px;overflow:hidden;background:var(--surface-2,#F3F5F9);display:grid;place-items:center;position:relative;cursor:pointer;border:1px solid var(--line-2,#E6EAF2)}
.ap-th img{width:100%;height:100%;object-fit:cover;display:block}.ap-play{position:absolute;inset:0;display:grid;place-items:center;color:#fff;background:rgba(0,0,0,.25)}
.ap-noimg{color:var(--ink-3)}
.ap-note{font-size:12.5px;color:var(--ink-2);background:var(--surface-2,#F3F5F9);border-radius:8px;padding:4px 8px;display:inline-flex;gap:6px;align-items:center;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ap-view{display:grid;place-items:center;max-height:78vh}.ap-view img,.ap-view video{max-width:100%;max-height:72vh;border-radius:12px;display:block}
.fix-bar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px}
@media (max-width:640px){.ap-row{flex-wrap:wrap}.ap-th{width:72px;height:72px}}`;
    ACT.apView = (id) => {
      const it = itemById(id); if (!it) return;
      const m = it.media || {};
      const vid = m.kind === 'video' && m.url;
      const img = !vid && (m.url || thumbOf(it));
      const body = vid ? '<video src="' + esc(m.url) + '" controls autoplay playsinline' + (m.thumb ? ' poster="' + esc(m.thumb) + '"' : '') + '></video>'
        : img ? '<img src="' + esc(img) + '" alt="' + esc(it.t) + '">' : '<div class="preview-pane" style="width:min(420px,90vw)">' + postPreview(it) + '</div>';
      openModal('<div class="mb" style="max-width:none"><h3 style="margin:0 0 10px">' + esc(it.t) + '</h3><div class="ap-view">' + body + '</div>' + (it.body ? '<p class="t-sub" style="margin:12px 0 0;line-height:1.6;max-width:640px">' + esc(it.body) + '</p>' : '') + '</div>' +
        '<div class="modal-foot">' + (!isMember() && it.s === 'pending' ? '<button class="btn btn-ok" data-act="approve:' + it.id + '">' + ic('check', 15) + ' אישור</button><button class="btn" data-act="askfix:' + it.id + '">' + ic('undo', 15) + ' תיקון</button><button class="btn" data-act="apEdit:' + it.id + '">' + ic('edit', 15) + ' תיקון בעצמי</button>' : '') + (isMember() && it.s === 'fix' && it.o === me() ? '<button class="btn btn-primary" data-act="fixGo:' + it.id + '">' + ic('edit', 15) + ' תיקון הפוסט</button>' : '') + '<button class="btn" data-act="goItem:' + it.id + '">פתיחת הפריט</button><button class="btn" data-act="closeModal">סגירה</button></div>');
    };
    // the organisation user fixes the post itself: the same editing screen as the creator, the item stays the same item
    ACT.apEdit = (id) => { closeModal(); closeDrawer(); ACT.edit(id); };
    ACT.fixGo = (id) => { closeModal(); closeDrawer(); ACT.edit(id); };
    // approve: with a date it is scheduled, without a date it goes out now; the requester sees "approved and ..."
    ACT.approve = (id) => {
      const it = itemById(id); if (!it) return;
      const now = !it.pub;
      confirmModal({ title: 'לאשר את הפריט?', body: now ? 'הפריט „' + esc(it.t) + '” יפורסם מיד לערוצים שנבחרו.' : 'הפריט „' + esc(it.t) + '” יתוזמן ל-' + esc(it.pub) + ' ויופיע בלוח התוכן.', ok: now ? 'אישור ופרסום' : 'אישור ותזמון', tone: 'ok', icon: 'checkc',
        onOk: () => {
          if (L.itemLog) L.itemLog(it, 'approved', '');
          it.s = now ? 'published' : 'scheduled'; it.u = 'עכשיו';
          closeDrawer(); closeModal(); render(); flush();
          toast(now ? 'אושר ופורסם' : 'אושר ותוזמן', now ? 'יוצא עכשיו לערוצים. הסטטוס אצל המבקש: אושר ופורסם.' : 'יוצא במועד ' + it.pub + '. הסטטוס אצל המבקש: אושר ותוזמן.');
          const next = apList()[0];
          if (next && S.route === 'approvals') setTimeout(() => toast('הפריט הבא בתור', '„' + next.t + '” ממתין לבדיקה.'), 700);
        } });
    };
    // askfix: the note goes back to the creator, who sees it on the item with a fix button
    ACT.askfix = (id) => {
      const it = itemById(id); if (!it) return;
      confirmModal({ title: 'בקשת תיקון', body: 'כתבו מה צריך לתקן. הפריט יחזור ליוצר עם ההערה, והוא יפתח אותו לתיקון הטקסט או העיצוב.', ok: 'שליחת בקשת תיקון', icon: 'undo',
        extra: '<div class="field" style="margin-top:14px"><textarea id="fixTxt" rows="3" placeholder="לדוגמה: להוסיף את שעת הסיום ואת פרטי החניה"></textarea></div>',
        onOk: () => { const t = ($('#fixTxt') && $('#fixTxt').value.trim()) || 'נדרש עדכון לפני האישור.'; it.s = 'fix'; it.fixnote = t; it.u = 'עכשיו'; closeDrawer(); closeModal(); render(); flush(); toast('הבקשה נשלחה', '„' + it.t + '” חזר ליוצר עם ההערה.'); } });
    };
    // the item screen: a returned item shows the note and opens the fix screen in one click
    if (SCREENS.item) {
      const _iR = SCREENS.item.render;
      SCREENS.item.render = function () {
        let h = _iR.apply(this, arguments);
        const it = items.find((x) => x.id === S.itemId) || items[0];
        if (!it) return h;
        let bar = '';
        if (it.s === 'fix') bar = '<div class="note warn fix-bar">' + ic('undo', 16) + '<span><b>הוחזר לתיקון.</b> ' + esc(it.fixnote || '') + '</span><button class="btn btn-primary btn-sm" style="margin-inline-start:auto" data-act="fixGo:' + it.id + '">' + ic('edit', 14) + ' תיקון הטקסט או העיצוב</button></div>';
        else if ((it.s === 'scheduled' || it.s === 'published') && approvedOf(it)) bar = '<div class="note fix-bar">' + ic('checkc', 16) + '<span><b>' + (it.s === 'published' ? 'אושר ופורסם.' : 'אושר ותוזמן.') + '</b> ' + (it.s === 'published' ? 'הפוסט יצא לערוצים.' : 'יוצא במועד ' + esc(it.pub) + '.') + '</span></div>';
        else if (it.s === 'pending' && !isMember() && it.o !== me()) bar = '<div class="note fix-bar">' + ic('clock', 16) + '<span><b>ממתין לאישור.</b></span><span style="margin-inline-start:auto;display:inline-flex;gap:6px;flex-wrap:wrap"><button class="btn btn-ok btn-sm" data-act="approve:' + it.id + '">' + ic('check', 14) + ' אישור</button><button class="btn btn-sm" data-act="askfix:' + it.id + '">' + ic('undo', 14) + ' תיקון</button><button class="btn btn-sm" data-act="apEdit:' + it.id + '">' + ic('edit', 14) + ' תיקון בעצמי</button></span></div>';
        return bar ? h.replace('<div class="split-wide">', bar + '<div class="split-wide">') : h;
      };
    }

    /* ===== 8. own media: a finished graphic or video the user made, no AI ===== */
    const _layPick = typeof layPickHtml === 'function' ? layPickHtml : null;
    if (_layPick) {
      layPickHtml = function (m, busy) {
        let h = _layPick(m, busy);
        const on = m.layout === 'own';
        const i = h.lastIndexOf('</div>');
        return h.slice(0, i) + '<button class="' + (on ? 'on' : '') + '" data-act="gOwn"' + (busy ? ' disabled' : '') + ' role="radio" aria-checked="' + on + '">' + ic('upload', 13) + ' העלאת גרפיקה מוכנה (בלי AI)</button>' + h.slice(i) +
          (on && m.url ? '<div class="t-sub" style="margin-top:6px">' + ic('checkc', 13) + ' הקובץ שהעליתם מוצג כמו שהוא. <button class="link-btn" data-act="gOwn" style="background:none;border:0;padding:0;font:inherit;color:var(--brand);font-weight:700;cursor:pointer">החלפת קובץ</button></div>' : '');
      };
    }
    const _gfxRun = typeof gfxRun === 'function' ? gfxRun : null;
    if (_gfxRun) gfxRun = async function (w, opts) { const m = w.media; if (m && m.layout === 'own' && m.url && !(opts && opts.layout && opts.layout !== 'own')) { m.busy = ''; render(); return; } return _gfxRun(w, opts); };
    ACT.gOwn = async () => {
      const w = S.wiz; if (!w || !w.media || w.media.busy) return;
      collectWiz();
      const [f] = await uploadPicked('image/*,video/*');
      if (!f || S.wiz !== w) return;
      const m = w.media; const vid = isVid(f.name);
      m.layout = 'own'; m.url = f.url; m.design = f.url; m.thumb = vid ? '' : f.url; m.image = vid ? '' : f.url; m.kind = vid ? 'video' : 'graphic';
      m.model = ''; m.qa = null; m.warn = null; m.stale = false; m.busy = ''; m.ready = true; m.uploaded = true; m.fmt = w.fmt || '1:1'; m.ar = m.ar || '1/1';
      render();
      toast('הקובץ הועלה', 'הגרפיקה שלכם תפורסם כמו שהיא, בלי שינוי.');
    };
    // the brief step: a finished post the user made, straight to the studio without AI text
    const _wizRB = SCREENS.wizard.render;
    SCREENS.wizard.render = function () {
      let h = _wizRB.apply(this, arguments);
      const w = S.wiz;
      if (!w || w.step !== 0 || !isGfx(w)) return h;
      return h.replace(/(<div class="brief-tools">)/, '$1<button class="btn btn-sm" data-act="wOwnStart" type="button">' + ic('upload', 14) + ' יש לי פוסט מוכן (בלי AI)</button>');
    };
    ACT.wOwnStart = async () => {
      const w = S.wiz; if (!w) return;
      collectWiz();
      const [f] = await uploadPicked('image/*,video/*');
      if (!f || S.wiz !== w) return;
      const vid = isVid(f.name);
      w.step = 1; w.t = w.brief.title || f.name.replace(/\.[a-z0-9]+$/i, ''); w.body = w.brief.free || ''; w.tags = w.tags || []; w.sugg = w.sugg || []; w.ver = 1; w.design = null;
      w.media = { kind: vid ? 'video' : 'graphic', layout: 'own', url: f.url, design: f.url, thumb: vid ? '' : f.url, image: vid ? '' : f.url, ready: true, uploaded: true, fmt: w.fmt || '1:1', ar: '1/1' };
      render(); window.scrollTo({ top: 0 });
      toast('הפוסט שלכם נטען', 'הקובץ יפורסם כמו שהוא. אפשר לערוך את הטקסט ולשלוח.');
    };
    // the preview shows the uploaded file as is
    const _wizR = SCREENS.wizard && SCREENS.wizard.mount;
    if (SCREENS.wizard) SCREENS.wizard.mount = function () {
      _wizR && _wizR.apply(this, arguments);
      const w = S.wiz; const m = w && w.media;
      if (!m || m.layout !== 'own' || !m.url) return;
      const pane = $('.preview-pane'); if (!pane) return;
      pane.innerHTML = m.kind === 'video' ? '<video src="' + esc(m.url) + '" controls playsinline style="width:100%;border-radius:12px;display:block"></video>' : '<img src="' + esc(m.url) + '" alt="" style="width:100%;border-radius:12px;display:block">';
    };
  })();


  /* ---------------- carousel posts and captions for uploaded posts ---------------- */
  (function () {
    // images one post may carry per network (provider documentation); 1 = no carousel, 0 = video only
    const CAR_MAX = { fb: 10, ig: 10, tk: 35, li: 20, x: 4, th: 10, tg: 10, gb: 1, yt: 0, wa: 1, web: 1 };
    const carOk = (k) => (CAR_MAX[k] == null ? 10 : CAR_MAX[k]) >= 2;
    const chName = (k) => (CH[k] ? CH[k].t : k);
    // step 0: the carousel choice, and the networks that cannot take one
    const _wz = SCREENS.wizard.render;
    SCREENS.wizard.render = function () {
      let h = _wz.apply(this, arguments);
      const w = S.wiz;
      if (!w || !isGfx(w)) return h;
      if (w.step === 0) {
        const n = +w.carousel || 0;
        const sel = '<div class="field full"><label>סוג הפוסט <span class="hint">תמונה אחת, או קרוסלה של כמה תמונות בפוסט אחד</span></label><div class="lay-pick" role="radiogroup" aria-label="סוג הפוסט">' +
          [[0, 'תמונה אחת'], [2, 'קרוסלה · 2'], [3, 'קרוסלה · 3'], [4, 'קרוסלה · 4'], [5, 'קרוסלה · 5'], [6, 'קרוסלה · 6']].map((o) => '<button class="' + (n === o[0] ? 'on' : '') + '" data-act="wCar:' + o[0] + '" role="radio" aria-checked="' + (n === o[0]) + '">' + o[1] + '</button>').join('') + '</div>' +
          (n ? '<div class="t-sub" style="margin-top:6px">קרוסלה: פייסבוק ואינסטגרם עד 10 תמונות, טיקטוק עד 35, לינקדאין עד 20, X עד 4, Threads וטלגרם עד 10. יוטיוב וגוגל לעסקים לא מקבלים קרוסלה ולכן חסומים.</div>' : '') + '</div>';
        h = h.replace('<div class="field full"><label>פלטפורמות לפרסום</label>', sel + '<div class="field full"><label>פלטפורמות לפרסום</label>');
        if (n) h = h.replace(/<button class="plat( on)?" data-act="ch:([a-z]+)">/g, (m, on, k) => carOk(k) ? m : '<button class="plat is-disabled" disabled title="' + esc(chName(k)) + ' לא מקבל קרוסלה" data-act="ch:' + k + '">');
      } else if (w.step === 1 && w.carousel && w.media) {
        const m = w.media, busy = !!m.busy, sl = m.slides || [];
        const strip = '<div class="car-strip">' + (w.slides || []).map((x, i) => '<div class="car-sl' + (sl[i] ? '' : ' wait') + '">' + (sl[i] ? '<img src="' + esc(sl[i]) + '" alt="">' : '<span class="t-sub">' + (busy && i === sl.length ? 'מעצבים...' : 'ממתין') + '</span>') + '<b>' + (i + 1) + '</b></div>').join('') + '</div>';
        const box = '<div class="field full"><label>קרוסלה · ' + (w.slides || []).length + ' שקפים</label>' + strip +
          '<div class="real-acts" style="margin-top:8px"><button class="btn btn-sm" data-act="carRedo"' + (busy ? ' disabled' : '') + '>' + ic('refresh', 14) + ' עיצוב מחדש של כל השקפים</button>' + (m.qa ? ' ' + qaHtml(m.qa) : '') + '</div>' +
          (busy ? '<div class="t-sub" style="margin-top:6px">' + esc(m.busy) + '</div>' : '') + '</div>';
        h = h.replace(/<div class="lay-pick" role="radiogroup" aria-label="פריסה">[\s\S]*?<\/div>/, '');
        h = h.replace(/(<div class="ai-box[^>]*>)/, box + '$1');
      }
      return h;
    };
    css.textContent += `
.car-strip{display:flex;gap:8px;overflow-x:auto;padding:4px 0}.car-sl{position:relative;width:96px;height:96px;flex:none;border-radius:12px;overflow:hidden;border:1px solid var(--line-2,#E6EAF2);background:var(--surface-2,#F3F5F9);display:grid;place-items:center}
.car-sl img{width:100%;height:100%;object-fit:cover;display:block}.car-sl b{position:absolute;top:4px;inset-inline-end:4px;background:#fff;border-radius:6px;font-size:11px;padding:1px 6px}.car-sl.wait{border-style:dashed}
.plat.is-disabled{opacity:.45;cursor:not-allowed}`;
    ACT.wCar = (n) => { const w = S.wiz; if (!w) return; collectWiz(); w.carousel = +n || 0; if (w.carousel) w.ch = (w.ch || []).filter(carOk); render(); };
    // the design of every slide, one after the other, with the organisation's kit
    async function carouselRun(w, opts) {
      const m = w.media; const job = ++m.job || (m.job = 1);
      const fmt = w.fmt || '1:1'; const size = IMG_SIZE(fmt);
      const logo = logoOf(); const photos = briefPhotos(w);
      const kit = logo ? await ensureKit() : null;
      if (S.wiz !== w || m.job !== job) return;
      const slides = w.slides || [];
      if (!opts || !opts.keep) m.slides = [];
      m.url = ''; m.thumb = ''; m.warn = null; m.qa = null;
      const qas = [];
      try {
        for (let i = 0; i < slides.length; i++) {
          if (m.slides[i]) continue;
          const sl = slides[i];
          m.busy = 'ChatGPT מעצב שקף ' + (i + 1) + ' מתוך ' + slides.length + '...'; render();
          const r = await fx('image', {
            action: 'design', org: aiCtx().org, dept: w.brief.dept, size, brief: (w.brief.title || '') + '\n' + (w.brief.free || '') + '\nשקף ' + (i + 1) + ' מתוך ' + slides.length + ' בקרוסלה. אותה שפה בדיוק בכל השקפים.',
            colors: brandFor(w.brief.dept).colors, roles: brandFor(w.brief.dept).roles, style: w.design.style || 'official', palette: w.design.palette || '', kit: kit || undefined,
            texts: { kicker: sl.kicker, headline: sl.headline, sub: sl.sub, details: sl.details || [], cta: sl.cta || '', icons: sl.icons || [], keyword: sl.keyword || '' },
            refs: [...(logo ? [logo] : []), ...(i === 0 ? photos : [])].slice(0, 4), logo: !!logo, note: opts && opts.note || '', quality: 'high', n: 1, redo: false,
          }, 150000);
          if (S.wiz !== w || m.job !== job) return;
          m.slides[i] = r.url; if (r.qa) qas.push(r.qa.score || 0);
          if (r.check && !r.check.ok && (r.check.issues || []).length) m.warn = [...(m.warn || []), 'שקף ' + (i + 1) + ': ' + r.check.issues.join('; ')];
          render();
        }
        m.url = m.slides[0] || ''; m.thumb = m.url; m.design = m.url; m.image = m.url; m.layout = 'ai'; m.kind = 'graphic'; m.fmt = fmt; m.ar = AR[fmt] || '1/1'; m.ready = true; m.dsize = size; m.stale = false;
        m.qa = qas.length ? { score: Math.round(qas.reduce((a, b) => a + b, 0) / qas.length), issues: [], tries: 1 } : null;
        m.busy = ''; w.ver = (w.ver || 1) + 1; render();
        if (m.warn) toast('בדקו את הטקסט בשקפים', m.warn.join(' · '), 'err');
      } catch (e) {
        if (S.wiz !== w || m.job !== job) return;
        m.busy = ''; render();
        toast('עיצוב הקרוסלה לא הושלם', 'אפשר ללחוץ "עיצוב מחדש" כדי להשלים את השקפים החסרים.', 'err');
      }
    }
    const _gfx = gfxRun;
    gfxRun = async function (w, opts) {
      if (w && w.carousel && (w.slides || []).length > 1 && isGfx(w)) {
        if (opts && opts.fit && w.media && w.media.slides && w.media.slides.length === w.slides.length && w.media.dsize === IMG_SIZE(w.fmt || '1:1')) return;
        return carouselRun(w, opts);
      }
      return _gfx(w, opts);
    };
    ACT.carRedo = () => { const w = S.wiz; if (!w || !w.media || w.media.busy) return; collectWiz(); carouselRun(w, { note: 'קומפוזיציה שונה מהגרסה הקודמת' }); };
    // the preview of a carousel: the first slide, with the strip above
    // an uploaded finished post: Claude reads it and writes the caption
    const _own = ACT.wOwnStart;
    ACT.wOwnStart = async () => {
      await _own();
      const w = S.wiz; const m = w && w.media;
      if (!m || m.layout !== 'own' || m.kind !== 'graphic' || !m.url) return;
      const done = busyBtn('[data-act="wizNext"]', 'קוראים את הפוסט וכותבים את הטקסט...');
      try {
        const r = await gen({ mode: 'caption', image: m.url, title: w.brief.title, brief: w.brief.free, dept: w.brief.dept });
        if (S.wiz !== w) return;
        if (r.title && !w.brief.title) w.t = r.title;
        if (r.body) w.body = r.body + (r.cta ? '\n\n' + r.cta : '');
        const tags = (r.tags || []).slice(0, 6);
        if (tags.length) { w.sugg = [...new Set([...tags, ...(w.sugg || [])])].slice(0, 7); w.tags = tags.slice(0, 4); }
        render();
        toast('הטקסט נכתב מתוך הגרפיקה', r.read ? String(r.read).slice(0, 120) : '');
      } catch (e) { done(); toast('קריאת הגרפיקה לא הצליחה', 'אפשר לכתוב את הטקסט ידנית.', 'err'); }
    };
  })();

  /* ---------------- no Facebook-group sharing: the publishing provider works with Pages only (Meta closed the Groups API) ---------------- */
  if (typeof groupsSec === 'function') groupsSec = () => '';
  const _wizItemG = wizItem;
  wizItem = function (st) { const it = _wizItemG(st); if (it) { it.groups = []; } return it; };


  /* ---------------- periodic content: plan upload first, period up to 6 months, 1-4 a week, holidays closed by default ---------------- */
  (function () {
    const HOL = [["חג הסיגד","2026-11-08","he"],["יום הילד הבינלאומי","2026-11-20","intl"],["יום הנשים הבינלאומי למניעת אלימות","2026-11-25","intl"],["חנוכה","2026-12-03","he"],["יום האדם עם מוגבלות","2026-12-03","intl"],["יום ההתנדבות הבינלאומי","2026-12-05","intl"],["ראש השנה האזרחי","2027-01-01","intl"],["ט״ו בשבט","2027-01-22","he"],["יום המשפחה","2027-02-06","he"],["יום האהבה","2027-02-14","intl"],["יום האישה הבינלאומי","2027-03-08","intl"],["פורים","2027-03-22","he"],["יום העלייה","2027-04-16","he"],["פסח","2027-04-21","he"],["יום כדור הארץ","2027-04-22","intl"],["יום השואה","2027-05-03","he"],["יום הזיכרון","2027-05-10","he"],["יום העצמאות","2027-05-11","he"],["יום ההורים","2027-05-15","intl"],["ל״ג בעומר","2027-05-24","he"],["יום ירושלים","2027-06-03","he"],["יום הסביבה העולמי","2027-06-05","intl"],["יום הספר העברי","2027-06-10","intl"],["שבועות","2027-06-11","he"],["פתיחת שנת הלימודים","2027-09-01","intl"],["ראש השנה","2027-10-01","he"],["יום הקשיש הבינלאומי","2027-10-01","intl"],["יום המורה הבינלאומי","2027-10-05","intl"],["יום כיפור","2027-10-10","he"],["סוכות","2027-10-15","he"],["שמחת תורה","2027-10-22","he"],["יום הילד הבינלאומי","2027-11-20","intl"],["יום הנשים הבינלאומי למניעת אלימות","2027-11-25","intl"],["חג הסיגד","2027-11-28","he"],["יום האדם עם מוגבלות","2027-12-03","intl"],["יום ההתנדבות הבינלאומי","2027-12-05","intl"],["חנוכה","2027-12-23","he"],["ראש השנה האזרחי","2028-01-01","intl"],["ט״ו בשבט","2028-02-11","he"],["יום האהבה","2028-02-14","intl"],["יום המשפחה","2028-02-26","he"],["יום האישה הבינלאומי","2028-03-08","intl"],["פורים","2028-03-11","he"],["יום העלייה","2028-04-05","he"],["פסח","2028-04-10","he"],["יום כדור הארץ","2028-04-22","intl"],["יום השואה","2028-04-23","he"],["יום הזיכרון","2028-04-30","he"],["יום העצמאות","2028-05-01","he"],["ל״ג בעומר","2028-05-13","he"],["יום ההורים","2028-05-15","intl"],["יום ירושלים","2028-05-23","he"],["שבועות","2028-05-31","he"],["יום הסביבה העולמי","2028-06-05","intl"],["יום הספר העברי","2028-06-10","intl"],["פתיחת שנת הלימודים","2028-09-01","intl"],["ראש השנה","2028-09-20","he"],["יום כיפור","2028-09-29","he"],["יום הקשיש הבינלאומי","2028-10-01","intl"],["סוכות","2028-10-04","he"],["יום המורה הבינלאומי","2028-10-05","intl"],["שמחת תורה","2028-10-11","he"],["חג הסיגד","2028-11-15","he"],["יום הילד הבינלאומי","2028-11-20","intl"],["יום הנשים הבינלאומי למניעת אלימות","2028-11-25","intl"],["יום האדם עם מוגבלות","2028-12-03","intl"],["יום ההתנדבות הבינלאומי","2028-12-05","intl"],["חנוכה","2028-12-11","he"]];
    HOLIDAYS.splice(0, HOLIDAYS.length, ...HOL.map((h) => [h[0], h[1]]));
    const HOL_KIND = {}; HOL.forEach((h) => { HOL_KIND[h[0] + '|' + h[1]] = h[2]; });
    const isoDay = (d) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
    const todayIso = () => isoDay(new Date());
    const plusDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoDay(d); };
    const startIso = () => { const d = new Date(); d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7)); return isoDay(d); };
    const b0 = S.bulk;
    b0.holidays = false; b0.hol = HOL.filter((h) => h[2] === 'he' && !/השואה|הזיכרון/.test(h[0])).map((h) => h[0]); b0.fmts = ['1:1']; b0.plan = null; b0.files = [];
    const myDept = () => (L.me && L.me.role === 'member' && (L.me.dept || S.dept)) || (S.user && S.user.dept) || DEPTS[0];
    // the period: from a plan (its dates), otherwise months from the coming week
    function periodOf(b) {
      const pl = b.plan && b.plan.items && b.plan.items.length ? b.plan : null;
      const dated = pl ? pl.items.filter((x) => x.date && x.date >= todayIso()) : [];
      if (dated.length) { const ds = dated.map((x) => x.date).sort(); return { st: ds[0], end: ds[ds.length - 1], plan: pl, dated: true }; }
      const st = startIso();
      return { st, end: plusDays(st, b.months * 30), plan: pl, dated: false };
    }
    const holIn = (b, per) => b.holidays ? HOLIDAYS.filter((h) => b.hol.includes(h[0]) && h[1] >= todayIso() && h[1] >= per.st && h[1] <= per.end) : [];
    bulkCount = function (b) {
      const per = periodOf(b);
      const weeks = Math.max(1, Math.round(b.months * 52 / 12));
      const hol = holIn(b, per).length;
      if (per.plan) { const n = per.plan.items.length; return { weeks, base: n, hol, total: n + hol, plan: true }; }
      return { weeks, base: weeks * b.perWeek, hol, total: weeks * b.perWeek + hol };
    };
    buildCamp = function (b, owner) {
      const per = periodOf(b), list = [];
      const mk = (date, extra) => Object.assign({ t: '', body: '', date, time: ['10:00', '18:00', '20:00'][list.length % 3], g: list.length % GV.length, lay: 0, ver: 1, ch: [...b.ch], flag: null, edited: false, hol: false }, extra);
      if (per.plan) {
        const pw = per.plan.perWeek >= 1 && per.plan.perWeek <= 4 ? per.plan.perWeek : 2;
        const off = [[2], [0, 3], [0, 2, 4], [0, 2, 3, 5]][pw - 1];
        let k = 0;
        per.plan.items.forEach((x) => {
          const date = x.date && x.date >= todayIso() ? x.date : plusDays(startIso(), Math.floor(k / off.length) * 7 + off[k % off.length]);
          if (!(x.date && x.date >= todayIso())) k++;
          list.push(mk(date, { hint: x.title, text: x.text || '', hol: x.hol || false, t: x.title || '' }));
        });
      } else {
        const off = [[2], [0, 3], [0, 2, 4], [0, 2, 3, 5]][b.perWeek - 1];
        const weeks = Math.max(1, Math.round(b.months * 52 / 12));
        for (let w = 0; w < weeks; w++) off.forEach((o) => list.push(mk(plusDays(per.st, w * 7 + o))));
      }
      holIn(b, per).forEach((h) => list.push(mk(plusDays(h[1], -1), { t: h[0], time: '12:00', g: 1, lay: 1, hol: h[0] })));
      list.sort((a, x) => (a.date < x.date ? -1 : 1));
      list.forEach((x, i) => { x.i = i; x.tags = []; x.sugg = []; });
      const last = list.length ? list[list.length - 1].date : per.st;
      const dept = myDept();
      const name = per.plan && b.files && b.files[0] ? b.files[0].name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]/g, ' ') : 'סדרת ' + dept + ' · ' + b.months + ' ' + (b.months === 1 ? 'חודש' : 'חודשים');
      return { id: 'c' + Date.now().toString(36), name, dept, owner, status: 'draft', type: b.type, items: list, range: fmtD(list[0] ? list[0].date : per.st) + ' - ' + fmtD(last), cur: 0, filter: 'all', fmt: (b.fmts || ['1:1'])[0], gfxUntil: plusDays(list[0] ? list[0].date : per.st, 31) };
    };
    // the screen
    const _bR = SCREENS.bulk.render;
    SCREENS.bulk.render = function () {
      const b = S.bulk; b.dept = myDept();
      let h = _bR.call(this);
      const per = periodOf(b), files = b.files || [], pl = b.plan;
      // 1-4 a week
      h = h.replace(/(<div class="bf-row"><label>תכנים בשבוע<\/label><div class="seg big">)[\s\S]*?(<\/div><\/div>)/, '$1' + [1, 2, 3, 4].map((v) => '<button class="' + (b.perWeek === v ? 'on' : '') + '" data-act="bSet:perWeek|' + v + '"' + (pl ? ' disabled' : '') + '>' + v + '</button>').join('') + '$2');
      if (pl) h = h.replace(/(<div class="bf-row"><label>תקופה<\/label><div class="seg big">)([\s\S]*?)(<\/div><\/div>)/, (m, a, mid, z) => a + mid.replace(/<button /g, '<button disabled ') + z);
      // one month of graphics per run
      h = h.replace('<div class="bf-row"><label>תכנים בשבוע</label>', '<div class="t-sub" style="margin:-6px 0 10px">הטקסטים נכתבים לכל התקופה. הגרפיקות מעוצבות חודש אחד בכל פעם; את החודש הבא מעצבים בלחיצה מתוך הסדרה.</div><div class="bf-row"><label>תכנים בשבוע</label>');
      // holidays: closed by default; when open, the list for the period with a kind label
      const holRow = '<div class="bf-row"><label>חגים ומועדים <button class="sw ' + (b.holidays ? 'on' : '') + '" data-act="bHol" role="switch" aria-checked="' + b.holidays + '" aria-label="חגים ומועדים"></button><span class="t-sub" style="font-weight:400;margin-inline-start:8px">' + (b.holidays ? 'ברכה יוצאת יום לפני כל מועד שמסומן' : 'סגור. פתיחה מציגה את החגים והמועדים בתקופה, כולל ימים בינלאומיים') + '</span></label>' +
        (b.holidays ? '<div class="hol-pick">' + HOL.filter((x) => x[1] >= todayIso() && x[1] >= per.st && x[1] <= per.end).map((x) => '<button class="tagc ' + (b.hol.includes(x[0]) ? 'on' : '') + '" data-act="bHolT:' + x[0] + '">' + (b.hol.includes(x[0]) ? ic('check', 13, 2.4) : ic('create', 13, 2.4)) + x[0] + ' <small>' + fmtD(x[1]) + (x[2] === 'intl' ? ' · בינלאומי' : '') + '</small></button>').join('') + '</div>' : '') + '</div>';
      h = h.replace(/<div class="bf-row"><label>חגים ומועדים [\s\S]*?<\/div>(?=<div class="bf-row"><label>מחלקה)/, holRow);
      // no department row
      h = h.replace(/<div class="bf-row"><label>מחלקה<\/label>[\s\S]*?<\/select><\/div>/, '');
      // sizes: no link, no A4
      h = h.replace(/<button class="fmt[^"]*" data-act="bFmt:(1\.91:1|A4)"[\s\S]*?<\/button>/g, '');
      // the plan upload, first
      const planRow = '<div class="bf-row plan-row"><label>העלה תוכנית מוכנה</label>' +
        '<div class="up-row"><button class="up-opt" data-act="bUpload"' + (b.planBusy ? ' disabled' : '') + '><span class="fi xlsx">' + ic('upload', 14) + '</span>' + (b.planBusy ? 'קוראים את התוכנית...' : 'העלאת קובץ') + '</button><span class="t-sub">Excel, Word, PDF או טקסט: תאריכים, נושאים והטקסטים אם כתובים</span></div>' +
        (files.length ? '<div class="up-chips">' + fileChips(files, 'bFileX2') + '</div>' : '') +
        (pl ? '<div class="note" style="margin-top:8px">' + ic('checkc', 15) + '<span><b>' + pl.items.length + ' פוסטים זוהו</b>' + (per.dated ? ' · מתוזמנים לפי התאריכים בתוכנית, ' + fmtD(per.st) + ' - ' + fmtD(per.end) : ' · אין תאריכים בתוכנית: יתוזמנו ' + (pl.perWeek >= 1 && pl.perWeek <= 4 ? pl.perWeek : 2) + ' בשבוע מהשבוע הבא') + (pl.items.some((x) => x.text) ? ' · כולל טקסטים' : '') + '. ' + esc(pl.note || '') + '</span></div>' : '') +
        '<textarea id="bBrief" rows="2" placeholder="או בריף קצר: נושאים, קהל, דגשים">' + esc(b.brief) + '</textarea></div>';
      h = h.replace(/<div class="bf-row"><label>מקור התוכן<\/label>[\s\S]*?<\/textarea><\/div>/, '');
      h = h.replace('<div class="card bulk-form">', '<div class="card bulk-form">' + planRow);
      return h;
    };
    ACT.bUpload = async () => {
      const b = S.bulk;
      const fs = await uploadPicked('.xlsx,.xls,.docx,.pdf,.txt,.csv', true);
      if (!fs.length) return;
      b.files = [...(b.files || []), ...fs];
      await ACT.bPlanRead();
    };
    // read the uploaded plan: dates, topics and texts become the slots
    ACT.bPlanRead = async () => {
      const b = S.bulk;
      if (!(b.files || []).length) return;
      b.planBusy = true; render();
      try {
        const r = await fx('generate', Object.assign(aiCtx(), { mode: 'plan', dept: myDept(), files: b.files.map((f) => ({ url: f.url, name: f.name })) }), 150000);
        b.plan = r && r.items && r.items.length ? { items: r.items, perWeek: r.perWeek || 0, note: r.note || '' } : null;
        if (b.plan) {
          const per = periodOf(b);
          const days = Math.max(1, Math.round((new Date(per.end) - new Date(per.st)) / 86400000));
          b.months = Math.max(1, Math.min(6, Math.ceil(days / 30)));
          b.perWeek = b.plan.perWeek >= 1 && b.plan.perWeek <= 4 ? b.plan.perWeek : 2;
          toast('התוכנית נקראה', b.plan.items.length + ' פוסטים' + (per.dated ? ', לפי התאריכים בקובץ' : ', בלי תאריכים: 2 בשבוע'));
        } else toast('לא זוהו פוסטים בקובץ', 'בדקו שהקובץ כולל נושאים או תאריכים, או כתבו בריף.', 'err');
      } catch (e) { b.plan = null; toast('קריאת התוכנית נכשלה', 'נסו קובץ אחר או כתבו בריף.', 'err'); }
      b.planBusy = false; render();
    };
    ACT.bFileX2 = (i) => { const b = S.bulk; (b.files || []).splice(+i, 1); if (!(b.files || []).length) b.plan = null; render(); };
    css.textContent += `.plan-row{border:1.5px dashed var(--line,#DDE3EC);border-radius:14px;padding:12px 14px;margin-bottom:6px}.fi.xlsx{background:#1D6F42;color:#fff}`;
    // graphics: one month per run; the next month on request from the review screen
    const _rv = SCREENS.bulkReview.render;
    SCREENS.bulkReview.render = function () {
      let h = _rv.call(this);
      const c = campById(S.campId); if (!c || !c.gfxUntil) return h;
      const rest = c.items.filter((x) => x.date > c.gfxUntil && !(x.media && (x.media.url || x.media.busy)));
      if (!rest.length) return h;
      const note = '<div class="note" style="margin-bottom:12px">' + ic('cal', 15) + '<span><b>' + rest.length + ' פוסטים מהחודשים הבאים עם טקסט בלבד.</b> הגרפיקות מעוצבות חודש אחד בכל פעם.</span><button class="btn btn-sm btn-primary" style="margin-inline-start:auto" data-act="cNextMonth">' + ic('spark', 14) + ' עיצוב החודש הבא</button></div>';
      return h.replace('<div class="rv-strip" id="rvStrip">', note + '<div class="rv-strip" id="rvStrip">');
    };
    ACT.cNextMonth = () => {
      const c = campById(S.campId); if (!c) return;
      const until = plusDays(c.gfxUntil, 31);
      const batch = c.items.filter((x) => x.date > c.gfxUntil && x.date <= until && !(x.media && (x.media.url || x.media.busy)));
      c.gfxUntil = until;
      batch.forEach((x) => L.queueGraphic(c, x));
      render(); flush();
      toast('מעצבים את החודש הבא', batch.length + ' גרפיקות בתור.');
    };
  })();


  /* ---------------- last details 21.10: departments' series reach the manager; calendar status chips; pause / resume; top bar order ---------------- */
  (function () {
    const isMember = () => !!(L.me && L.me.role === 'member');
    const isManagerUser = () => !!(L.me && L.me.role !== 'member' && L.kind === 'client');
    /* --- departments' series are visible to the manager and approved from there --- */
    const _cs = clientState;
    clientState = function () { const o = _cs.apply(this, arguments); o.camps = (S.camps || []).filter((c) => !c.mid); return o; };
    const _hyd = hydrateClient;
    hydrateClient = function (st) {
      const r = _hyd.apply(this, arguments);
      if (isManagerUser() && st && st.memberCamps && typeof st.memberCamps === 'object') {
        S.memberCampsAll = st.memberCamps;
        const mine = (S.camps || []).filter((c) => !c.mid);
        const theirs = Object.keys(st.memberCamps).flatMap((mid) => (Array.isArray(st.memberCamps[mid]) ? st.memberCamps[mid] : []).map((c) => Object.assign(c, { mid })));
        S.camps = [...mine, ...theirs];
        S.memberCampsSynced = {}; Object.keys(st.memberCamps).forEach((mid) => { S.memberCampsSynced[mid] = JSON.stringify(st.memberCamps[mid]); });
      }
      return r;
    };
    // a manager's change to a department's series (approval, return) is written to that department's slot
    let patching = false;
    setInterval(async () => {
      if (!L.ready || !isManagerUser() || patching || !S.memberCampsSynced) return;
      const by = {};
      (S.camps || []).forEach((c) => { if (c.mid) (by[c.mid] = by[c.mid] || []).push(c); });
      for (const mid of Object.keys(by)) {
        const list = by[mid].map((c) => { const x = Object.assign({}, c); delete x.mid; return x; });
        const j = JSON.stringify(list);
        if (j === S.memberCampsSynced[mid]) continue;
        patching = true;
        try { await call('state.patch', { data: { memberCamps: { [mid]: list } } }); S.memberCampsSynced[mid] = j; } catch (e) { /* next tick */ }
        patching = false;
      }
    }, 2500);
    /* --- calendar: the status chips filter --- */
    if (SCREENS.calendar) {
      const _cR = SCREENS.calendar.render;
      SCREENS.calendar.render = function () {
        let h = _cR.apply(this, arguments);
        const f = S.calF || {};
        const chips = ['draft', 'pending', 'approved', 'scheduled', 'paused', 'published'].map((k) => { const on = f.st === ST[k].t; return '<button class="badge ' + ST[k].c + (on ? ' cal-on' : '') + '" data-act="calSt:' + k + '" aria-pressed="' + on + '">' + ic(ST[k].i, 13, 2) + ST[k].t + '</button>'; }).join('') +
          (f.st ? '<button class="chip" data-act="calSt:">' + ic('x', 13) + ' כל הסטטוסים</button>' : '<span class="t-sub" style="align-self:center">לחיצה על סטטוס מסננת את הלוח</span>');
        return h.replace(/<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">[\s\S]*?<\/div>(?=<div class="cal">|<div class="tbl-wrap">|<div class="card card-pad")/, '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center">' + chips + '</div>');
      };
    }
    ACT.calSt = (k) => { S.calF = S.calF || { dept: '', ch: '', st: '' }; S.calF.st = k && ST[k] ? ST[k].t : ''; render(); };
    css.textContent += `.badge.cal-on{outline:2px solid var(--brand);outline-offset:1px}button.badge{cursor:pointer;font:inherit}
.pz-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.pz-row input{width:100%}`;
    /* --- a scheduled post: pause / resume; an expired pause needs a new date; without permission it goes back to approval --- */
    ST.paused = { t: 'מושהה', c: 's-archived', e: 'ev-draft', i: 'pause' };
    const future = (pub) => !!pub && Date.parse(String(pub).replace(' ', 'T') + ':00+03:00') > Date.now() + 60000;
    const _peek = peekDrawer;
    peekDrawer = function (it) {
      let h = _peek(it);
      if (it.s !== 'scheduled' && it.s !== 'paused') return h;
      const exp = it.s === 'paused' && !future(it.pub);
      const d = (it.pub || '').slice(0, 10), t = (it.pub || '').slice(11, 16);
      const box = '<div class="note" style="margin-top:12px;display:block">' +
        (it.s === 'scheduled' ? '<div style="display:flex;gap:10px;align-items:center">' + ic('pause', 16) + '<span><b>מתוזמן ל-' + esc(it.pub) + '.</b> השהיה מורידה את הפוסט מהתור; הפעלה מחדש מחזירה אותו.</span><button class="btn btn-sm" style="margin-inline-start:auto" data-act="pzPause:' + it.id + '">' + ic('pause', 14) + ' השהיה</button></div>'
          : '<div style="display:flex;gap:10px;align-items:center">' + ic('pause', 16) + '<span><b>מושהה.</b> ' + (exp ? 'המועד ' + esc(it.pub) + ' עבר. לפרסום צריך לקבוע מועד חדש.' : 'מתוזמן ל-' + esc(it.pub) + '.') + (isMember() && !canDirect() ? ' הפעלה מחדש מחזירה את הפוסט לאישור.' : '') + '</span></div>' +
            '<div class="pz-row"><input type="date" id="pzDate" value="' + esc(d) + '" aria-label="תאריך"><input type="time" id="pzTime" value="' + esc(t || '10:00') + '" aria-label="שעה"></div>' +
            '<div style="margin-top:8px"><button class="btn btn-sm btn-primary" data-act="pzResume:' + it.id + '">' + ic('play', 14) + ' ' + (isMember() && !canDirect() ? 'הפעלה מחדש ושליחה לאישור' : 'הפעלה מחדש') + '</button></div>') +
        '</div>';
      return h.replace(/<div class="note">(?=[\s\S]*?התאמת הפרסום)/, box + '<div class="note">');
    };
    ACT.pzPause = (id) => {
      const it = itemById(id); if (!it || it.s !== 'scheduled') return;
      it.s = 'paused'; it.u = 'עכשיו';
      closeDrawer(); render(); flush();
      toast('הפוסט הושהה', 'ירד מהתור. אפשר להפעיל מחדש מתוך הפוסט בלוח.');
    };
    ACT.pzResume = (id) => {
      const it = itemById(id); if (!it || it.s !== 'paused') return;
      const d = $('#pzDate') && $('#pzDate').value, t = $('#pzTime') && $('#pzTime').value;
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) it.pub = d + ' ' + (t || '10:00');
      if (!future(it.pub)) { toast('המועד עבר', 'קבעו תאריך ושעה עתידיים לפני ההפעלה מחדש.', 'err'); return; }
      const needs = isMember() && !canDirect();
      it.s = needs ? 'pending' : 'scheduled'; it.u = 'עכשיו'; it.wait = 'דקה';
      closeDrawer(); render(); flush();
      toast(needs ? 'נשלח לאישור' : 'הפוסט הופעל מחדש', needs ? 'הפוסט חזר למרכז האישורים ויתוזמן ל-' + it.pub + ' עם האישור.' : 'יוצא במועד ' + it.pub + '.');
    };
    /* --- top bar order, left to right: department name, accessibility, notifications, search, create --- */
    function orderTopbar() {
      const ta = document.querySelector('.top-actions'), bar = document.querySelector('.topbar'); if (!ta || !bar) return;
      const q = (sel) => bar.querySelector(sel);
      const help = q('#btnHelp'); if (help) (help.closest('.tip') || help).remove();
      const org = q('#btnOrg'); if (org) org.style.display = 'none';
      const search = q('.search'), create = q('#btnNewTop'), notif = q('#btnNotif'), a11y = q('#a11yTop'), user = q('#btnUser'), demo = q('.demo-chip');
      // DOM order in RTL = right to left
      [demo, create, search, notif && (notif.closest('.tip') || notif), a11y && (a11y.closest('.tip') || a11y), user].forEach((el) => { if (el) ta.appendChild(el); });
      if (search) { search.style.margin = '0'; search.style.maxWidth = '340px'; search.style.flex = '1'; }
      if (user) user.style.marginInlineStart = 'auto';
      ta.style.flex = '1'; ta.style.justifyContent = 'flex-start'; ta.style.gap = '10px';
    }
    const tick = setInterval(() => { if (document.body.classList.contains('in-app') && document.querySelector('#a11yTop')) { orderTopbar(); clearInterval(tick); } }, 400);
  })();


  /* ---------------- 21.10 evening: no check circles; event logo optional with one button; media optional; full preview in the event editor ---------------- */
  (function () {
    css.textContent += `
.pk{display:none!important}
.ev-th.big.ev-real{height:auto!important;min-height:360px;aspect-ratio:4/5;max-height:70vh}
.ev-th.big.ev-real video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
#drawer .ev-th.big{width:100%}`;
    if (SCREENS.eventKit) {
      const _r = SCREENS.eventKit.render;
      SCREENS.eventKit.render = function () {
        let h = _r.apply(this, arguments);
        const e = S.ev; if (!e || e.step !== 0) return h;
        // one logo button, optional
        h = h.replace(/<div class="field full"><label>לוגו האירוע<\/label>[\s\S]*?<\/div>(?=<div class="field full"><label>תמונות וסרטונים)/, '<div class="field full"><label>לוגו האירוע <span class="hint">לא חובה. בלי לוגו משתמשים בלוגו מנכסי המותג</span></label>' +
          (e.logo && e.logo.url ? '<div class="up-chips"><span class="file-chip up-chip"><img src="' + esc(e.logo.url) + '" alt=""><b>' + esc(e.logo.n || 'לוגו') + '</b><button class="icon-btn" data-act="evLogoX" aria-label="הסרה">' + ic('x', 14) + '</button></span></div>' : '<div class="up-row"><button class="up-opt" data-act="evLogo:png"><span class="fi png">' + ic('upload', 14) + '</span>לוגו האירוע</button></div>') + '</div>');
        h = h.replace('תמונות וסרטונים <span class="hint">לפחות 3 קבצים</span>', 'תמונות וסרטונים <span class="hint">לא חובה. כל תמונה או סרטון שתעלו ישמשו בגרפיקות ובסרטונים</span>');
        return h;
      };
    }
    ACT.evLogoX = () => { if (S.ev) { S.ev.logo = null; render(); } };
    ACT.evNext0 = () => {
      evCollect(); const e = S.ev;
      if (!e.name.trim()) { toast('חסר שם אירוע', '', 'err'); return; }
      if (!e.date || !e.start) { toast('חסרים תאריך ושעה', '', 'err'); return; }
      if (evDays(e) < 3) { toast('האירוע קרוב מדי', 'צריך לפחות 3 ימים עד האירוע כדי לבנות את רצף הפרסומים.', 'err'); return; }
      if (!e.place.trim()) { toast('חסר מקום', '', 'err'); return; }
      if (!e.ch.length) { toast('לא נבחרה פלטפורמה', '', 'err'); return; }
      // no event logo: the organisation's logo; no media: the AI creates the imagery
      if (!e.logo || !e.logo.url) { const u = logoOf(); e.logo = u ? { k: 'png', n: 'לוגו ' + (aiCtx().org || 'הארגון'), url: u, auto: true } : null; }
      e.step = 1; render(); window.scrollTo({ top: 0 });
    };
  })();


  /* ---------------- 21.10 night: skip the sting without an event logo; drafts survive a closed window; event posters by the AI designer ---------------- */
  (function () {
    /* --- sting: optional when no event logo was uploaded --- */
    if (SCREENS.eventKit) {
      const _r = SCREENS.eventKit.render;
      SCREENS.eventKit.render = function () {
        let h = _r.apply(this, arguments);
        const e = S.ev; if (!e || e.step !== 1) return h;
        const noLogo = !e.logo || !e.logo.url || e.logo.auto;
        if (noLogo) h = h.replace('<button class="btn btn-primary btn-lg" data-act="evNext1">', '<button class="btn" data-act="evSkipSting">' + ic('fwd', 16) + ' דילוג על הסיומת</button><button class="btn btn-primary btn-lg" data-act="evNext1">');
        return h;
      };
    }
    ACT.evSkipSting = () => { const e = S.ev; if (!e) return; e.sting.skip = true; toast('בלי סיומת לוגו', 'הסרטונים ייסגרו בסיום הרגיל של המותג.'); ACT.evNext1(); };

    /* --- drafts: the work in progress of every wizard is saved and offered back on the create screen --- */
    const isMember = () => !!(L.me && L.me.role === 'member');
    const mid = () => (L.me && L.me.id) || 'me';
    const KINDS = [
      { k: 'wiz', key: 'wiz', route: 'wizard', he: (w) => (TYPES[w.type] ? TYPES[w.type].t : 'תוכן') + ': ' + (w.t || w.brief && w.brief.title || 'בלי כותרת'), test: (w) => !!(w && (w.brief && (w.brief.title || w.brief.free) || w.t)) },
      { k: 'vd', key: 'vd', route: 'vidWiz', he: (v) => 'סרטון: ' + (v.name || 'בלי שם'), test: (v) => !!(v && (v.name || v.desc)) },
      { k: 'dw', key: 'dw', route: 'docWiz', he: (w) => 'מסמך: ' + (w.title || w.t || (w.brief && w.brief.title) || 'בלי כותרת'), test: (w) => !!w },
      { k: 'dk', key: 'dk', route: 'deckWiz', he: (w) => 'מצגת: ' + (w.title || w.t || (w.brief && w.brief.title) || 'בלי כותרת'), test: (w) => !!w },
      { k: 'ev', key: 'ev', route: 'eventKit', he: (e) => 'אירוע: ' + (e.name || 'בלי שם'), test: (e) => !!(e && e.name && e.st !== 'scheduled' && e.st !== 'after' && e.st !== 'done') },
    ];
    const store = () => { if (isMember()) { S.myDrafts = S.myDrafts || {}; return S.myDrafts; } S.draftsAll = S.draftsAll || {}; return (S.draftsAll[mid()] = S.draftsAll[mid()] || {}); };
    const slim = (o) => { try { return JSON.parse(JSON.stringify(o, (k, v) => (k === 'busy' ? '' : typeof v === 'function' ? undefined : v))); } catch (e) { return null; } };
    // a draft is deleted only when a wizard that was open in THIS session closes (saved, sent or exited); a window that
    // closed in the middle never reaches that branch, so its draft waits on the create screen
    const seen = {};
    setInterval(() => {
      if (!L.ready || L.kind !== 'client') return;
      const d = store();
      KINDS.forEach((K) => {
        const cur = S[K.key];
        if (cur && K.test(cur) && K.route === S.route) { seen[K.k] = true; const sl = slim(cur); if (sl) { const j = JSON.stringify(sl); if (!d[K.k] || JSON.stringify(d[K.k].data) !== j) d[K.k] = { data: sl, at: Date.now(), he: K.he(cur) }; } }
        else if (!cur && d[K.k] && seen[K.k]) { delete d[K.k]; seen[K.k] = false; }
      });
    }, 3000);
    const _cs = clientState;
    clientState = function () { const o = _cs.apply(this, arguments); if (!isMember()) o.drafts = S.draftsAll || {}; return o; };
    const _hyd = hydrateClient;
    hydrateClient = function (st) {
      const r = _hyd.apply(this, arguments);
      if (!isMember() && st && st.drafts && typeof st.drafts === 'object') { if (!S.draftsAll || JSON.stringify(S.draftsAll) !== JSON.stringify(st.drafts)) S.draftsAll = st.drafts; }
      if (isMember() && st && st.memberDrafts && st.memberDrafts[mid()] && !S.myDrafts) S.myDrafts = st.memberDrafts[mid()];
      return r;
    };
    const _mp = L.memberPatch;
    L.memberPatch = function () { const o = _mp ? _mp.apply(this, arguments) : null; if (!o) return o; o.memberDrafts = { [mid()]: S.myDrafts || {} }; return o; };
    const rel = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'עכשיו' : m < 60 ? 'לפני ' + m + ' דק׳' : m < 1440 ? 'לפני ' + Math.round(m / 60) + ' שע׳' : 'לפני ' + Math.round(m / 1440) + ' ימים'; };
    if (SCREENS.create) {
      const _cr = SCREENS.create.render;
      SCREENS.create.render = function () {
        let h = _cr.apply(this, arguments);
        const d = store(); const ks = Object.keys(d).filter((k) => d[k] && d[k].data);
        if (!ks.length) return h;
        const list = '<h2 class="sec-h">טיוטות בעבודה</h2><div class="t-sub" style="margin:-4px 0 10px">תוכן שהתחלתם ולא נשלח. נשמר אוטומטית, אפשר להמשיך מהנקודה שעצרתם.</div><div class="grid g-3">' + ks.map((k) => '<div class="card card-pad" style="display:flex;flex-direction:column;gap:8px"><b>' + esc(d[k].he || 'טיוטה') + '</b><span class="t-sub">' + ic('clock', 13) + ' נשמר ' + rel(d[k].at || Date.now()) + '</span><div style="display:flex;gap:6px;margin-top:4px"><button class="btn btn-sm btn-primary" data-act="draftGo:' + k + '">' + ic('edit', 14) + ' המשך מאיפה שעצרתי</button><button class="btn btn-sm btn-quiet-bad" data-act="draftX:' + k + '">' + ic('x', 14) + '</button></div></div>').join('') + '</div>';
        const i = h.indexOf('<h2 class="sec-h">אירועים פעילים</h2>');
        if (i >= 0) return h.slice(0, i) + list + h.slice(i);
        const j = h.lastIndexOf('</span></button>');
        return j >= 0 ? h.slice(0, j + '</span></button>'.length) + list + h.slice(j + '</span></button>'.length) : h + list;
      };
    }
    ACT.draftGo = (k) => {
      const d = store(); const K = KINDS.find((x) => x.k === k); const dr = d[k];
      if (!K || !dr || !dr.data) return;
      S[K.key] = JSON.parse(JSON.stringify(dr.data)); seen[K.k] = true;
      if (K.k === 'ev') { const e = S[K.key]; (e.posts || []).forEach((p) => { if (p.mg && p.mg.busy) p.mg = null; if (p.mv && p.mv.busy && !p.mv.job) p.mv = null; }); }
      if (K.k === 'wiz' && S.wiz.media && S.wiz.media.busy) S.wiz.media.busy = '';
      S.dirty = true; go(K.route); window.scrollTo({ top: 0 });
      toast('ממשיכים מהטיוטה', dr.he || '');
    };
    ACT.draftX = (k) => { const d = store(); delete d[k]; render(); flush(); toast('הטיוטה נמחקה', ''); };
  })();

  /* ---------------- console on a phone: client and user lists as compact rows ----------------
     The mockup turns every table row into a stacked card (one line per column). In the console that makes a client
     eight lines tall; here the console's tables show one name line and one line of facts, same tokens and type. */
  (function () {
    const _render = render;
    render = function () { try { document.body.dataset.route = S.route || ''; } catch (e) { /* no body */ } return _render.apply(this, arguments); };
    css.textContent += `
@media(max-width:760px){
  body.is-admin .tbl-wrap table.responsive tr{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;padding:10px 8px}
  body.is-admin .tbl-wrap table.responsive td{display:inline-flex;align-items:center;gap:4px;padding:0;font-size:12.5px;line-height:1.5;min-width:0}
  body.is-admin .tbl-wrap table.responsive td:before{width:auto;font-size:11.5px;font-weight:500}
  body.is-admin .tbl-wrap table.responsive td[data-l="לקוח"],body.is-admin .tbl-wrap table.responsive td[data-l="משתמש"]{flex:1 1 100%;font-size:14px}
  body.is-admin .tbl-wrap table.responsive td[data-l="לקוח"]:before,body.is-admin .tbl-wrap table.responsive td[data-l="משתמש"]:before{content:none}
  body.is-admin .tbl-wrap table.responsive td[data-l=""]{margin-inline-start:auto}
  body.is-admin .tbl-wrap table.responsive td .uwrap{gap:6px}
  body.is-admin .tbl-wrap table.responsive td .uwrap .ubar,body.is-admin .tbl-wrap table.responsive td .ubar{width:56px}
  /* the facts that matter on a phone; the rest waits for the client's page */
  body.is-admin .tbl-wrap table.responsive td[data-l="הסכם"],body.is-admin .tbl-wrap table.responsive td[data-l="לשנה"],body.is-admin .tbl-wrap table.responsive td[data-l="תחילה"],body.is-admin .tbl-wrap table.responsive td[data-l="AI"],body.is-admin .tbl-wrap table.responsive td[data-l="חלק"],body.is-admin .tbl-wrap table.responsive td[data-l="מסמכים"],body.is-admin .tbl-wrap table.responsive td[data-l="שקופיות"],body.is-admin .tbl-wrap table.responsive td[data-l="שניות וידאו"],body.is-admin .tbl-wrap table.responsive td[data-l="מצגות"],body.is-admin .tbl-wrap table.responsive td[data-l="סרטונים"]{display:none}
  /* users list: the client is a fact under the user's name, not a second title */
  body.is-admin[data-route="a_users"] .tbl-wrap table.responsive td[data-l="לקוח"]{flex:0 1 auto;font-size:12.5px}
  body.is-admin[data-route="a_users"] .tbl-wrap table.responsive td[data-l="לקוח"]:before{content:attr(data-l)}
}`;
  })();

  /* ---------------- subscription plans, quotas and add-ons (approved spec 24.10.2026) ----------------
     Limits come from the server (organizations.quotas + active add-ons); outputs are counted server-side.
     Here: the console edits them per client, the client sees them, and a full quota is explained, not hidden. */
  (function () {
    const QK = ['gfx', 'doc', 'slides', 'vsec'];
    // the usage columns count slides and video seconds now, so their labels say so
    if (typeof USE_T !== 'undefined') USE_T.forEach((t) => { if (t[0] === 'decks') t[1] = 'שקופיות'; if (t[0] === 'vids') t[1] = 'שניות וידאו'; });
    const QT = { gfx: 'גרפיקות', doc: 'מסמכים', slides: 'שקופיות', vsec: 'שניות וידאו', profiles: 'פרופילים מחוברים', depts: 'מחלקות', members: 'משתמשים' };
    const ADD_K = { pack: 'הגדלת חבילה', video: 'הגדלת חבילת סרטונים' };
    const nis = (n) => Math.round(+n || 0).toLocaleString('en-US') + ' ₪';
    const dateOf = (iso) => { if (!iso) return ''; const t = new Date(iso); return t.getDate() + '.' + (t.getMonth() + 1) + '.' + t.getFullYear(); };
    // plan and add-on definitions from the server (v2_plan_defs); kept in one place for both sides
    L.plans = L.plans || [];
    const planDef = (id) => L.plans.find((p) => p.id === id) || null;
    const addonDefs = () => L.plans.filter((p) => p.kind === 'addon');
    const addText = (p) => QK.filter((k) => +((p.quotas || {})[k] || 0) > 0).map((k) => '+' + (+p.quotas[k]).toLocaleString('en-US') + ' ' + QT[k]).join(', ');
    function applyPlans(plans) {
      if (!Array.isArray(plans) || !plans.length) return;
      L.plans = plans;
      const ext = planDef('extended'), bas = planDef('basic');
      if (ext && +ext.price > 0 && PLANS.appr) PLANS.appr.cost = +ext.price;
      if (bas && +bas.price > 0 && PLANS.solo) PLANS.solo.cost = +bas.price;
      if (typeof PACKS !== 'undefined') replaceAll(PACKS, addonDefs().map((p) => ({ k: p.id, n: p.name, q: addText(p), price: +p.price || 0 })));
    }
    // the base quota of the plan, for the grey "מסלול: 400" hints
    const planQuota = (plan) => { const p = planDef(plan === 'solo' ? 'basic' : 'extended'); return (p && p.quotas) || {}; };

    /* ---- admin: real quotas on every organisation ---- */
    const _liveAdmin = liveAdmin;
    liveAdmin = function (real) {
      _liveAdmin(real);
      real.forEach((r) => {
        const o = ORGS.find((x) => x.live && x.live.id === r.id);
        if (!o) return;
        o.plan = r.plan === 'basic' ? 'solo' : 'appr';
        PLAN_OF[o.id] = o.plan;
        o.quotas = r.quotas || {}; o.addons = r.addons || {}; o.billing_day = r.billing_day || 1; o.unlimited = !!r.unlimited; o.quota = r.quota || null; o.variety = r.variety === 'uniform' ? 'uniform' : 'mixed';
        const lim = (o.quota && o.quota.limit) || o.quotas;
        const used = (o.quota && o.quota.used) || {};
        if (lim.members !== undefined) o.uLim = o.plan === 'solo' ? 1 : Math.max(1, +lim.members || 1);
        if (lim.depts !== undefined) o.dLim = o.plan === 'solo' ? 0 : +lim.depts || 0;
        o.gfx = +used.gfx || 0; o.docs = +used.doc || 0; o.decks = +used.slides || 0; o.vids = +used.vsec || 0;
        o.add = Object.keys(o.addons).filter((k) => o.addons[k]);
      });
    };
    // the saved console blob restores PLANS / PACKS: the server's definitions win after that
    const _hydrateAdmin = hydrateAdmin;
    hydrateAdmin = function (st) { _hydrateAdmin(st); applyPlans(L.plans); };
    // every API answer passes here: plans and the quota state are picked up, a full quota gets its own words
    const _post0 = post;
    post = async function (url, body, ms) {
      const action = body && body.action;
      try {
        const r = await _post0(url, body, ms);
        if (action === 'admin.load' && r && r.plans) applyPlans(r.plans);
        if (action === 'live.load' && r) { if (r.plans) applyPlans(r.plans); if (r.quota) L.quota = r.quota; }
        if (body && body.action === 'start' && /\/api\/video$/.test(String(url))) refreshQuota();
        return r;
      } catch (e) {
        if (e && e.message === 'quota' && e.detail && body && body.action === 'start' && /\/api\/video$/.test(String(url))) quotaToast(e);
        throw e;
      }
    };

    const limOf = (o) => (o.quota && o.quota.limit) || Object.assign({}, planQuota(o.plan), o.quotas || {});
    const usedOf = (o) => (o.quota && o.quota.used) || {};
    const resetOf = (o) => (o.quota && o.quota.period && o.quota.period.to) || '';
    const quotaBars = (o) => {
      const lim = limOf(o), used = usedOf(o);
      return [['gfx', ''], ['doc', 'cy'], ['slides', ''], ['vsec', 'cy']].map(([k, c]) => '<div><div class="q-row"><b>' + QT[k] + '</b><span>' + (+used[k] || 0) + ' / ' + (o.unlimited ? '∞' : (+lim[k] || 0)) + '</span></div>' + uBar(+used[k] || 0, o.unlimited ? Math.max(1, +used[k] || 1) : Math.max(1, +lim[k] || 1), c + ' lg') + '</div>').join('') +
        '<div class="t-sub">' + (o.unlimited ? 'ללא הגבלה' : 'מתאפס ב־' + dateOf(resetOf(o))) + (o.add && o.add.length ? ' · ' + o.add.map((k) => ADD_K[k] || k).join(', ') : '') + '</div>';
    };

    /* a_org: overview bars and the account tab fields */
    if (SCREENS.a_org) {
      const _aor = SCREENS.a_org.render;
      SCREENS.a_org.render = function () {
        let h = _aor.apply(this, arguments);
        const o = orgById(S.orgId); if (!o || !o.live) return h;
        const tab = S.tab.aorg || 'over';
        if (tab === 'over') {
          h = h.replace(/(<h3>מכסות ושימוש החודש<\/h3><\/div><div class="card-pad quota">)[\s\S]*?(<div class="use-chips">)/, '$1' + quotaBars(o) + '$2');
          h = h.replace(/(<div class="use-chips">)<span class="chip">[\s\S]*?סרטונים <b>\d+<\/b><\/span>/, '$1');
        } else if (tab === 'account') {
          const pq = planQuota(S.pendPlan || o.plan), q = o.quotas || {};
          const fld = (k) => '<div class="field"><label>' + QT[k] + (k === 'vsec' ? '' : ' בחודש') + ' <span class="hint">מסלול: ' + (pq[k] !== undefined ? pq[k] : '-') + '</span></label><input type="text" id="eoQ-' + k + '" dir="ltr" style="text-align:right" value="' + (q[k] !== undefined ? q[k] : (pq[k] || 0)) + '"></div>';
          const extra = ['gfx', 'doc', 'slides', 'vsec', 'profiles'].map(fld).join('') +
            '<div class="field"><label>יום החיוב <span class="hint">1 עד 28 · המכסה מתאפסת ביום הזה</span></label><input type="text" id="eoBD" dir="ltr" style="text-align:right" value="' + (o.billing_day || 1) + '"></div>' +
            '<div class="field"><label>סגנון גרפיקות <span class="hint">גיוון: הקומפוזיציה משתנה לפי המסר, המיתוג קבוע · אחיד: שלד קבוע לכל הפוסטים</span></label><div class="seg"><button class="' + (o.variety !== 'uniform' ? 'on' : '') + '" data-act="aoVar:mixed">גיוון</button><button class="' + (o.variety === 'uniform' ? 'on' : '') + '" data-act="aoVar:uniform">אחיד</button></div></div>';
          h = h.replace(/(<div class="field"><label>איש קשר<\/label>)/, extra + '$1');
          const sw = addonDefs().map((p) => '<div class="checkline addon"><span>' + esc(p.name) + ' <span class="t-sub">' + esc(addText(p)) + ' · ' + nis(p.price) + ' + מע״מ לחודש</span></span><button class="sw ' + (o.addons && o.addons[p.id] ? 'on' : '') + '" data-act="aoAddon:' + p.id + '" role="switch" aria-checked="' + !!(o.addons && o.addons[p.id]) + '" aria-label="' + esc(p.name) + '"></button></div>').join('');
          const unl = '<div class="checkline" style="margin-top:10px"><button class="sw ' + (o.unlimited ? 'on' : '') + '" data-act="aoUnl" role="switch" aria-checked="' + !!o.unlimited + '" aria-label="ללא הגבלה"></button><span><b>ללא הגבלה</b><br><span class="t-sub">לארגון בדיקה או להסכם מיוחד. המכסות למעלה לא נאכפות.</span></span></div>';
          h = h.replace('</div><div style="margin-top:20px;display:flex;gap:10px"><button class="btn btn-primary" data-act="aSaveOrg:', '</div><div class="field" style="margin-top:18px"><label>הגדלות חבילה</label><div class="addon-row">' + sw + '</div></div>' + unl + '<div style="margin-top:20px;display:flex;gap:10px"><button class="btn btn-primary" data-act="aSaveOrg:');
        }
        return h;
      };
    }
    ACT.aoAddon = (k) => { const o = orgById(S.orgId); if (!o) return; o.addons = o.addons || {}; o.addons[k] = !o.addons[k]; o._addonsDirty = true; const b = $('[data-act="aoAddon:' + k + '"]'); if (b) { b.classList.toggle('on', !!o.addons[k]); b.setAttribute('aria-checked', String(!!o.addons[k])); } };
    ACT.aoVar = (k) => { const o = orgById(S.orgId); if (!o) return; o.variety = k === 'uniform' ? 'uniform' : 'mixed'; o._varDirty = true; $$('[data-act^="aoVar:"]').forEach((b) => b.classList.toggle('on', b.dataset.act === 'aoVar:' + o.variety)); };
    ACT.aoUnl = () => { const o = orgById(S.orgId); if (!o) return; o.unlimited = !o.unlimited; o._addonsDirty = true; const b = $('[data-act="aoUnl"]'); if (b) { b.classList.toggle('on', !!o.unlimited); b.setAttribute('aria-checked', String(!!o.unlimited)); } };
    const _aSave = ACT.aSaveOrg;
    ACT.aSaveOrg = (id) => {
      const o = orgById(id);
      if (!o || !o.live || L.kind !== 'admin') return _aSave(id);
      const v = (k) => { const e = $('#' + k); return e ? e.value.trim() : null; };
      const n = (x, d) => { const r = parseInt(String(x == null ? '' : x).replace(/[^\d]/g, ''), 10); return isNaN(r) ? d : r; };
      const prevPlan = o.plan;
      const quotas = {};
      ['gfx', 'doc', 'slides', 'vsec', 'profiles'].forEach((k) => { const x = v('eoQ-' + k); if (x !== null) quotas[k] = n(x, (o.quotas || {})[k] || 0); });
      const ul = v('eoUL'), dl = v('eoDL');
      const planNow = S.pendPlan || o.plan;
      quotas.members = planNow === 'solo' ? 1 : Math.max(1, n(ul, o.uLim || 5));
      quotas.depts = planNow === 'solo' ? 0 : Math.max(0, n(dl, o.dLim || 5));
      const bd = Math.max(1, Math.min(28, n(v('eoBD'), o.billing_day || 1)));
      _aSave(id);
      const payload = { org_id: o.live.id, quotas, addons: o.addons || {}, unlimited: !!o.unlimited, billing_day: bd };
      if (o.plan !== prevPlan) payload.plan = o.plan === 'solo' ? 'basic' : 'extended';
      if (o._varDirty) { call('admin.org.update', { org_id: o.live.id, settings: { variety: o.variety || 'mixed' } }).then(() => { o._varDirty = false; }).catch(() => toast('סגנון הגרפיקות לא נשמר', 'נסו שוב בעוד רגע.', 'err')); }
      call('admin.quota.set', payload).then((r) => {
        if (r && r.quota) { o.quota = r.quota; o.addons = r.quota.addons || o.addons; o.unlimited = !!r.quota.unlimited; o.billing_day = (r.quota.period && r.quota.period.day) || bd; const lim = r.quota.limit || {}; if (o.plan !== 'solo') { o.uLim = Math.max(1, +lim.members || o.uLim); o.dLim = +lim.depts || 0; } o.add = Object.keys(o.addons).filter((k) => o.addons[k]); }
        o.quotas = Object.assign({}, o.quotas, quotas);
        o._addonsDirty = false;
        if (S.route === 'a_org') render();
        flush();
      }).catch(() => toast('המכסות לא נשמרו בשרת', 'נסו שוב בעוד רגע.', 'err'));
    };
    // the plan change on the account tab also updates the grey plan hints
    const _aPlan = ACT.aPlan;
    ACT.aPlan = (k) => { _aPlan(k); const o = orgById(S.orgId); if (!o || !o.live) return; const pq = planQuota(k); ['gfx', 'doc', 'slides', 'vsec', 'profiles'].forEach((q) => { const e = $('#eoQ-' + q); if (e) { e.value = pq[q] !== undefined ? pq[q] : 0; const hint = e.closest('.field') && e.closest('.field').querySelector('.hint'); if (hint) hint.textContent = 'מסלול: ' + (pq[q] !== undefined ? pq[q] : '-'); } }); };

    /* a_new: the quota box becomes editable, the add-on switches are the real ones */
    const _nwNew = nwNew;
    nwNew = function () { const w = _nwNew(); w.quotas = Object.assign({}, planQuota('appr')); w.addons = { pack: false, video: false }; return w; };
    const _nwPlan = ACT.nwPlan;
    ACT.nwPlan = (p) => { _nwPlan(p); const w = S.nw; if (!w) return; w.quotas = Object.assign({}, planQuota(p)); w.uLim = w.plan === 'appr' ? (w.quotas.members || 5) : 1; w.dLim = w.plan === 'appr' ? (w.quotas.depts || 5) : 0; render(); };
    if (SCREENS.a_new) {
      const _anr = SCREENS.a_new.render;
      SCREENS.a_new.render = function () {
        let h = _anr.apply(this, arguments);
        const w = S.nw; if (!w || L.kind !== 'admin') return h;
        const cur = NW_STEPS[w.plan][w.step][0];
        if (cur !== 'ch') return h;
        w.quotas = w.quotas || Object.assign({}, planQuota(w.plan));
        const box = '<div class="form-grid" style="margin-top:14px;max-width:720px">' + ['gfx', 'doc', 'slides', 'vsec', 'profiles'].map((k) => '<div class="field"><label>' + QT[k] + (k === 'vsec' ? '' : ' בחודש') + ' <span class="hint">מסלול: ' + (planQuota(w.plan)[k] !== undefined ? planQuota(w.plan)[k] : '-') + '</span></label><input type="text" dir="ltr" style="text-align:right" data-nwq="' + k + '" value="' + (w.quotas[k] !== undefined ? w.quotas[k] : 0) + '"></div>').join('') + '</div>';
        h = h.replace(/<div class="quota-box">[\s\S]*?<\/div><\/div>/, box);
        const sw = '<div class="field" style="margin-top:14px"><label>הגדלות חבילה</label><div class="addon-row">' + addonDefs().map((p) => '<div class="checkline addon"><span>' + esc(p.name) + ' <span class="t-sub">' + esc(addText(p)) + ' · ' + nis(p.price) + ' + מע״מ לחודש</span></span><button class="sw ' + (w.addons[p.id] ? 'on' : '') + '" data-act="nwAdd:' + p.id + '" role="switch" aria-checked="' + !!w.addons[p.id] + '" aria-label="' + esc(p.name) + '"></button></div>').join('') + '</div>';
        h = h.replace(/<div class="field" style="margin-top:14px"><label>תוספות<\/label>[\s\S]*?<\/div><\/div>/, sw);
        return h;
      };
      const _anm = SCREENS.a_new.mount;
      SCREENS.a_new.mount = function () { _anm && _anm.apply(this, arguments); const w = S.nw; if (!w) return; $$('[data-nwq]').forEach((el) => el.addEventListener('input', () => { w.quotas[el.dataset.nwq] = Math.max(0, parseInt(el.value, 10) || 0); })); };
    }
    // after admin.org.create the server is told the typed quotas and the add-ons
    const _nwNext2 = ACT.nwNext;
    ACT.nwNext = () => {
      const w0 = S.nw;
      const cur = w0 && NW_STEPS[w0.plan][w0.step][0];
      const snap = w0 && cur === 'done' ? { quotas: Object.assign({}, w0.quotas || {}), addons: Object.assign({}, w0.addons || {}), uLim: w0.uLim, dLim: w0.dLim, plan: w0.plan } : null;
      const before = ORGS.length;
      _nwNext2();
      if (!snap || ORGS.length <= before || L.kind !== 'admin') return;
      const o = ORGS[ORGS.length - 1];
      o.quotas = snap.quotas; o.addons = snap.addons; o.add = Object.keys(snap.addons).filter((k) => snap.addons[k]);
      const quotas = Object.assign({}, snap.quotas, { members: snap.plan === 'solo' ? 1 : Math.max(1, +snap.uLim || 5), depts: snap.plan === 'solo' ? 0 : Math.max(0, +snap.dLim || 0) });
      const send = () => {
        if (!o.live || !o.live.id) { setTimeout(send, 800); return; }
        call('admin.quota.set', { org_id: o.live.id, quotas, addons: snap.addons }).then((r) => { if (r && r.quota) { o.quota = r.quota; o.unlimited = !!r.quota.unlimited; } if (S.route === 'a_org') render(); }).catch(() => {});
      };
      setTimeout(send, 1200);
    };

    /* a_reqs: add-on requests from clients are approved by switching the add-on on */
    if (SCREENS.a_reqs) {
      const _arr = SCREENS.a_reqs.render;
      SCREENS.a_reqs.render = function () {
        let h = _arr.apply(this, arguments);
        REQS.filter((r) => ADD_K[r.type]).forEach((r) => {
          const def = planDef(r.type);
          const grid = '<div class="rq-grid"><div><span class="t-sub">סוג הבקשה</span><b>' + ADD_K[r.type] + '</b></div><div><span class="t-sub">מוסיף</span><b>' + esc(def ? addText(def) : '') + '</b></div><div><span class="t-sub">מחיר לחודש</span><b class="pos">' + (def ? nis(def.price) + ' + מע״מ' : '-') + '</b></div><div><span class="t-sub">נוצל החודש</span><b>' + esc(r.note2 || '') + '</b></div></div>';
          // replace the users/depts grid of this card: find the card by its approve button
          const i = h.indexOf('data-act="reqOk:' + r.id + '"'); if (i < 0) return;
          const cardStart = h.lastIndexOf('<div class="card req-card">', i);
          const gs = h.indexOf('<div class="rq-grid">', cardStart), ge = h.indexOf('</div></div>', gs) + 12;
          if (gs > cardStart && ge > gs) h = h.slice(0, gs) + grid + h.slice(ge);
        });
        return h;
      };
    }
    const _reqOk = ACT.reqOk;
    ACT.reqOk = (id) => {
      const r = REQS.find((x) => x.id === id);
      if (!r || !ADD_K[r.type]) return _reqOk(id);
      const o = orgById(r.org), def = planDef(r.type);
      if (!o || !o.live) return _reqOk(id);
      confirmModal({ title: 'לאשר את ' + ADD_K[r.type] + '?', body: esc(o.n) + ': ' + (def ? addText(def) + ' · ' + nis(def.price) + ' + מע״מ לחודש' : '') + '. המכסה גדלה מיד והתוספת נרשמת ברכישות.', ok: 'אישור', tone: 'ok', icon: 'checkc',
        onOk: () => {
          const addons = Object.assign({}, o.addons || {}); addons[r.type] = true;
          call('admin.quota.set', { org_id: o.live.id, addons }).then((res) => {
            r.st = 'approved'; o.addons = addons; o.add = Object.keys(addons).filter((k) => addons[k]); if (res && res.quota) o.quota = res.quota;
            PURCH.unshift({ id: Date.now(), org: o.id, date: new Date().toISOString().slice(0, 10), type: 'user', plan: o.plan, note: ADD_K[r.type] + (def ? ': ' + addText(def) : ''), cost: def ? +def.price : 0, price: def ? +def.price : null });
            toast('המנוי הורחב', o.n + ' · ' + ADD_K[r.type] + ' פעילה.'); render(); flush();
          }).catch(() => toast('האישור לא נשמר', 'נסו שוב בעוד רגע.', 'err'));
        } });
    };

    /* a_settings money tab + revenue: the real plan prices and add-ons */
    const _moneySave = ACT.moneySave;
    ACT.moneySave = () => {
      const v = (id) => { const e = $('#' + id); return e ? e.value.trim() : null; };
      const n = (x, d) => { const r = parseFloat(String(x == null ? '' : x).replace(/[^\d.]/g, '')); return isNaN(r) ? d : r; };
      const before = { appr: PLANS.appr && PLANS.appr.cost, solo: PLANS.solo && PLANS.solo.cost, packs: (typeof PACKS !== 'undefined' ? PACKS : []).map((p) => ({ k: p.k, n: p.n, price: p.price })) };
      _moneySave();
      if (L.kind !== 'admin') return;
      const jobs = [];
      if (PLANS.appr && PLANS.appr.cost !== before.appr) jobs.push({ id: 'extended', price: PLANS.appr.cost });
      if (PLANS.solo && PLANS.solo.cost !== before.solo) jobs.push({ id: 'basic', price: PLANS.solo.cost });
      (typeof PACKS !== 'undefined' ? PACKS : []).forEach((p) => { const b = before.packs.find((x) => x.k === p.k); if (!planDef(p.k)) return; if (!b || b.n !== p.n || b.price !== p.price) jobs.push({ id: p.k, name: p.n, price: p.price == null ? 0 : p.price }); });
      Promise.all(jobs.map((j) => call('admin.plan.save', j))).then((rs) => { const last = rs[rs.length - 1]; if (last && last.plans) applyPlans(last.plans); }).catch(() => toast('המחירים לא נשמרו בשרת', 'נסו שוב בעוד רגע.', 'err'));
    };
    if (SCREENS.a_settings) {
      const _asr = SCREENS.a_settings.render;
      SCREENS.a_settings.render = function () {
        let h = _asr.apply(this, arguments);
        if (S.asTab !== 'money') return h;
        h = h.replace(/<div class="note">[^<]*<span>המחירים ייקבעו אחרי בדיקת עלויות היצירה[\s\S]*?<\/span><\/div>/, '<div class="note">' + ic('help', 14) + '<span>הכמויות של כל הגדלה נקבעות במסלולים (שדה הכמויות כאן הוא לתצוגה אצל הלקוח). המחיר לחודש, לפני מע״מ.</span></div>');
        return h;
      };
    }
    if (SCREENS.a_revenue) {
      const _arv = SCREENS.a_revenue.render;
      SCREENS.a_revenue.render = function () {
        let h = _arv.apply(this, arguments);
        const sum = ORGS.filter((o) => o.st !== 'paused' && o.st !== 'trial').reduce((s, o) => s + (o.add || []).reduce((a, k) => { const d = planDef(k); return a + (d ? +d.price : 0); }, 0), 0);
        const cnt = ORGS.reduce((s, o) => s + (o.add || []).length, 0);
        h = h.replace(/(<b>חבילות הרחבה<\/b><span class="t-sub">)[\s\S]*?(<\/span><\/span><b class="ps-sum">)[^<]*(<\/b>)/, '$1' + addonDefs().map((p) => esc(p.name) + ' · ' + nis(p.price)).join(' · ') + (cnt ? ' · ' + cnt + ' פעילות' : '') + '$2' + usd(sum) + '$3');
        return h;
      };
    }
    // dashboard: the graphics column against each client's own quota
    if (SCREENS.a_dash) {
      const _adr = SCREENS.a_dash.render;
      SCREENS.a_dash.render = function () {
        let h = _adr.apply(this, arguments);
        ORGS.forEach((o) => {
          if (!o.live) return;
          const lim = limOf(o).gfx || QUOTA.gfx;
          const re = new RegExp('(<tr data-act="aOrg:' + o.id + '">[\\s\\S]*?<td data-l="גרפיקות"><div class="uwrap">)[\\s\\S]*?(<\\/div><\\/td>)');
          h = h.replace(re, '$1' + uBar(o.gfx, o.unlimited ? Math.max(1, o.gfx) : Math.max(1, lim)) + '<span>' + o.gfx + '/' + (o.unlimited ? '∞' : lim) + '</span>$2');
        });
        return h;
      };
    }

    /* ---- client: the plan card, add-on requests, limits and the full-quota message ---- */
    const Q = () => (L.kind === 'client' && L.quota) || null;
    const refreshQuota = (() => { let t = 0; return () => { clearTimeout(t); t = setTimeout(() => call('quota.state').then((r) => { if (r && r.quota) { L.quota = r.quota; if (S.route === 'settings') render(); } }).catch(() => {}), 1500); }; })();
    L.refreshQuota = refreshQuota;
    const kindOfErr = (e) => e && e.message === 'quota' && e.detail && e.detail.kind;
    function quotaToast(e) {
      const d = e.detail || {}; const k = d.kind || 'gfx';
      quotaAt = Date.now();
      _toast('מכסת ה' + QT[k] + ' של החודש נוצלה', (d.used != null ? d.used + ' מתוך ' + d.limit + '. ' : '') + 'מתאפס ב־' + dateOf(d.reset) + '. אפשר לבקש הגדלת חבילה בהגדרות ← מסלול.', 'err');
      refreshQuota();
    }
    // the generic "ה-AI לא הצליח" that follows a quota refusal is dropped: the quota message already said why
    let quotaAt = 0;
    const _toast = toast;
    toast = function (t) { if (t === 'ה-AI לא הצליח להשלים' && Date.now() - quotaAt < 3000) return; return _toast.apply(this, arguments); };
    const _produce = produce;
    produce = async function (jobs, dept) {
      try { const r = await _produce(jobs, dept); refreshQuota(); return r; }
      catch (e) { if (kindOfErr(e)) { quotaToast(e); quotaAt = Date.now(); } throw e; }
    };

    // the plan card in the client's settings
    const _planBox = planBox;
    planBox = function () {
      const q = Q(); if (!q) return _planBox();
      const o = myOrg(); const lim = q.limit || {}, used = q.used || {};
      const meter = (k) => '<div><span class="t-sub">' + QT[k] + '</span><b>' + (+used[k] || 0) + ' / ' + (q.unlimited ? '∞' : (+lim[k] || 0)) + '</b></div>';
      const cnt = L.members ? L.members.length : users.length;
      const addRows = addonDefs().map((p) => '<div class="rowi"><span class="ic-box ' + (q.addons && q.addons[p.id] ? 'ok' : 'info') + '">' + ic('limit', 17) + '</span><span class="grow"><span class="nm">' + esc(p.name) + (q.addons && q.addons[p.id] ? ' <span class="chip">פעילה</span>' : '') + '</span><br><span class="mt">' + esc(addText(p)) + ' · ' + nis(p.price) + ' + מע״מ לחודש</span></span>' + (q.addons && q.addons[p.id] ? '' : (myReq(p.id) ? '<span class="chip warn-chip">' + ic('clock', 13) + ' ממתינה לאישור</span>' : '<button class="btn btn-sm" data-act="limitAdd:' + p.id + '">בקשת הגדלה</button>')) + '</div>').join('');
      return '<div class="card card-pad plan-box" style="max-width:820px;margin-top:16px"><div><span class="t-sub">המנוי שלכם</span><b>' + PLANS[o.plan].t + '</b></div>' +
        (o.plan === 'appr' ? '<div><span class="t-sub">משתמשים</span><b>' + cnt + ' / ' + (+lim.members || o.uLim) + '</b></div><div><span class="t-sub">מחלקות</span><b>' + DEPTS.length + ' / ' + (+lim.depts || 0) + '</b></div>' : '<div><span class="t-sub">משתמשים</span><b>1 / 1</b></div>') +
        QK.map(meter).join('') +
        '<div><span class="t-sub">' + (q.unlimited ? 'מכסות' : 'מתאפס') + '</span><b>' + (q.unlimited ? 'ללא הגבלה' : dateOf(q.period && q.period.to)) + '</b></div>' +
        '<button class="btn btn-sm" data-act="agrView:' + o.id + '">' + ic('doc', 15) + ' צפייה בהסכם המנוי</button></div>' +
        '<div class="card" style="max-width:820px;margin-top:16px"><div class="card-head">' + ic('limit', 18) + '<h3>הגדלות חבילה</h3></div><div class="row-list">' + addRows + '</div></div>';
    };
    // request an add-on: same request path as users/depts (inbox to the console)
    ACT.limitAdd = (k) => {
      const def = planDef(k); if (!def) return;
      if (myReq(k)) { openModal('<div class="mb"><div class="m-ic warn">' + ic('clock', 20) + '</div><h3>הבקשה כבר נשלחה</h3><p>בקשת ' + ADD_K[k] + ' מחכה לאישור מנהל המערכת של PrimeOS.</p></div><div class="modal-foot"><button class="btn btn-primary" data-act="closeModal">הבנתי</button></div>'); return; }
      const q = Q() || {}; const used = q.used || {}, lim = q.limit || {};
      openModal('<div class="mb"><div class="m-ic info">' + ic('limit', 20) + '</div><h3>' + ADD_K[k] + '</h3>' +
        '<p>' + esc(addText(def)) + ' · <b>' + nis(def.price) + ' + מע״מ לחודש</b>, עד שמבטלים. הבקשה תגיע למנהל המערכת של PrimeOS לאישור, והמכסה גדלה מיד עם האישור.</p>' +
        '<div class="lim-meter"><div class="lm-bar"><span style="width:' + Math.min(100, Math.round((+used.gfx || 0) / Math.max(1, +lim.gfx || 1) * 100)) + '%"></span></div><span><b>' + (+used.gfx || 0) + '</b> מתוך ' + (+lim.gfx || 0) + ' גרפיקות החודש</span></div>' +
        '<div class="form-grid" style="margin-top:14px"><div class="field full"><label for="rqNote">הערה למנהל המערכת <span class="hint">לא חובה</span></label><textarea id="rqNote" rows="2"></textarea></div></div></div>' +
        '<div class="modal-foot"><button class="btn btn-primary" data-act="sendReq:' + k + '">' + ic('send', 16) + ' שליחת בקשה</button><button class="btn" data-act="closeModal">ביטול</button></div>');
    };
    const _sendReq = ACT.sendReq;
    ACT.sendReq = (type) => {
      if (!ADD_K[type]) return _sendReq(type);
      const o = myOrg(); const q = Q() || {}; const used = q.used || {}, lim = q.limit || {};
      REQS.unshift({ id: 'r' + (REQS.length + 1) + Date.now() % 1000, org: o.id, type, cur: +used.gfx || 0, lim: +lim.gfx || 0, add: 1, note: ($('#rqNote') && $('#rqNote').value.trim()) || '', note2: QK.map((k) => QT[k] + ' ' + (+used[k] || 0) + '/' + (+lim[k] || 0)).join(' · '), who: MAIN_APPR.n, ph: MAIN_APPR.ph, mail: MAIN_APPR.mail, date: new Date().toISOString().slice(0, 10), time: new Date().toTimeString().slice(0, 5), st: 'new' });
      closeModal(); toast('הבקשה נשלחה', 'מנהל המערכת של PrimeOS קיבל התראה עם פרטי המנוי ופרטי הקשר שלכם.'); render();
    };
    // limits that the console set for this client: departments and users
    const _deptNew = ACT.deptNew;
    ACT.deptNew = () => {
      const q = Q();
      if (q && !q.unlimited && DEPTS.length >= (+(q.limit || {}).depts || 0)) { const o = myOrg(); o.dLim = +(q.limit || {}).depts || 0; limitModal('depts'); return; }
      return _deptNew();
    };
    const _inviteQ = ACT.inviteUser;
    ACT.inviteUser = () => {
      const q = Q();
      if (q && !q.unlimited && L.members && L.members.length >= (+(q.limit || {}).members || 1) && L.org && L.org.plan !== 'basic') { const o = myOrg(); o.uLim = +(q.limit || {}).members || 1; limitModal('users'); return; }
      return _inviteQ();
    };
    // the client's own org object carries the live limits, so the existing meters show the right numbers
    const _myOrg = myOrg;
    myOrg = function () { const o = _myOrg(); const q = Q(); if (o && q && q.limit) { if (q.limit.members !== undefined) o.uLim = L.org && L.org.plan === 'basic' ? 1 : Math.max(1, +q.limit.members || 1); if (q.limit.depts !== undefined) o.dLim = L.org && L.org.plan === 'basic' ? 0 : +q.limit.depts || 0; o.plan = L.org && L.org.plan === 'basic' ? 'solo' : 'appr'; } return o; };
    // the create wizard: a one-line notice from 85% of the monthly quota
    const wizKind = () => { const t = S.wiz && S.wiz.type; return t === 'doc' ? 'doc' : t === 'deck' ? 'slides' : t === 'video' ? 'vsec' : 'gfx'; };
    const notice = (k) => {
      const q = Q(); if (!q || q.unlimited) return '';
      const used = +(q.used || {})[k] || 0, lim = +(q.limit || {})[k] || 0; if (!lim) return '';
      if (used >= lim) return '<div class="note ai-warn">' + ic('limit', 15) + '<span>מכסת ה' + QT[k] + ' של החודש נוצלה (' + used + ' מתוך ' + lim + '). מתאפס ב־' + dateOf(q.period && q.period.to) + '. אפשר לבקש הגדלת חבילה בהגדרות ← מסלול.</span></div>';
      if (used / lim >= 0.85) return '<div class="note ai-warn">' + ic('limit', 15) + '<span>נשארו ' + (lim - used) + ' ' + QT[k] + ' החודש.</span></div>';
      return '';
    };
    const wrapWiz = (name, k) => { if (!SCREENS[name]) return; const _r = SCREENS[name].render; SCREENS[name].render = function () { const h = _r.apply(this, arguments); if (typeof h !== 'string') return h; const n = notice(typeof k === 'function' ? k() : k); if (!n) return h; const i = h.indexOf('<div class="card'); return i > 0 ? h.slice(0, i) + n + h.slice(i) : h + n; }; };
    wrapWiz('wizard', wizKind); wrapWiz('docWiz', 'doc'); wrapWiz('deckWiz', 'slides'); wrapWiz('vidWiz', 'vsec');
  })();

  /* ---------------- connected profiles: the subscription allows so many social accounts ----------------
     The server counts the organisation's connected accounts (ch.list -> profiles {used, limit}) and refuses a new
     connection past the limit; accounts beyond it are connected but not published to. Here: the meter on the
     channels screen, the request for more (50 ₪ a profile, a month), and the console's approval of that request. */
  (function () {
    const PROFILE_PRICE = 50, DEPT_PRICE = 300;
    const K = { users: 'משתמשים', depts: 'מחלקות', profiles: 'פרופילים מחוברים' };
    const QKEY = { users: 'members', depts: 'depts', profiles: 'profiles' };
    const PF = () => (L.pub && L.pub.profiles) || null;
    const pfFull = () => { const p = PF(); return !!(p && p.limit != null && !p.unlimited && p.used >= p.limit); };
    // ch.list carries the count; a quota refusal from ch.connect opens the request instead of a generic error
    const _post1 = post;
    post = async function (url, body, ms) {
      const action = body && body.action;
      try {
        const r = await _post1(url, body, ms);
        if (action === 'ch.list' && r && r.profiles) { L.pub = L.pub || {}; L.pub.profiles = r.profiles; }
        return r;
      } catch (e) {
        if (action === 'ch.connect' && e && e.message === 'quota' && e.detail && e.detail.kind === 'profiles') { L.pub = L.pub || {}; L.pub.profiles = { used: e.detail.used, limit: e.detail.limit }; setTimeout(() => profilesModal(), 50); e.handled = true; }
        throw e;
      }
    };
    function profilesModal() {
      const p = PF() || { used: 0, limit: 0 }, pend = typeof myReq === 'function' && myReq('profiles');
      if (pend) { openModal('<div class="mb"><div class="m-ic warn">' + ic('clock', 20) + '</div><h3>הבקשה כבר נשלחה</h3><p>בקשה להרחבת כמות הפרופילים המחוברים נשלחה ב־' + fmtDM(pend.date) + ' ומחכה לאישור מנהל המערכת של PrimeOS.</p></div><div class="modal-foot"><button class="btn btn-primary" data-act="closeModal">הבנתי</button></div>'); return; }
      openModal('<div class="mb"><div class="m-ic bad">' + ic('limit', 20) + '</div><h3>חריגה מכמות הפרופילים במנוי</h3>' +
        '<p>המנוי שלכם כולל <b>' + p.limit + ' פרופילים מחוברים</b>, וכולם כבר בשימוש. כל פרופיל נוסף: <b>' + PROFILE_PRICE + ' ₪ + מע״מ לחודש</b>. הבקשה תגיע למנהל המערכת של PrimeOS לאישור, והחיבור ייפתח מיד עם האישור.</p>' +
        '<div class="lim-meter"><div class="lm-bar"><span style="width:100%"></span></div><span><b>' + p.used + '</b> מתוך ' + p.limit + ' בשימוש</span></div>' +
        '<div class="form-grid" style="margin-top:14px"><div class="field"><label for="rqAdd">כמה פרופילים להוסיף</label><select id="rqAdd">' + [1, 2, 3, 5].map((n) => '<option>' + n + '</option>').join('') + '</select></div>' +
        '<div class="field full"><label for="rqNote">הערה למנהל המערכת <span class="hint">לא חובה</span></label><textarea id="rqNote" rows="2" placeholder="לדוגמה: חיבור עמוד הפייסבוק של מחלקת התרבות"></textarea></div></div></div>' +
        '<div class="modal-foot"><button class="btn btn-primary" data-act="sendReq:profiles">' + ic('send', 16) + ' שליחת בקשה</button><button class="btn" data-act="closeModal">ביטול</button></div>');
    }
    const _sendReq = ACT.sendReq;
    ACT.sendReq = (type) => {
      if (type !== 'profiles') return _sendReq(type);
      const o = myOrg(), p = PF() || { used: 0, limit: 0 };
      REQS.unshift({ id: 'r' + (REQS.length + 1) + Date.now() % 1000, org: o.id, type, cur: p.used, lim: p.limit, add: +($('#rqAdd') ? $('#rqAdd').value : 1), note: ($('#rqNote') && $('#rqNote').value.trim()) || '', who: MAIN_APPR.n, ph: MAIN_APPR.ph, mail: MAIN_APPR.mail, date: new Date().toISOString().slice(0, 10), time: new Date().toTimeString().slice(0, 5), st: 'new' });
      closeModal(); toast('הבקשה נשלחה', 'מנהל המערכת של PrimeOS קיבל התראה עם פרטי המנוי ופרטי הקשר שלכם.'); render();
    };
    // a full quota: the connect buttons open the request instead of the provider window
    const _chGo = ACT.chGo;
    ACT.chGo = function (k) {
      if (L.pub && L.pub.on !== false && pfFull()) { const after = () => profilesModal(); if ($('#modal').classList.contains('hidden')) after(); else { closeModal(); setTimeout(after, 230); } return; }
      return _chGo.apply(this, arguments);
    };
    if (SCREENS.channels) {
      const _cr = SCREENS.channels.render;
      SCREENS.channels.render = function () {
        let h = _cr.apply(this, arguments);
        const p = PF(); if (!p || L.pub.on === false) return h;
        const lim = p.unlimited || p.limit == null ? '∞' : p.limit, pct = p.unlimited || !p.limit ? 0 : Math.min(100, Math.round(p.used / p.limit * 100));
        const meter = '<div class="lim-meter" style="margin:0 0 14px"><div class="lm-bar"><span style="width:' + pct + '%"></span></div><span><b>' + p.used + '</b> מתוך ' + lim + ' פרופילים מחוברים במנוי' + (pfFull() ? ' · <button class="btn btn-sm" data-act="profilesMore">בקשת הרחבה</button>' : '') + '</span></div>';
        h = h.replace('<div class="ch-list">', meter + '<div class="ch-list">');
        // an account beyond the quota is connected but not published to
        (L.pub.acc || []).filter((a) => a.over && a.name).forEach((a) => {
          const i = h.indexOf('<span class="t-sub">' + esc(a.name) + '</span>'); if (i < 0) return;
          const j = h.indexOf('<i></i>מחובר</span>', i); if (j < 0 || j - i > 400) return;
          h = h.slice(0, j) + '<i></i>מעבר למכסה</span>' + h.slice(j + '<i></i>מחובר</span>'.length);
        });
        return h;
      };
    }
    ACT.profilesMore = () => profilesModal();
    // the console: the request card and its approval raise the client's quota on the server
    if (SCREENS.a_reqs) {
      const _ar = SCREENS.a_reqs.render;
      SCREENS.a_reqs.render = function () {
        let h = _ar.apply(this, arguments);
        REQS.filter((r) => r.type === 'profiles').forEach((r) => {
          const grid = '<div class="rq-grid"><div><span class="t-sub">סוג הבקשה</span><b>הרחבת פרופילים מחוברים</b></div><div><span class="t-sub">מצב נוכחי</span><b>' + r.cur + ' מתוך ' + r.lim + '</b></div><div><span class="t-sub">מבוקש</span><b class="pos">' + r.add + ' · ' + nis(r.add * PROFILE_PRICE) + ' + מע״מ לחודש</b></div><div><span class="t-sub">אחרי אישור</span><b>' + (r.lim + r.add) + '</b></div></div>';
          const i = h.indexOf('data-act="reqOk:' + r.id + '"'); if (i < 0) return;
          const cardStart = h.lastIndexOf('<div class="card req-card">', i);
          const gs = h.indexOf('<div class="rq-grid">', cardStart), ge = h.indexOf('</div></div>', gs) + 12;
          if (gs > cardStart && ge > gs) h = h.slice(0, gs) + grid + h.slice(ge);
        });
        return h;
      };
    }
    const _reqOk = ACT.reqOk;
    ACT.reqOk = (id) => {
      const r = REQS.find((x) => x.id === id);
      if (!r || !K[r.type]) return _reqOk(id);
      const o = orgById(r.org);
      if (!o || !o.live) return _reqOk(id);
      const key = QKEY[r.type], cur = +((o.quotas || {})[key] || r.lim || 0), next = cur + r.add;
      const price = r.type === 'profiles' ? r.add * PROFILE_PRICE : r.type === 'depts' ? r.add * DEPT_PRICE : 0;
      confirmModal({ title: 'לאשר את ההרחבה?', body: esc(o.n) + ': מכסת ה' + K[r.type] + ' תעלה מ־' + cur + ' ל־' + next + (price ? ' · ' + nis(price) + ' + מע״מ לחודש' : '') + '. המכסה גדלה מיד והשינוי נרשם ברכישות.', ok: 'אישור', tone: 'ok', icon: 'checkc',
        onOk: () => {
          const quotas = {}; quotas[key] = next;
          call('admin.quota.set', { org_id: o.live.id, quotas }).then((res) => {
            r.st = 'approved'; o.quotas = Object.assign({}, o.quotas || {}, quotas); if (res && res.quota) { o.quota = res.quota; if (key === 'members') o.uLim = next; if (key === 'depts') o.dLim = next; }
            PURCH.unshift({ id: Date.now(), org: o.id, date: new Date().toISOString().slice(0, 10), type: 'user', plan: o.plan, note: 'הרחבה: עוד ' + r.add + ' ' + K[r.type], cost: price, price: price || null });
            toast('המנוי הורחב', o.n + ' · ' + K[r.type] + ': ' + next + '.'); render(); flush();
          }).catch(() => toast('האישור לא נשמר', 'נסו שוב בעוד רגע.', 'err'));
        } });
    };
  })();

  /* ---------------- incidents: what the monitor found, one "fix" per kind, and the security-event log ----------------
     Only the console (admin_users). Same parts as the rest of the console: request cards, row lists, stat tiles. */
  (function () {
    const KN = { site: 'האתר', api: 'השרת ובסיס הנתונים', jobs: 'עבודות שנכשלו', stuck: 'עבודות תקועות', wa: 'שליחות WhatsApp', storage: 'אחסון', backup: 'גיבוי', tenant: 'הפרדה בין לקוחות', security: 'אבטחה' };
    const SEV = { crit: ['s-rejected', 'קריטי'], high: ['s-fix', 'גבוה'], mid: ['s-pending', 'בינוני'], sec: ['s-scheduled', 'אבטחה'], ok: ['s-approved', 'תקין'] };
    const STT = { open: ['s-rejected', 'פתוחה'], fixed: ['s-approved', 'תוקנה'], resolved: ['s-approved', 'טופלה'], muted: ['s-archived', 'מושתקת'] };
    const SEC_T = { unauthorized: 'גישה לא מורשית', leak: 'דליפת מידע', integrity: 'אובדן או שינוי מידע', blocked: 'ניסיון פריצה שנחסם', other: 'אחר' };
    const SEC_A = { none: 'אף אחד', one: 'לקוח אחד', some: 'כמה לקוחות', all: 'כל הלקוחות' };
    const INC = { open: [], history: [], health: null, at: 0, busy: {}, tab: 'open', kind: '', loading: false };
    const sevBadge = (s) => { const x = SEV[s] || SEV.mid; return '<span class="badge ' + x[0] + '">' + x[1] + '</span>'; };
    const stBadge = (s) => { const x = STT[s] || STT.open; return '<span class="badge ' + x[0] + '">' + x[1] + '</span>'; };
    const dt = (iso) => { if (!iso) return ''; const t = new Date(iso); return t.getDate() + '.' + (t.getMonth() + 1) + ' ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0'); };
    const ago = (iso) => { if (!iso) return 'עדיין לא'; const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 1 ? 'עכשיו' : m < 60 ? 'לפני ' + m + ' דק׳' : m < 1440 ? 'לפני ' + Math.round(m / 60) + ' שע׳' : 'לפני ' + Math.round(m / 1440) + ' ימים'; };
    const dur = (a, b) => { if (!a || !b) return '-'; const m = Math.round((new Date(b) - new Date(a)) / 60000); return m < 60 ? m + ' דק׳' : m < 1440 ? Math.round(m / 60) + ' שע׳' : Math.round(m / 1440) + ' ימים'; };
    const lastLog = (i) => { const l = (i.fix_log || []).slice(-1)[0]; return l ? l.text : '-'; };
    const mb = (n) => (n == null ? '-' : (n / 1048576).toFixed(0) + 'MB');

    async function load(quiet) {
      if (INC.loading) return;
      INC.loading = true; if (!quiet) render();
      try { const r = await call('admin.incidents.load', {}); INC.open = r.open || []; INC.history = r.history || []; INC.health = r.health || null; INC.at = Date.now(); }
      catch (e) { toast('לא הצלחתי לטעון את התקלות', 'נסו שוב בעוד רגע.', 'err'); }
      INC.loading = false; if (S.route === 'a_incidents') render(); buildNav();
    }

    SCREENS.a_incidents = {
      nav: { t: 'תקלות', i: 'alert', count: () => INC.open.length },
      render() {
        const h = INC.health || {}, res = h.res || {};
        const month = Date.now() - 30 * 86400000;
        const all = [...INC.open, ...INC.history];
        const crit = INC.open.filter((i) => i.severity === 'crit').length, high = INC.open.filter((i) => i.severity === 'high').length, mid = INC.open.length - crit - high;
        const auto = INC.history.filter((i) => i.state === 'fixed' && new Date(i.opened_at).getTime() > month).length;
        const hist = h.history || []; const up = hist.length ? Math.round(hist.filter((x) => x.ok).length / hist.length * 1000) / 10 : null;
        const checks = Object.keys(res).length;
        const list = INC.tab === 'open' ? INC.open : INC.tab === 'done' ? INC.history : all;
        const shown = list.filter((i) => !INC.kind || i.kind === INC.kind);
        const strip = [
          ...Object.entries(res).map(([k, c]) => ({ k, ok: !!c.ok, s: (c.ms ? c.ms + 'ms' : '') + (c.note ? (c.ms ? ' · ' : '') + c.note : '') })),
          { k: 'backup', ok: !!h.backup && !Object.values(h.backup.tables || {}).some((n) => n < 0), s: h.backup ? 'אחרון: ' + dt(h.backup.at) : 'עדיין לא רץ' },
          { k: 'tenant', ok: !h.tenant || !!h.tenant.ok, s: h.tenant ? (h.tenant.ok ? 'בדיקה יומית: תקין' : 'נכשלה ' + dt(h.tenant.at)) : 'עדיין לא רץ' },
          { k: 'storage', ok: true, s: 'קבצים: ' + mb(h.storage_bytes) },
        ];
        return pageHead({ title: 'תקלות', actions: '<button class="btn" data-act="incSec">' + ic('shield', 16) + ' דיווח אירוע אבטחה</button><button class="btn btn-primary" data-act="incRun"' + (INC.busy.run ? ' disabled' : '') + '>' + ic('refresh', 16) + (INC.busy.run ? ' בודק...' : ' הרץ בדיקה עכשיו') + '</button>' }) +
          '<p class="t-sub" style="margin:-8px 0 16px">מה המוניטור מצא, מה נעשה ומה דורש טיפול. כל אירוע נשמר 30 יום ומשמש גם כיומן אירועי אבטחה.</p>' +
          '<div class="grid g-4" style="margin-bottom:16px">' +
            stat({ l: 'תקלות פתוחות', n: INC.open.length, s: crit + ' קריטיות · ' + high + ' גבוהות · ' + mid + ' בינוניות', i: 'alert', nav: 'a_incidents', f: INC.open.length ? 'rejected' : 'approved' }) +
            stat({ l: 'תוקנו אוטומטית, 30 יום', n: auto, s: 'מתוך ' + INC.history.length + ' תקלות שנסגרו', i: 'refresh', nav: 'a_incidents', f: 'pending' }) +
            stat({ l: 'זמינות 24 שעות', n: up == null ? '-' : up + '%', s: hist.length + ' בדיקות', i: 'pulse', nav: 'a_incidents', f: 'published' }) +
            stat({ l: 'בדיקה אחרונה', n: ago(h.at), s: 'כל 5 דקות · ' + checks + ' בדיקות', i: 'clock', nav: 'a_incidents', f: 'draft' }) +
          '</div>' +
          '<div class="card" style="margin-bottom:16px"><div class="card-head">' + ic('pulse', 18) + '<h3>מצב המערכת עכשיו</h3><span class="chip" style="margin-inline-start:auto">' + (INC.loading ? 'טוען...' : 'עודכן ' + ago(h.at)) + '</span></div>' +
            '<div class="row-list">' + strip.map((x) => '<div class="rowi"><span class="ic-box ' + (x.ok ? 'ok' : 'bad') + '">' + ic(x.ok ? 'checkc' : 'alert', 17) + '</span><span class="grow"><span class="nm">' + esc(KN[x.k] || x.k) + '</span><br><span class="mt">' + esc(x.s || (x.ok ? 'תקין' : 'לא עונה')) + '</span></span>' + (x.ok ? '<span class="badge s-approved">תקין</span>' : '<span class="badge s-rejected">תקלה</span>') + '</div>').join('') + '</div></div>' +
          '<div class="filters"><div class="seg">' + [['open', 'פתוחות (' + INC.open.length + ')'], ['done', 'טופלו'], ['all', 'הכל, 30 יום']].map((t) => '<button class="' + (INC.tab === t[0] ? 'on' : '') + '" data-act="incTab:' + t[0] + '">' + t[1] + '</button>').join('') + '</div>' +
            '<select id="incKind"><option value="">כל הרכיבים</option>' + Object.entries(KN).map(([k, v]) => '<option value="' + k + '"' + (INC.kind === k ? ' selected' : '') + '>' + v + '</option>').join('') + '</select></div>' +
          (INC.tab === 'open' ? (shown.length ? '<div class="req-list">' + shown.map(card).join('') + '</div>' : emptyState({ i: 'checkc', t: 'אין תקלות פתוחות', d: 'המוניטור בודק כל 5 דקות. תקלה חדשה תופיע כאן ותישלח גם במייל.' })) : table(shown)) +
          '<div class="note" style="margin-top:16px">' + ic('lock', 15) + '<span>רק משתמשי admin_users רואים את המסך. כל "תקן" נרשם ביומן הניהול עם מי לחץ ומתי.</span></div>';
      },
      mount() { const s = $('#incKind'); if (s) s.onchange = () => { INC.kind = s.value; render(); }; if (!INC.at || Date.now() - INC.at > 60000) load(true); },
    };
    function card(i) {
      const d = i.detail || {}, log = i.fix_log || [], b = INC.busy[i.id];
      const sec = i.kind === 'security';
      return '<div class="card req-card" id="inc' + i.id + '"><div class="rq-top"><span class="ic-box ' + (i.severity === 'crit' ? 'bad' : i.severity === 'sec' ? 'info' : 'warn') + '" style="width:44px;height:44px;border-radius:12px;display:grid;place-items:center">' + ic(sec ? 'shield' : 'alert', 20) + '</span><div class="grow"><b class="rq-org">' + esc(i.title) + '</b><div class="oh-meta">' + sevBadge(i.severity) + stBadge(i.state) + '<span class="chip">' + esc(KN[i.kind] || i.kind) + '</span><span class="chip">#' + i.id + '</span></div></div><span class="t-sub">התחיל ' + dt(i.opened_at) + ' · ' + ago(i.opened_at) + '</span></div>' +
        '<div class="rq-grid">' + (sec
          ? '<div><span class="t-sub">סוג</span><b>' + esc(SEC_T[d.type] || d.type || '-') + '</b></div><div><span class="t-sub">לקוחות שנפגעו</span><b>' + esc(SEC_A[d.affected] || d.affected || '-') + '</b></div><div><span class="t-sub">אירוע חמור</span><b>' + (d.severe ? 'כן, דיווח לרשות' : 'לא') + '</b></div><div><span class="t-sub">הודעה ללקוח עד</span><b>' + dt(d.clock24h) + '</b></div>'
          : '<div><span class="t-sub">מה נבדק</span><b>' + esc(d.checked || '-') + '</b></div><div><span class="t-sub">ממצא</span><b>' + esc(d.note || '-') + '</b></div><div><span class="t-sub">סיבה משוערת</span><b>' + esc(d.cause || '-') + '</b></div><div><span class="t-sub">מה "תקן" יעשה</span><b>' + esc(d.fix || 'אין תיקון אוטומטי') + '</b></div>') + '</div>' +
        (sec && d.note ? '<div class="rq-note">' + ic('note', 14) + ' ' + esc(d.note) + '</div>' : '') +
        (log.length ? '<div class="row-list">' + log.map((l) => '<div class="rowi"><span class="ic-box ' + (l.ok ? 'ok' : 'bad') + '">' + ic(l.ok ? 'check' : 'x', 15) + '</span><span class="grow"><span class="nm">' + esc(l.text) + '</span><br><span class="mt">' + dt(l.at) + ' · ' + esc(l.by || '') + '</span></span></div>').join('') + '</div>' : '') +
        '<div class="rq-acts">' + (i.state === 'open' || i.state === 'muted'
          ? (sec ? '' : '<button class="btn btn-primary" data-act="incFix:' + i.id + '"' + (b ? ' disabled' : '') + '>' + ic('refresh', 16) + (b ? ' מתקן...' : ' תקן') + '</button>') +
            '<button class="btn" data-act="incClaude:' + i.id + '">' + ic('bot', 16) + ' פתח בקלוד</button>' +
            '<button class="btn btn-ghost" data-act="incResolve:' + i.id + '">' + ic('check', 15) + ' סמן טופל</button>' +
            (i.state === 'open' ? '<button class="btn btn-ghost" data-act="incMute:' + i.id + '">' + ic('pause', 15) + ' השתק 24 שעות</button>' : '')
          : '<button class="btn btn-ghost" data-act="incClaude:' + i.id + '">' + ic('bot', 16) + ' פתח בקלוד</button><button class="btn btn-ghost" data-act="incReopen:' + i.id + '">' + ic('undo', 15) + ' פתיחה מחדש</button>') + '</div></div>';
    }
    function table(list) {
      return '<div class="card"><div class="card-head">' + ic('hist', 18) + '<h3>היסטוריה, 30 יום</h3></div><div class="tbl-wrap flat"><table class="responsive"><thead><tr><th>#</th><th>תאריך</th><th>רכיב</th><th>תקלה</th><th>חומרה</th><th>מצב</th><th>איך נפתר</th><th>משך</th><th>מי</th></tr></thead><tbody>' +
        (list.length ? list.map((i) => '<tr data-act="incOpen:' + i.id + '"><td data-l="#">' + i.id + '</td><td data-l="תאריך">' + dt(i.opened_at) + '</td><td data-l="רכיב">' + esc(KN[i.kind] || i.kind) + '</td><td data-l="תקלה"><b>' + esc(i.title) + '</b></td><td data-l="חומרה">' + sevBadge(i.severity) + '</td><td data-l="מצב">' + stBadge(i.state) + '</td><td data-l="איך נפתר">' + esc(lastLog(i)) + '</td><td data-l="משך">' + dur(i.opened_at, i.closed_at) + '</td><td data-l="מי">' + esc(i.closed_by || '-') + '</td></tr>').join('') : '<tr><td colspan="9" class="t-sub">אין תקלות בתקופה.</td></tr>') + '</tbody></table></div></div>';
    }
    const findInc = (id) => [...INC.open, ...INC.history].find((i) => String(i.id) === String(id));
    ACT.incTab = (t) => { INC.tab = t; render(); };
    ACT.incOpen = (id) => { const i = findInc(id); if (!i) return; INC.tab = i.state === 'open' ? 'open' : 'all'; render(); setTimeout(() => { const el = $('#inc' + id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 80); };
    ACT.incRun = async () => {
      INC.busy.run = true; render();
      try { const r = await post(API, { action: 'admin.monitor.run', payload: {} }, 120000); const d = (r.result && r.result.down) || [], ok = r.result && r.result.ok; toast(ok ? 'הבדיקה עברה' : 'הבדיקה מצאה תקלה', ok ? 'כל הרכיבים עונים.' : (d.length ? d.map((k) => KN[k] || k).join(', ') : 'הפרטים במסך.')); }
      catch (e) { toast('הבדיקה לא רצה', 'נסו שוב בעוד רגע.', 'err'); }
      INC.busy.run = false; await load(true);
    };
    ACT.incFix = async (id) => {
      const i = findInc(id); if (!i || INC.busy[id]) return;
      INC.busy[id] = true; render();
      try {
        const r = await post(API, { action: 'admin.incident.fix', payload: { id: +id } }, 295000);
        toast(r.fixed ? 'התקלה תוקנה ונסגרה' : 'התיקון רץ, התקלה עדיין פתוחה', (r.log || []).map((l) => l.text).join(' · ').slice(0, 160), r.fixed ? undefined : 'err');
      } catch (e) { toast('התיקון לא רץ', 'נסו שוב, או פתחו בקלוד.', 'err'); }
      delete INC.busy[id]; await load(true);
    };
    ACT.incResolve = (id) => { const i = findInc(id); if (!i) return;
      confirmModal({ title: 'לסמן כטופל?', body: esc(i.title) + '. התקלה תעבור להיסטוריה ותירשם מי סגר אותה.', ok: 'סמן טופל', tone: 'ok', icon: 'checkc', extra: '<div class="field" style="margin-top:12px"><textarea id="incNote" rows="2" placeholder="מה נעשה (לא חובה)"></textarea></div>',
        onOk: async () => { const note = ($('#incNote') && $('#incNote').value.trim()) || ''; try { await call('admin.incident.set', { id: +id, op: 'resolve', note }); toast('סומן כטופל', i.title); } catch (e) { toast('לא נשמר', 'נסו שוב.', 'err'); } load(true); } });
    };
    ACT.incMute = async (id) => { const i = findInc(id); if (!i) return; try { await call('admin.incident.set', { id: +id, op: 'mute', hours: 24 }); toast('הושתק ל-24 שעות', i.title); } catch (e) { toast('לא נשמר', 'נסו שוב.', 'err'); } load(true); };
    ACT.incReopen = async (id) => { try { await call('admin.incident.set', { id: +id, op: 'reopen' }); toast('נפתח מחדש', ''); } catch (e) { toast('לא נשמר', 'נסו שוב.', 'err'); } load(true); };
    const claudeMsg = (i) => {
      const d = i.detail || {}, log = (i.fix_log || []).slice(-5);
      return 'תקלה #' + i.id + ' ב-PrimeOS, ' + (SEV[i.severity] || SEV.mid)[1] + '.\nרכיב: ' + (KN[i.kind] || i.kind) + '. התחיל ' + dt(i.opened_at) + '.\n' +
        (i.kind === 'security' ? 'סוג: ' + (SEC_T[d.type] || d.type || '') + '. לקוחות שנפגעו: ' + (SEC_A[d.affected] || d.affected || '') + '. אירוע חמור: ' + (d.severe ? 'כן' : 'לא') + '.\nפירוט: ' + (d.note || '') : 'מה נבדק: ' + (d.checked || '') + '\nממצא: ' + (d.note || '') + '\nסיבה משוערת: ' + (d.cause || '')) +
        (log.length ? '\nמה כבר נעשה:\n' + log.map((l) => '- ' + dt(l.at) + ' ' + (l.ok ? '✔' : '✖') + ' ' + l.text).join('\n') : '') +
        '\nמה אני צריך: אבחון והצעת תיקון. הקוד ב-GitHub simplesolutions05055-blip/-AI-, לוגים ב-Supabase Edge Functions.';
    };
    ACT.incClaude = (id) => { const i = findInc(id); if (!i) return; const m = claudeMsg(i);
      openModal('<div class="mb"><div class="m-ic warn">' + ic('bot', 20) + '</div><h3>פתיחה בקלוד</h3><p>ההודעה מוכנה עם פרטי התקלה. להעתיק ולהדביק בשיחה, או לפתוח שיחה חדשה עם ההודעה.</p><div class="field" style="margin-top:12px"><textarea id="incMsg" rows="9" readonly>' + esc(m) + '</textarea></div></div>' +
        '<div class="modal-foot"><button class="btn btn-primary" data-act="incCopy">' + ic('copy', 15) + ' העתק הודעה</button><a class="btn" href="https://claude.ai/new?q=' + encodeURIComponent(m) + '" target="_blank" rel="noopener">' + ic('link', 15) + ' פתח בקלוד</a><button class="btn" data-act="closeModal">סגור</button></div>');
    };
    ACT.incCopy = () => { const t = $('#incMsg'); if (!t) return; const done = () => toast('ההודעה הועתקה', 'להדביק בשיחה עם קלוד.'); try { navigator.clipboard.writeText(t.value).then(done, () => { t.select(); document.execCommand && document.execCommand('copy'); done(); }); } catch (e) { t.select(); done(); } };
    ACT.incSec = () => {
      openModal('<div class="mb"><div class="m-ic bad">' + ic('shield', 20) + '</div><h3>דיווח אירוע אבטחה</h3><p>לתיעוד לפי תקנות אבטחת מידע. השעון של 24 השעות להודעה ללקוח מתחיל מרגע השמירה.</p>' +
        '<div class="form-grid" style="margin-top:14px"><div class="field full"><label for="secT">מה קרה, במשפט</label><input type="text" id="secT" maxlength="160"></div>' +
        '<div class="field"><label for="secK">סוג</label><select id="secK">' + Object.entries(SEC_T).map(([k, v]) => '<option value="' + k + '">' + v + '</option>').join('') + '</select></div>' +
        '<div class="field"><label for="secA">לקוחות שנפגעו</label><select id="secA">' + Object.entries(SEC_A).map(([k, v]) => '<option value="' + k + '">' + v + '</option>').join('') + '</select></div>' +
        '<div class="field full"><label for="secD">מה התגלה, איך, מה נעשה עד עכשיו</label><textarea id="secD" rows="4"></textarea></div>' +
        '<div class="field full"><label style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" id="secS"> אירוע חמור (נדרש דיווח לרשות להגנת הפרטיות)</label></div></div></div>' +
        '<div class="modal-foot"><button class="btn btn-quiet-bad" data-act="incSecSave">שמור אירוע</button><button class="btn" data-act="closeModal">ביטול</button></div>');
      $('#modalBox').classList.add('wide');
    };
    ACT.incSecSave = async () => {
      const title = ($('#secT').value || '').trim(); if (!title) { toast('חסר תיאור', 'כתבו במשפט מה קרה.', 'err'); return; }
      try { await call('admin.incident.create', { title, type: $('#secK').value, affected: $('#secA').value, detail: ($('#secD').value || '').trim(), severe: $('#secS').checked }); closeModal(); toast('האירוע נרשם', 'השעון של 24 השעות להודעה ללקוח התחיל.'); INC.tab = 'open'; load(true); }
      catch (e) { toast('לא נשמר', 'נסו שוב.', 'err'); }
    };
    // the console menu: after the support meetings, before the money screens
    const i = ADMIN_NAV.indexOf('a_meet');
    if (!ADMIN_NAV.includes('a_incidents')) ADMIN_NAV.splice(i >= 0 ? i + 1 : ADMIN_NAV.length, 0, 'a_incidents');
    // the nav badge needs the open count from the first admin load
    const _bn = buildNav;
    buildNav = function () { _bn.apply(this, arguments); if (S.mode === 'admin' && !INC.at && !INC.loading) load(true); };
  })();

  /* ---------------- accessibility: widget, skip link, statement and automatic fixes (IS 5568 / WCAG AA) ---------------- */
  (function () {
    const KEY = 'pos_a11y';
    const OPTS = [
      ['hc', 'ניגודיות גבוהה', 'contrast'], ['gs', 'גווני אפור', 'drop'], ['links', 'הדגשת קישורים וכפתורים', 'link'],
      ['font', 'גופן קריא', 'type'], ['still', 'עצירת אנימציות', 'pause'], ['focus', 'הדגשת מיקוד מקלדת', 'target'],
      ['cursor', 'סמן עכבר גדול', 'cursor'], ['space', 'ריווח טקסט', 'space'],
    ];
    const ICO = {
      contrast: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
      drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
      link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
      type: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
      pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
      target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
      cursor: '<path d="M5 3l14 7-6 2-2 6z"/>',
      space: '<path d="M4 7h16M4 12h16M4 17h10"/>',
    };
    const svgI = (n) => '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + ICO[n] + '</svg>';
    const MAN = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="6.4" r="1.7" fill="currentColor"/><path d="M6.5 9.3c1.9.5 3.7.8 5.5.8s3.6-.3 5.5-.8M12 10.2v4.2m0 0l-2.6 5m2.6-5l2.6 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    let st = { z: 0 };
    try { st = Object.assign(st, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* storage blocked */ }
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* storage blocked */ } };
    const css = document.createElement('style');
    css.textContent = `
:root{--ink-4:#5F6888}
.skip-link{position:fixed;top:-60px;right:16px;z-index:10000;background:#0B1437;color:#fff;padding:12px 18px;border-radius:10px;font-weight:700;text-decoration:none;transition:top .15s}
.skip-link:focus{top:12px;outline:3px solid #FFD400;outline-offset:2px}
.a11y-btn{position:fixed;left:18px;bottom:18px;z-index:90;width:46px;height:46px;border-radius:50%;border:2px solid #fff;background:#0B1437;color:#fff;display:grid;place-items:center;cursor:pointer;box-shadow:0 10px 24px -10px rgba(9,36,101,.6);transition:bottom .25s}
body.in-app .a11y-btn{display:none}
body.in-app .main{padding-bottom:110px}
body.in-app:has(.action-bar) .main{padding-bottom:190px}
.top-actions #a11yTop{color:var(--p-navy,#092465)}
.top-actions #a11yTop svg{width:22px;height:22px}
@media (max-width:480px){.top-actions #btnOrg{display:none}.topbar .icon-btn,.topbar .btn-new-top{width:38px;height:38px;min-width:38px}.top-actions{gap:4px}}
@media (max-width:360px){html.a11y-z2 .topbar .btn-new-top,html.a11y-z3 .topbar .btn-new-top{display:none}}
@media (max-width:360px){.topbar .top-logo .logo-txt,.topbar .top-logo b,.topbar .top-logo span{display:none}}
@media (max-width:528px){html.a11y-z1 .top-actions #btnOrg{display:none}html.a11y-z1 .topbar .icon-btn,html.a11y-z1 .topbar .btn-new-top{width:38px;height:38px;min-width:38px}html.a11y-z1 .top-actions{gap:4px}}
@media (max-width:426px){html.a11y-z1 .topbar .top-logo .logo-txt,html.a11y-z1 .topbar .top-logo b,html.a11y-z1 .topbar .top-logo span{display:none}}
@media (max-width:576px){html.a11y-z2 .top-actions #btnOrg{display:none}html.a11y-z2 .topbar .icon-btn,html.a11y-z2 .topbar .btn-new-top{width:38px;height:38px;min-width:38px}html.a11y-z2 .top-actions{gap:4px}}
@media (max-width:462px){html.a11y-z2 .topbar .top-logo .logo-txt,html.a11y-z2 .topbar .top-logo b,html.a11y-z2 .topbar .top-logo span{display:none}}
@media (max-width:624px){html.a11y-z3 .top-actions #btnOrg{display:none}html.a11y-z3 .topbar .icon-btn,html.a11y-z3 .topbar .btn-new-top{width:38px;height:38px;min-width:38px}html.a11y-z3 .top-actions{gap:4px}}
@media (max-width:498px){html.a11y-z3 .topbar .top-logo .logo-txt,html.a11y-z3 .topbar .top-logo b,html.a11y-z3 .topbar .top-logo span{display:none}}
body.fab-away .ai-fab:not(.on){transform:translateY(160%);opacity:0;pointer-events:none}
.ai-fab{transition:transform .25s ease,opacity .2s ease,bottom .25s ease}
.a11y-btn:hover{background:#0124C7}
.a11y-btn:focus-visible{outline:3px solid #FFD400;outline-offset:2px}
.a11y-pan{position:fixed;left:18px;bottom:76px;z-index:91;width:320px;max-width:calc(100vw - 36px);max-height:calc(100vh - 110px);overflow:auto;background:#fff;color:#0B1437;border:1px solid #D5DBEA;border-radius:18px;box-shadow:0 24px 60px -20px rgba(9,36,101,.45);padding:16px;display:none}
body.in-app .a11y-pan{top:calc(var(--topbar-h,64px) + 28px);bottom:auto;max-height:calc(100vh - var(--topbar-h,64px) - 48px)}
.a11y-pan.on{display:block}
.a11y-pan h2{font-size:17px;margin:0 0 12px;display:flex;align-items:center;gap:8px}
.a11y-pan .a11y-x{margin-inline-start:auto;width:34px;height:34px;border-radius:10px;border:1px solid #D5DBEA;background:#fff;cursor:pointer;font-size:18px;line-height:1;color:#0B1437}
.a11y-z{display:flex;align-items:center;gap:8px;margin-bottom:10px;padding:8px 10px;border:1px solid #E4E8F2;border-radius:12px}
.a11y-z span{flex:1;font-weight:600;font-size:14px}
.a11y-z button{width:38px;height:34px;border-radius:9px;border:1px solid #D5DBEA;background:#F2F4FA;cursor:pointer;font-weight:800;font-size:15px;color:#0B1437}
.a11y-z output{min-width:42px;text-align:center;font-weight:700;font-size:13px}
.a11y-g{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.a11y-o{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-height:72px;padding:8px;border-radius:12px;border:1px solid #D5DBEA;background:#F7F8FC;cursor:pointer;font-size:12.5px;font-weight:600;color:#0B1437;text-align:center;line-height:1.3}
.a11y-o[aria-pressed="true"]{background:#0124C7;border-color:#0124C7;color:#fff}
.a11y-f{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
.a11y-f button{flex:1;min-width:120px;height:38px;border-radius:10px;border:1px solid #D5DBEA;background:#fff;cursor:pointer;font-weight:700;font-size:13px;color:#0B1437}
.a11y-pan button:focus-visible{outline:3px solid #FFD400;outline-offset:2px}
.a11y-stmt{max-width:640px;line-height:1.7;font-size:14.5px}
.a11y-stmt h3{margin:0 0 10px}.a11y-stmt h4{margin:16px 0 6px;font-size:15px}
.a11y-stmt ul{margin:0;padding-inline-start:20px}
.a11y-stmt .mail{direction:ltr;display:inline-block;font-weight:700;user-select:all}
html.a11y-z1 body{zoom:1.1}html.a11y-z2 body{zoom:1.2}html.a11y-z3 body{zoom:1.3}
html.a11y-hc{filter:contrast(1.25)}
html.a11y-gs{filter:grayscale(1)}
html.a11y-hc.a11y-gs{filter:contrast(1.25) grayscale(1)}
html.a11y-hc{--ink:#000;--ink-2:#111;--ink-3:#222;--ink-4:#333;--line:#6B7393;--line-2:#8A92AE}
html.a11y-hc .ambient{display:none}
html.a11y-hc body{background:#fff}
html.a11y-links a,html.a11y-links button:not(.a11y-o):not(.a11y-btn),html.a11y-links [role="button"],html.a11y-links [data-nav]{text-decoration:underline!important;text-underline-offset:3px;outline:2px solid #E0A800!important;outline-offset:1px}
html.a11y-font body,html.a11y-font body *:not(svg):not(svg *){font-family:Arial,"Helvetica Neue",Helvetica,sans-serif!important;letter-spacing:.01em}
html.a11y-still *,html.a11y-still *::before,html.a11y-still *::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}
html.a11y-still .ambient .orb,html.a11y-still .ambient .streak{display:none}
html.a11y-focus *:focus{outline:3px solid #FFD400!important;outline-offset:2px!important;box-shadow:0 0 0 6px #0B1437!important}
html.a11y-cursor,html.a11y-cursor *{cursor:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 24 24'%3E%3Cpath d='M4 2l16 8-7 2.4L10 20z' fill='%23000' stroke='%23fff' stroke-width='1.4' stroke-linejoin='round'/%3E%3C/svg%3E") 3 2,auto!important}
html.a11y-space p,html.a11y-space li,html.a11y-space .note,html.a11y-space .msg{line-height:1.9!important;letter-spacing:.03em!important;word-spacing:.12em!important}
`;
    document.head.appendChild(css);
    const root = document.documentElement;
    const apply = () => {
      root.classList.remove('a11y-z1', 'a11y-z2', 'a11y-z3');
      if (st.z) root.classList.add('a11y-z' + st.z);
      OPTS.forEach((o) => root.classList.toggle('a11y-' + o[0], !!st[o[0]]));
      const pan = document.getElementById('a11yPan');
      if (pan) {
        pan.querySelectorAll('[data-a11y]').forEach((b) => b.setAttribute('aria-pressed', st[b.dataset.a11y] ? 'true' : 'false'));
        const out = pan.querySelector('output'); if (out) out.textContent = (100 + st.z * 10) + '%';
      }
    };
    // skip link, button and panel
    const skip = document.createElement('a');
    skip.className = 'skip-link'; skip.href = '#view'; skip.textContent = 'דילוג לתוכן המרכזי';
    skip.addEventListener('click', (e) => {
      e.preventDefault();
      const app = document.getElementById('app');
      const t = app && getComputedStyle(app).display !== 'none' && document.body.classList.contains('in-app') ? document.getElementById('view') : document.querySelector('#authRoot input, #authRoot button');
      if (t) { if (!t.hasAttribute('tabindex') && t.id === 'view') t.setAttribute('tabindex', '-1'); t.focus(); }
    });
    document.body.insertBefore(skip, document.body.firstChild);
    const btn = document.createElement('button');
    btn.className = 'a11y-btn'; btn.id = 'a11yBtn'; btn.type = 'button';
    btn.setAttribute('aria-label', 'תפריט נגישות'); btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 'a11yPan');
    btn.title = 'נגישות'; btn.innerHTML = MAN;
    const pan = document.createElement('div');
    pan.className = 'a11y-pan'; pan.id = 'a11yPan'; pan.setAttribute('role', 'dialog'); pan.setAttribute('aria-modal', 'false'); pan.setAttribute('aria-labelledby', 'a11yTtl');
    pan.innerHTML = '<h2 id="a11yTtl">' + MAN + ' התאמות נגישות<button type="button" class="a11y-x" data-a11y-do="close" aria-label="סגירת תפריט הנגישות">×</button></h2>' +
      '<div class="a11y-z" role="group" aria-label="גודל תצוגה"><span>גודל תצוגה</span>' +
        '<button type="button" data-a11y-do="zm" aria-label="הקטנת התצוגה">−</button><output aria-live="polite">100%</output>' +
        '<button type="button" data-a11y-do="zp" aria-label="הגדלת התצוגה">+</button></div>' +
      '<div class="a11y-g">' + OPTS.map((o) => '<button type="button" class="a11y-o" data-a11y="' + o[0] + '" aria-pressed="false">' + svgI(o[2]) + '<span>' + o[1] + '</span></button>').join('') + '</div>' +
      '<div class="a11y-f"><button type="button" data-a11y-do="reset">איפוס התאמות</button><button type="button" data-a11y-do="stmt">הצהרת נגישות</button></div>';
    document.body.appendChild(btn); document.body.appendChild(pan);
    // inside the app the button sits in the top bar (never over content); the floating one serves the login screen
    const top = document.createElement('div');
    top.className = 'tip';
    top.innerHTML = '<button type="button" class="icon-btn" id="a11yTop" aria-label="תפריט נגישות" aria-expanded="false" aria-controls="a11yPan">' + MAN + '</button><span class="tip-b">נגישות</span>';
    const ta = document.querySelector('.top-actions');
    if (ta) { const help = document.getElementById('btnHelp'); const ref = help && help.closest('.tip'); ta.insertBefore(top, ref && ref.parentElement === ta ? ref : ta.firstChild); }
    const btnTop = top.querySelector('button');
    const opener = () => (document.body.classList.contains('in-app') ? btnTop : btn);
    const open = (on) => {
      pan.classList.toggle('on', on); [btn, btnTop].forEach((x) => x.setAttribute('aria-expanded', on ? 'true' : 'false'));
      if (on) { const f = pan.querySelector('.a11y-x'); if (f) f.focus(); } else opener().focus();
    };
    btn.addEventListener('click', () => open(!pan.classList.contains('on')));
    btnTop.addEventListener('click', () => open(!pan.classList.contains('on')));
    // the AI button steps aside while the page scrolls down and returns on scroll up or at the end of the page
    let lastY = scrollY;
    addEventListener('scroll', () => {
      const y = scrollY, end = y + innerHeight >= document.documentElement.scrollHeight - 40;
      if (end || y < 80 || y < lastY - 6) document.body.classList.remove('fab-away');
      else if (y > lastY + 6) document.body.classList.add('fab-away');
      lastY = y;
    }, { passive: true });
    pan.addEventListener('click', (e) => {
      const o = e.target.closest('[data-a11y]');
      if (o) { const k = o.dataset.a11y; st[k] = !st[k]; save(); apply(); return; }
      const d = e.target.closest('[data-a11y-do]'); if (!d) return;
      const w = d.dataset.a11yDo;
      if (w === 'close') open(false);
      else if (w === 'zp') { st.z = Math.min(3, st.z + 1); save(); apply(); }
      else if (w === 'zm') { st.z = Math.max(0, st.z - 1); save(); apply(); }
      else if (w === 'reset') { st = { z: 0 }; save(); apply(); }
      else if (w === 'stmt') { pan.classList.remove('on'); [btn, btnTop].forEach((x) => x.setAttribute('aria-expanded', 'false')); statement(); }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && pan.classList.contains('on')) { open(false); return; }
      // keyboard activation for clickable elements that are not native buttons or links
      if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.matches && e.target.matches('[role="button"]:not(button):not(a):not(input):not(textarea):not(select),[role="switch"]:not(button)') && e.target.matches('[role]:not(button):not(a):not(input):not(textarea):not(select)')) { e.preventDefault(); e.target.click(); }
    });
    document.addEventListener('click', (e) => { if (pan.classList.contains('on') && !pan.contains(e.target) && !btn.contains(e.target) && !btnTop.contains(e.target)) { pan.classList.remove('on'); [btn, btnTop].forEach((x) => x.setAttribute('aria-expanded', 'false')); } });
    function statement() {
      const mail = 'prime.os.team1@gmail.com';
      openModal('<div class="mb a11y-stmt"><h3>הצהרת נגישות</h3>' +
        '<p>PrimeOS היא מערכת לניהול תוכן ורשתות חברתיות לרשויות מקומיות ולארגונים. אנחנו רואים חשיבות בהנגשת המערכת לכל המשתמשים, כולל אנשים עם מוגבלות, ופועלים לפי תקנות שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות), התשע״ג-2013, ולפי התקן הישראלי ת״י 5568, המבוסס על הנחיות WCAG ברמה AA.</p>' +
        '<h4>מה הונגש</h4><ul>' +
        '<li>ניווט מלא במקלדת, כולל קישור „דילוג לתוכן המרכזי” וסימון מיקוד ברור.</li>' +
        '<li>תוויות לרכיבי טופס ולכפתורים שמוצגים כסמל בלבד, לטובת קוראי מסך.</li>' +
        '<li>ניגודיות צבעים שעומדת ביחס 4.5:1 לטקסט רגיל.</li>' +
        '<li>תצוגה מותאמת לטלפון, לטאבלט ולמחשב, בלי גלילה רוחבית.</li>' +
        '<li>תפריט נגישות בכל מסך: הגדלת תצוגה, ניגודיות גבוהה, גווני אפור, הדגשת קישורים, גופן קריא, עצירת אנימציות, הדגשת מיקוד, סמן גדול וריווח טקסט.</li>' +
        '<li>כיבוד הגדרת „הפחתת תנועה” של מערכת ההפעלה.</li></ul>' +
        '<h4>מגבלות ידועות</h4><ul>' +
        '<li>תמונות וסרטונים שמשתמשים מעלים עשויים שלא לכלול טקסט חלופי או כתוביות מלאות.</li>' +
        '<li>חלונות חיבור של רשתות חברתיות נפתחים באתרי הרשתות עצמן, והנגישות שלהם באחריותן.</li></ul>' +
        '<h4>פניות בנושא נגישות</h4>' +
        '<p>נתקלתם בקושי? כתבו לנו ונטפל בהקדם: <span class="mail">' + mail + '</span><br>בפנייה ציינו את המסך, את הפעולה שניסיתם לבצע ואת סוג הדפדפן או הטכנולוגיה המסייעת.</p>' +
        '<p style="color:var(--ink-3);font-size:13px">ההצהרה עודכנה ב-19.10.2026.</p></div>' +
        '<div class="modal-foot"><button class="btn" data-act="closeModal">סגירה</button></div>');
    }
    window.openA11yStatement = statement;
    // automatic fixes after every render: names for icon-only controls, alt text, form labels, keyboard reach
    const txt = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
    let busy = false;
    const fix = () => {
      busy = true;
      try {
        document.querySelectorAll('button:not([aria-label]),a:not([aria-label]),[role="button"]:not([aria-label])').forEach((b) => {
          if (txt(b)) return;
          const tip = b.parentElement && b.parentElement.classList.contains('tip') ? b.parentElement.querySelector('.tip-b') : null;
          const n = b.getAttribute('title') || (tip && txt(tip)) || (b.querySelector('img[alt]') && b.querySelector('img[alt]').alt) || '';
          if (n) b.setAttribute('aria-label', n);
        });
        document.querySelectorAll('img:not([alt])').forEach((i) => i.setAttribute('alt', i.classList.contains('logo-img') ? 'PrimeOS' : ''));
        document.querySelectorAll('svg:not([aria-hidden]):not([role])').forEach((s) => s.setAttribute('aria-hidden', 'true'));
        document.querySelectorAll('input:not([type=hidden]):not([aria-label]),textarea:not([aria-label]),select:not([aria-label])').forEach((f) => {
          if (f.id && document.querySelector('label[for="' + f.id + '"]')) return;
          if (f.closest('label')) return;
          const n = f.getAttribute('placeholder') || f.getAttribute('title') || (f.previousElementSibling && /^(LABEL|SPAN|DIV)$/.test(f.previousElementSibling.tagName) && txt(f.previousElementSibling).slice(0, 60)) || '';
          if (n) f.setAttribute('aria-label', n);
        });
        document.querySelectorAll('[data-act]:not(button):not(a):not(input):not(select):not(textarea):not(label):not([role]),[data-nav]:not(button):not(a):not([role])').forEach((el) => {
          el.setAttribute('role', 'button'); if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
        });
        document.querySelectorAll('.sw:not([role])').forEach((s) => { s.setAttribute('role', 'switch'); s.setAttribute('aria-checked', s.classList.contains('on') ? 'true' : 'false'); if (!s.hasAttribute('tabindex')) s.setAttribute('tabindex', '0'); });
        const m = document.getElementById('modal'); if (m && !m.hasAttribute('aria-labelledby')) { const h = m.querySelector('h2,h3'); if (h) { h.id = h.id || 'modalTtl'; m.setAttribute('aria-labelledby', h.id); } }
        const v = document.getElementById('view'); if (v && !v.hasAttribute('aria-label')) v.setAttribute('aria-label', 'התוכן המרכזי');
        const nav = document.getElementById('nav'); if (nav && !nav.hasAttribute('aria-label')) nav.setAttribute('aria-label', 'תפריט ראשי');
      } finally { busy = false; }
    };
    let tm = 0;
    new MutationObserver(() => { if (busy) return; clearTimeout(tm); tm = setTimeout(fix, 120); }).observe(document.body, { childList: true, subtree: true });
    apply(); fix();
  })();
})();
