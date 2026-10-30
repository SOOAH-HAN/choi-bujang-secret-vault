# BYTE BACK 방어전 시작 틀 R5

이 저장소는 1단계에서 학생 본인이 GitHub 저장소와 Vercel 배포를 만드는 출발점입니다. 포함된 메모 네 건은 가상 자료입니다. 실제 학생 자료, 토큰, 비밀키를 넣지 마세요.

## 5단계: 자료 요청을 서버 한곳으로 모음 (현재 상태)

- 브라우저의 메모 읽기·추가·수정·삭제는 모두 Vercel 서버 함수(`/api/notes`, `/api/notes/:id`)로만 갑니다. 화면 코드(`public/index.html`)가 Supabase를 직접 부르는 곳은 로그인·로그아웃·세션 확인(`auth`)뿐이고, 메모 자료를 직접 읽거나 고치는 곳은 없습니다(찾아봤고 없음). 그래서 제작 1에서는 파일을 바꾸지 않았습니다.
- DB(학습용 Supabase `public.notes`): `PUBLIC`·`anon`·`authenticated`의 직접 권한이 모두 없습니다. 서버 함수는 서버 전용 비밀 키(`service_role`)로만 접속합니다. 서버 함수의 로그인·소유자 검사는 그대로입니다. RLS 정책 네 개도 남아 있어, 나중에 권한이 다시 열려도 본인 행만 허용되는 두 번째 방어선이 됩니다. 적용한 SQL은 `supabase/*.local.sql`에 있고 Git에는 올리지 않습니다.
- `aleph.config.json`: `step`은 5, `originalApiUrl`은 쿼리 없는 원본 자료 HTTPS 경로(`…supabase.co/rest/v1/notes`)입니다. 허용 경로(`allowedRoutes`)와 로그인 발급자 정보는 4단계와 같습니다.
- 확인한 것: 학생이 직접 실행한 DB 권한 확인에서 `anon`·`authenticated`는 SELECT·INSERT·UPDATE·DELETE가 모두 `false`, `service_role`은 모두 `true`. 공개(anon) 키로 DB에 직접 요청하면 `401`(`permission denied for table notes`)(4단계에서 확인). 시험 계정 A·B로 화면에서 각자 자기 메모 읽기·추가·수정·삭제가 정상.
- 확인하지 못한 것: 로그인 토큰(`authenticated`)으로 실제 직접 요청을 보내 본 시험은 하지 않았습니다. 권한 표로만 확인했습니다. 심판의 재현도 아닙니다.
- 남은 약점: 화면 코드에 Supabase 공개 키(`sb_publishable_…`)가 있습니다. 로그인(Auth)을 브라우저가 직접 부르기 때문이고, 공개용 키이며 DB 직접 접근 권한은 없습니다. 이전 공개 커밋(`dd089bb`)과 옛 배포에는 가상 메모가 그대로 남아 있습니다.
- 다시 실행: `npm run test:notes`, `npm run test:attack`, `npm run test:r5`. 가상 요청 연습이며 실제 배포나 심판 판정이 아닙니다.
- 제출 묶음: `npm run bundle`은 4단계 점검에 더해 공개 화면 HTML과 `/aleph.json`에 서버 전용 키·토큰 모양의 문자열이 있는지 봅니다(있는지 여부만 기록하고 값은 싣지 않음). 요청을 보내지 못하면 `미실행`으로 남습니다.

## 4단계: 로그인해도 내 자료만 보임 (이전 단계)

