// 학생이 단계마다 같은 자료실에 공격 하나를 더해 가며 고치는 자기 점검입니다.
// 실제로 보낸 요청의 결과만 적습니다. 심판의 판정이 아닙니다.
// 요청을 보내지 못한 점검은 '미실행'으로 남깁니다.
// 토큰, 개인키, 실명, 메모 본문은 결과에 넣지 않습니다.

// 가상 메모 문장 모양입니다. 저장소 검색에 이 파일이 걸리지 않도록 조각으로 만듭니다.
const MEMO_SENTENCE = new RegExp(`${['실습용', '가상'].join(' ')} \\S+ ${'기록'}`, 'u');

function appUrl(config) {
  let app;
  try {
    app = new URL(config.publicAppUrl);
  } catch {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  if (app.protocol !== 'https:' || app.username || app.password || app.search || app.hash
      || app.pathname !== '/' || app.hostname.endsWith('.example')) {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  return app;
}

// 로그인 정보 없이(또는 일부러 잘못된 토큰으로) 요청합니다. 보내지 못하면 이유만 돌려줍니다.
async function request(app, path, { method = 'GET', headers, body } = {}) {
  try {
    const response = await fetch(new URL(path, app), {
      method, redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = (await response.text()).slice(0, 200000);
    return { sent: true, status: response.status, text,
      json: (response.headers.get('content-type') ?? '').includes('application/json') };
  } catch (error) {
    return { sent: false, reason: error?.name === 'TimeoutError' ? '시간 초과' : '연결 실패' };
  }
}

const notRun = (result) => `미실행: 요청을 보내지 못함 (${result.reason})`;

function noteCount(text) {
  try {
    const data = JSON.parse(text);
    const notes = Array.isArray(data) ? data : data?.notes;
    return Array.isArray(notes) ? notes.length : null;
  } catch {
    return null;
  }
}

async function firstStage(config, app) {
  if (typeof config.sampleMarker !== 'string' || !config.sampleMarker) throw new Error('가상 메모의 확인 표시를 넣어 주세요.');
  const response = await fetch(new URL('/data.json', app), {
    redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  let visible = false;
  if (response.ok) {
    try {
      const data = await response.json();
      visible = data?.sampleMarker === config.sampleMarker && Array.isArray(data.notes)
        && data.notes.length > 0;
    } catch {
      // A non-JSON response is a failed check, not a successful deployment.
    }
  }
  return [{ attackId: 'anonymous_note_read', expected: '비로그인 화면에서 가상 메모를 확인',
    observed: visible ? '비로그인 요청에서 공개 가상 메모 확인 표시가 보임' : `비로그인 요청에서 확인 표시가 보이지 않음 (HTTP ${response.status})` }];
}

// 2단계부터 이어지는 공개 파일 점검: /data.json이 없고, 화면과 /aleph.json에 메모 문장이 없어야 합니다.
async function staticAttempts(app) {
  const attempts = [];
  const data = await request(app, '/data.json');
  let dataObserved;
  if (!data.sent) {
    dataObserved = notRun(data);
  } else if (data.status === 404) {
    dataObserved = 'HTTP 404: 공개 /data.json이 없음';
  } else {
    const count = noteCount(data.text);
    dataObserved = count === 0 ? `HTTP ${data.status}: 메모 0건`
      : count > 0 ? `HTTP ${data.status}: 공개 /data.json에 메모 ${count}건이 보임`
        : `HTTP ${data.status}: 메모가 없는지 확인할 수 없음`;
  }
  attempts.push({ attackId: 'static_data_json_removed',
    expected: '공개 /data.json에서 메모가 보이지 않음 (404 또는 0건)', observed: dataObserved });

  const pages = [await request(app, '/'), await request(app, '/aleph.json')];
  const blocked = pages.find((page) => !page.sent);
  attempts.push({ attackId: 'static_pages_note_text',
    expected: '화면 HTML과 /aleph.json에 가상 메모 문장이 보이지 않음',
    observed: blocked ? notRun(blocked)
      : pages.some((page) => MEMO_SENTENCE.test(page.text)) ? '공개 파일에 가상 메모 문장이 보임'
        : `HTTP ${pages[0].status}·${pages[1].status}: 두 공개 파일에 가상 메모 문장이 보이지 않음` });
  return attempts;
}

async function secondStage(app) {
  const attempts = await staticAttempts(app);
  const api = await request(app, '/api/notes');
  let apiObserved;
  if (!api.sent) {
    apiObserved = notRun(api);
  } else {
    const count = noteCount(api.text);
    apiObserved = api.status === 200 && count !== null
      ? `HTTP 200: 로그인 없이 메모 ${count}건이 응답됨 (3단계 전의 알려진 약점)`
      : `HTTP ${api.status}: 로그인 없이 메모 응답을 받지 못함`;
  }
  attempts.push({ attackId: 'anonymous_api_notes_read',
    expected: '로그인 없이 서버 함수를 불러 봄. 3단계 전에는 열려 있는 약점이 남아 있음', observed: apiObserved });
  return attempts;
}

// 서명이 없는 가짜 토큰입니다. 비밀 키를 쓰지 않으며 서명 칸은 아무 글자입니다.
function fakeToken(claims) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'ES256', typ: 'JWT' })}.${part(claims)}.${Buffer.from('not-a-real-signature').toString('base64url')}`;
}

// 거부되어야 하는 요청이 실제로 거부되는지 봅니다 (401·403과 JSON 오류 문구).
function rejection(result) {
  if (!result.sent) return notRun(result);
  const refused = result.status === 401 || result.status === 403;
  if (refused && result.json) return `거부됨: HTTP ${result.status}, JSON 오류 문구`;
  if (refused) return `HTTP ${result.status}로 거부됐지만 응답이 JSON이 아님`;
  return `거부되지 않음: HTTP ${result.status}`;
}

async function thirdStage(config, app) {
  const provider = config.identityProvider;
  if (typeof provider?.issuer !== 'string' || typeof provider?.audience !== 'string') {
    throw new Error('aleph.config.json의 identityProvider에 발급자와 대상을 먼저 적어 주세요.');
  }
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: provider.issuer, aud: provider.audience, role: 'authenticated',
    sub: '99999999-9999-4999-8999-999999999999', iat: now, exp: now + 600 };
  const withToken = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
  const attempts = await staticAttempts(app);

  const attacks = [
    ['anonymous_note_add', '로그인 없이 메모를 추가하면 거부됨',
      ['/api/notes', { method: 'POST', body: { title: '공격 점검', body: '가상 요청' } }]],
    ['anonymous_notes_list', '로그인 토큰 없이 메모 목록을 요청하면 401 또는 403과 JSON 오류 문구',
      ['/api/notes']],
    ['forged_signature_token', '서명이 위조된 로그인 토큰으로 요청하면 거부됨',
      ['/api/notes', withToken(fakeToken(claims))]],
    ['expired_token', '만료된 로그인 토큰으로 요청하면 거부됨',
      ['/api/notes', withToken(fakeToken({ ...claims, iat: now - 7200, exp: now - 3600 }))]],
    ['wrong_audience_token', '다른 서비스용으로 발급된 로그인 토큰으로 요청하면 거부됨',
      ['/api/notes', withToken(fakeToken({ ...claims, aud: 'another-service' }))]],
  ];
  for (const [attackId, expected, [path, init]] of attacks) {
    attempts.push({ attackId, expected, observed: rejection(await request(app, path, init)) });
  }
  return attempts;
}

export async function runAttackChecks(config) {
  if (![1, 2, 3].includes(config.step)) throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
  const app = appUrl(config);
  if (config.step === 1) return firstStage(config, app);
  return config.step === 2 ? secondStage(app) : thirdStage(config, app);
}
