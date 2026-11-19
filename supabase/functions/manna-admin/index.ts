// ============================================================================
// 만나방 · 방장 관리 Edge Function  (supabase/functions/manna-admin)
// ----------------------------------------------------------------------------
// 이 함수는 service_role 키로만 동작합니다. 그 키는 절대 브라우저로 나가지 않습니다.
// 모든 요청은 Authorization: Bearer <로그인 access_token> 을 검사해
//   · bootstrap  : 아직 계정이 하나도 없을 때(최초 1회) 또는 방장(ag1)
//   · create_agent / reset_pin / toggle_agent : 방장(is_owner)만
//   · change_my_pin : 로그인한 주선자 본인만 (현재 비번 확인 후 변경)
// 로 처리합니다.
//
// 배포: supabase functions deploy manna-admin --no-verify-jwt
// (부트스트랩은 로그인 전에 호출되므로 게이트웨이 JWT 검증을 끄고, 함수 안에서 직접 검증합니다.)
// ============================================================================

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const PIN_RE = /^\d{4,8}$/;
const GUEST_EMAIL = 'guest@manna.local';

function pinOf(v: unknown): string {
  return String(v ?? '').replace(/\s/g, '');
}

async function findUserByEmail(admin: SupabaseClient, email: string) {
  // 계정 수가 적은 앱이라 한 페이지(최대 1000명)면 충분합니다.
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) return null;
  const target = email.toLowerCase();
  return data.users.find((u: any) => (u.email || '').toLowerCase() === target) ?? null;
}