- 서버 함수(`src/notes-service.mjs`)는 읽기·추가·수정·삭제를 모두 본인 메모로 제한합니다. 한 건 요청은 DB에 `id`와 `owner_id`(검증된 사용자)를 함께 걸고, 돌아온 행의 주인도 다시 비교합니다. 추가할 때 주인은 검증된 사용자 ID로만 저장하며 URL·본문의 소유자 값은 믿지 않습니다.
- 남의 메모에 대한 읽기·수정·삭제는 없는 메모와 같은 `404`입니다. 수정 본문에 `owner_id`·`userId` 같은 소유자 값이 있으면 `403`(`OWNER_CHANGE_FORBIDDEN`)으로 거부하고 소유자는 바뀌지 않습니다.
- DB(학습용 Supabase `public.notes`): RLS를 켜고 `PUBLIC`·`anon`·`authenticated`의 권한을 모두 회수한 뒤, `authenticated`에 SELECT·INSERT·UPDATE·DELETE만 주었습니다. 네 정책 모두 `auth.uid() = owner_id`일 때만 허용합니다(UPDATE는 기존 행과 새 행 둘 다). 서버 함수는 서버 전용 비밀 키로 접속하므로 이 변경과 상관없이 동작합니다. 적용한 SQL은 `supabase/*.local.sql`에 있고 Git에는 올리지 않습니다.
- 확인한 것: 학생이 직접 실행한 결과, `anon`은 네 권한 모두 없음, `authenticated`는 네 권한 있음, 정책 네 개. 공개(anon) 키로 DB에 직접 요청하면 `401`(`permission denied for table notes`). 시험 계정 A·B로 화면에서 각자 자기 메모만 보이고 추가·수정·삭제가 됨.
- 확인하지 못한 것: 심판 계정으로 한 재현, `authenticated` 역할의 직접 접근(심판이 재현할 수 없는 부분이라 점수에서 제외됨).
- 다시 실행: `npm run test:notes`(서버 함수·A/B 소유자 시험, 가짜 Supabase), `npm run test:attack`(자기 점검 코드), `npm run test:r5`. 가상 요청 연습이며 실제 배포나 심판 판정이 아닙니다.
- 제출 묶음: `npm run bundle`은 3단계 점검에 더해 공개 키로 DB에 직접 묻는 요청(`anon_direct_data_api`)이 거부되는지 봅니다. 요청을 보내지 못하면 `미실행`으로 남습니다. 두 시험 계정의 토큰이 없어서 A가 B의 메모를 건드리는 요청은 이 점검에 넣지 않았고 서버 시험으로만 확인합니다.
- **남은 약점**: 이전 공개 커밋(`dd089bb`)과 옛 배포에는 가상 메모가 그대로 남아 있습니다. 서버 함수가 비밀 키로 DB를 읽으므로 앱 쪽 검사 코드가 틀리면 RLS가 막아 주지 못합니다(RLS는 직접 접근을 막는 두 번째 방어선입니다).
- 계정: 화면 시험은 가짜 시험 계정(`example.com`)으로 합니다. 실제 이메일은 코드·Git·제출 묶음에 넣지 않습니다.

## 3단계: 진짜 로그인 (이전 단계)

- 화면(`public/index.html`)에서 Supabase Auth 이메일·비밀번호로 로그인·로그아웃합니다. 로그인한 사람만 메모를 추가·수정·삭제하고 목록을 봅니다. 로그인 전에는 서버에 요청도 보내지 않습니다.
- 서버 함수 `api/notes.js`, `api/notes/[id].js`(구현은 `src/notes-service.mjs`)는 `Authorization: Bearer <토큰>`을 시작 틀의 도우미 `src/verify-login.mjs`로 검사합니다. 도우미는 고치지 않았습니다. 토큰이 없거나 위조·만료·다른 대상용이면 `401`과 JSON 오류 문구(`LOGIN_REQUIRED`)를 돌려줍니다. 브라우저가 보내는 `userId`·`role`은 믿지 않고, 메모의 주인은 검사가 끝난 토큰의 사용자 ID로만 정합니다.
- 허용 경로(`aleph.config.json`의 `allowedRoutes`): `GET /api/notes`, `POST /api/notes`, `GET`·`PUT`·`DELETE /api/notes/:id`. 발급자 정보(`identityProvider`)는 Supabase 프로젝트의 Auth 주소입니다. 화면에 있는 Project URL과 publishable key는 공개용이고, 서버 전용 비밀 키는 Vercel 환경변수에만 있습니다.
- `aleph.config.json`의 `step`은 3입니다. 응답에는 `X-Content-Type-Options: nosniff`(`vercel.json`)가 붙고, `/aleph.json`은 계속 열립니다.
- (3단계 당시) 소유자 검사가 없어 다른 사람 메모 번호로 고치거나 지울 수 있었고, 4단계에서 막았습니다.
- 처음의 가상 메모 네 건은 3단계 당시 주인이 없어 화면에 보이지 않았고, 4단계에서 시험 계정 A의 소유로 연결했습니다.
- 다시 실행: `npm run test:notes`(서버 함수, 가짜 Supabase), `npm run test:attack`(자기 점검 코드), `npm run test:r5`. 가상 요청 연습이며 실제 배포나 심판 판정이 아닙니다. 배포 확인은 `curl.exe -s -i <내 배포 주소>/api/notes`가 로그인 없이 `401`과 JSON 오류 문구를 주는지 봅니다.
- 제출 묶음: `npm run bundle`은 작업 트리가 깨끗하고 Git에 올리지 않는 `bundle-notes.json`이 있어야 합니다. `src/attack-check.mjs`가 배포 주소로 직접 보낸 요청의 결과만 적습니다. 로그인 없는 추가·조회와 일부러 만든 가짜 토큰(위조 서명·만료·다른 대상) 요청이 거부되는지 보고, 요청을 보내지 못하면 `미실행`으로 남깁니다. 심판의 판정이 아닙니다.

