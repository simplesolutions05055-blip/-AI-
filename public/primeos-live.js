/* PrimeOS live layer.
 * The UI is the approved mockup (index.html) untouched. This file connects it to
 * the real backend: link login, persistence of every screen's data, and Claude
 * text generation. Loaded after the mockup scripts; boots the app.
 */
(function () {
  'use strict';
  const API = '/api/v2';
  // long generations (documents, decks) go straight to the edge function: no 60s proxy limit
  const LIVE_HOST = /(^|\.)primeos\.co\.il$|\.vercel\.app$/.test(location.hostname);
  const GEN = LIVE_HOST ? 'https://tgropjisnheppsxejfdn.supabase.co/functions/v1/generate' : '/api/generate';
  const L = (window.PrimeLive = { token: null, kind: null, org: null, me: null, admin: null, demo: false, ready: false });

  /* ---------------- transport ---------------- */
  async function post(url, body, timeoutMs) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs || 30000);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-primeos-token': L.token || '' },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      const j = await r.json().catch(() => ({ error: 'bad_response' }));
      if (!r.ok || j.error) throw Object.assign(new Error(j.error || 'http_' + r.status), { status: r.status });
      return j;
    } finally {
      clearTimeout(t);
    }
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
  function restore(target, data) { if (data == null) return; Array.isArray(target) ? replaceAll(target, data) : replaceObj(target, data); }
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
  };
  function adminStateObj() { const o = {}; for (const k in ADMIN_KEYS) o[k] = ADMIN_KEYS[k](); return o; }
  function hydrateAdmin(st) { for (const k in ADMIN_KEYS) if (st[k] !== undefined) restore(ADMIN_KEYS[k](), st[k]); }

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
  }

  /* ---------------- sync engine ---------------- */
  const SY = { items: new Map(), state: '', inbox: new Set(), busy: false, fail: 0, on: false };
  const itemsSnap = () => { const m = new Map(); for (const it of items) m.set(it.id, JSON.stringify(it)); return m; };
  function baseline() {
    // what the server already holds counts as saved; anything else is pushed on the first flush
    SY.items = L.kind === 'client' ? itemsSnap() : new Map();
    if (L.kind === 'client' && !L.srvHadItems) SY.items = new Map();
    SY.state = L.srvHadState ? JSON.stringify(L.kind === 'client' ? clientState() : adminStateObj()) : '';
    if (L.kind === 'client') { REQS.forEach((r) => SY.inbox.add('r:' + r.id)); MEETINGS.forEach((m) => SY.inbox.add('m:' + m.id)); }
  }
  async function flush() {
    if (!SY.on || SY.busy) return;
    SY.busy = true;
    try {
      if (L.kind === 'client') {
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
        const st = JSON.stringify(clientState());
        if (st !== SY.state) { await call('state.save', { data: JSON.parse(st) }); SY.state = st; }
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
    if (L.kind === 'client') setInterval(pull, 25000);
  }

  /* other users' changes come in quietly */
  const QUIET = ['wizard', 'docWiz', 'deckWiz', 'vidWiz', 'bulk', 'bulkGen', 'bulkReview', 'evWiz', 'onboard'];
  async function pull() {
    if (!SY.on || SY.busy || document.hidden) return;
    let d;
    try { d = await call('live.load'); } catch (e) { return; }
    if (SY.busy) return;
    let changed = false;
    const local = new Map(items.map((i) => [i.id, i]));
    const seen = new Set();
    for (const r of d.items || []) {
      const ui = r.ui;
      seen.add(ui.id);
      const sj = JSON.stringify(ui);
      const synced = SY.items.get(ui.id);
      const l = local.get(ui.id);
      if (!l) { if (synced === undefined) { items.unshift(ui); SY.items.set(ui.id, sj); changed = true; } }
      else if (JSON.stringify(l) === synced && sj !== synced) { replaceObj(l, ui); SY.items.set(ui.id, sj); changed = true; }
    }
    for (const [id, sj] of [...SY.items]) {
      if (seen.has(id)) continue;
      const l = local.get(id);
      if (l && JSON.stringify(l) === sj) { items.splice(items.indexOf(l), 1); SY.items.delete(id); changed = true; }
    }
    if (d.state && !d.state.fresh) {
      const sj = JSON.stringify(Object.assign(clientState(), d.state));
      if (JSON.stringify(clientState()) === SY.state && sj !== SY.state) { hydrateClient(d.state); SY.state = JSON.stringify(clientState()); changed = true; }
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
      if (L.org && isDept() && !S.imp) $('#btnOrg .otx').textContent = L.org.name + ' · ' + S.dept;
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
    const em = $('#lEmail'), pw = $('#lPass');
    if (em) em.value = '';
    if (pw) pw.value = '';
    const go = async () => {
      const email = (em && em.value || '').trim(), password = pw && pw.value || '';
      if (!email || !password) { toast('חסרים פרטים', 'הזינו דוא״ל וסיסמה.', 'err'); return; }
      const done = busyBtn('#lIn', 'מתחבר...');
      try {
        const r = await post(API, { action: 'login', payload: { email, password } });
        L.token = r.token;
        ls.set(SLOT.client, r.token);
        await bootWithToken();
      } catch (e) {
        done();
        toast('הכניסה נכשלה', e.status === 401 ? 'דוא״ל או סיסמה שגויים.' : 'בעיית חיבור. נסו שוב.', 'err');
      }
    };
    $('#lIn').onclick = go;
    if (pw) pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    $('#lAdmin').onclick = () => toast('כניסת מנהל מערכת', 'הכניסה לממשק הניהול מתבצעת מהקישור האישי שלך.', '');
    $('#lForgot').onclick = (e) => { e.preventDefault(); toast('איפוס סיסמה', 'פנו למנהל המערכת לקבלת קישור כניסה חדש.', ''); };
  };

  /* logout clears this interface's link */
  const _logout = ACT.logout;
  ACT.logout = () => {
    ls.del(L.kind === 'admin' ? SLOT.admin : SLOT.client);
    location.href = '/';
  };

  /* ---------------- boot ---------------- */
  function loader(txt) {
    $('#authRoot').innerHTML = '<div style="min-height:100vh;display:grid;place-items:center;font-family:Heebo,sans-serif;color:var(--ink-3,#5A6386)"><div style="display:flex;align-items:center;gap:12px;font-size:15px"><span class="gm-spin"></span>' + esc(txt || 'טוען את PrimeOS...') + '</div></div>';
  }
  async function bootClient() {
    const d = await call('live.load');
    L.kind = 'client';
    L.org = d.org;
    L.me = d.me;
    L.demo = !!d.demo;
    L.srvHadItems = !!(d.items && d.items.length);
    L.srvHadState = !!(d.state && !d.state.fresh);
    const fresh = !d.state || d.state.fresh;
    if (d.state && !d.state.fresh) hydrateClient(d.state);
    else if (!L.demo) freshClient();
    if (d.items && d.items.length) items = d.items.map((r) => r.ui).sort((a, b) => b.id - a.id);
    else if (!L.demo || !fresh) items = [];
    S.seq = items.reduce((m, i) => Math.max(m, +i.id || 0), 100);
    S.org = L.org.name;
    if (L.me) {
      const demoUser = L.demo && L.me.name === 'יעל כהן';
      S.user = { name: L.me.name, role: demoUser ? 'מנהלת תקשורת' : (L.me.role === 'admin' ? 'מנהל/ת מערכת' : 'משתמש מערכת'), init: initials(L.me.name), dept: L.me.dept || S.user.dept || DEPTS[0] };
      if (!users.some((u) => u.n === L.me.name)) users.unshift({ n: L.me.name, r: S.user.role, d: S.user.dept, st: 'פעיל', last: 'עכשיו', i: S.user.init, direct: true });
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
  }
  async function bootAdmin() {
    const d = await call('admin.load');
    L.kind = 'admin';
    L.admin = d.admin;
    L.srvHadState = !!d.state;
    if (d.state) hydrateAdmin(d.state);
    linkRealOrgs(d.realOrgs || []);
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
  L.boot = async function () {
    const u = new URL(location.href);
    const k = u.searchParams.get('k');
    if (k) {
      u.searchParams.delete('k');
      history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
      L.token = k.trim();
    } else {
      L.token = ls.get(isAdminPath() ? SLOT.admin : SLOT.client);
    }
    if (!L.token) { renderAuth(isAdminPath() ? 'הכניסה לממשק הניהול מתבצעת מהקישור האישי.' : ''); return; }
    try {
      await bootWithToken();
    } catch (e) {
      if (e.status === 401) {
        ls.del(isAdminPath() ? SLOT.admin : SLOT.client);
        renderAuth('הקישור אינו בתוקף. פנו למנהל המערכת לקבלת קישור חדש.');
      } else {
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
  const linkOf = (o) => location.origin + '/?k=' + encodeURIComponent(o.live.token);
  function linkBox(o) {
    return '<div class="card card-pad" style="margin-top:14px;text-align:start"><b style="font-size:13.5px">קישור כניסה ללקוח</b>' +
      '<div class="t-sub" style="margin:4px 0 10px">שולחים את הקישור לאיש הקשר. הכניסה ישירה, בלי סיסמה.</div>' +
      '<div style="display:flex;gap:8px;align-items:center"><input type="text" readonly value="' + esc(linkOf(o)) + '" style="flex:1;direction:ltr;font-size:12.5px" onclick="this.select()">' +
      '<button class="btn btn-sm btn-primary" data-act="liveCopy:' + o.id + '">' + ic('copy', 14) + ' העתקה</button></div></div>';
  }
  ACT.liveCopy = (id) => {
    const o = ORGS.find((x) => x.id === id);
    if (!o || !o.live) return;
    const t = linkOf(o);
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast('הקישור הועתק', o.n), () => toast('העתקה ידנית', t));
  };
  ACT.liveOpen = (id) => { const o = ORGS.find((x) => x.id === id); if (o && o.live) window.open(linkOf(o), '_blank', 'noopener'); };

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
    _nwNext();
    if (ORGS.length <= before || L.kind !== 'admin') return;
    const o = ORGS[ORGS.length - 1];
    call('admin.org.create', { name: o.n, plan: o.plan === 'solo' ? 'basic' : 'extended', contact: o.contact, mail: o.mail, phone: o.phone, otype: o.type, ui_id: o.id })
      .then((r) => {
        o.live = { id: r.org_id, token: r.token };
        const mb = $('#modalBox .mb');
        if (mb) mb.insertAdjacentHTML('beforeend', linkBox(o));
        if (S.route === 'a_org') render();
        flush();
      })
      .catch(() => toast('הלקוח נשמר', 'יצירת קישור הכניסה נכשלה. נסו שוב מעמוד הלקוח.', 'err'));
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
    };
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
  const FX = 'https://tgropjisnheppsxejfdn.supabase.co/functions/v1/';
  const fx = (name, body, ms) => post(FX + name, body, ms || 150000);
  const FMT_K = { '1:1': '1x1', '4:5': '4x5', '9:16': '9x16', '16:9': '16x9', '1.91:1': '191x1' };
  const IMG_SIZE = (f) => (f === '4:5' || f === '9:16' ? 'portrait' : f === '16:9' || f === '1.91:1' ? 'landscape' : 'square');
  const LAY = [
    ['ai', 'עיצוב AI חופשי', 0],
    ['photo', 'תמונה מלאה', 1], ['frame', 'מסגרת ממלכתית', 1], ['split', 'תמונה ופאנל', 1], ['greeting', 'ברכה', 1],
    ['official', 'רשמי', 0], ['notice', 'הודעה דחופה', 0], ['stat', 'נתון מרכזי', 0], ['editorial', 'בהיר מערכתי', 0],
  ];
  const needsImg = (l) => !!(LAY.find((x) => x[0] === l) || [])[2];
  function brandFor(dept) {
    const c = (typeof BRAND !== 'undefined' && BRAND.colors) || [];
    return { org: aiCtx().org, dept: dept || aiCtx().dept || '', colors: c.map((x) => (Array.isArray(x) ? x[1] : x)) };
  }
  async function aiImage(o) {
    const r = await fx('image', { brief: o.brief || '', title: o.title || '', dept: o.dept || '', people: o.people || 'auto', style: o.style || 'photo', size: o.size || 'square', quality: 'high' }, 150000);
    return r.url;
  }
  async function produce(jobs, dept) {
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
.sp-img.has-real,.pimg.has-real{position:relative;overflow:hidden;background:#E6EBF2;padding:0}
.sp-img.has-real>*:not(.sp-real):not(.sp-mb),.pimg.has-real>*:not(.sp-real){display:none!important}
.sp-real{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
video.sp-real{object-fit:contain;background:#0A2C51}
.sp-mb{position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:rgba(10,44,81,.62);color:#fff;font-weight:700;font-size:14px;text-align:center;padding:16px}
.sp-mb .gm-spin{width:26px;height:26px;border-width:3px}
.lay-pick{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-bottom:10px}
.lay-pick button{border:1.5px solid var(--line,#DDE3EC);background:#fff;border-radius:10px;padding:8px 4px;font:inherit;font-size:12.5px;font-weight:600;color:var(--ink-2,#41506A);cursor:pointer;line-height:1.25}
.lay-pick button.on{border-color:var(--brand,#0E3B6B);background:var(--brand,#0E3B6B);color:#fff}
.lay-pick button:disabled{opacity:.5;cursor:default}
.real-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.real-acts a{text-decoration:none}
.thumb.has-real{background-size:cover!important;background-position:center!important}
.thumb.has-real .tt{display:none}
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
    const m = o.media || (w && w.media);
    if (!m || (!realTag(m) && !m.busy)) return h;
    const busy = m.busy ? '<span class="sp-mb"><span class="gm-spin"></span>' + esc(m.busy) + '</span>' : '';
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
    if (m.layout === 'ai') return aiDesignRun(w, m, fmt, job, opts);
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
      const r = gfx
        ? await gen({ mode: 'graphic', title: w.brief.title, brief: w.brief.free, dept: w.brief.dept, files: briefFiles(w) })
        : await gen({ mode: 'post', title: w.brief.title, brief: w.brief.free, dept: w.brief.dept, channels: chNames(w.ch), typeLabel: TYPES[w.type] ? TYPES[w.type].t : 'גרפיקה' });
      if (S.wiz !== w) return;
      w.step = 1;
      w.t = (gfx ? r.headline : r.title) || w.brief.title;
      w.body = (gfx ? r.caption : r.body) || '';
      const tags = (r.tags || []).slice(0, 6);
      w.sugg = [...new Set([...tags, ...suggestTags(w.t, w.brief.dept)])].slice(0, 7);
      w.tags = tags.slice(0, 4);
      w.ver = 1;
      if (gfx) {
        w.design = { kicker: r.kicker || '', sub: r.sub || '', details: r.details || [], cta: r.cta || '' };
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
      if (w.media.layout === 'ai') { w.media.stale = true; render(); return; }
      clearTimeout(tmr); tmr = setTimeout(() => gfxRun(w), 300);
    });
  };
  // the saved item keeps the real file
  const _wizItemL = wizItem;
  wizItem = function (st) {
    const w = S.wiz;
    const it = _wizItemL(st);
    if (w && w.media && w.media.url) it.media = { kind: w.media.kind, url: w.media.url, thumb: w.media.thumb || '', layout: w.media.layout, fmt: w.media.fmt, ar: w.media.ar, image: w.media.image || '', design: w.design || null, ready: w.media.ready !== false };
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
      const goal = v.goal === 'marketing' ? 'סרטון שיווקי שמניע לפעולה' : 'סרטון ראווה שמציג עשייה ואווירה';
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
      m.url = x.urls.main; m.thumb = x.urls.p1; m.busy = '';
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
      ? '<div class="rd-busy"><span class="sp-mb"><span class="gm-spin"></span>' + esc(m.busy) + '</span></div>'
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
    if (m && m.url && it && it.ty === 'doc') { it.media = { kind: 'doc', url: m.url, thumb: m.thumb, ar: '210/297', style: w.style }; if (w.doc) it.doc = w.doc; flush(); }
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
        const [d, imgs] = await Promise.all([
          gen({ mode: 'deck2', style: w.style, title: w.title, pages: w.pages, keep: !!(w.src === 'file' && w.file && w.file.url), files: w.file && w.file.url ? [{ url: w.file.url, name: w.file.n }] : [],
            brief: (w.src === 'file' && w.file ? ({ visual: 'שמור על הטקסט של המצגת המצורפת כמו שהוא, מילה במילה, שקף אחר שקף. ', text: 'שפר את הניסוח של המצגת המצורפת: קצר, ברור ומדויק, בלי להוסיף עובדות. שמור על סדר השקפים. ', both: 'ערוך את המצגת המצורפת: שפר ניסוח וסדר, בלי להוסיף עובדות. ' })[w.editKind] + 'מספר השקפים כמו במצגת המקורית. ' : '') + (w.prompt || '') }),
          w.style === 'designed' && !m.images ? Promise.all([aiImage({ title: w.title, brief: w.prompt + '\nתמונת שער רחבה ואווירתית', size: 'landscape' }).catch(() => ''), aiImage({ title: w.title, brief: w.prompt + '\nאנשים ורגע אנושי מהנושא', size: 'landscape' }).catch(() => '')]) : Promise.resolve(null),
        ]);
        if (S.dk !== w || m.job !== job) return;
        w.deck = d;
        if (imgs) m.images = { cover: imgs[0] || imgs[1], quote: imgs[1] || imgs[0], side: imgs[1] || imgs[0], end: imgs[0] || imgs[1] };
        const sl = d.slides || [];
        w.slides = mkSlides(sl.length || w.pages);
        w.slides.forEach((s, i) => { if (sl[i]) { s.t = sl[i].t || s.t; s.pts = sl[i].pts || []; } });
        if (!w.title.trim() && d.title) w.title = d.title;
        w.ai = true;
        if (w.cur >= w.slides.length) w.cur = 0;
      }
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
    if (m && m.busy && !mini) return '<div class="slide real"><span class="sp-mb"><span class="gm-spin"></span>' + esc(m.busy) + '</span></div>';
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
    if (m && m.url && it && it.ty === 'deck') { it.media = { kind: 'deck', url: m.url, pptx: m.pptx, slides: m.slides, thumb: m.thumb, ar: '16/9', style: w.style }; if (w.deck) it.deck = w.deck; flush(); }
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
    const box = '<div class="note">' + ic('down', 16) + '<span>הקובץ המקורי: ' + links.map((l) => '<a href="' + esc(l[1]) + '" target="_blank" rel="noopener" style="font-weight:700;color:var(--brand)">' + l[0] + '</a>').join(' · ') + (m.kind === 'video' && !m.ready ? ' (הסרטון עדיין ברינדור)' : '') + '</span></div>';
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
  async function uploadFile(f) {
    if (f.size > MAXB) throw new Error('too_big');
    const s = await call('upload.sign', { name: f.name });
    const r = await fetch(s.upload, { method: 'PUT', headers: { 'content-type': f.type || 'application/octet-stream', 'x-upsert': 'true' }, body: f });
    if (!r.ok) throw new Error('upload_failed');
    return { url: s.url, name: f.name, ext: s.ext, type: f.type, size: f.size };
  }
  async function uploadPicked(accept, multiple) {
    const fs = await pickFiles(accept, multiple);
    if (!fs.length) return [];
    toast('מעלה ' + (fs.length > 1 ? fs.length + ' קבצים' : 'את הקובץ') + '...', fs.map((f) => f.name).join(', '));
    const out = [];
    for (const f of fs) {
      try { out.push(await uploadFile(f)); }
      catch (e) { toast('ההעלאה נכשלה', f.name + (e.message === 'too_big' ? ' גדול מ-50MB.' : e.message === 'file_type_not_allowed' ? ': סוג קובץ שלא נתמך.' : '. נסו שוב.'), 'err'); }
    }
    return out;
  }
  const fileIcon = (n) => (isImg(n) ? 'img' : isVid(n) ? 'vid' : 'doc');
  const fileChips = (list, xAct) => (list || []).map((f, i) => '<span class="file-chip up-chip">' + (isImg(f.name) ? '<img src="' + esc(f.url) + '" alt="">' : '<span class="fi ' + esc(extOf(f.name)) + '">' + esc(extOf(f.name).toUpperCase()) + '</span>') + '<b>' + esc(f.name) + '</b><button class="icon-btn" data-act="' + xAct + ':' + i + '" aria-label="הסרה">' + ic('x', 14) + '</button></span>').join('');
  css.textContent += `
.up-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.up-chip{display:inline-flex;align-items:center;gap:8px;max-width:100%}.up-chip img{width:34px;height:34px;object-fit:cover;border-radius:6px}.up-chip b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px;font-size:13px}
.lc-img.has-logo{background:repeating-conic-gradient(#EEF1F6 0 25%,#fff 0 50%) 50%/18px 18px!important}.lc-img.has-logo img{max-width:80%;max-height:80%;object-fit:contain}
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
    if (!S.brandEdit && (S.tab.brand || 'logos') === 'docs') $$('table tbody tr').forEach((tr, i) => { const d = b.docs[i]; const btn = tr.querySelector('[data-act^="toastInfo"]'); if (d && d.url && btn) { const a = document.createElement('a'); a.className = 'btn btn-sm'; a.href = d.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'צפייה'; btn.replaceWith(a); } });
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
      if (cols.length) { t.colors = cols.slice(0, 8).map((c) => [c.n || 'צבע', c.hex.toUpperCase()]); ch.push(cols.length + ' צבעי מותג'); }
      if ((r.fonts || []).length && typeof FONTS !== 'undefined') { const f = r.fonts.find((x) => FONTS.includes(x)); if (f) { t.fonts.h = f; t.fonts.b = f; ch.push('גופן'); } }
      render();
      toast(ch.length ? 'המערכת למדה מהמסמכים' : 'המסמכים נקלטו', ch.length ? 'עודכנו: ' + ch.join(', ') + '.' : (r.summary || 'לא נמצאו בהם הנחיות מותג מפורשות.'));
      flush();
    } catch (e) { aiFail(e); }
  }
  ACT.bAddDoc = async () => {
    const fs = await uploadPicked('.pdf,.docx,.pptx,.txt,.csv,.xlsx,image/*', true);
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
    const fs = await uploadPicked('.pdf,.docx,.pptx,.txt,.csv,.xlsx,image/*', true);
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
      const fs = await uploadPicked('image/*,video/*,.pdf,.docx,.pptx,.txt,.csv', true);
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
    const [f] = await uploadPicked('.pdf,.docx,.txt,.pptx');
    if (!f || !S.dw) return;
    S.dw.file = { k: extOf(f.name), n: f.name, url: f.url };
    render();
    toast('הקובץ הועלה', f.name);
  };
  ACT.dkFile = async () => {
    dkCollect();
    const [f] = await uploadPicked('.pptx,.pdf,.docx');
    if (!f || !S.dk) return;
    S.dk.file = { k: extOf(f.name), n: f.name, sub: '', url: f.url };
    render();
    toast('המצגת הועלתה', f.name);
  };

  /* ---------- ChatGPT designs the whole graphic from the brand palette ---------- */
  const DESIGN_AR = { square: '1/1', portrait: '2/3', landscape: '3/2' };
  async function aiDesignRun(w, m, fmt, job, opts) {
    const size = IMG_SIZE(fmt);
    const logo = logoOf();
    const photos = briefPhotos(w);
    try {
      let url = '', check = { ok: true }, want = [];
      if (opts.fixOnly && m.design) {
        url = m.design; check = { ok: false, issues: m.warn || [], fixes: m.fixes || [] }; want = m.want || [];
      } else if (opts.fit && m.design && m.dsize === size && !opts.note) {
        url = m.design; check = { ok: !m.warn, issues: m.warn || [] }; want = m.want || [];
        if (m.warn) check.ok = true; // keep the existing warning, no new fix round on a resize
      } else {
        m.busy = 'ChatGPT מעצב את הגרפיקה... (כדקה)';
        m.warn = null;
        render();
        const r = await fx('image', {
          action: 'design', org: aiCtx().org, dept: w.brief.dept, size, brief: (w.brief.title || '') + '\n' + (w.brief.free || ''),
          colors: brandFor(w.brief.dept).colors, texts: { kicker: w.design.kicker, headline: w.t, sub: w.design.sub, details: w.design.details, cta: w.design.cta },
          refs: [...(logo ? [logo] : []), ...photos].slice(0, 4), logo: !!logo, note: opts.note || '', quality: 'high', n: 2,
        }, 150000);
        if (S.wiz !== w || m.job !== job) return;
        url = r.url; check = r.check || { ok: true }; want = r.want || [];
      }
      for (let round = 1; round <= 2 && !check.ok && (check.issues || []).length; round++) {
        m.busy = 'מתקנים את הטקסט בגרפיקה' + (round > 1 ? ' (סבב ' + round + ')' : '') + '...';
        m.design = url;
        render();
        try {
          const f = await fx('image', { action: 'fixtext', url, issues: check.issues, fixes: check.fixes || [], want, size }, 150000);
          if (S.wiz !== w || m.job !== job) return;
          url = f.url; check = f.check || { ok: true };
        } catch (e) { break; /* keep the last version and show the issues */ }
      }
      const keepWarn = opts.fit && m.dsize === size && !opts.note ? m.warn : null;
      m.design = url; m.want = want; m.dsize = size; m.stale = false; m.fixes = check.fixes || [];
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
      toast('העיצוב החופשי לא הושלם', 'עברנו לתבנית מותג. אפשר לנסות שוב בכפתור עיצוב AI חופשי.', 'err');
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
    h = h.replace('<div class="lay-pick" role="radiogroup" aria-label="פריסה">', '<div class="t-sub" style="margin-bottom:6px">עיצוב חופשי של ChatGPT בצבעי המותג, או תבנית מותג קבועה:</div><div class="lay-pick" role="radiogroup" aria-label="פריסה">');
    if (m.layout === 'ai') {
      h = h.replace('<div class="real-acts">', '<div class="real-acts"><button class="btn btn-sm" data-act="gNew"' + (busy ? ' disabled' : '') + '>' + ic('refresh', 14) + ' עיצוב חדש</button>' + (m.warn ? '<button class="btn btn-sm" data-act="gFix"' + (busy ? ' disabled' : '') + '>' + ic('edit', 14) + ' תיקון הטקסט</button>' : ''));
      if (m.stale) h += '<div class="note ai-warn">' + ic('edit', 15) + '<span>הכותרת השתנתה. לחצו "עיצוב חדש" כדי לעדכן את הגרפיקה.</span></div>';
      if (m.warn) h += '<div class="note ai-warn">' + ic('alert', 15) + '<span>בדיקת הטקסט מצאה: ' + m.warn.map(esc).join(' · ') + '</span></div>';
      if (briefPhotos(w).length || logoOf()) h += '<div class="t-sub" style="margin-top:8px">בעיצוב משולבים: ' + [logoOf() ? 'הלוגו מנכסי המותג' : '', briefPhotos(w).length ? briefPhotos(w).length + ' תמונות שהעליתם' : ''].filter(Boolean).join(' ו') + '.</div>';
    }
    return h;
  };
  ACT.gNew = () => { const w = S.wiz; if (!isGfx(w) || !w.media || w.media.busy) return; collectWiz(); gfxRun(w, { note: 'קומפוזיציה ועיצוב שונים לגמרי מהגרסה הקודמת' }); };
  ACT.gFix = () => { const w = S.wiz; if (!isGfx(w) || !w.media || w.media.busy) return; gfxRun(w, { fixOnly: true }); };
  // edit requests on an AI design: Claude updates the texts, ChatGPT redesigns with the request
  const _wAiD = ACT.wAi, _wAiQD = ACT.wAiQ;
  async function aiDesignEdit(w, q) {
    const m = w.media;
    m.busy = 'ה-AI מעדכן...';
    render();
    try {
      const cur = { headline: w.t, kicker: w.design.kicker, sub: w.design.sub, details: w.design.details, cta: w.design.cta };
      const r = await gen({ mode: 'revise', content: cur, instruction: q + '\nאם הבקשה נוגעת רק לעיצוב או לתמונה, החזר את הטקסטים בלי שינוי.' });
      if (S.wiz !== w) return;
      const c = r.content || {};
      if (c.headline) w.t = c.headline;
      ['kicker', 'sub', 'cta'].forEach((k) => { if (typeof c[k] === 'string') w.design[k] = c[k]; });
      if (Array.isArray(c.details)) w.design.details = c.details;
      m.busy = '';
      gfxRun(w, { note: q });
    } catch (e) { m.busy = ''; render(); aiFail(e); }
  }
  ACT.wAi = () => {
    const w = S.wiz;
    if (!isGfx(w) || !w.media || w.media.layout !== 'ai') return _wAiD();
    collectWiz();
    const el = $('#wAi'); const q = (el && el.value || '').trim();
    if (!q) { toast('מה לשנות?', 'לדוגמה: רקע בהיר יותר, להדגיש את התאריך, או תמונה של משפחה בפארק.', 'err'); return; }
    if (w.media.busy) return;
    aiDesignEdit(w, q);
  };
  ACT.wAiQ = (q) => {
    const w = S.wiz;
    if (!isGfx(w) || !w.media || w.media.layout !== 'ai') return _wAiQD(q);
    collectWiz();
    if (w.media.busy) return;
    gfxRun(w, { note: ({ 'צבעוני יותר': 'יותר צבע ואנרגיה, עדיין בפלטת המותג', 'פריסה אחרת': 'קומפוזיציה שונה לגמרי', 'כותרת גדולה': 'כותרת גדולה ובולטת הרבה יותר', 'סגנון רשמי': 'סגנון רשמי, שמרני ונקי יותר' })[q] || q });
  };
})();
