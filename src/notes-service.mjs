// 3단계: 로그인한 사람의 메모 조회·추가·수정·삭제를 처리하는 서버 코드입니다.
// 토큰 검사는 시작 틀의 src/verify-login.mjs를 그대로 씁니다. 브라우저가 보낸
// userId·role·owner_id 같은 값은 읽지도 믿지도 않고, 검증을 통과한 토큰의 사용자만 인정합니다.
// 메모를 추가할 때는 그 사용자 ID를 owner_id로 저장합니다.
// 아직 소유자 검사는 없습니다. 로그인한 다른 사용자가 메모 번호(id)를 알면
// 수정·삭제할 수 있는 허점이 남아 있고, 4단계에서 막습니다.
// SUPABASE_URL, SUPABASE_SECRET_KEY는 Vercel 환경변수에서만 읽고
// 응답·로그·브라우저 파일에는 절대 싣지 않습니다.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../aleph.config.json', import.meta.url), 'utf8'));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const MAX_TITLE = 200;
const MAX_BODY = 5000;

function projectOrigin(raw) {
  try {
    const url = new URL(String(raw ?? ''));
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co')
        || url.username || url.password || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

// 도우미는 첫 요청 때 한 번만 만들어 둡니다. 만들지 못하면 요청은 거부됩니다.
let verifier;
async function verifyLoginWithStarterHelper(authorization) {
  if (!verifier) {
    const { createLoginVerifier } = await import('./verify-login.mjs');
    verifier = createLoginVerifier({ config, supabaseSecretKey: process.env.SUPABASE_SECRET_KEY });
  }
  return verifier(authorization);
}

const toNote = (row) => ({ id: row.id, title: row.title, body: row.content });
const isRow = (row) => typeof row?.id === 'string' && typeof row?.title === 'string'
  && typeof row?.content === 'string';

function cleanTitle(value) {
  return typeof value === 'string' && value.trim() && value.length <= MAX_TITLE ? value.trim() : null;
}
function cleanBody(value) {
  return typeof value === 'string' && value.length <= MAX_BODY ? value : null;
}
function readJson(request) {
  let input = request.body;
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch { return null; }
  }
  return input && typeof input === 'object' && !Array.isArray(input) ? input : null;
}

// 새 형식 비밀 키는 apikey 헤더만, 옛 JWT 형식 키는 Bearer도 함께 보냅니다.
async function rest(context, query, { method = 'GET', payload, prefer } = {}) {
  const headers = { apikey: context.key, Accept: 'application/json' };
  if (context.key.startsWith('eyJ')) headers.Authorization = `Bearer ${context.key}`;
  if (payload !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  try {
    const upstream = await fetch(`${context.origin}/rest/v1/notes${query}`, {
      method, headers, signal: AbortSignal.timeout(8000),
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const text = await upstream.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { return { ok: false, status: upstream.status }; }
    }
    return { ok: upstream.ok, status: upstream.status, data };
  } catch {
    return { ok: false, status: 0 };
  }
}

function upstreamError(response, result) {
  console.error('NOTES_UPSTREAM_STATUS', result.status);
  return response.status(502).json({ error: 'NOTES_UPSTREAM_ERROR' });
}

// 방법·설정·로그인을 차례로 확인합니다. 통과하지 못하면 응답을 이미 보내고 null을 돌려줍니다.
async function begin(request, response, allowed, verifyLogin) {
  response.setHeader('Cache-Control', 'no-store');
  if (!allowed.includes(request.method)) {
    response.setHeader('Allow', allowed.join(', '));
    response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    return null;
  }
  const origin = projectOrigin(process.env.SUPABASE_URL);
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!origin || typeof key !== 'string' || !key) {
    response.status(500).json({ error: 'NOTES_NOT_CONFIGURED' });
    return null;
  }
  // 토큰이 없거나 검사에 실패하거나 검사 중 오류가 나면 자료 없이 거부합니다.
  let login = null;
  try {
    login = await verifyLogin(request.headers?.authorization);
  } catch (error) {
    console.error('NOTES_LOGIN_CHECK_FAILED', error?.name);
  }
  if (!login || typeof login.userId !== 'string' || !UUID.test(login.userId)) {
    response.setHeader('WWW-Authenticate', 'Bearer');
    response.status(401).json({ error: 'LOGIN_REQUIRED', message: '로그인이 필요합니다.' });
    return null;
  }
  return { origin, key, userId: login.userId.toLowerCase() };
}

const invalidNote = (response) => response.status(400).json({
  error: 'INVALID_NOTE',
  message: `title(1~${MAX_TITLE}자)과 body(${MAX_BODY}자 이하 문자열)를 확인해 주세요.`,
});

// GET /api/notes  → 로그인한 사용자의 메모 배열 [{id,title,body}]
// POST /api/notes → {id?,title,body}를 받아 {id}를 돌려줌 (id가 없으면 서버가 UUID를 만듦)
export function createCollectionHandler({ verifyLogin = verifyLoginWithStarterHelper } = {}) {
  return async function handler(request, response) {
    const context = await begin(request, response, ['GET', 'POST'], verifyLogin);
    if (!context) return undefined;

    if (request.method === 'GET') {
      const result = await rest(context,
        `?select=id,title,content&owner_id=eq.${encodeURIComponent(context.userId)}&order=created_at.asc,id.asc`);
      if (!result.ok || !Array.isArray(result.data)) return upstreamError(response, result);
      return response.status(200).json(result.data.filter(isRow).map(toNote));
    }

    const input = readJson(request);
    const title = input ? cleanTitle(input.title) : null;
    const body = input ? cleanBody(input.body) : null;
    if (title === null || body === null) return invalidNote(response);
    let id = input.id ?? null;
    if (id === null) {
      id = randomUUID();
    } else if (typeof id !== 'string' || !UUID.test(id)) {
      return response.status(400).json({ error: 'INVALID_ID', message: 'id는 UUID여야 합니다.' });
    }
    id = id.toLowerCase();
    const result = await rest(context, '', {
      method: 'POST', prefer: 'return=minimal',
      payload: { id, owner_id: context.userId, title, content: body },
    });
    if (result.status === 409) return response.status(409).json({ error: 'ID_ALREADY_EXISTS' });
    if (!result.ok) return upstreamError(response, result);
    return response.status(201).json({ id });
  };
}

// GET·PUT·DELETE /api/notes/:id
export function createItemHandler({ verifyLogin = verifyLoginWithStarterHelper } = {}) {
  return async function handler(request, response) {
    const context = await begin(request, response, ['GET', 'PUT', 'DELETE'], verifyLogin);
    if (!context) return undefined;

    const rawId = Array.isArray(request.query?.id) ? request.query.id[0] : request.query?.id;
    if (typeof rawId !== 'string' || !UUID.test(rawId)) return response.status(404).json({ error: 'NOT_FOUND' });
    const where = `id=eq.${rawId.toLowerCase()}`;
    const notFound = () => response.status(404).json({ error: 'NOT_FOUND' });

    if (request.method === 'GET') {
      const result = await rest(context, `?${where}&select=id,title,content&limit=1`);
      if (!result.ok || !Array.isArray(result.data)) return upstreamError(response, result);
      const row = result.data.find(isRow);
      return row ? response.status(200).json(toNote(row)) : notFound();
    }

    if (request.method === 'PUT') {
      const input = readJson(request);
      const changes = {};
      if (input && input.title !== undefined) changes.title = cleanTitle(input.title);
      if (input && input.body !== undefined) changes.content = cleanBody(input.body);
      if (!input || !Object.keys(changes).length || Object.values(changes).includes(null)) {
        return invalidNote(response);
      }
      const result = await rest(context, `?${where}&select=id,title,content`, {
        method: 'PATCH', payload: changes, prefer: 'return=representation',
      });
      if (!result.ok || !Array.isArray(result.data)) return upstreamError(response, result);
      const row = result.data.find(isRow);
      return row ? response.status(200).json(toNote(row)) : notFound();
    }

    const result = await rest(context, `?${where}&select=id`, {
      method: 'DELETE', prefer: 'return=representation',
    });
    if (!result.ok || !Array.isArray(result.data)) return upstreamError(response, result);
    return result.data.length ? response.status(200).json({ id: rawId.toLowerCase() }) : notFound();
  };
}