## 2단계: 자료를 코드 밖으로 옮김 (이전 단계)

- 가상 메모 네 건은 저장소와 `public/`에서 빠졌고, 학습용 Supabase 테이블 `notes`에 있습니다. 테이블을 만드는 SQL은 메모 본문이 들어 있어 Git에 올리지 않습니다.
- 화면(`public/index.html`)은 서버 함수 `/api/notes`(`api/notes.js`)로 메모를 읽습니다. 함수는 Vercel 환경변수 `SUPABASE_URL`과 서버 전용 `SUPABASE_SECRET_KEY`를 서버에서만 읽습니다. 값은 Vercel 설정의 비밀 입력란에 직접 넣고 코드·Git·로그·응답에 두지 않습니다.
- `aleph.config.json`의 `step`은 2입니다. 빌드는 `public/data.json`을 만들지 않고, 배포의 `/aleph.json`은 계속 만듭니다. `/data.json`을 열면 메모가 없어야 합니다.
- (2단계 당시) `/api/notes`에는 로그인 확인이 없었고 3단계에서 막았습니다.
- **남은 약점**: 이전 공개 커밋(`dd089bb`)과 옛 배포에는 가상 메모가 그대로 남아 있습니다. 확인 절차는 제작 3에서 적습니다.
- 로컬 시험: `npm run test:notes`, `npm run test:attack`, `npm run test:r5`. 가상 요청 연습이며 실제 배포나 심판 판정이 아닙니다. `npm run build -- --local`은 정적 결과물만 만들고 서버 함수나 배포를 증명하지 않습니다.
- 제출 묶음: `npm run bundle`은 작업 트리가 깨끗하고 Git에 올리지 않는 `bundle-notes.json`이 있어야 합니다. `src/attack-check.mjs`가 배포 주소로 로그인 없는 요청을 직접 보내 결과를 적고, 요청을 보내지 못한 점검은 `미실행`으로 남깁니다. 심판의 판정이 아닙니다.

### 노출 확인 절차 (2단계)

가상 메모 문장은 `실습용 가상`으로 시작해 `기록`으로 끝납니다. 아래 검색식은 이 README의 글자와 겹치지 않게 골랐습니다. `<내 배포 주소>`는 Vercel Domains의 짧은 주소(`https://…vercel.app`)로 바꿉니다.

1. **GitHub 최신 파일** (저장소 폴더에서): 결과가 아무것도 나오지 않아야 합니다.
   ```
   git fetch origin
   git grep -n -E "실습용 가상 [^ ]+ 기록" origin/main
   ```
2. **배포 파일** (PowerShell): 앞의 세 줄은 `False`, 마지막 `/api/notes` 줄은 `True`여야 합니다. 마지막 줄은 검색이 제대로 되는지 보는 대조입니다. 마지막이 `False`이면 한글 검색이 깨진 것이라 앞의 `False`도 믿을 수 없습니다. 첫 줄은 한글을 읽게 하는 설정이니 같이 실행하세요.
   ```
   [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
   foreach ($p in '/', '/data.json', '/aleph.json', '/api/notes') { "$p -> " + [bool]((curl.exe -s "<내 배포 주소>$p") -match '실습용 가상') }
   ```
3. **검색이 믿을 만한지 대조**: 옛 공개 커밋에서는 걸려야 정상입니다(`data.json`과 `public/data.json`에 각 4줄). 여기서 0건이면 검색 방법이 틀린 것이라 1·2번의 0건도 믿을 수 없습니다. 한글 입력 문제일 수 있으니 `chcp 65001` 뒤에 다시 실행하거나, GitHub 저장소 검색 칸에서 같은 문장을 찾아 보세요.
   ```
   git grep -n -E "실습용 가상 [^ ]+ 기록" dd089bb
   ```
4. **공개 API** (3단계부터는 `401`과 JSON 오류 문구가 나와야 정상): 메모가 돌아오면 아직 열려 있는 것입니다.
   ```
   curl.exe -s <내 배포 주소>/api/notes
   ```

**이 확인의 한계**

- 현재 최신 파일과 현재 배포만 봅니다. 과거 노출이 해소됐다는 뜻이 아닙니다.
- 옛 공개 커밋 `dd089bb`에는 메모가 그대로 남아 있습니다. Git 이력은 지우지 않았습니다.
- Vercel의 이전 배포는 삭제하기 전까지 남을 수 있습니다. 이 절차는 이전 배포를 확인하지 않습니다.
- `/api/notes`는 2단계 당시 로그인 없이 메모를 돌려줬고, 3단계에서 `401`로 막았습니다(아래 기록은 2단계 시점).

