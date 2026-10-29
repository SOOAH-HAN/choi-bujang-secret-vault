// 3단계: 로그인한 사람에게만 가상 메모를 읽어 주는 서버 함수입니다.
// 토큰 검사는 시작 틀의 src/verify-login.mjs를 그대로 씁니다. 브라우저가 보낸
// userId·role 같은 값은 읽지도 믿지도 않고, 오직 검증을 통과한 토큰의 사용자만 인정합니다.
// 아직 소유자 검사는 없어서 로그인한 사람은 모든 메모를 봅니다. 4단계에서 막습니다.
// SUPABASE_URL, SUPABASE_SECRET_KEY는 Vercel 환경변수에서만 읽고
// 응답·로그·브라우저 파일에는 절대 싣지 않습니다.
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../aleph.config.json', import.meta.url), 'utf8'));

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
    const { createLoginVerifier } = await import('../src/verify-login.mjs');
    verifier = createLoginVerifier({ config, supabaseSecretKey: process.env.SUPABASE_SECRET_KEY });
  }
  return verifier(authorization);
}

export function createHandler({ verifyLogin = verifyLoginWithStarterHelper } = {}) {
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }

    const origin = projectOrigin(process.env.SUPABASE_URL);
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!origin || typeof key !== 'string' || !key) {
      return response.status(500).json({ error: 'NOTES_NOT_CONFIGURED' });
    }

    // 토큰이 없거나 검사에 실패하거나 검사 중 오류가 나면 자료 없이 거부합니다.
    let login = null;
    try {
      login = await verifyLogin(request.headers?.authorization);
    } catch (error) {
      console.error('NOTES_LOGIN_CHECK_FAILED', error?.name);
      login = null;
    }
    if (!login) {
      response.setHeader('WWW-Authenticate', 'Bearer');
      return response.status(401).json({ error: 'LOGIN_REQUIRED', message: '로그인이 필요합니다.' });
    }

    // 새 형식 비밀 키는 apikey 헤더만, 옛 JWT 형식 키는 Bearer도 함께 보냅니다.
    const headers = { apikey: key, Accept: 'application/json' };
    if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;

    let upstream;
    try {
      upstream = await fetch(`${origin}/rest/v1/notes?select=title,content`, {
        headers, signal: AbortSignal.timeout(8000),
      });
    } catch {
      return response.status(502).json({ error: 'NOTES_UPSTREAM_ERROR' });
    }
    if (!upstream.ok) {
      console.error('NOTES_UPSTREAM_STATUS', upstream.status);
      return response.status(502).json({ error: 'NOTES_UPSTREAM_ERROR' });
    }

    let rows;
    try {
      rows = await upstream.json();
    } catch {
      return response.status(502).json({ error: 'NOTES_UPSTREAM_ERROR' });
    }
    if (!Array.isArray(rows)) return response.status(502).json({ error: 'NOTES_UPSTREAM_ERROR' });

    // 화면에 필요한 두 칸만 내보냅니다. owner_id 같은 다른 칸은 싣지 않습니다.
    const notes = rows
      .filter((row) => typeof row?.title === 'string' && typeof row?.content === 'string')
      .map(({ title, content }) => ({ title, content }));
    return response.status(200).json({ notes });
  };
}

export default createHandler();