/** 없으면 만들고, 있으면 비번을 새로 맞춘다. */
async function ensureUser(admin: SupabaseClient, email: string, pin: string) {
  const existing = await findUserByEmail(admin, email);
  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password: pin,
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    return { id: existing.id, created: false };
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: pin,
    email_confirm: true,
  });
  if (error || !data?.user) throw new Error(error?.message || 'create_user_failed');
  return { id: data.user.id, created: true };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  let body: Record<string, any> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const action = String(body.action || '');

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey =
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
    Deno.env.get('SUPABASE_SECRET_KEY') ??
    '';
  const publicKey =
    Deno.env.get('SUPABASE_ANON_KEY') ??
    Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ??
    '';

  if (!serviceKey) {
    return json({ ok: false, error: 'server_not_configured', message: 'service_role 키가 없습니다.' }, 500);
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // --- 요청자 확인 ---------------------------------------------------------
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  let caller: any = null;
  if (token) {
    const { data, error } = await admin.auth.getUser(token);
    if (!error && data?.user) caller = data.user;
  }

  let callerAgent: { id: string; name: string; is_owner: boolean; active: boolean } | null = null;
  if (caller) {
    const { data } = await admin
      .from('agents')
      .select('id,name,is_owner,active')
      .eq('auth_uid', caller.id)
      .maybeSingle();
    callerAgent = (data as any) ?? null;
  }
  const isOwner = !!(callerAgent && callerAgent.active && callerAgent.is_owner);

  try {
    // ---------------------------------------------------------------- whoami
    if (action === 'whoami') {
      return json({
        ok: true,
        uid: caller?.id ?? null,
        email: caller?.email ?? null,
        agent: callerAgent,
        is_owner: isOwner,
      });
    }

    // -------------------------------------------------------------- bootstrap
    // 최초 1회: ag1~ag9 + guest 계정을 만들고 agents.auth_uid 를 연결합니다.
    if (action === 'bootstrap') {
      const pin = pinOf(body.pin || Deno.env.get('MANNA_INIT_PIN') || '');
      const guestPin = pinOf(body.guestPin || Deno.env.get('MANNA_GUEST_PIN') || '');
      if (!PIN_RE.test(pin)) {
        return json({ ok: false, error: 'pin_format', message: '주선자 초기 비번은 숫자 4~8자리로 정해 주세요.' }, 400);
      }
      if (!PIN_RE.test(guestPin)) {
        return json({ ok: false, error: 'guest_pin_format', message: '손님 비번은 숫자 4~8자리로 정해 주세요.' }, 400);
      }

      const { count } = await admin
        .from('agents')
        .select('id', { count: 'exact', head: true })
        .not('auth_uid', 'is', null);
      const linked = count ?? 0;
      if (linked > 0 && !isOwner) {
        return json({
          ok: false,
          error: 'already_bootstrapped',
          message: '이미 계정이 만들어져 있어요. 방장(종윤)으로 로그인한 뒤 다시 실행해 주세요.',
        }, 403);
      }

      const { data: agents, error: agErr } = await admin.from('agents').select('id,name').order('id');
      if (agErr) throw new Error(agErr.message);

      const created: string[] = [];
      const repaired: string[] = [];
      for (const ag of agents ?? []) {
        const email = `${ag.id}@manna.local`;
        const { id: uid, created: isNew } = await ensureUser(admin, email, pin);
        const { error: upErr } = await admin.from('agents').update({ auth_uid: uid }).eq('id', ag.id);
        if (upErr) throw new Error(upErr.message);
        (isNew ? created : repaired).push(ag.id);
      }
      const guest = await ensureUser(admin, GUEST_EMAIL, guestPin);
      (guest.created ? created : repaired).push('guest');

      return json({ ok: true, created, repaired, count: (agents ?? []).length + 1 });
    }

    // ----------------------------------------------------------- create_agent
    if (action === 'create_agent') {
      if (!isOwner) return json({ ok: false, error: 'forbidden', message: '방장만 할 수 있어요.' }, 403);
      const name = String(body.name ?? '').trim();
      const emoji = String(body.emoji ?? '🌿').trim() || '🌿';
      const role = String(body.role ?? '주선자').trim() || '주선자';
      const pin = pinOf(body.pin);
      if (!name) return json({ ok: false, error: 'name_required', message: '이름을 입력해 주세요.' }, 400);
      if (!PIN_RE.test(pin)) return json({ ok: false, error: 'pin_format', message: '비번은 숫자 4~8자리로 정해 주세요.' }, 400);

      const { data: rows, error: listErr } = await admin.from('agents').select('id');
      if (listErr) throw new Error(listErr.message);
      const maxNo = (rows ?? []).reduce((mx: number, r: any) => {
        const n = Number(String(r.id).replace(/[^0-9]/g, ''));
        return Number.isFinite(n) && n > mx ? n : mx;
      }, 0);
      const id = 'ag' + (maxNo + 1);
      const email = `${id}@manna.local`;

      const user = await ensureUser(admin, email, pin);
      const { error: insErr } = await admin.from('agents').insert({
        id, name, emoji, role, active: true, is_owner: false, auth_uid: user.id,
      });
      if (insErr) throw new Error(insErr.message);
      return json({ ok: true, id, name, emoji, role, pin });
    }

    // -------------------------------------------------------------- reset_pin
    if (action === 'reset_pin') {
      if (!isOwner) return json({ ok: false, error: 'forbidden', message: '방장만 할 수 있어요.' }, 403);
      const agentId = String(body.agentId ?? '').trim();
      const pin = pinOf(body.pin);
      if (!PIN_RE.test(pin)) return json({ ok: false, error: 'pin_format', message: '비번은 숫자 4~8자리로 정해 주세요.' }, 400);
      if (!agentId) return json({ ok: false, error: 'agent_required' }, 400);

      if (agentId === 'guest') {
        const guest = await ensureUser(admin, GUEST_EMAIL, pin);
        return json({ ok: true, agentId: 'guest', pin, created: guest.created });
      }

      const { data: ag } = await admin.from('agents').select('id,name,auth_uid').eq('id', agentId).maybeSingle();
      if (!ag) return json({ ok: false, error: 'not_found', message: '없는 주선자예요.' }, 404);
      const user = await ensureUser(admin, `${ag.id}@manna.local`, pin);
      if (ag.auth_uid !== user.id) await admin.from('agents').update({ auth_uid: user.id }).eq('id', ag.id);
      return json({ ok: true, agentId: ag.id, name: ag.name, pin });
    }

    // ----------------------------------------------------------- toggle_agent
    if (action === 'toggle_agent') {
      if (!isOwner) return json({ ok: false, error: 'forbidden', message: '방장만 할 수 있어요.' }, 403);
      const agentId = String(body.agentId ?? '').trim();
      const active = body.active === undefined ? null : !!body.active;
      if (!agentId || active === null) return json({ ok: false, error: 'bad_request' }, 400);
      const { data: ag } = await admin.from('agents').select('id,name,is_owner').eq('id', agentId).maybeSingle();
      if (!ag) return json({ ok: false, error: 'not_found' }, 404);
      if (ag.is_owner && !active) {
        return json({ ok: false, error: 'owner_locked', message: '방장 계정은 비활성화할 수 없어요.' }, 400);
      }
      const { error } = await admin.from('agents').update({ active }).eq('id', agentId);
      if (error) throw new Error(error.message);
      return json({ ok: true, agentId, active });
    }

    // --------------------------------------------------------- change_my_pin
    if (action === 'change_my_pin') {
      if (!callerAgent || !callerAgent.active) {
        return json({ ok: false, error: 'forbidden', message: '주선자만 바꿀 수 있어요.' }, 403);
      }
      const currentPin = pinOf(body.currentPin);
      const pin = pinOf(body.pin);
      if (!PIN_RE.test(pin)) return json({ ok: false, error: 'pin_format', message: '새 비번은 숫자 4~8자리로 정해 주세요.' }, 400);
      if (!publicKey) return json({ ok: false, error: 'server_not_configured' }, 500);

      // 현재 비번 확인 (서버에서 직접 로그인 시도)
      const signer = createClient(url, publicKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error: signErr } = await signer.auth.signInWithPassword({
        email: `${callerAgent.id}@manna.local`,
        password: currentPin,
      });
      if (signErr) {
        return json({ ok: false, error: 'wrong_current_pin', message: '지금 쓰는 비번이 맞지 않아요.' }, 400);
      }

      const { error } = await admin.auth.admin.updateUserById(caller.id, { password: pin });
      if (error) throw new Error(error.message);
      return json({ ok: true, agentId: callerAgent.id });
    }

    return json({ ok: false, error: 'unknown_action', action }, 400);
  } catch (e) {
    return json({ ok: false, error: 'server_error', message: String((e as Error)?.message ?? e) }, 500);
  }
});