**확인 기록 (2026-10-28)**

| 확인 | 결과 |
|---|---|
| GitHub 최신(`37ec184`) 검색 (1번) | 0건 (실행함) |
| 옛 커밋 `dd089bb` 대조 검색 (3번) | 8줄 걸림: `data.json` 4줄, `public/data.json` 4줄 (실행함) |
| 배포 `/data.json` HTTP 상태 | 404 (직접 요청해 확인함) |
| 배포 `/`·`/data.json`·`/aleph.json` 문장 검색 (2번) | `/`·`/data.json`·`/aleph.json`은 모두 `False`, 대조인 `/api/notes`는 `True` (UTF-8 설정을 넣은 명령, 학생이 직접 실행한 결과를 받아 기록). 한글 읽기 설정 없이 돌린 첫 검색은 대조가 `False`로 깨져서 무효 처리함 |
| 배포 `/api/notes` (4번) | HTTP 200, 로그인 없이 가상 메모 네 건(`title`·`content`만)이 돌아옴. 공개 약점이 남아 있음 (학생이 직접 실행한 결과를 받아 기록) |

## 학생이 하는 일: 세 걸음 (1단계)

1. GitHub 계정을 만듭니다.
2. 방어전 1단계 카드의 **Deploy** 버튼을 누릅니다. Vercel에 GitHub로 로그인하고, 새 저장소가 **본인 계정의 Public 저장소**인지 확인한 뒤 Deploy를 누릅니다.
3. 배포가 끝나면 화면에 나온 `https://…vercel.app` 주소를 방어전 1단계 카드에 붙여넣고 제출합니다. 저장소 주소나 설정 파일은 적지 않습니다.

배포가 끝나면 `/`에서 점령된 가상 자료실을 볼 수 있습니다. `/data.json`에는 같은 가상 메모가 공개됩니다. 이 공개 상태를 확인하는 것이 1단계의 출발점입니다. 1단계 접수와 심판 판정은 포털에서 확인합니다.

## 시작 틀의 자동 처리

`vercel.json`은 정적 결과물 `public`을 배포합니다. 빌드 명령 `npm run build`는 Vercel이 제공하는 GitHub 저장소 소유자·이름, 커밋 SHA, 배포 URL을 검증하고 `public/aleph.json`을 생성합니다. 이 값이 없으면 빌드가 실패하므로, 성공한 것처럼 빈 주소를 내보내지 않습니다. `aleph.json`의 내용만으로 저장소 소유권이나 방어 성공을 인정하지 않습니다. 심판이 공개 저장소의 실제 커밋과 배포된 자료를 따로 대조해야 합니다.

`aleph.config.json`의 `repoUrl`과 `publicAppUrl`은 1단계에서는 자리표시자였고 학생이 편집하지 않습니다. 2단계 저장점에서 실제 저장소와 배포 주소로 채웠고, 3단계에서 로그인 발급자와 허용 경로를 더했고 4단계에서 단계 값을 4로 맞췄습니다. 2단계 이후 코딩 도구가 필요한 설정과 보호 기능을 단계별로 작성합니다. `npm run bundle`과 `bundle-notes.json`도 1단계의 세 걸음에는 포함되지 않습니다.

로컬에서 가상 화면만 확인할 때는 `npm run build -- --local`을 사용합니다. 로컬 실행은 Vercel 배포나 심판 접수를 증명하지 않습니다. 저장소의 `src/attack-check.mjs`는 실제 배포가 된 뒤 `/data.json`을 비로그인으로 요청해 공개 가상 메모의 확인 표시를 읽습니다.

## 다음 단계의 코딩 도구에 전달할 규칙

[AGENTS.md](AGENTS.md)를 먼저 읽히고 한 번에 한 제작 단위만 요청하세요. 2단계부터는 자료 보호를 구현할 때 `public/data.json`을 복사하는 1단계 빌드 흐름도 함께 바꿔야 합니다. 3단계 이후의 로그인, 허용 경로, 5단계의 원본 API 주소, 6단계 이후 정책 규칙은 해당 단계 원고와 계약에 맞춰 추가합니다. 비밀번호·토큰·서버 전용 키·실제 학생 기록을 코드, Git, 제출 묶음에 넣지 않습니다.

`src/decider.mjs`와 `src/detect.mjs`의 로컬 시험은 반 엔진이나 운영 심판의 결과가 아닙니다. 1단계 이후 제출 묶음 계약 `aleph.defense.submission.v2`는 `scripts/bundle.mjs`에 남아 있으며, 코딩 도구가 해당 단계의 최신 배포 주소와 Git 원격을 맞춘 뒤 사용합니다.
