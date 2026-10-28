// 2단계: 가상 메모를 서버에서만 읽어 주는 함수입니다.
// 아직 로그인 확인이 없어 주소를 아는 누구나 부를 수 있습니다. 3단계에서 막습니다.
// SUPABASE_URL, SUPABASE_SECRET_KEY는 Vercel 환경변수에서만 읽고,
// 응답·로그·브라우저 파일에는 절대 싣지 않습니다.

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

export default async function handler(request, response) {
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
}
