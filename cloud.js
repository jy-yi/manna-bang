/* ============================================================================
   만나방 · Supabase 연동 계층 (cloud.js)
   ----------------------------------------------------------------------------
   · UI(index.html)는 이 파일이 제공하는 window.MannaCloud 만 씁니다.
   · 여기에는 publishable(anon) 키만 들어갑니다. service_role 키는 절대 넣지 않습니다.
   · 로그인 세션 규칙
       - 주선자: localStorage · 1시간 (지나면 자동 로그아웃)
       - 손님  : sessionStorage · 탭을 닫을 때까지
     토큰은 Supabase Auth 가 발급하고, 우리는 만료 시각만 직접 관리합니다.
   · 토큰 회전(refresh)의 주인은 이 파일 하나뿐입니다.
     supabase-js 에게 회전을 맡기면, 라이브러리가 몰래 회전시킨 토큰과 우리가
     들고 있는 사본이 어긋나 다음 새로고침에서 로그인이 통째로 날아갑니다(§세션 복원).
   · 사진은 비공개 버킷(manna-photos)에 올리고, 표시할 때만 서명 URL(2시간)을 받습니다.
   ============================================================================ */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  /* 테스트용 목(mock) 주입 통로 */
  if (window.__MANNA_MOCK_CLOUD__) { window.MannaCloud = window.__MANNA_MOCK_CLOUD__; return; }
  if (!window.supabase || !window.supabase.createClient) { window.MannaCloud = null; return; }

  var SUPABASE_URL = 'https://pzvlgehxokxpsinlshua.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_s2wojq0RWfcd6KvdpmeVuQ_FFVoF2vz';
  var BUCKET = 'manna-photos';
  var SIGNED_TTL = 60 * 60 * 2;              /* 서명 URL 2시간 */
  var AGENT_TTL = 60 * 60 * 1000;            /* 주선자 로그인 1시간 */
  var AUTH_KEY = 'mannabang.auth.v2';
  var GUEST_KEY = 'mannabang.guest.v2';
  var GUEST_EMAIL = 'guest@manna.local';
  /* supabase-js 는 세션 만료 90초 전부터 스스로 토큰을 회전시킨다(내부 상수 3×30초).
     우리가 그보다 먼저(150초 전) 갱신해서 라이브러리가 손댈 일을 없앤다. */
  var AUTH_MARGIN = 150;
  var refreshInFlight = null;   /* 동시 회전 방지(두 번 회전하면 하나는 죽은 토큰이 된다) */
  var libToken = null;          /* 지금 supabase-js 메모리에 들어가 있는 액세스 토큰 */

  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  /* ---------------------------------------------------------------- 유틸 */
  function nowS() { return Math.floor(Date.now() / 1000); }

  function jwtExp(token) {
    try {
      var part = String(token || '').split('.')[1] || '';
      var s = part.replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) s += '=';
      var bin = atob(s), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var json = JSON.parse(new TextDecoder('utf-8').decode(bytes));
      return Number(json.exp) || 0;
    } catch (e) { return 0; }
  }

  function readJson(store, key) {
    try {
      var raw = store.getItem(key);
      if (!raw) return null;
      var o = JSON.parse(raw);
      return (o && typeof o === 'object') ? o : null;
    } catch (e) { return null; }
  }
  function writeJson(store, key, obj) {
    try { store.setItem(key, JSON.stringify(obj)); return true; } catch (e) { return false; }
  }
  function dropKey(store, key) { try { store.removeItem(key); } catch (e) {} }

  /* 세션 레코드 = { mode, id?, expiresAt?, access, refresh }
     주선자는 localStorage, 손님은 sessionStorage. 토큰의 유일한 사본이다. */
  function recSpot(rec) { return (rec && rec.mode === 'guest') ? window.sessionStorage : window.localStorage; }
  function recKey(rec) { return (rec && rec.mode === 'guest') ? GUEST_KEY : AUTH_KEY; }
  function persist(rec) {
    var out = { mode: rec.mode, access: rec.access, refresh: rec.refresh };
    if (rec.mode !== 'guest') { out.id = rec.id; out.expiresAt = rec.expiresAt; }
    return writeJson(recSpot(rec), recKey(rec), out);
  }
  function activeRecord() {
    var a = readJson(window.localStorage, AUTH_KEY);
    if (a && a.mode === 'agent' && a.access && a.refresh) return a;
    var g = readJson(window.sessionStorage, GUEST_KEY);
    if (g && g.mode === 'guest' && g.access && g.refresh) return g;
    return null;
  }

  /* ---------------------------------------------------------- 오류 구분 */
  /* kind: no_token | no_refresh | refresh | set_session | lost
     fatal=true  → 서버가 토큰을 거부했다(진짜 만료·폐기) → 세션을 버린다
     fatal=false → 네트워크·5xx·429 등 일시 오류 → 세션을 남기고 다시 시도한다 */
  function sessErr(kind) {
    var e = new Error(kind);
    e.kind = kind; e.fatal = false; e.network = false; e.status = 0;
    return e;
  }
  function isTransientErr(e) {
    if (!e) return false;
    if (e.network) return true;
    if (e.fatal === false && e.kind) return true;
    var st = Number(e.status || 0);
    if (st >= 500 || st === 429 || st === 408) return true;
    var m = String(e.message || e || '');
    return /Failed to fetch|NetworkError|network request failed|Load failed|timed? ?out|연결하지 못했|서버에 연결/i.test(m);
  }

  /* ------------------------------------------------------- 세션 복원/갱신 */
  /* Supabase Auth 의 refresh_token 은 1회용(회전)이다. 새 토큰은 반드시
     받은 즉시 레코드에 저장하고, supabase-js 에는 방금 받은 신선한 토큰만 넣는다. */
  function refreshTokens(refreshToken) {
    if (!refreshToken) { var ne = sessErr('no_refresh'); ne.fatal = true; return Promise.reject(ne); }
    return fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken })
    }).then(function (res) {
      return res.text().then(function (raw) {
        var body = null;
        try { body = raw ? JSON.parse(raw) : null; } catch (e) {}
        if (res.ok && body && body.access_token) return body;
        var e = sessErr('refresh');
        e.status = res.status;
        var code = String((body && (body.error_code || body.error || body.msg || body.message)) || '');
        e.detail = code || ('HTTP ' + res.status);
        e.fatal = (res.status === 400 || res.status === 401 || res.status === 403) &&
                  !/rate|too many/i.test(code);
        throw e;
      });
    }, function () {
      var e = sessErr('network'); e.network = true; e.fatal = false; throw e;
    });
  }

  function rotate(rec) {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = refreshTokens(rec.refresh).then(function (body) {
      rec.access = body.access_token;
      if (body.refresh_token) rec.refresh = body.refresh_token;
      persist(rec);
      libToken = null;              /* 라이브러리 사본은 이제 낡았다 → 다시 넣는다 */
      refreshInFlight = null;
      return rec;
    }, function (e) {
      refreshInFlight = null;
      throw e;
    });
    return refreshInFlight;
  }

  async function importSession(rec) {
    var res = null, err = null;
    try {
      res = await sb.auth.setSession({ access_token: rec.access, refresh_token: rec.refresh });
      if (res && res.error) err = res.error;
    } catch (e) { err = e || sessErr('set_session'); }
    if (!err && res && res.data && res.data.session) {
      var s = res.data.session;
      libToken = s.access_token || null;
      if (s.access_token) rec.access = s.access_token;
      if (s.refresh_token) rec.refresh = s.refresh_token;
      persist(rec);
      return s;
    }
    var e2 = sessErr('set_session');
    e2.status = Number((err && (err.status || err.code)) || 0) || 0;
    e2.detail = String((err && (err.message || err.error_description)) || err || '');
    e2.network = (typeof TypeError !== 'undefined' && err instanceof TypeError) ||
      /Failed to fetch|NetworkError|network request failed|Load failed|timed? ?out/i.test(e2.detail);
    e2.fatal = !e2.network && (e2.status === 400 || e2.status === 401 || e2.status === 403);
    throw e2;
  }

  /* 저장된 레코드로 세션을 되살린다. 실패는 던지지 않고 종류를 돌려준다. */
  async function hydrate(rec) {
    if (!rec || !rec.access || !rec.refresh) {
      var nt = sessErr('no_token'); nt.fatal = true; throw nt;
    }
    /* ① 만료·만료임박이면 라이브러리에 맡기지 않고 여기서 먼저 회전한다 */
    if (jwtExp(rec.access) <= nowS() + AUTH_MARGIN) await rotate(rec);
    /* ② 신선한 토큰을 supabase-js 에 넣는다(여기서 /auth/v1/user 확인 1회) */
    try {
      return await importSession(rec);
    } catch (err) {
      if (!err.fatal) throw err;            /* 일시 오류 → 레코드는 살려 둔다 */
      await rotate(rec);                    /* 서버가 토큰을 거부 → 한 번만 새로 받아 재시도 */
      return await importSession(rec);
    }
  }

  async function getSessionSafe() {
    try {
      var r = await sb.auth.getSession();
      return (r && r.data) ? (r.data.session || null) : null;
    } catch (e) { return null; }
  }

  /* 요청 직전 보증: 라이브러리 안의 세션이 항상 150초 이상 살아 있게 만든다.
     (라이브러리가 스스로 회전하는 순간 우리 레코드의 refresh 사본이 죽는다) */
  async function ensureFresh() {
    var rec = activeRecord();
    if (!rec) { var le = sessErr('lost'); le.fatal = true; throw le; }
    if (jwtExp(rec.access) <= nowS() + AUTH_MARGIN) await rotate(rec);
    if (!libToken || libToken !== rec.access) return await importSession(rec);
    var sess = await getSessionSafe();
    if (sess && sess.access_token === rec.access) return sess;
    return await importSession(rec);
  }

  /* -------------------------------------------------------------- 오류 문구 */
  function friendly(e) {
    var m = String((e && (e.message || e.error_description || e.hint || e.details)) || e || '');
    if (/Invalid login credentials/i.test(m)) return '비밀번호가 맞지 않아요.';
    if (/Email not confirmed/i.test(m)) return '이 계정은 아직 활성화되지 않았어요. 방장에게 초기화를 요청해 주세요.';
    if (/Password should be at least|weak_password|password.*6 characters/i.test(m)) return '비밀번호는 숫자 6~8자리로 정해 주세요.';
    if (/not_authenticated/i.test(m)) return '로그인이 필요해요.';
    if (/not_agent/i.test(m)) return '주선자 계정이 아니에요.';
    if (/forbidden|42501/i.test(m)) return '권한이 없어요.';
    if (/not_found|P0002/i.test(m)) return '대상을 찾을 수 없어요. 새로고침 후 다시 시도해 주세요.';
    if (/duplicate key|unique/i.test(m)) return '이미 있는 항목이에요.';
    if (/Failed to fetch|NetworkError|network/i.test(m)) return '서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
    return m || '알 수 없는 오류가 났어요.';
  }

  /* 서버 응답 실패를 상태코드까지 달아서 던진다 — 화면이 "일시 오류인지"를
     구분해 로그인을 함부로 지우지 않을 수 있게. */
  function fail(res) {
    var err = res && res.error;
    var e = new Error(friendly(err));
    e.status = Number((err && (err.status || err.code)) || 0) || 0;
    if (!e.status && /^\d{3}$/.test(String((err && err.code) || ''))) e.status = Number(err.code);
    e.network = /Failed to fetch|NetworkError|network request failed|Load failed/i.test(
      String((err && (err.message || err.details)) || ''));
    return e;
  }

  function dataUrlToBlob(dataUrl) {
    var s = String(dataUrl || '');
    var comma = s.indexOf(',');
    if (comma < 0) return null;
    var head = s.slice(0, comma), body = s.slice(comma + 1);
    var m = head.match(/data:([^;,]+)/);
    var mime = (m && m[1]) || 'image/jpeg';
    var bin;
    try { bin = atob(body); } catch (e) { return null; }
    var n = bin.length, arr = new Uint8Array(n);
    for (var i = 0; i < n; i++) arr[i] = bin.charCodeAt(i);
    try { return new Blob([arr], { type: mime }); } catch (e) { return null; }
  }

  /* ------------------------------------------------------------------ 인증 */
  async function signIn(agentId, pin) {
    var isGuest = !agentId || agentId === 'guest';
    var email = isGuest ? GUEST_EMAIL : (agentId + '@manna.local');
    var res = await sb.auth.signInWithPassword({ email: email, password: String(pin || '') });
    if (res.error) throw new Error(friendly(res.error));
    var s = res.data && res.data.session;
    if (!s) throw new Error('로그인 정보를 받지 못했어요. 다시 시도해 주세요.');
    libToken = s.access_token || null;
    var saved = true;
    if (isGuest) {
      dropKey(window.localStorage, AUTH_KEY);       /* 같은 브라우저의 주선자 기록은 정리 */
      saved = persist({ mode: 'guest', access: s.access_token, refresh: s.refresh_token });
    } else {
      dropKey(window.sessionStorage, GUEST_KEY);
      saved = persist({ mode: 'agent', id: agentId, expiresAt: Date.now() + AGENT_TTL,
                access: s.access_token, refresh: s.refresh_token });
    }
    /* saved=false → 브라우저가 저장을 막았다(시크릿 모드·용량 초과). 화면에 알린다. */
    return { mode: isGuest ? 'guest' : 'agent', agentId: isGuest ? 'guest' : agentId, persisted: !!saved };
  }

  /* 저장된 세션을 복원한다. 결과 종류
       {mode:'agent'|'guest'}  복원 성공
       {expired:true}          1시간이 지나 자동 로그아웃됨
       {dead:true}             토큰이 서버에서 거부됨(폐기) → 다시 입장 필요
       {retry:true}            네트워크·서버 일시 오류 → 기록은 남겨 두고 다시 시도
       null                    저장된 세션 없음 */
  async function restore() {
    var rec = readJson(window.localStorage, AUTH_KEY);
    if (rec && rec.mode === 'agent') {
      var live = (typeof rec.expiresAt === 'number' && Date.now() <= rec.expiresAt);
      if (live && rec.access && rec.refresh) {
        try {
          var sess = await hydrate(rec);
          if (sess && sess.access_token) return { mode: 'agent', agentId: rec.id };
        } catch (e) {
          if (isTransientErr(e)) return { mode: null, retry: true };   /* 로그인 유지 */
        }
      }
      dropKey(window.localStorage, AUTH_KEY);
      libToken = null;
      try { await sb.auth.signOut(); } catch (e) {}
      return live ? { mode: null, dead: true } : { mode: null, expired: true };
    }

    var g = readJson(window.sessionStorage, GUEST_KEY);
    if (g && g.mode === 'guest') {
      try {
        var gs = await hydrate(g);
        if (gs && gs.access_token) return { mode: 'guest', agentId: 'guest' };
      } catch (e) {
        if (isTransientErr(e)) return { mode: null, retry: true };
      }
      dropKey(window.sessionStorage, GUEST_KEY);
      libToken = null;
      try { await sb.auth.signOut(); } catch (e) {}
      return { mode: null, dead: true };
    }
    return null;
  }

  /* 부팅 화면이 게이트를 잠깐 띄웠다가 앱으로 넘어가는 깜빡임을 막기 위해
     "복원할 세션이 있는지"만 값싸게 먼저 확인한다(네트워크 없음). */
  function restoreCandidate() {
    var a = readJson(window.localStorage, AUTH_KEY);
    if (a && a.mode === 'agent' && a.access && a.refresh &&
        typeof a.expiresAt === 'number' && Date.now() <= a.expiresAt) return 'agent';
    var g = readJson(window.sessionStorage, GUEST_KEY);
    if (g && g.mode === 'guest' && g.access && g.refresh) return 'guest';
    return null;
  }

  async function signOut() {
    dropKey(window.localStorage, AUTH_KEY);
    dropKey(window.sessionStorage, GUEST_KEY);
    libToken = null;
    try { await sb.auth.signOut(); } catch (e) {}
  }

  function currentMode() {
    var a = readJson(window.localStorage, AUTH_KEY);
    if (a && a.mode === 'agent' && Date.now() <= (a.expiresAt || 0)) return 'agent';
    var g = readJson(window.sessionStorage, GUEST_KEY);
    return (g && g.mode === 'guest') ? 'guest' : null;
  }

  /* ------------------------------------------------------------- 조회 */
  async function fetchAgents() {
    var res = await sb.from('agents')
      .select('id,name,emoji,role,active')
      .order('id', { ascending: true });
    if (res.error) throw res.error;
    return res.data || [];
  }

  async function signedMap(paths) {
    var map = {};
    var uniq = [];
    (paths || []).forEach(function (p) { if (typeof p === 'string' && p && uniq.indexOf(p) === -1) uniq.push(p); });
    for (var i = 0; i < uniq.length; i += 100) {
      var chunk = uniq.slice(i, i + 100);
      var res = await sb.storage.from(BUCKET).createSignedUrls(chunk, SIGNED_TTL);
      (res.data || []).forEach(function (x) {
        if (!x) return;
        var url = x.signedUrl || x.signedURL || '';
        if (url) map[x.path] = url;
      });
    }
    return map;
  }

  async function fetchState() {
    await ensureFresh();
    var res = await sb.rpc('manna_state');
    if (res.error) throw fail(res);
    var raw = res.data || {};
    var assets = (raw.assets || []).map(function (a) {
      var paths = Array.isArray(a.photos) ? a.photos.slice() : [];
      var o = {};
      for (var k in a) if (Object.prototype.hasOwnProperty.call(a, k)) o[k] = a[k];
      o.photoPaths = paths;
      o.photos = [];
      o.extras = Array.isArray(a.extras) ? a.extras : [];
      o.tags = Array.isArray(a.tags) ? a.tags : [];
      o.wants = Array.isArray(a.wants) ? a.wants : [];
      o.history = [];
      o.reviews = [];
      return o;
    });
    var allPaths = [];
    assets.forEach(function (a) { a.photoPaths.forEach(function (p) { allPaths.push(p); }); });
    var map = await signedMap(allPaths);
    assets.forEach(function (a) {
      a.photos = a.photoPaths.map(function (p) { return map[p] || ''; });
      /* 서명에 실패한 사진은 목록에서 빼서 깨진 이미지가 보이지 않게 한다 */
      var keepP = [], keepU = [];
      a.photoPaths.forEach(function (p, i) { if (a.photos[i]) { keepP.push(p); keepU.push(a.photos[i]); } });
      a.photoPaths = keepP;
      a.photos = keepU;
    });

    var byAsset = {};
    assets.forEach(function (a) { byAsset[a.id] = a; });
    (raw.reviews || []).forEach(function (r) {
      var a = byAsset[r.assetId];
      if (!a) return;
      a.reviews.push({
        id: r.id, by: r.by, m: r.matchId || '',
        at: r.at, vis: r.vis === 'private' ? 'private' : 'public', text: r.text
      });
    });
    (raw.history || []).forEach(function (h) {
      var a = byAsset[h.assetId];
      if (!a) return;
      a.history.push({ at: h.at, by: h.by, text: h.text });
    });

    return {
      agents: raw.agents || [],
      assets: assets,
      matches: (raw.matches || []).map(function (m) {
        return { id: m.id, aId: m.aId, bId: m.bId, from: m.from === 'b' ? 'b' : 'a', stage: m.stage, at: m.at };
      })
    };
  }

  /* ------------------------------------------------------------- 사진 */
  async function uploadPhoto(assetId, dataUrl, idx) {
    var blob = dataUrlToBlob(dataUrl);
    if (!blob) throw new Error('사진을 읽지 못했어요');
    var path = assetId + '/' + Date.now() + '-' + (Number(idx) + 1) + '-' +
      Math.random().toString(36).slice(2, 7) + '.jpg';
    var res = await sb.storage.from(BUCKET).upload(path, blob, {
      contentType: 'image/jpeg', cacheControl: '3600', upsert: false
    });
    if (res.error) throw new Error(friendly(res.error));
    return path;
  }

  async function removePhotos(paths) {
    var list = (paths || []).filter(function (p) { return typeof p === 'string' && p; });
    if (!list.length) return;
    try { await sb.storage.from(BUCKET).remove(list); } catch (e) {}
  }

  async function signPhoto(path) {
    if (!path) return '';
    var res = await sb.storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL);
    if (res.error || !res.data) return '';
    return res.data.signedUrl || res.data.signedURL || '';
  }

  /* ------------------------------------------------------------- 쓰기 */
  async function rpc(name, args) {
    await ensureFresh();
    var res = await sb.rpc(name, args || {});
    if (res.error) throw fail(res);
    return res.data;
  }

  function saveAsset(id, data, history) {
    return rpc('manna_save_asset', {
      p_id: id || null,
      p_data: data || {},
      p_history: history || ''
    });
  }
  function setStatus(id, status, history) {
    return rpc('manna_set_status', { p_id: id, p_status: status, p_history: history || '' });
  }
  function addHistory(id, text) {
    return rpc('manna_add_history', { p_id: id, p_text: text });
  }
  function setEmoji(emoji) {
    return rpc('manna_set_emoji', { p_emoji: emoji });
  }
  function propose(aId, bId) {
    return rpc('manna_propose', { p_a: aId, p_b: bId });
  }
  function setStage(mid, stage) {
    return rpc('manna_set_stage', { p_mid: mid, p_stage: stage });
  }
  function deleteAsset(id) {
    return rpc('manna_delete_asset', { p_id: id });
  }

  /* ------------------------------------------------------------- 리뷰 */
  async function insertReview(assetId, matchId, vis, body) {
    await ensureFresh();
    var me = await agentIdOf();
    var res = await sb.from('reviews').insert({
      asset_id: assetId,
      match_id: matchId || null,
      by_agent: me,
      vis: vis === 'private' ? 'private' : 'public',
      body: body
    }).select('id,asset_id,match_id,by_agent,vis,body,created_at').single();
    if (res.error) throw new Error(friendly(res.error));
    return res.data;
  }

  async function updateReview(id, patch) {
    await ensureFresh();
    var res = await sb.from('reviews').update(patch).eq('id', id).select('id').maybeSingle();
    if (res.error) throw new Error(friendly(res.error));
    return res.data;
  }

  async function deleteReview(id) {
    await ensureFresh();
    var res = await sb.from('reviews').delete().eq('id', id);
    if (res.error) throw new Error(friendly(res.error));
    return true;
  }

  async function agentIdOf() {
    var { data } = await sb.rpc('manna_agent_id');
    return (typeof data === 'string' && data) ? data : '';
  }

  /* --------------------------------------------------------- 방장 관리 */
  async function admin(action, payload) {
    await ensureFresh().catch(function () { /* bootstrap 은 세션 없이도 가능 */ });
    var body = Object.assign({ action: action }, payload || {});
    var res = await sb.functions.invoke('manna-admin', { body: body });
    if (res.error) {
      var msg = '';
      try {
        var ctx = res.error.context;
        if (ctx && typeof ctx.json === 'function') {
          var b = await ctx.json();
          msg = b && (b.message || b.error);
        }
      } catch (e) {}
      if (!msg && res.data && res.data.message) msg = res.data.message;
      throw new Error(msg || friendly(res.error));
    }
    var d = res.data || {};
    if (d.ok === false) throw new Error(d.message || d.error || '요청을 처리하지 못했어요.');
    return d;
  }

  window.MannaCloud = {
    available: true,
    bucket: BUCKET,
    signIn: signIn,
    restore: restore,
    restoreCandidate: restoreCandidate,
    isTransient: isTransientErr,
    signOut: signOut,
    currentMode: currentMode,
    fetchAgents: fetchAgents,
    fetchState: fetchState,
    saveAsset: saveAsset,
    setStatus: setStatus,
    addHistory: addHistory,
    setEmoji: setEmoji,
    propose: propose,
    setStage: setStage,
    deleteAsset: deleteAsset,
    insertReview: insertReview,
    updateReview: updateReview,
    deleteReview: deleteReview,
    uploadPhoto: uploadPhoto,
    removePhotos: removePhotos,
    signPhoto: signPhoto,
    admin: admin,
    agentId: agentIdOf,
    friendly: friendly
  };
})();
