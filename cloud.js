/* ============================================================================
   만나방 · Supabase 연동 계층 (cloud.js)
   ----------------------------------------------------------------------------
   · UI(index.html)는 이 파일이 제공하는 window.MannaCloud 만 씁니다.
   · 여기에는 publishable(anon) 키만 들어갑니다. service_role 키는 절대 넣지 않습니다.
   · 로그인 세션 규칙
       - 주선자: localStorage · 1시간 (지나면 자동 로그아웃)
       - 손님  : sessionStorage · 탭을 닫을 때까지
     토큰은 Supabase Auth 가 발급하고, 우리는 만료 시각만 직접 관리합니다.
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

  function saveAgentSession(id, session, expiresAt) {
    writeJson(window.localStorage, AUTH_KEY, {
      mode: 'agent', id: id, expiresAt: expiresAt,
      access: session.access_token, refresh: session.refresh_token
    });
  }
  function saveGuestSession(session) {
    writeJson(window.sessionStorage, GUEST_KEY, {
      mode: 'guest', access: session.access_token, refresh: session.refresh_token
    });
  }
  function touch(rec, session) {
    if (!rec) return;
    if (rec.mode === 'guest') saveGuestSession(session);
    else saveAgentSession(rec.id, session, rec.expiresAt);
  }

  /* ------------------------------------------------------- 세션 복원/갱신 */
  async function hydrate(rec) {
    if (!rec || !rec.access || !rec.refresh) return null;
    var sess = null;
    if (jwtExp(rec.access) > nowS() + 60) {
      var res = await sb.auth.setSession({ access_token: rec.access, refresh_token: rec.refresh });
      if (!res.error && res.data && res.data.session) sess = res.data.session;
    }
    if (!sess) {
      var rr = await sb.auth.refreshSession({ refresh_token: rec.refresh });
      if (!rr.error && rr.data && rr.data.session) sess = rr.data.session;
    }
    if (!sess) return null;
    touch(rec, sess);
    return sess;
  }

  async function ensureFresh() {
    var cur = await sb.auth.getSession();
    var sess = cur && cur.data ? cur.data.session : null;
    if (!sess) throw new Error('로그인이 풀렸어요. 다시 입장해 주세요.');
    if (jwtExp(sess.access_token) > nowS() + 60) return sess;
    var rr = await sb.auth.refreshSession();
    if (rr.error || !rr.data || !rr.data.session) throw new Error('로그인이 풀렸어요. 다시 입장해 주세요.');
    var rec = readJson(window.localStorage, AUTH_KEY) || readJson(window.sessionStorage, GUEST_KEY);
    touch(rec, rr.data.session);
    return rr.data.session;
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
    if (isGuest) saveGuestSession(s);
    else saveAgentSession(agentId, s, Date.now() + AGENT_TTL);
    return { mode: isGuest ? 'guest' : 'agent', agentId: isGuest ? 'guest' : agentId };
  }

  async function restore() {
    var rec = readJson(window.localStorage, AUTH_KEY);
    if (rec && rec.mode === 'agent') {
      if (typeof rec.expiresAt === 'number' && Date.now() <= rec.expiresAt) {
        var sess = await hydrate(rec);
        if (sess) return { mode: 'agent', agentId: rec.id };
      }
      dropKey(window.localStorage, AUTH_KEY);   /* 1시간 지남 → 자동 로그아웃 */
      try { await sb.auth.signOut(); } catch (e) {}
      return { mode: null, expired: true };
    }
    var g = readJson(window.sessionStorage, GUEST_KEY);
    if (g && g.mode === 'guest') {
      var gs = await hydrate(g);
      if (gs) return { mode: 'guest', agentId: 'guest' };
      dropKey(window.sessionStorage, GUEST_KEY);
    }
    return null;
  }

  async function signOut() {
    dropKey(window.localStorage, AUTH_KEY);
    dropKey(window.sessionStorage, GUEST_KEY);
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
    if (res.error) throw new Error(friendly(res.error));
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
    if (res.error) throw new Error(friendly(res.error));
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
