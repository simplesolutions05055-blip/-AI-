/* PrimeOS live layer.
 * The UI is the approved mockup (index.html) untouched. This file connects it to
 * the real backend: link login, persistence of every screen's data, and Claude
 * text generation. Loaded after the mockup scripts; boots the app.
 */
(function () {
  'use strict';
  const API = '/api/v2';
  const GEN = '/api/generate';
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
  const gen = (payload) => post(GEN, Object.assign(aiCtx(), payload), 95000);

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
})();
