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
  function hydrateAdmin(st) {
    for (const k in ADMIN_KEYS) if (st[k] !== undefined) restore(ADMIN_KEYS[k](), st[k]);
    Object.keys(PLAN_DEF).forEach((k) => { if (!PLANS[k]) PLANS[k] = JSON.parse(JSON.stringify(PLAN_DEF[k])); PLANS[k].t = PLAN_DEF[k].t; PLANS[k].d = PLAN_DEF[k].d; PLANS[k].c = PLAN_DEF[k].c; if (!(+PLANS[k].cost > 100)) PLANS[k].cost = PLAN_DEF[k].cost; });
    VENDORS.forEach((v) => { if (typeof v.usd !== 'number') v.usd = +v.usd || 0; });
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
    replaceObj(MAIN_APPR, { n: mgr ? mgr.name : 'משתמש הארגון', r: 'משתמש ארגון', ph: (mgr && mgr.phone) || '', mail: (mgr && mgr.email) || '' });
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
    if (!SY.on || SY.busy) return;
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
    // a real organisation never starts from the demo data: empty first, then whatever the server holds
    if (!L.demo) freshClient();
    if (d.state && !d.state.fresh) hydrateClient(d.state);
    if (d.items && d.items.length) items = d.items.map((r) => r.ui).sort((a, b) => b.id - a.id);
    else if (!L.demo || !fresh) items = [];
    S.seq = items.reduce((m, i) => Math.max(m, +i.id || 0), 100);
    S.org = L.org.name;
    if (Array.isArray(d.members) && d.members.length && L.applyMembers) L.applyMembers(d.members);
    if (L.memberSlices) L.memberSlices(d.state && !d.state.fresh ? d.state : null);
    if (L.me) {
      const demoUser = L.demo && L.me.name === 'יעל כהן';
      S.user = { name: L.me.name, role: demoUser ? 'מנהלת תקשורת' : (L.me.role === 'member' ? 'משתמש יחיד' : 'משתמש ארגון'), init: initials(L.me.name), dept: L.me.dept || S.user.dept || DEPTS[0] };
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
    const wrap = (inner) => '<div style="position:relative;z-index:50;min-height:100vh;background:var(--bg,#F4F6FB);padding:28px 16px;font-family:Heebo,sans-serif"><div style="max-width:760px;margin:0 auto">' + inner + '</div></div>';
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
        '<div class="field"><label for="sgName">שם מלא של החותם/ת</label><input type="text" id="sgName" value="' + esc(d.org.contact || '') + '"></div>' +
        '<label class="checkline" style="margin:12px 0;gap:10px;display:flex;align-items:center"><input type="checkbox" id="sgOk"> <span>קראתי את ההסכם ואני מאשר/ת אותו בשם ' + esc(d.org.name) + '</span></label>' +
        '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button class="btn btn-primary btn-lg" id="sgBtn">' + ic('sign', 16) + ' חתימה על ההסכם</button><button class="btn" id="sgPrint">' + ic('down', 16) + ' הדפסה / PDF</button></div></div>';
    root.innerHTML = wrap('<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px"><b style="font-size:22px;color:#4A1BE8">PrimeOS</b><span class="t-sub">הסכם מנוי · ' + esc(d.org.name) + '</span></div><div class="card card-pad agr-page">' + doc() + '</div>' + form);
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
  /* the console shows the real organisations only: the demo municipalities of the mockup never appear */
  const ROLE_A = { owner: 'משתמש ארגון', admin: 'משתמש ארגון', member: 'משתמש יחיד' };
  function liveAdmin(real) {
    const keep = ['uLim', 'dLim', 'agr', 'add', 'c', 'type', 'ch', 'xch', 'xu', 'st'];
    const list = real.map((r) => {
      const ext = r.plan !== 'basic';
      const id = r.ui_id ? 'o' + r.ui_id : 'r' + String(r.id).slice(0, 8);
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
  const linkOf = (o) => location.origin + '/?k=' + encodeURIComponent(o.live.token);
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
  // every user of the client with a personal login link: the organisation user and each department user
  const tokLink = (t) => location.origin + '/?k=' + encodeURIComponent(t);
  function memberLinks(o) {
    const ms = o.members || [];
    const dept = ms.filter((m) => m.role === 'member');
    const rows = ms.map((m) => '<div class="ml-row" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--line-2)">' +
      '<span style="flex:1;min-width:160px"><b>' + esc(m.name) + '</b> <span class="t-sub">' + (m.role === 'member' ? 'משתמש יחיד' + (m.dept ? ' · ' + esc(m.dept) : '') : 'משתמש ארגון') + '</span></span>' +
      (m.token ? '<button class="btn btn-sm" data-act="liveCopyTok:' + esc(m.token) + '">' + ic('copy', 14) + ' העתקת קישור</button><a class="btn btn-sm" target="_blank" rel="noopener" href="' + esc(tokLink(m.token)) + '">' + ic('eye', 14) + ' כניסה</a>' : '<span class="t-sub">אין קישור</span>') + '</div>').join('');
    return '<div style="margin-top:14px"><b style="font-size:13.5px">משתמשים וקישורי כניסה</b>' + rows +
      (dept.length ? '' : '<div class="note" style="margin-top:8px">' + ic('help', 14) + '<span>עדיין אין משתמשי מחלקה. משתמש הארגון פותח אותם מתוך הממשק שלו: צוות והרשאות -> הזמנת משתמש -> סוג "משתמש יחיד". הקישור שנוצר מופיע גם כאן.</span></div>') + '</div>';
  }
  ACT.liveCopyTok = (t) => { const l = tokLink(t); navigator.clipboard.writeText(l).then(() => toast('הקישור הועתק', ''), () => prompt('קישור כניסה', l)); };
  function linkBox(o) {
    return '<div class="card card-pad" style="margin-top:14px;text-align:start"><b style="font-size:13.5px">קישור כניסה ללקוח</b>' +
      '<div class="t-sub" style="margin:4px 0 10px">שולחים את הקישור לאיש הקשר. הכניסה ישירה, בלי סיסמה.</div>' +
      '<div style="display:flex;gap:8px;align-items:center"><input type="text" readonly value="' + esc(linkOf(o)) + '" style="flex:1;direction:ltr;font-size:12.5px" onclick="this.select()">' +
      '<button class="btn btn-sm btn-primary" data-act="liveCopy:' + o.id + '">' + ic('copy', 14) + ' העתקה</button>' +
      '<a class="btn btn-sm" target="_blank" rel="noopener" href="https://wa.me/' + waNum(o.phone) + '?text=' + encodeURIComponent('שלום ' + (o.contact || '') + ', נפתח עבור ' + o.n + ' חשבון במערכת PrimeOS.\nקישור הכניסה האישי שלך (בלי סיסמה):\n' + linkOf(o) + (signLinkOf(o) && !(o.agr && o.agr.signed) ? '\n\nהסכם המנוי לחתימה דיגיטלית:\n' + signLinkOf(o) : '') + '\n\nהקישורים אישיים, לא להעביר הלאה.') + '">' + ic('send', 14) + ' WhatsApp</a></div>' +
      memberLinks(o) +
      '<div style="margin-top:14px;display:flex;justify-content:flex-end"><button class="btn btn-sm btn-quiet-bad" data-act="liveDelete:' + o.id + '">' + ic('x', 14) + ' מחיקת הלקוח לצמיתות</button></div></div>';
  }
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
  const FX = 'https://tgropjisnheppsxejfdn.supabase.co/functions/v1/';
  const fx = (name, body, ms) => post(FX + name, body, ms || 150000);
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
  // 'ai' = free design in the brand colours; 'tpl:<id>' = the organisation's own template, only texts and imagery change
  const isAiLay = (l) => l === 'ai' || /^tpl:/.test(String(l || ''));
  const tplOf = (l) => { const id = /^tpl:(.+)$/.exec(String(l || '')); return id ? ((typeof BRAND !== 'undefined' && BRAND.tpls) || []).find((t) => t.url && String(t.id) === id[1]) || null : null; };
  function brandFor(dept) {
    const c = (typeof BRAND !== 'undefined' && BRAND.colors) || [];
    return { org: aiCtx().org, dept: dept || aiCtx().dept || '', colors: c.map((x) => (Array.isArray(x) ? x[1] : x)) };
  }
  async function aiImage(o) {
    const r = await fx('image', { brief: o.brief || '', title: o.title || '', dept: o.dept || '', people: o.people || 'auto', style: o.style || 'photo', size: o.size || 'square', quality: o.quality || 'high', model: o.model || undefined, colors: brandFor(o.dept).colors }, 150000);
    return r.url;
  }
  /* a photo for every slide of a presentation (fast image model, medium quality); reused by slide title between re-renders */
  async function deckImages(w, m, d) {
    const sl = d.slides || [];
    m.imgBy = m.imgBy || {};
    const keyOf = (s, i) => (s.kind || 'b') + '|' + (i === 0 ? (d.title || s.t || '') : (s.t || '')) + '|' + ((s.pts || []).slice(0, 2).join(' '));
    const briefOf = (s, i) => ((m.imgNote && m.imgNote[i]) ? m.imgNote[i] + '\n' : '') + (i === 0 ? 'תמונת שער רחבה ואווירתית למצגת: ' + (d.title || w.title) : s.kind === 'end' ? 'תמונת סיום חמה ואופטימית למצגת: ' + (d.title || w.title) : 'תמונה שמלווה את השקף "' + (s.t || '') + '": ' + (s.pts || []).slice(0, 3).join('. ')) + '\n' + (w.prompt || '');
    const todo = sl.map((s, i) => [s, i]).filter(([s, i]) => !m.imgBy[keyOf(s, i)]);
    // up to 4 images at a time
    let at = 0;
    const worker = async () => { while (at < todo.length) { const [s, i] = todo[at++]; try { m.imgBy[keyOf(s, i)] = await aiImage({ title: w.title, brief: briefOf(s, i), size: 'landscape', quality: 'medium', model: FAST_IMG }); } catch (e) { /* that slide stays without a photo */ } } };
    await Promise.all(Array.from({ length: Math.min(4, todo.length) }, worker));
    const out = {};
    sl.forEach((s, i) => { const u = m.imgBy[keyOf(s, i)]; if (u) out['s' + i] = u; });
    if (out.s0) out.cover = out.s0;
    return out;
  }
  async function produce(jobs, dept) {
    const b = brandFor(dept);
    try {
      if (b.colors && b.colors[0] && lum(b.colors[0]) > 0.18) {
        let c = b.colors[0]; for (let t = 0; lum(c) > 0.18 && t < 12; t++) c = mix(c, '#000000', 0.12);
        b.colors = [c, ...b.colors.slice(1)];
      }
    } catch (e) { /* keep the palette as is */ }
    return fx('produce', { brand: b, jobs }, 150000);
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
.sp-mb .pth-orb{--s:68px}.sp-mb .pth-ph{color:#fff;font-size:14px;max-width:260px}
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
      if (isAiLay(w.media.layout)) { w.media.stale = true; render(); return; }
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
      if (cols.length) { const pal = paletteFrom(cols.map((c) => c.hex.toUpperCase())); pal.forEach((x) => { x[0] = x[0].replace('(מהלוגו)', '(מהמסמך)'); }); if (cols[0] && cols[0].n) pal[0][0] = cols[0].n + ' (מהמסמך)'; t.colors = pal; ch.push(cols.length + ' צבעי מותג'); }
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
        const r = await fx('image', {
          action: 'design', org: aiCtx().org, dept: w.brief.dept, size, brief: (w.brief.title || '') + '\n' + (w.brief.free || ''),
          colors: brandFor(w.brief.dept).colors, texts: { kicker: w.design.kicker, headline: w.t, sub: w.design.sub, details: w.design.details, cta: w.design.cta },
          refs: [...(logo && !tpl ? [logo] : []), ...photos].slice(0, tpl ? 3 : 4), logo: !!logo && !tpl, note: opts.note || '', quality: 'high', n: 2,
          template: tpl ? { url: tpl.url, desc: tpl.desc || '', slots: tpl.slots || [] } : undefined,
        }, 150000);
        if (S.wiz !== w || m.job !== job) return;
        url = r.url; check = r.check || { ok: true }; want = r.want || []; m.model = r.model || '';
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
      if (m.stale) h += '<div class="note ai-warn">' + ic('edit', 15) + '<span>הכותרת השתנתה. לחצו "עיצוב חדש" כדי לעדכן את הגרפיקה.</span></div>';
      if (m.warn) h += '<div class="note ai-warn">' + ic('alert', 15) + '<span>בדיקת הטקסט מצאה: ' + m.warn.map(esc).join(' · ') + '</span></div>';
      if (m.model && m.url) h += '<div class="t-sub" style="margin-top:8px">' + ic('img', 13) + ' עוצב ב-ChatGPT, מודל <span dir="ltr">' + esc(m.model) + '</span> · <a href="' + esc(m.design || m.url) + '" target="_blank" rel="noopener">הקובץ המקורי</a></div>';
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
    let W = 1200, H = 1200;
    if (vb && +vb[1] && +vb[2]) { const a = +vb[1], b = +vb[2]; if (a >= b) H = Math.round(1200 * b / a); else W = Math.round(1200 * a / b); }
    const tag = m[0].replace(/\s(width|height)=["'][^"']*["']/gi, '').replace(/<svg/i, '<svg width="' + W + '" height="' + H + '"');
    return new Blob([t.replace(m[0], tag)], { type: 'image/svg+xml' });
  }
  async function processLogo(file) {
    const src = URL.createObjectURL(await svgSized(file));
    try {
      const img = await loadImg(src);
      let w = img.naturalWidth || 1000, h = img.naturalHeight || 1000;
      const k = Math.max(w, h) > 1400 ? 1400 / Math.max(w, h) : Math.max(w, h) < 700 ? 1000 / Math.max(w, h) : 1;
      w = Math.round(w * k); h = Math.round(h * k);
      const c = canvasOf(w, h), x = c.getContext('2d', { willReadFrequently: true });
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
      return { png: await blobOf(out), light: await blobOf(lt), colors, removed, hadAlpha, w: tw, h: th };
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
        b.logoInfo = { colors: r.colors, removed: r.removed, hadAlpha: r.hadAlpha, name: file.name, at: new Date().toLocaleDateString('he-IL') };
        b.colors = pal;
      };
      apply(BRAND);
      if (S.brandEdit && S.brandDraft) apply(S.brandDraft);
      S.logoBusy = '';
      S.logoFresh = Date.now();
      render();
      flush();
      if (r.colors.length) toast('הלוגו עודכן וצבעי המותג הוחלפו', (r.removed ? 'הרקע הוסר אוטומטית. ' : '') + r.colors.length + ' צבעים זוהו בלוגו. הצבע הראשי החדש: \u200E' + pal[0][1]);
      else toast('הלוגו עודכן', 'לא זוהו בלוגו צבעים ברורים, נשארו צבעי ברירת המחדל. אפשר לשנות אותם בלשונית צבעים ופונטים.', 'err');
    } catch (e) {
      S.logoBusy = '';
      render();
      toast('עיבוד הלוגו נכשל', 'נסו קובץ PNG, JPG או SVG אחר.', 'err');
    }
  }
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
.lo-prev{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.lo-prev>div{aspect-ratio:4/3;border-radius:14px;display:grid;place-items:center;padding:18px;border:1px solid var(--line,#DDE3EC)}
.lo-prev .lo-l{background:repeating-conic-gradient(#EEF1F6 0 25%,#fff 0 50%) 50%/18px 18px}
.lo-prev img{max-width:100%;max-height:100%;object-fit:contain}
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
      ? '<div class="lo-prev"><div class="lo-l"><img src="' + esc(l.url) + '" alt="הלוגו"></div><div class="lo-d" style="background:' + esc((b.colors[0] || [])[1] || '#0E3B6B') + '"><img src="' + esc(b.logoLight || l.url) + '" alt="הלוגו על רקע כהה"></div></div>'
      : '<div class="lo-prev"><div class="lo-l" style="background:var(--surface-2,#F3F5F9)"><span class="t-sub">עוד לא הועלה לוגו</span></div><div class="lo-d" style="background:#0E3B6B"><span style="color:#fff;font-size:13px">גרסה לרקע כהה</span></div></div>';
    const panel = '<div class="card card-pad logo-one">' + prev + '<div class="lo-info"><h3>הלוגו של הארגון</h3>' +
      '<span class="t-sub">מעלים לוגו אחד. המערכת מסירה רקע אם צריך, חותכת שוליים, יוצרת גרסה לבנה לרקע כהה ומחלצת ממנו את צבעי המותג.</span>' +
      (S.logoBusy ? '<div class="lo-busy">' + thinkBox(1) + '</div>' : '') +
      (l && info.colors ? '<div class="lo-pal' + (S.logoFresh && Date.now() - S.logoFresh < 8000 ? ' fresh' : '') + '"><b style="font-size:13.5px">צבעי המותג, נשלפו מהלוגו</b><div class="lo-sw">' + (b.colors || []).slice(0, 6).map((c) => '<span title="' + esc(c[0]) + '"><i style="background:' + esc(c[1]) + '"></i><em>' + esc(c[0].replace(/ \(מהלוגו\)/, '')) + '</em><small dir="ltr">' + esc(c[1]) + '</small></span>').join('') + '</div></div>' : '') +
      (l && info.colors ? '<div><b style="font-size:13.5px">הצבעים שזוהו בלוגו</b><div class="lo-chips" style="margin-top:6px">' + info.colors.map((c) => '<span><i style="background:' + c + '"></i>' + c + '</span>').join('') + '</div></div>' +
        '<div class="note">' + ic('palette', 15) + '<span>הוחלו על צבעי המותג' + (info.removed ? ' · הרקע הוסר אוטומטית' : info.hadAlpha ? ' · הלוגו הגיע שקוף' : '') + '. <button class="link-btn" data-act="tab:brand:colors" style="background:none;border:0;padding:0;font:inherit;color:var(--brand);font-weight:700;cursor:pointer">לצבעים ופונטים</button></span></div>' : '') +
      '<div><button class="btn btn-primary" data-act="logoUp"' + (S.logoBusy ? ' disabled' : '') + '>' + ic('upload', 16) + ' ' + (l ? 'החלפת לוגו' : 'העלאת לוגו') + '</button></div>' +
      '<span class="t-sub">PNG, JPG או SVG. רקע אחיד מוסר אוטומטית.</span></div></div>';
    return h.replace(/<div class="grid g-4">[\s\S]*?(<div class="card card-pad lp-card">)/, panel + '$1');
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
      '<span class="t-sub" style="display:block;margin:4px 0 8px">תוכנית עבודה, לוח אירועים או כל מסמך. Claude קורא אותו ובונה ממנו את הסדרה.</span>';
    return h.replace(/<div class="up-row">[\s\S]*?<\/button><\/div>(?=<textarea id="bBrief")/, up).replace(/<div class="file-chip">[\s\S]*?<\/button><\/div>(?=<textarea id="bBrief")/, up)
      .replace('<span>טקסט + גרפיקה לכל תוכן</span>', '<span>טקסט ב-Claude, גרפיקה ב-ChatGPT</span>');
  };
  ACT.bUpload = async () => { const fs = await uploadPicked('.pdf,.docx,.pptx,.txt,.csv,image/*', true); if (!fs.length) return; S.bulk.files = [...(S.bulk.files || []), ...fs]; render(); };
  ACT.bFileX2 = (i) => { (S.bulk.files || []).splice(+i, 1); render(); };
  // generation: texts first (Claude, in batches), then the graphics fill in one by one
  const GQ = { list: [], run: 0, max: 2 };
  function campOf(x) { return (S.camps || []).find((c) => c.items.includes(x)); }
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
      let r = await fx('image', { action: 'design', org: aiCtx().org, dept: c.dept, size, brief: x.t + '\n' + (x.body || ''), colors: brandFor(c.dept).colors, texts: tx,
        refs: logo ? [logo] : [], logo: !!logo, note: note || '', quality: 'high', n: 1, model: FAST_IMG }, 150000);
      let url = r.url, check = r.check || { ok: true }; m.model = r.model || '';
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
        const r = await fx('generate', Object.assign(aiCtx(), { mode: 'series', dept: b.dept, brief: b.brief, files, avoid: avoid.slice(-30), slots: part.map((x) => ({ i: x.i, date: x.date, hol: x.hol || '' })) }), 150000);
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
    camp.items.forEach((x) => queueGraphic(camp, x));
    toast('הטקסטים מוכנים', 'מעצבים עכשיו את הגרפיקות, שתיים במקביל. אפשר לעבור על הפוסטים בינתיים.');
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
      (m.model && m.url ? '<div class="t-sub" style="margin-bottom:8px">' + ic('img', 13) + ' עוצב ב-ChatGPT, מודל <span dir="ltr">' + esc(m.model) + '</span> · <a href="' + esc(m.design || m.url) + '" target="_blank" rel="noopener">הקובץ המקורי</a></div>' : '') +
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
    const ROLE_T = { owner: 'משתמש ארגון', admin: 'משתמש ארגון', member: 'משתמש יחיד' };
    const linkOfTok = (t) => location.origin + '/?k=' + encodeURIComponent(t);
    const waShare = (name, link) => 'https://wa.me/?text=' + encodeURIComponent('שלום ' + name + ', זה קישור הכניסה האישי שלך למערכת PrimeOS של ' + (L.org ? L.org.name : '') + ':\n' + link + '\nהקישור אישי, לא להעביר הלאה.');
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
      return '<div class="tbl-wrap"><table class="responsive"><thead><tr><th>שם</th><th>תפקיד</th><th>מחלקה</th><th>פרסום</th><th>קישור כניסה</th><th></th></tr></thead><tbody>' +
        users.map((u) => '<tr><td data-l="שם"><span style="display:flex;align-items:center;gap:9px"><span class="avatar">' + esc(u.i) + '</span><span><b>' + esc(u.n) + '</b>' + (u.phone ? '<div class="t-sub" dir="ltr" style="text-align:start">' + esc(u.phone) + '</div>' : '') + '</span></span></td>' +
          '<td data-l="תפקיד">' + esc(u.r) + (u.mid === me ? ' <span class="badge s-approved">את/ה</span>' : '') + '</td><td data-l="מחלקה">' + esc(u.d) + '</td>' +
          '<td data-l="פרסום">' + (u.role === 'member' ? '<button class="chip" data-act="userDirect:' + esc(u.mid) + '" title="לחיצה משנה">' + (u.direct ? ic('checkc', 13) + ' פרסום ישיר' : ic('clock', 13) + ' דרוש אישור') + '</button>' : '<span class="t-sub">ישיר</span>') + '</td>' +
          '<td data-l="קישור כניסה">' + (u.tok ? '<span style="display:inline-flex;gap:6px;flex-wrap:wrap"><button class="btn btn-sm" data-act="userLink:' + esc(u.mid) + '">' + ic('copy', 14) + ' העתקה</button><a class="btn btn-sm" target="_blank" rel="noopener" href="' + waShare(u.n, linkOfTok(u.tok)) + '">' + ic('send', 14) + ' WhatsApp</a></span>' : '<span class="t-sub">-</span>') + '</td>' +
          '<td>' + (u.mid && u.mid !== me && u.role !== 'owner' ? '<span style="display:inline-flex;gap:6px;flex-wrap:wrap"><button class="btn btn-sm" data-act="userRelink:' + esc(u.mid) + '">קישור חדש</button><button class="btn btn-sm btn-quiet-bad" data-act="userRemove:' + esc(u.mid) + '">הסרה</button></span>' : '') + '</td></tr>').join('') +
        '</tbody></table></div>' +
        (users.length <= 1 ? '<div class="note" style="margin-top:14px">' + ic('users', 15) + '<span>עדיין אין משתמשי מחלקה. בלחיצה על „הזמנת משתמש” נפתח משתמש ומתקבל קישור כניסה אישי לשליחה.</span></div>' : '');
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
      openDrawer('<div class="drawer-head"><div><h3>הזמנת משתמש</h3><p>המשתמש מקבל קישור כניסה אישי. בלי סיסמה.</p></div>' +
        '<button class="icon-btn" style="margin-inline-start:auto" data-act="closeDrawer" aria-label="סגירה">' + ic('x', 17) + '</button></div>' +
        '<div class="drawer-body">' +
        '<div class="field"><label for="ivName">שם מלא</label><input type="text" id="ivName" placeholder="לדוגמה: דנה לוי"></div>' +
        '<div class="field"><label for="ivKind">סוג משתמש</label><select id="ivKind"><option value="dept">משתמש יחיד (המחלקה שלו בלבד)</option><option value="ext">משתמש ארגון (כל המערכת, מחלקות ואישורים)</option></select></div>' +
        '<div class="field" id="ivDeptWrap"><label for="ivDept">מחלקה</label><select id="ivDept">' + DEPTS.map((d) => '<option>' + esc(d) + '</option>').join('') + '</select></div>' +
        '<div class="field"><label for="ivPhone">טלפון נייד</label><input type="text" id="ivPhone" inputmode="tel" dir="ltr" placeholder="050-0000000"></div>' +
        '<div class="field"><label for="ivMail">דוא״ל (לא חובה)</label><input type="text" id="ivMail" inputmode="email" dir="ltr" placeholder="name@example.muni.il"></div>' +
        '<label class="chk" id="ivDirectWrap" style="display:flex;gap:8px;align-items:center;margin:4px 0 10px"><input type="checkbox" id="ivDirect"> רשאי לפרסם ישירות, בלי אישור של משתמש הארגון</label>' +
        '<div class="note">' + ic('shield', 16) + '<span>משתמש יחיד רואה רק את התוכן של המחלקה שלו. בלי ההרשאה שלמעלה, כל תוכן שלו עובר אישור של משתמש הארגון לפני פרסום.</span></div></div>' +
        '<div class="drawer-foot"><button class="btn btn-primary" data-act="doInvite">פתיחת משתמש וקבלת קישור</button><button class="btn" data-act="closeDrawer">ביטול</button></div>');
      const k = $('#ivKind'), w = $('#ivDeptWrap');
      const dw = $('#ivDirectWrap');
      if (k && w) k.onchange = () => { w.style.display = k.value === 'dept' ? '' : 'none'; if (dw) dw.style.display = k.value === 'dept' ? '' : 'none'; };
    };
    const _doInvite = ACT.doInvite;
    ACT.doInvite = async () => {
      if (!L.members) return _doInvite();
      const name = ($('#ivName') && $('#ivName').value || '').trim();
      if (!name) { toast('חסר שם', 'כתבו את שם המשתמש.', 'err'); return; }
      const view = $('#ivKind') ? $('#ivKind').value : 'dept';
      const dept = $('#ivDept') ? $('#ivDept').value : '';
      const phone = ($('#ivPhone') && $('#ivPhone').value || '').trim();
      const email = ($('#ivMail') && $('#ivMail').value || '').trim();
      const direct = view !== 'dept' || !!($('#ivDirect') && $('#ivDirect').checked);
      const done = busyBtn('[data-act="doInvite"]', 'פותחים...');
      try {
        const r = await call('members.create', { name, view, dept, phone, email, direct });
        const m = { id: r.id, name, role: view === 'dept' ? 'member' : 'admin', dept: view === 'dept' ? dept : null, view, phone, email, perms: { direct }, token: r.token };
        L.applyMembers([...(L.members || []), m]);
        closeDrawer();
        render();
        linkModal(m);
        if (email || phone) {
          call('members.send', { id: r.id, mail: !!email, wa: !!phone }).then((st) => {
            const ok = [st.mail === 'sent' ? 'מייל' : '', st.wa === 'sent' ? 'WhatsApp' : ''].filter(Boolean).join(' + ');
            const box = $('#modalBox .mb');
            if (box) box.insertAdjacentHTML('beforeend', '<div class="note" style="margin-top:12px">' + ic(ok ? 'checkc' : 'alert', 14) + '<span>' + (ok ? 'הקישור נשלח גם ב' + ok + '.' : 'השליחה האוטומטית נכשלה. אפשר לשלוח ידנית.') + '</span></div>');
          }).catch(() => {});
        }
      } catch (e) { done(); toast('הפתיחה נכשלה', e.message === 'forbidden' ? 'אין לך הרשאה לפתוח משתמשים.' : 'נסו שוב בעוד רגע.', 'err'); }
    };
    function linkModal(m) {
      const link = linkOfTok(m.token);
      openModal('<div class="mb"><div class="m-ic ok">' + ic('checkc', 20) + '</div><h3>המשתמש נפתח</h3><p>„' + esc(m.name) + '” · ' + esc(ROLE_T[m.role] || '') + (m.dept ? ' · ' + esc(m.dept) : '') + '</p>' +
        '<div style="display:flex;gap:8px;align-items:center;margin-top:14px"><input type="text" readonly value="' + esc(link) + '" style="flex:1;direction:ltr;font-size:12.5px" onclick="this.select()"><button class="btn btn-sm btn-primary" data-act="userLink:' + esc(m.id) + '">' + ic('copy', 14) + ' העתקה</button></div>' +
        '<p class="t-sub" style="margin-top:10px">הקישור אישי. מי שמחזיק בו נכנס למערכת בשם המשתמש הזה. אפשר להנפיק קישור חדש בכל רגע מטבלת הצוות.</p></div>' +
        '<div class="modal-foot"><a class="btn btn-primary" target="_blank" rel="noopener" href="' + waShare(m.name, link) + '">' + ic('send', 16) + ' שליחה ב-WhatsApp</a><button class="btn" data-act="closeModal">סגירה</button></div>');
    }
    ACT.closeModal = ACT.closeModal || (() => closeModal());
    ACT.userLink = (mid) => {
      const u = users.find((x) => x.mid === mid); if (!u || !u.tok) return;
      const t = linkOfTok(u.tok);
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast('הקישור הועתק', u.n), () => toast('העתקה ידנית', t));
    };
    ACT.userDirect = async (mid) => {
      const m = (L.members || []).find((x) => x.id === mid); if (!m || !canManage()) return;
      const direct = !(m.perms && m.perms.direct);
      try { await call('members.update', { id: mid, perms: { direct } }); m.perms = Object.assign({}, m.perms, { direct }); L.applyMembers(L.members); render(); toast(direct ? 'פרסום ישיר הופעל' : 'הפרסום דורש אישור', m.name); }
      catch (e) { toast('העדכון נכשל', 'נסו שוב בעוד רגע.', 'err'); }
    };
    ACT.userRelink = (mid) => {
      const u = users.find((x) => x.mid === mid); if (!u) return;
      confirmModal({ title: 'קישור חדש ל„' + u.n + '”?', body: 'הקישור הישן יפסיק לעבוד מיד. שולחים למשתמש את הקישור החדש.', ok: 'הנפקת קישור חדש', tone: 'warn', icon: 'alert',
        onOk: async () => { try { const r = await call('members.relink', { id: mid }); const m = (L.members || []).find((x) => x.id === mid); if (m) m.token = r.token; L.applyMembers(L.members); render(); linkModal(Object.assign({}, m, { token: r.token })); } catch (e) { toast('לא הצלחנו להנפיק קישור', 'נסו שוב בעוד רגע.', 'err'); } } });
    };
    ACT.userRemove = (mid) => {
      const u = users.find((x) => x.mid === mid); if (!u) return;
      confirmModal({ title: 'להסיר את „' + u.n + '”?', body: 'הקישור שלו יפסיק לעבוד. התכנים שיצר נשארים בספרייה.', ok: 'הסרת המשתמש', tone: 'warn', icon: 'alert',
        onOk: async () => { try { await call('members.remove', { id: mid }); L.applyMembers((L.members || []).filter((x) => x.id !== mid)); render(); toast('המשתמש הוסר', u.n); } catch (e) { toast('ההסרה נכשלה', e.message === 'owner_protected' ? 'את מנהל המערכת הראשי אי אפשר להסיר.' : 'נסו שוב בעוד רגע.', 'err'); } } });
    };
    // the demo "edit user" drawer makes no sense for real members: open the link actions instead
    const _userEdit = ACT.userEdit;
    ACT.userEdit = (i) => { if (!L.members) return _userEdit(i); const u = users[+i]; if (u && u.tok) ACT.userLink(u.mid); };
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
    ['wizPublish', 'sched', 'cPublish', 'publish'].forEach((k) => { const f = ACT[k]; if (!f) return; ACT[k] = (...a) => { if (isSingle() && !canDirect()) { toast('הפרסום דורש אישור', 'התוכן נשלח לאישור של משתמש הארגון.', ''); return ACT.wizSend ? ACT.wizSend() : undefined; } return f.apply(null, a); }; });
  })();
  /* ---------------- publishing: real channels and real posts through the provider layer ----------------
   * The server talks to the publishing provider (Zernio today, replaceable). The UI only knows:
   * ch.list / ch.connect / ch.disconnect, and that a scheduled or published item goes out by itself. */
  (function () {
    const CHK = ['fb', 'ig', 'x', 'yt', 'li', 'tk', 'th', 'gb', 'tg', 'wa'];
    // networks added on top of the mockup's six
    Object.assign(CH, { th: { t: 'Threads', b: '#101010', s: 'TH' }, gb: { t: 'גוגל לעסקים', b: '#4285F4', s: 'G' }, tg: { t: 'Telegram', b: '#229ED9', s: 'TG' }, wa: { t: 'WhatsApp', b: '#25A244', s: 'WA' } });
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
})();
