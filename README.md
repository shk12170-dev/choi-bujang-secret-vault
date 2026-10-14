# BYTE BACK 방어전 시작 틀 R5

이 저장소는 1단계에서 학생 본인이 GitHub 저장소와 Vercel 배포를 만드는 출발점입니다. 포함된 메모 네 건은 가상 자료입니다. 실제 학생 자료, 토큰, 비밀키를 넣지 마세요.

## 학생이 하는 일: 세 걸음

1. GitHub 계정을 만듭니다.
2. 방어전 1단계 카드의 **Deploy** 버튼을 누릅니다. Vercel에 GitHub로 로그인하고, 새 저장소가 **본인 계정의 Public 저장소**인지 확인한 뒤 Deploy를 누릅니다.
3. 배포가 끝나면 화면에 나온 `https://…vercel.app` 주소를 방어전 1단계 카드에 붙여넣고 제출합니다. 저장소 주소나 설정 파일은 적지 않습니다.

배포가 끝나면 `/`에서 점령된 가상 자료실을 볼 수 있습니다. `/data.json`에는 같은 가상 메모가 공개됩니다. 이 공개 상태를 확인하는 것이 1단계의 출발점입니다. 1단계 접수와 심판 판정은 포털에서 확인합니다.

## 시작 틀의 자동 처리

`vercel.json`은 정적 결과물 `public`을 배포합니다. 빌드 명령 `npm run build`는 Vercel이 제공하는 GitHub 저장소 소유자·이름, 커밋 SHA, 배포 URL을 검증하고 `public/aleph.json`을 생성합니다. 이 값이 없으면 빌드가 실패하므로, 성공한 것처럼 빈 주소를 내보내지 않습니다. `aleph.json`의 내용만으로 저장소 소유권이나 방어 성공을 인정하지 않습니다. 심판이 공개 저장소의 실제 커밋과 배포된 자료를 따로 대조해야 합니다.

`aleph.config.json`의 `repoUrl`과 `publicAppUrl`은 이전 제출 묶음 방식의 자리표시자입니다. 1단계에서는 학생이 편집하지 않습니다. 2단계 이후 코딩 도구가 필요한 설정과 보호 기능을 단계별로 작성합니다. `npm run bundle`과 `bundle-notes.json`도 1단계의 세 걸음에는 포함되지 않습니다.

로컬에서 가상 화면만 확인할 때는 `npm run build -- --local`을 사용합니다. 로컬 실행은 Vercel 배포나 심판 접수를 증명하지 않습니다. 저장소의 `src/attack-check.mjs`는 실제 배포가 된 뒤 `/data.json`을 비로그인으로 요청해 공개 가상 메모의 확인 표시를 읽습니다.

## 다음 단계의 코딩 도구에 전달할 규칙

[AGENTS.md](AGENTS.md)를 먼저 읽히고 한 번에 한 제작 단위만 요청하세요. 2단계부터는 자료 보호를 구현할 때 `public/data.json`을 복사하는 1단계 빌드 흐름도 함께 바꿔야 합니다. 3단계 이후의 로그인, 허용 경로, 5단계의 원본 API 주소, 6단계 이후 정책 규칙은 해당 단계 원고와 계약에 맞춰 추가합니다. 비밀번호·토큰·서버 전용 키·실제 학생 기록을 코드, Git, 제출 묶음에 넣지 않습니다.

`src/decider.mjs`와 `src/detect.mjs`의 로컬 시험은 반 엔진이나 운영 심판의 결과가 아닙니다. 1단계 이후 제출 묶음 계약 `aleph.defense.submission.v2`는 `scripts/bundle.mjs`에 남아 있으며, 코딩 도구가 해당 단계의 최신 배포 주소와 Git 원격을 맞춘 뒤 사용합니다.

## 2단계: 자료를 코드 밖으로 옮김

- 가상 메모 네 건은 학습용 Supabase `public.notes` 테이블에 있습니다. 테이블은 RLS가 켜져 있고 `anon`·`authenticated`에는 읽기 권한이 없습니다. 테이블을 만든 SQL(`supabase/*.local.sql`)은 메모 문장이 들어 있어 Git에 올리지 않습니다.
- 화면(`public/index.html`)은 `/api/notes` 서버 함수(`api/notes.js`)로 메모를 읽습니다. 함수는 Vercel 환경변수 `SUPABASE_URL`과 서버 전용 `SUPABASE_SECRET_KEY`만 씁니다. 키는 브라우저 파일·응답·로그·Git에 넣지 않으며, Vercel 프로젝트 설정의 Environment Variables 화면에 학생이 직접 입력합니다.
- `aleph.config.json`은 `step: 2`이며 실제 저장소·배포 주소를 담습니다. 첫 화면을 포함한 모든 응답에 `X-Content-Type-Options: nosniff` 헤더를 붙입니다(`vercel.json`).
- 빌드는 더 이상 메모를 `public/data.json`으로 복사하지 않습니다. `public/data.json`은 메모 0건이고 1단계 확인 표시(`sampleMarker`)도 없으며, 메모나 표시가 다시 들어가면 빌드가 실패합니다. `/aleph.json`은 계속 빌드 때 생성됩니다.

### 2단계 당시의 약점 (3단계에서 해결)

- **(해결됨: 3단계에서 로그인 필수로 막음) `/api/notes`는 공개 주소였습니다.** 로그인 확인이 없어 주소를 아는 누구나 비로그인 요청으로 가상 메모 네 건을 받을 수 있습니다. 화면에서 `data.json`을 뺀 것은 저장 위치를 옮긴 것이지 접근을 막은 것이 아닙니다. 3단계에서 로그인한 본인만 읽도록 막기 전까지 이 테이블에는 가상 메모만 둡니다.

### 메모 문장 검색 확인 절차

가상 메모 문장의 공통 부분을 정규식 `실습용 가[상]`으로 찾습니다. 대괄호를 쓰면 이 README 자체는 검색에 걸리지 않습니다. 배포 주소는 Vercel Domains의 짧은 주소를 씁니다.

1. 현재 배포 파일(비로그인 요청):
   ```bash
   APP=https://choi-bujang-secret-vault-seven-omega.vercel.app
   for p in / /data.json /aleph.json /api/notes; do
     printf '%s %s 메모문장 %s건\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' "$APP$p")" "$(curl -s "$APP$p" | grep -o '실습용 가[상]' | wc -l)"
   done
   ```
   정상: `/`·`/data.json`·`/aleph.json`은 0건입니다. 3단계부터 `/api/notes`는 로그인 없이 401과 JSON 오류 문구만 돌려주므로 이 명령에서도 0건입니다.
2. GitHub 최신 파일:
   ```bash
   git fetch origin && git grep -n '실습용 가[상]' origin/main -- . || echo '최신 파일: 메모 문장 없음'
   ```
   정상: `최신 파일: 메모 문장 없음`. `supabase/*.local.sql`은 `.gitignore`로 제외되어 검색 대상에 없어야 합니다.
3. 옛 공개 이력(지워지지 않았음을 확인):
   ```bash
   git log --oneline --all -- data.json public/data.json
   git grep -c '실습용 가[상]' "$(git rev-list --max-parents=0 HEAD)" -- data.json public/data.json
   ```

### 검색 결과 기록

| 확인 시점 | 대상 | 결과 |
|---|---|---|
| 2단계 저장점 커밋 전 | 현재 배포(1단계 버전) `/data.json` | 메모 문장 4건 공개 중 |
| 2단계 저장점 커밋 전 | GitHub `origin/main`(`80aae74`) `data.json`·`public/data.json` | 각 4건 |
| 2단계 저장점 커밋 전 | 로컬 작업본의 Git 추적 파일 | 0건 |
| 2단계 저장점 배포 후 | 현재 배포 `/data.json`·`/api/notes`·첫 화면 헤더 | `npm run bundle`의 직접 점검(`src/attack-check.mjs`)으로 기록 |
| 2단계 저장점 배포 후 | GitHub `origin/main` | 위 절차 2로 확인(저장점 커밋 뒤 실행) |

### 과거 노출은 해소되지 않았습니다

- 최신 파일에서 메모를 빼도 첫 커밋 `80aae74`의 `data.json`·`public/data.json`에는 메모 네 건이 그대로 있고, 공개 저장소의 커밋 기록으로 누구나 볼 수 있습니다.
- 1단계 배포(`choi-bujang-secret-vault-2u0dogq1o-dk-security.vercel.app` 등)도 Vercel에 남아 있으며, 이미 복제·캐시된 사본은 회수할 수 없습니다.
- 그래서 이번 단계는 "앞으로 새로 공개되는 파일에 메모를 두지 않음"까지만 해당합니다. 실제 자료였다면 내용 교체·키 폐기·이력 정리를 따로 해야 하며, 여기서는 가상 메모라 기록만 남깁니다.

### 공개 API의 남은 약점(검색과 별도 기록)

| 대상 | 상태 |
|---|---|
| `/api/notes` 비로그인 GET | 2단계 당시에는 막지 않았음. 3단계에서 401로 막음 |
| `SUPABASE_SECRET_KEY` | 서버 환경변수에만 있음. 공개 키로 테이블을 직접 읽는 요청은 RLS로 거부되어야 하며, 심판이 확인함 |

## 3단계: 진짜 로그인을 붙임

- **로그인:** 화면(`public/index.html`)이 Supabase Auth 이메일·비밀번호 로그인·로그아웃을 공식 SDK(`@supabase/supabase-js`)로 처리합니다. 화면 코드에는 공개용 Project URL과 publishable key만 있고, 비밀번호·토큰은 코드에 두지 않습니다. 서버 전용 `SUPABASE_SECRET_KEY`는 Vercel 환경변수에만 있습니다.
- **서버 검사:** 모든 `/api/notes` 요청은 `src/memo-api.mjs`가 시작 틀의 `src/verify-login.mjs`(수정하지 않음)로 `Authorization: Bearer` 토큰을 검사합니다. 사용자 ID는 서버가 검증한 토큰에서만 얻고, 브라우저가 보낸 `userId`·`role`은 읽지 않습니다. 토큰이 없거나 위조·만료·다른 발급자·다른 서비스용이면 자료 없이 `401`과 JSON 오류 문구(`LOGIN_REQUIRED`)로 거부합니다.
- **메모 추가·수정·삭제:** `user_notes` 테이블(`supabase/user_notes.sql`, RLS 켬, `anon`·`authenticated` 권한 없음, `owner_id uuid`에 외래키 없음)을 서버 함수만 서버 전용 키로 읽고 씁니다. 추가할 때 서버가 확인한 사용자 ID를 `owner_id`로 저장합니다.
- **발급자 정보:** `aleph.config.json`의 `identityProvider`에 발급자·대상·공개키 주소를 적었고 비밀 키는 넣지 않았습니다. `step`은 3입니다.

### 허용 경로(`allowedRoutes`)

| 경로 | 동작 | 응답 |
|---|---|---|
| `GET /api/notes` | 로그인 사용자의 메모 목록 | `[{id,title,body}]` |
| `POST /api/notes` | 메모 추가. `id`(UUID)는 없으면 서버가 만듦 | `201 {id}` |
| `GET /api/notes/:id` | 메모 한 건 | `{id,title,body}`, 없으면 `404` |
| `PUT /api/notes/:id` | 메모 수정 | `{id,title,body}` |
| `DELETE /api/notes/:id` | 메모 삭제(뒤이은 GET은 `404`) | `{id}` |

로그인 없는 요청은 위 모든 경로에서 `401` + JSON입니다. 허용하지 않은 메서드는 `405`입니다.

### 3단계 당시의 약점 (소유자 검사는 4단계에서 해결, 나머지는 그대로)

- **(해결됨: 4단계에서 소유자 검사를 붙임) 소유자 검사가 없었습니다.** 로그인한 사용자는 다른 사람의 메모 UUID를 알면 `GET`·`PUT`·`DELETE /api/notes/:id`로 읽고 고치고 지울 수 있습니다. 목록은 본인 `owner_id` 메모만 돌려주지만 한 건 경로는 `owner_id`를 비교하지 않습니다. 4단계에서 서버가 `owner_id`와 토큰의 사용자 ID를 비교하도록 고칩니다. 로그인은 신원 확인일 뿐이고 접근 권한이 아닙니다.
- **이전 `notes` 테이블과 옛 공개 이력은 그대로입니다.** 2단계의 `notes` 테이블(가상 메모 네 건)은 이제 쓰이지 않지만 지우지 않았고, 옛 공개 커밋 `80aae74`와 1단계 배포의 노출도 해소되지 않았습니다.
- 가상 메모만 쓰며, 실제 개인정보·비밀번호를 메모에 적지 않습니다.

### 직접 확인할 것

1. 시크릿 창에서 로그인 없이 자료가 안 보이는가? (「로그인하면 자료가 보입니다.」만 보이고 쓰기 칸이 없어야 함)
2. 정상 A 로그인 뒤 가상 메모를 추가·수정·삭제할 수 있는가?
3. 브라우저에 서버 전용 키가 없는가? (페이지 소스에서 `sb_secret_`·`service_role`이 검색되지 않아야 함. `sb_publishable_`만 있어야 함)

### 100점 항목 확인

| 항목 | 확인 방법 |
|---|---|
| 로그인 없이 목록 요청 시 401 또는 403 + JSON 오류 문구 | `curl -i $APP/api/notes` → `401`, `Content-Type: application/json`, `{"error":"LOGIN_REQUIRED",…}` |
| `/aleph.json`이 열림 | `curl -s $APP/aleph.json` → `step 3`과 현재 커밋. 빌드 스크립트가 지우지 않음 |
| 첫 화면에 보안 헤더 | `curl -I $APP/` → `X-Content-Type-Options: nosniff` (`vercel.json`의 `headers`) |

위 세 가지는 `npm run bundle`의 직접 점검(`src/attack-check.mjs`)에서도 비로그인 요청으로 확인해 기록합니다.

## 4단계: 로그인해도 내 자료만 보이게 함

- **서버 소유자 검사:** `src/memo-routes.mjs`가 서버가 검증한 사용자 ID(`login.userId`)와 DB의 `owner_id`를 비교합니다. URL·본문의 `owner_id`(`ownerId`·`userId` 포함)는 믿지 않습니다.
  - 목록(`GET /api/notes`)은 본인 `owner_id` 메모만 돌려줍니다.
  - 추가(`POST /api/notes`)는 본문의 `owner_id`를 읽지 않고 확인된 ID로만 저장합니다.
  - 한 건 조회·수정·삭제(`/api/notes/:id`)는 먼저 행을 읽어 `owner_id`가 본인인지 비교합니다. 쓰기 쿼리에도 `owner_id` 조건을 한 번 더 걸어 확인과 변경 사이에 소유자가 달라지는 경우도 막습니다.
  - 남의 메모와 없는 메모는 같은 `404`로 답해 메모 번호가 존재하는지 알려 주지 않습니다.
  - 수정 본문은 `{title,body}`만 쓰며, `owner_id`를 다른 사람 값으로 바꾸려는 수정은 `403`(`OWNER_CHANGE_NOT_ALLOWED`)으로 거부합니다.
- **DB 권한과 RLS:** `supabase/user_notes_rls.sql`을 적용했습니다. `public`·`anon`·`authenticated`의 기존 권한을 모두 회수한 뒤 `authenticated`에만 SELECT·INSERT·UPDATE·DELETE를 주고, 정책 네 개가 모두 `auth.uid() = owner_id`일 때만 허용합니다(SELECT·DELETE는 기존 행 USING, INSERT는 새 행 WITH CHECK, UPDATE는 두 가지 모두). 앱 서버는 서버 전용 키(`service_role`)로 접근하므로 이 SQL의 영향을 받지 않고, 이 SQL은 `anon`·`authenticated` 키로 Data API를 직접 부르는 경로를 좁힙니다.
- **소유자 연결:** `supabase/owners.local.sql`(메모 문장이 있어 Git에 올리지 않음)로 A의 가상 메모 세 건과 B의 가상 시험 메모 한 건에 올바른 소유자 ID를 연결했습니다.
- `aleph.config.json`의 `step`은 4이고 `allowedRoutes`는 3단계와 같은 실제 경로 다섯 개입니다.

### 권한 확인 결과 (적용 전후, `supabase/user_notes_grants_check.sql`)

| 역할 | 적용 전 | 적용 후 |
|---|---|---|
| `anon` | 권한 없음 | 권한 없음 |
| `authenticated` | 권한 없음 | SELECT·INSERT·UPDATE·DELETE만 (REFERENCES·TRIGGER·TRUNCATE 없음) |
| `service_role` | 전체 | 전체(서버 API가 쓰는 권한, 그대로) |

DB에서 직접 시험한 결과(롤백함, 시험 SQL은 계정 이메일이 있어 Git에 올리지 않음): A가 보는 B 행 0건, B가 보는 A 행 0건, 서로의 행 수정·삭제 0건, 남의 소유자로 추가·소유자 변경은 거부(42501), `anon` 읽기는 거부(42501).

### 직접 확인할 것 (두 개의 시크릿 창)

1. A로 로그인한 창에서 A의 메모 세 건이 보이고, B의 「B의 시험 메모」는 보이지 않는가?
2. B로 로그인한 창에서 「B의 시험 메모」만 보이고 A의 메모는 보이지 않는가?
3. A와 B는 각자 자기 메모를 추가·수정·삭제할 수 있는가? 5단계 뒤에도 화면에서 다시 확인합니다.

### 점검 기록과 남은 약점

- `npm run bundle`의 직접 점검(`src/attack-check.mjs`)은 비로그인 요청만 보냅니다. 메모 번호를 안다고 해도 로그인 없이는 조회·수정·삭제가 401 + JSON으로 거부되는지 확인합니다. **A와 B 사이의 접근은 비밀번호가 필요해 자동 점검에 넣지 못했고** 위의 직접 확인과 서버 소유자 검사 시험(`test/owner-check.test.mjs`, 가짜 DB 사용)으로 확인했습니다. 심판 신원으로 학생 메모에 접근하는 경우는 심판 환경에서만 재현되며, 서버는 심판 신원도 같은 `owner_id` 비교로 거부합니다.
- 심판이 재현할 수 없는 `authenticated` 역할의 직접 Data API 접근은 점수에서 제외되지만 위 RLS로 막아 두었습니다. 직접 Data API 확인은 `anon` 키로만 합니다. 실제 DB에 publishable(`anon`) 키로 `user_notes`와 이전 `notes` 테이블의 읽기·추가·수정·삭제를 요청했고 모두 `42501`(권한 없음)로 거부됐습니다.
- **심판 신원과 다른 서비스용 토큰:** 심판 서버 자체는 재현할 수 없습니다. 대신 `test/login-claims.test.mjs`가 시험용 키를 검증기(`src/verify-login.mjs`, 수정하지 않음)에 넣어, 심판 토큰은 서명·대상(`aud`)·역할·신원 a/b·수명(15분)·UUID 조건이 모두 맞을 때만 통과하고, 학생 토큰은 발급자·대상·`authenticated` 역할·만료가 맞을 때만 통과하는지 확인합니다. 다른 서비스용 대상, `anon` 역할, 만료, 다른 발급자, 다른 키로 서명한 토큰은 거부됩니다. 통과한 심판 신원과 학생은 서로의 메모를 읽거나 고치거나 지우지 못합니다(404). 이 시험은 실제 심판 판정이 아닙니다.
- **과거 노출은 그대로입니다.** 2단계의 `notes` 테이블(가상 메모 네 건)과 옛 공개 커밋 `80aae74`, 1단계 배포의 노출은 해소되지 않았습니다. `notes` 테이블의 `owner_id`만 연결했습니다.
- 가상 메모만 쓰며, 실제 개인정보·비밀번호를 메모에 적지 않습니다.

### 100점 항목 확인 (4단계에서도 유지)

| 항목 | 확인 방법 |
|---|---|
| 로그인 없이 목록 요청 시 401 또는 403 + JSON 오류 문구 | `curl -i $APP/api/notes` → `401`, `application/json`, `{"error":"LOGIN_REQUIRED",…}` |
| `/aleph.json`이 열림 | `curl -s $APP/aleph.json` → `step 4`와 현재 커밋 |
| 첫 화면에 보안 헤더 | `curl -I $APP/` → `X-Content-Type-Options: nosniff` |

## 5단계: 자료 요청을 서버 한곳으로 모음

- **브라우저는 서버 함수만 부릅니다.** 화면(`public/index.html`)은 Supabase 주소·공개 키·SDK를 모두 갖지 않고 우리 서버 함수만 부릅니다.
  - 메모: `GET·POST /api/notes`, `GET·PUT·DELETE /api/notes/:id` (3·4단계의 로그인·소유자 검사 그대로)
  - 로그인: `POST /api/auth/login`·`/api/auth/refresh`·`/api/auth/logout` (`src/auth-proxy.mjs`). 서버가 Supabase Auth에 대신 요청하고 브라우저에는 토큰·이메일·만료 시각만 돌려줍니다. 입력 길이를 검사하고 비밀번호·토큰은 로그에 남기지 않습니다.
  - 로그인 세션은 이 탭의 `sessionStorage`에만 두고 비밀번호는 저장하지 않습니다. 탭을 닫으면 로그아웃됩니다.
- **키는 서버에만 있습니다.** Vercel 환경변수 `SUPABASE_URL`, 서버 전용 `SUPABASE_SECRET_KEY`, 로그인 요청용 `SUPABASE_PUBLISHABLE_KEY`를 학생이 Environment Variables 화면에 직접 넣었습니다. 코드·Git·제출 묶음에는 값이 없습니다. (이전 커밋에는 화면 코드에 있던 공개용 키가 남아 있습니다. 공개용 키이며 아래 권한 회수로 이 키로는 자료에 접근할 수 없습니다.)
- **원본 자료 경로:** `aleph.config.json`의 `originalApiUrl`은 쿼리 없는 `https://lvakmgwgeayyxrjwdltp.supabase.co/rest/v1/user_notes`이고 `step`은 5입니다. 허용 경로(`allowedRoutes`)는 자료 API 다섯 개 그대로입니다. 심판은 배포된 `/aleph.json`을 읽으므로 빌드(`scripts/deployment-identity.mjs`)가 `originalApiUrl`(쿼리·사용자 정보가 없는 HTTPS 주소만)과 `allowedRoutes`를 `/aleph.json`에도 담습니다. 5단계 첫 제출에서 `/aleph.json`에 `originalApiUrl`이 없어 `S05_ORIGINAL_URL_MISSING`으로 지적받아 고쳤습니다.
- **직접 권한 회수:** `supabase/user_notes_revoke_direct.sql`로 `user_notes`에서 `PUBLIC`·`anon`·`authenticated`의 권한을 모두 회수했습니다. RLS와 4단계 정책(`auth.uid() = owner_id`)은 켜 둔 채 남겨 권한이 실수로 다시 열려도 본인 행만 보이게 합니다. 서버 함수는 서버 전용 키(`service_role`)로 접근하므로 영향이 없습니다. 다른 테이블은 건드리지 않았습니다.

### 권한 확인 결과 (적용 전후, `supabase/user_notes_grants_check.sql`)

| 역할 | 적용 전 | 적용 후 |
|---|---|---|
| `anon` | 권한 없음 | 권한 없음 |
| `authenticated` | SELECT·INSERT·UPDATE·DELETE | **권한 없음** |
| `service_role` | 전체 | 전체(서버 함수가 쓰는 권한, 그대로) |

적용 후 `rls_enabled = true`, 정책 4개 유지, `anon_can_select = false`, `authenticated_can_select = false`, `authenticated_can_insert = false`, `service_role_can_select = true`입니다.

### 원본 자료 직접 요청 확인

| 요청 | 결과 |
|---|---|
| 원본 경로를 키 없이 GET | `401` 키 없음, 메모 없음 |
| 같은 경로를 공개(anon) 키로 GET | `42501` 권한 없음, 메모 없음 |
| 공개(anon) 키로 추가·수정·삭제 | 거부(`42501` 또는 `401`) |

심판은 `authenticated` 역할의 직접 접근을 재현할 수 없어서 `anon` 키로만 확인합니다. 그래도 `authenticated`의 권한도 회수해 두었습니다.

### 직접 확인할 것

1. 브라우저는 서버 함수만 부르는가? (개발자 도구 Network 탭에 `supabase.co` 요청이 없고 `/api/auth/*`·`/api/notes*`만 보여야 함. 페이지 소스에 `sb_publishable_`이 없어야 함)
2. A 정상·B 거부·무로그인을 확인했는가? (A는 자기 메모를 읽고 추가·수정·삭제, B는 A의 메모가 안 보이고, 로그인 없이는 401)
3. 원본 자료 주소를 공개 키로 직접 불러도 메모가 없는가? (위 표)

### 점검 기록과 남은 약점

- `npm run bundle`의 직접 점검(`src/attack-check.mjs`)은 비로그인 요청만 보냅니다. 화면에 키 없음, 원본 경로를 키 없이 부를 때 메모 없음, 서버 로그인 함수가 빈 요청을 거부함, 메모 번호만 알고 로그인 없이 읽기·수정·삭제 거부를 확인해 기록합니다. A·B 계정 간 접근과 공개 키(anon)로 직접 부르는 시험은 키·비밀번호가 필요해 자동 점검에 넣지 못했고 위 수동 확인과 `test/` 시험으로 확인했습니다.
- **로그인 요청이 서버를 거치므로** Supabase의 로그인 시도 횟수 제한이 서버 전체로 공유됩니다. 학습용이라 두었습니다.
- **과거 노출은 그대로입니다.** 이전 `notes` 테이블(가상 메모 네 건)과 옛 공개 커밋 `80aae74`, 1단계 배포의 노출은 해소되지 않았습니다. 이전 커밋에는 화면 코드에 있던 공개용 키도 남아 있습니다.
- 가상 메모만 쓰며, 실제 개인정보·비밀번호를 메모에 적지 않습니다.

### 100점 항목 확인

| 항목 | 확인 방법 |
|---|---|
| `/aleph.json`에 `allowedRoutes`가 적혀 있음 | `curl -s $APP/aleph.json` → `step 5`, 현재 커밋, `allowedRoutes` 다섯 개와 `originalApiUrl`(https). `scripts/build-public.mjs`가 빌드할 때 `aleph.config.json`의 허용 경로를 담아 `public/aleph.json`을 만들며 이 파일을 지우지 않습니다. |
| 첫 화면에 보안 헤더 | `curl -I $APP/` → `X-Content-Type-Options: nosniff` |
| 화면 코드에 Supabase 공개 키가 없음 | `curl -s $APP/ \| grep -c sb_publishable_` → `0` |

## 보너스 xdr-01: 무차별 로그인 공격 탐지

Wazuh 형식의 공식 연습 경보(`xdr/fixtures/brute-force.json`, 28건, SHA256 `7F73C089…8E9563A`, 공식 시작 틀과 같음)에서 로그인 실패 무리를 찾아 행동을 정합니다. 경보 원본은 고치지 않습니다. 실제 로그가 아니라 수업용 가상 자료입니다.

### 구성

| 파일 | 역할 |
|---|---|
| `xdr/brute-force/read-alerts.mjs` | 확인용 읽기 모듈(공통 구현 `xdr/read-alerts.mjs`). 시각·출발 주소·계정·규칙 수준·설명만 뽑고, 비밀값처럼 보이는 값은 `[가림]`으로 바꿉니다. `decide.mjs`는 이 파일을 부르지 않습니다. |
| `xdr/brute-force/patterns.json` | 공격 형태 세 개(이름·찾는 조건·근거 한 줄·출처, MITRE ATT&CK T1110)와 일부러 막지 않는 정상·애매한 사례 |
| `xdr/brute-force/decide.mjs` | 제출용 판단 모듈. `decide(alert)` 하나만 내보내며 **`import`가 없는 단일 ES 모듈**이고 파일·네트워크·시계를 쓰지 않습니다. 패턴은 파일 맨 위 상수입니다. |
| `xdr/brute-force/respond.mjs` | `block`만 만료·근거 경보 번호가 있는 추가 거부 후보(`xdr/deny-rules.json`)로 만들고 알림을 `xdr/alerts.log`에 쌓습니다(공통 구현 `xdr/ztna-overlay.mjs`, 기존 판정 위에 거부만 덧씌우는 `applyDenyOverlay()` 포함). |
| `xdr/brute-force/result.json` | `npm run xdr:run -- brute-force` 결과(`aleph.xdr.result.v1`) |
| `scripts/xdr-replay.mjs` | 가상 경보 시각으로 두 보너스 모듈의 overlay를 함께 재생하는 모의 시험 |
| `test/brute-force.test.mjs` | 읽기·분류·복합 조건·독립 실행·차단 후보·만료·중복 방지 시험 |

`xdr/alerts.log`, `xdr/deny-rules.json`, `xdr/replay-result.json`은 실행할 때마다 다시 만드는 런타임 파일이라 Git에서 제외했습니다.

### 판단 기준 (학습용 기준값, MITRE의 보편 임계값 아님)

| 패턴 | 기법 | 차단(block) 조건 |
|---|---|---|
| `same-source-failure-burst` | T1110.001 | 실패 집계 20건 이상 + 경보 수준 10 이상 + 시간 범위가 있으면 5분 이내 |
| `multi-account-same-password` | T1110.003 | 같은 비밀번호·같은 간격·계정 이름 바꿔 대입이 계정 5개 이상 + 수준 10 이상(계정 수가 없으면 실패 10건 이상도 확인) |
| `incremental-password-guess` | T1110.001 | 비밀번호를 조금씩 바꿔 대입 + 실패 20건 이상 + 수준 10 이상 |

조건을 일부만 만족하거나 실패 3~19건이면 `alert`(0.50~0.80), 실패 1~2건이거나 실패가 없는 정상 이벤트는 `record`입니다. 0.85 이상 `block`, 0.50 이상 `alert`, 그 아래 `record`입니다. 단어·경보 수준·MITRE 태그·주소·경보 번호·순서 하나만으로는 막지 않고, 저장된 `result.json`을 정답으로 읽지 않습니다.

### 실행과 실제 결과

```bash
npm run xdr:test                 # XDR 시험 24개(XDR-01 11개, XDR-02 10개, 실행기 3개)
npm run xdr:run -- brute-force   # result.json 생성(판정자도 격리 환경에서 같은 명령을 다시 실행)
npm run xdr:replay               # 두 모듈 모의 overlay 재생
node xdr/brute-force/respond.mjs # 거부 후보·알림 로그 생성
```

- 분류: **block 10 · alert 9 · record 9** (총 28건). 명확한 공격 `bf-01`~`bf-10`은 `block`, 애매한 시도 `bf-11`~`bf-19`(실패 3~8건, 실패 뒤 성공, 잠금 뒤 재시도 등)는 `alert`, 정상 이벤트 `bf-20`~`bf-28`은 `record`입니다. **정상·애매한 이벤트를 막은 경우는 없습니다.** 이 구분은 경보 설명과 수준으로 판단한 것이며 저장소에 정답표는 없습니다.
- 모의 overlay(XDR-01만): attackDenied 10/10, normalDenied 0, ambiguousDenied 0, expiredDenied 0. 두 모듈을 함께 재생한 결과는 아래 XDR-02 절에 있습니다.
- 차단 후보 10개: 각 경보 시각부터 15분 유효, 근거 경보 번호 포함. 같은 주소(203.0.113.10)의 경보 두 건은 각각 규칙이 되고 마지막 규칙이 끝나야 풀립니다.
- 독립 실행: `decide.mjs` 파일 하나를 `data:` URL로 불러와도 28건 결과가 같습니다.

### 연결 범위와 한계

- **Jev reviewer:** 연결 정보·키·계약이 없어 쓰지 않습니다. 애매한 경보는 바깥에 묻지 않고 `alert`로 남깁니다.
- **ZTNA 판정기:** 이 저장소의 `src/decider.mjs`는 시작 틀 상태(모든 요청 거부, `starter.deny`)이고, 요청 계약(`docs/DECIDER_REQUEST.md`)에 검증된 출발 IP가 없습니다. 그래서 **운영 판정기에는 연결하지 않았고 기존 규칙도 고치지 않았습니다.** 출발 IP를 사용자가 보낸 값·헤더에서 가져와 막지 않습니다. 추가 거부는 `applyDenyOverlay()`(맞는 유효 규칙이 없으면 기존 판정에 그대로 위임)를 모의 재생에서만 검증했고, 실제 접속 허용·회수로 보고하지 않습니다.
- 내부망·루프백 주소, 같은 주소에 정상 이벤트가 있는 경우, 시각·근거 번호가 없는 경보는 차단 후보로 만들지 않습니다.
- 기준값은 공식 경보 28건과 길라잡이의 학습 기준에 맞춘 것이라, 다른 경보 묶음에서는 오분류가 있을 수 있습니다. 로컬 시험 통과는 심판 통과가 아니며, 판정은 심판이 다시 실행해 확인합니다.

## 보너스 xdr-02: 웹 주입 공격 탐지

Wazuh 형식의 공식 연습 경보(`xdr/fixtures/web-injection.json`, 26건, SHA256 `52CB9255…FAB39AD0`, 공식 시작 틀과 같음)에서 웹 요청에 섞인 주입 시도를 가려 행동을 정합니다. 경보 원본은 고치지 않습니다. 공식 경보의 요청 주소에는 실제 공격 문자열 대신 문서용 표기(`doc-sql-chain` 등)가 들어 있습니다.

### 구성

| 파일 | 역할 |
|---|---|
| `xdr/web-injection/read-alerts.mjs` | 확인용 읽기 모듈(공통 구현 `xdr/read-alerts.mjs`). 시각·출발 주소·계정·규칙 수준·설명만 뽑고 **요청 주소 원문은 내보내지 않습니다.** `decide.mjs`는 이 파일을 부르지 않습니다. |
| `xdr/web-injection/patterns.json` | 공격 형태 네 개(이름·찾는 조건·근거 한 줄·출처, MITRE ATT&CK T1190)와 일부러 막지 않는 정상·애매한 사례 |
| `xdr/web-injection/decide.mjs` | 제출용 판단 모듈. `decide(alert)` 하나만 내보내며 **`import`가 없는 단일 ES 모듈**이고 파일·네트워크·시계를 쓰지 않습니다. 패턴은 파일 맨 위 상수입니다. |
| `xdr/web-injection/respond.mjs` | `block`만 15분 만료·근거 경보 번호가 있는 추가 거부 후보로 `xdr/deny-rules.json`에 넣고(XDR-01 규칙 보존), 알림을 `xdr/alerts.log`에 계정·요청 주소 원문 없이 쌓습니다. |
| `xdr/web-injection/result.json` | `npm run xdr:run -- web-injection` 결과(`aleph.xdr.result.v1`) |
| `xdr/read-alerts.mjs`, `xdr/ztna-overlay.mjs` | 두 모듈이 함께 쓰는 읽기·차단 연결 공통 부품(XDR-01도 같은 부품을 쓰도록 정리했고 XDR-01의 `decide.mjs`와 결과는 바뀌지 않음) |
| `test/web-injection.test.mjs` | 읽기·분류·단어 하나로 막지 않음·실제 구문 변형·독립 실행·차단 후보·두 모듈 겹침과 만료 시험 |

### 패턴과 판단 기준 (학습용 기준값, MITRE의 보편 임계값 아님)

| 패턴 | 찾는 구조 |
|---|---|
| `sql-injection` | SQL 구문을 이어 붙이거나 조건을 덧붙인 구조(union·select 연결, 따옴표 뒤 or 조건, 주석 등) 또는 센서의 SQL 구문 표기 |
| `script-injection` | script 태그·이벤트 처리기·`javascript:` 또는 센서의 스크립트 삽입 표식 |
| `path-traversal` | `../`(또는 인코딩)가 두 단계 이상 이어지는 구조 또는 센서의 경로 이탈 표기 |
| `command-injection` | 명령 구분자(`;` `\|` `&&` `$(`)와 명령어 또는 센서의 명령 구분자 표기 (근거 T1190·CWE-78) |

- **차단(block):** 주입 구조 + 같은 주소의 반복 5번 이상 + 경보 수준 10 이상 (0.90~0.97)
- **알림(alert):** 구조는 있으나 반복이 적거나 수준이 낮은 경우(0.60~0.70), 또는 구조는 없지만 센서가 수준 5 이상으로 남긴 웹 경보(0.55)
- **기록(record):** 구조가 없고 수준 4 이하인 정상 조회(0.10)

요청 주소는 2048자로 자르고 최대 두 번 디코딩해 소문자 문자열로만 검사하며, SQL·스크립트·명령을 실행하지 않습니다. 센서 설명은 부정하는 문장("삽입 표식은 아닙니다", "반복은 없습니다")을 구조 근거로 쓰지 않습니다. `select`·`script`·`SQL`이라는 수업명·공지 제목, 경보 수준, MITRE 태그, 주소, 경보 번호 하나만으로는 막지 않습니다.

### 실행과 실제 결과

```bash
npm run xdr:run -- web-injection   # result.json 생성(판정자도 격리 환경에서 같은 명령을 다시 실행)
npm run xdr:replay                 # 두 모듈 모의 overlay 재생
node xdr/web-injection/respond.mjs # 거부 후보·알림 로그 생성
```

- 분류: **block 8 · alert 9 · record 9** (총 26건). 명확한 공격 `wi-01`~`wi-08`(구조 + 8~20번 반복 + 수준 10~12)은 `block`, 애매한 시도 `wi-09`~`wi-17`(1건뿐인 표기, 수업명·공지 제목, 긴 주소 등)은 `alert`, 정상 조회 `wi-18`~`wi-26`은 `record`입니다. **정상·애매한 이벤트를 막은 경우는 없습니다.** 이 구분은 경보 설명·요청 구조·반복·수준으로 판단한 것이며 저장소에 정답표는 없습니다.
- 두 모듈 모의 overlay: **attackDenied 18(XDR-01 10 + XDR-02 8), normalDenied 0, ambiguousDenied 0, expiredDenied 0**
- 두 모듈 규칙이 겹친 주소 `203.0.113.10`(bf-01·bf-02·wi-01)은 먼저 끝난 규칙 뒤에도 다른 모듈 규칙이 유효하면 계속 거부되고, 마지막 규칙이 끝나야 기존 판정으로 돌아갑니다.
- 독립 실행: `decide.mjs` 파일 하나를 `data:` URL로 불러와도 26건 결과가 같습니다.

### 연결 범위와 한계

- **Jev reviewer:** 연결 정보·키·계약이 없어 쓰지 않습니다. 애매한 경보는 바깥에 묻지 않고 `alert`로 남깁니다.
- **ZTNA 판정기:** XDR-01과 같습니다. `src/decider.mjs`는 시작 틀 상태이고 요청 계약에 검증된 출발 IP가 없어 **운영 판정기에는 연결하지 않았고 기존 규칙도 고치지 않았습니다.** 추가 거부는 모의 재생에서만 검증했고 실제 접속 허용·회수로 보고하지 않습니다.
- 공식 경보의 요청 주소는 문서용 표기라 센서 설명과 반복 집계를 함께 읽습니다. 실제 구문 형태(인코딩된 script 태그, `../` 반복, union select 등)는 시험의 변형 사례로만 확인했습니다. 다른 경보 묶음에서는 오분류가 있을 수 있으며, 로컬 시험 통과는 심판 통과가 아닙니다.

## 6단계: 등록한 기기만 자료실에 들어옴

- **규칙 하나를 판정기에 더했습니다.** `src/decider.mjs`의 규칙 `device_registered`(`RULE_IDS`에 `starter.deny`와 함께 등록)는 판정 요청의 `deviceRegistered`가 정확히 `true`일 때만 다음 조건을 봅니다. 값이 `false`이거나 없거나 `true`가 아닌 형태(문자열 `"true"`, 숫자 `1` 등)이면 `deny`와 이유 코드 `device_not_registered`로 거부합니다. 등록 기기의 읽기(`method`가 `GET`)는 `allow`(이유 코드 `approved`)이고, 그 밖의 요청은 아직 허용하는 규칙이 없어 기본 거부(`starter.deny`)입니다.
- **계약에 있는 이름만 읽습니다.** 판정기는 `docs/DECIDER_REQUEST.md`의 `requestId`, `deviceRegistered`, `method`만 읽습니다. 브라우저가 보낸 사용자 번호·역할·기기 상태나 계약에 없는 값(`identity`, `device`, `role`, `geo`)은 읽지 않고 임의 상수로 채우지 않습니다. 응답은 5개 이름(`schema`, `requestId`, `decision`, `reasonCode`, `ruleIds`)만 담고 `ruleIds`는 항상 `RULE_IDS`에 있는 이름입니다.
- **기존 자료실은 그대로입니다.** 자료실 주소·브라우저 화면·로그인·메모 API는 이번 단계에서 바꾸지 않았습니다. 이번 단계에는 설치할 접속 프로그램이 없고, 인증서·CA·서명 키·개인키를 만들거나 Git에 넣지 않았습니다.

### 확인 순서

1. 저장소 루트에서 판정기 연습을 실행합니다.
   ```bash
   npm run decider:test
   ```
2. 출력에 아래 두 줄이 모두 보여야 하고, 마지막 줄 안내와 함께 종료 코드가 0이어야 합니다.
   ```text
   통과 · 등록 기기의 정상 요청
   통과 · 미등록 기기의 가상 요청
   이 명령은 가상 요청으로 연습하며 심판 통과 증거가 아닙니다.
   ```
   「확인 필요」가 한 줄이라도 보이면 그 요청의 응답을 확인합니다.
3. 두 줄의 "통과"는 위 응답이 각각 아래와 같다는 뜻입니다(같은 가상 요청으로 `decide`를 직접 불러 확인한 값).

   | 가상 요청 | `deviceRegistered` | 결정 | 이유 코드 | 규칙 |
   |---|---|---|---|---|
   | 등록 기기의 정상 요청 | `true` | `allow` | `approved` | `device_registered` |
   | 미등록 기기의 가상 요청 | `false` | `deny` | `device_not_registered` | `device_registered` |
   | 기기 등록 값이 없는 요청 | 없음 | `deny` | `device_not_registered` | `device_registered` |

4. 판정기 규칙 시험(값 형태·읽기 외 요청·이상한 입력·계약 이름만 읽는지)도 함께 실행합니다.
   ```bash
   node --test test/decider.test.mjs
   ```

### 확인 범위와 한계

- `npm run decider:test`는 가상 요청으로 하는 **로컬 연습**이며 심판 통과의 증거가 아닙니다. 반 엔진이 실제 기기·인증서를 확인하는 경로는 이 저장소에서 시험하지 않았습니다.
- 서울(미등록 기기 인증서), 의성(클라이언트 인증서 없는 mTLS 통로), 보성(등록 기기와 다른 사용자 토큰), 청양(등록되지 않은 가상 기기 사건) 같은 **미등록 기기 공격은 심판이 직접 시험합니다.** 이 저장소에서 그 공격을 재현했다고 주장하지 않습니다.
- `npm run fixture:7`(정상 사건 `allow`, 복합 이상 사건 `step_up`)은 7단계 연습이라 6단계에서는 복합 이상 사건 부분이 통과하지 않는 것이 정상입니다.
- 허용 이유 코드 `approved`는 문서의 예시를 따른 것이며 운영 등록부의 허용 코드 목록은 이 저장소에서 확인할 수 없습니다.

### 설정과 100점 항목 확인

- `aleph.config.json`의 `step`은 6입니다. 단계를 올릴 때 이 숫자도 함께 올리며, `src/attack-check.mjs`에도 6단계 점검(5단계 점검 + 판정기 기기 등록 규칙의 가상 요청 호출 3개)을 더했습니다.
- `허용 경로(allowedRoutes)`와 `originalApiUrl`, 로그인·메모 API는 바뀌지 않았습니다.

| 항목 | 확인 방법과 결과 |
|---|---|
| 저장소를 새로 받아 `npm install`이 오류 없이 끝남 | 커밋할 파일만 새 폴더에 풀고(`node_modules` 없음) `npm install`을 실행했고 오류 없이 끝났습니다(패키지 10개). 같은 폴더에서 `npm run decider:test`도 통과했습니다. |
| 판정기가 계약의 요청 이름만 읽고 모든 가상 요청에 형식이 맞는 응답을 돌려줌 | `test/decider.test.mjs`가 소스에서 읽는 요청 이름(`requestId`, `deviceRegistered`, `method`)이 `docs/DECIDER_REQUEST.md`의 이름인지, `role`·`identity`·`device`·`geo`를 읽지 않는지, 응답이 5개 이름이고 `ruleIds`가 모두 `RULE_IDS`에 있는지 확인합니다. |
| `aleph.config.json`의 `step`이 6 이상 | `step: 6` |

## 7단계: 평소와 다른 접속은 다시 확인함

판정기(`src/decider.mjs`)에 심판이 보낸 가상 접속 사건을 읽는 규칙을 더했습니다. 6단계의 기기 규칙 `device_registered`는 그대로 앞에 있습니다. `RULE_IDS`는 `starter.deny`, `device_registered`, `step_up_required`입니다.

### 입력 검사: 접속 정보의 출처 구분 (`readAccessSignals`)

접속 정보는 엔진이 만든 `signals`, `recentEvents`, `stepUp`에서만 읽습니다. 계약에 없는 이름(클라이언트 헤더, 위치 값 등)은 읽지 않고 개수만 기록하며, 값이 없거나 출처가 불명확하면 임의의 정상값으로 채우지 않습니다.

| 출처 | 조건 | 쓰임 |
|---|---|---|
| `fixture` | `signals.source`가 정확히 `judge_fixture` | 심판의 가상 사건. 규칙 시험에는 쓰지만 실제 위치 증거가 아님 |
| `none` | `signals.source`가 정확히 `none` | 실제 경로. 근거 없음이며 같이 온 값도 쓰지 않음 |
| `untrusted` | 그 밖의 모든 경우 | 어떤 값도 판단에 쓰지 않음 |

지역·네트워크는 소문자 단어, 시각은 0~23 정수일 때만 값으로 받고 아니면 `null`(사용 불가)입니다. `recentEvents`는 최대 12건이고 항목 형태가 맞을 때만 읽습니다. `stepUp`은 `verified: true`이고 나이가 0~900초일 때만 검증됨으로 읽습니다.

### 규칙 `step_up_required`

등록 기기의 읽기(GET)에서 아래 세 가지가 **모두** 겹칠 때만 `step_up`(이유 코드 `step_up_required`)을 돌려줍니다. 기준값은 학습용이며 보편 기준이 아닙니다.

| 요소 | 기준 |
|---|---|
| 평소와 다른 시각 | 7~21시 밖 |
| 처음 보는 네트워크 | 엔진이 `network: "unusual"`로 표시 |
| 갑작스러운 읽기 급증 | `recentEvents`의 `risk_signal`이 10분 안에 합계 10건 이상 |

- 지역 하나만으로는 추가 확인도 거부도 만들지 않습니다. 지역은 `region_foreign` 참고 표시로만 남고, 이 규칙은 어떤 조합에서도 `deny`를 만들지 않습니다.
- 요소가 하나나 둘뿐이면 걸리지 않고, 출처가 불명확하거나 값이 빠진 사건도 근거로 쓰지 않아 기기 규칙의 `allow`를 따릅니다.
- 엔진이 다시 확인했다고 넘긴 요청(`stepUp.verified: true`, 0~900초)은 `allow`합니다. 기기 규칙이 먼저여서 미등록 기기는 복합 사건이어도 `device_not_registered`로 거부됩니다.
- 사유는 `describeStepUp(request)`가 요소별(`unusual_hour`, `unusual_network`, `read_burst`)로 남깁니다. 응답은 5개 이름만 담을 수 있어 이유 코드는 `step_up_required` 하나입니다. 주소·값 원문은 담지 않습니다.

### 재로그인 계약 확인 결과

| 확인 항목 | 결과 |
|---|---|
| 요청 쪽: 다시 확인했다는 표시 | **있음**. `stepUp: {verified, authAgeSeconds}`(`docs/DECIDER_REQUEST.md`). `verified`가 `true`일 때 나이는 0~900초 |
| 응답 쪽: 추가 확인 요청 | **있음**. `decision: 'step_up'`은 엔진에 추가 본인 확인을 요청하는 결정 |
| 엔진이 같은 내 로그인으로 **다시 로그인한 시각을 검증**하는 방법·값·경로 | **문서에 없음**. 이 저장소와 공식 시작 틀 최신(`2cd777b`) 어디에도 설명이 없음 |
| 이 자료실이 엔진 뒤에서 `step_up`을 집행하는지 | **아님**. 배포 설정에 엔진 연결이 없음 |
| 판정기가 토큰을 읽거나 기록하는지 | **아님**. 토큰·헤더·쿠키를 읽지 않고 응답·사유에도 되돌리지 않음(시험으로 확인) |

따라서 **가상 사건 규칙만 시험했고, 실제 자료 차단과 재로그인 뒤 재판정은 미실행입니다.** `step_up` 결정이 실제로 자료 응답을 막는지는 엔진이 결정을 집행하는 환경에서만 알 수 있어서, 이 저장소의 시험을 실제 차단 증거로 보고하지 않습니다.

### 직접 확인할 것

| 확인 | 결과 | 근거 |
|---|---|---|
| 정상과 복합 이상 사건의 판정이 다른가? | **예** | 정상 사건은 `allow`(`approved`), 복합 이상 사건은 `step_up`(`step_up_required`). `npm run fixture:7`, `npm run decider:test`(네 항목), `test/step-up.test.mjs`로 확인 |
| 추가 확인 전 자료가 없는가? | **판정기 응답까지는 예, 실제 자료 차단은 미실행** | `step_up` 응답은 5개 이름(`schema`, `requestId`, `decision`, `reasonCode`, `ruleIds`)뿐이고 메모·본문·토큰이 실리지 않으며 판정기에는 자료를 읽어 오는 코드가 없음(시험으로 확인). 엔진이 `step_up`을 받아 실제 자료 응답을 막는지는 엔진이 결정을 집행하는 환경에서만 알 수 있어 이 저장소에서는 실측하지 않았음 |

### 확인 순서

1. 가상 사건 연습: `npm run fixture:7` → `정상 사건: allow`, `복합 이상 사건: step_up`
2. 판정기 연습: `npm run decider:test` → 네 항목 모두 `통과`(등록 정상, 미등록, 복합 이상, 다시 확인한 복합 이상)
3. 규칙 시험: `node --test test/step-up.test.mjs test/access-signals.test.mjs`
4. (미실행, 계약이 준비된 환경에서만) 복합 사건 요청에 대한 자료 응답이 없고 `step_up` 결정만 돌아오는지, 엔진이 새 로그인 시각을 검증해 `stepUp.verified`를 채운 뒤 같은 요청이 `allow`되는지를 실측합니다. 그 결과를 이 문서에 적기 전에는 완료라고 쓰지 않습니다.

### 100점 항목 확인

| 항목 | 확인 방법 |
|---|---|
| 저장소를 새로 받아 `npm install` 성공 | 커밋할 파일만 새 폴더에 풀고(`node_modules` 없음) `npm install`을 실행해 오류 없이 끝났습니다(패키지 10개). 같은 폴더에서 `npm run decider:test`(네 항목 통과)와 `npm run fixture:7`(정상 `allow`, 복합 `step_up`)도 확인했습니다. |
| 판정기가 계약 이름만 읽고 응답 형식이 맞음 | `test/decider.test.mjs`가 읽는 이름(`requestId`, `deviceRegistered`, `method`, `signals`, `recentEvents`, `stepUp`)이 계약에 있는지, 응답 5개 이름·`ruleIds`가 `RULE_IDS` 안인지 확인 |
| `aleph.config.json`의 `step`이 7 이상 | `step: 7`. `src/attack-check.mjs`에 7단계 점검(6단계 점검 18개 + 판정기 가상 사건 2개, 제출 묶음 점검 상한 20개)을 더했습니다. |

## 8단계: 자료마다 갈 수 있는 구역을 나눔

자원을 구역으로 나누고, 판정기와 자료 API가 **각자** 구역과 권한을 확인합니다. 화면 메뉴 숨김이나 요청 본문의 `role`은 어떤 쪽에서도 근거로 쓰지 않습니다.

### 자원 구분표 (`src/resources.mjs`)

요청마다 서버가 구별할 수 있는 자원 ID를 붙입니다. API는 로그인 통과 뒤 이 ID를 `X-Resource-Id` 응답 머리글과 컨텍스트에 남깁니다.

| 자원 | 자원 ID | 구역 | 권한 확인 방식 |
|---|---|---|---|
| 메모 | `student.memo.list` / `student.memo.item` | `student` | API가 검증된 사용자와 저장된 `owner_id`를 대조 |
| 반 공지 | `instructor.notice.list` / `instructor.notice.item` | `instructor` | 읽기는 로그인한 사용자, 쓰기는 누구에게나 거부 |
| 강사 관리 경로 | `instructor.notice.admin.list` / `.item` | `instructor` | 서버의 강사 허용 목록에 있는 검증된 학생 로그인만 추가(POST)·수정(PUT) |

미등록 경로, `:id` 자리의 기능 이름(`export`, `all`, `admin` 등), 쿼리·인코딩·점 조각이 섞인 경로는 자원으로 인정하지 않습니다.

### 판정기 구역 규칙 `zone_access`

`RULE_IDS`는 `starter.deny`, `device_registered`, `step_up_required`, `zone_access`입니다. 규칙 순서는 기기 등록(6단계) → 구역(8단계) → 추가 확인(7단계)이고 앞 단계 규칙은 그대로 유지됩니다.

| 구역 | 서비스 | 허용 | 거부 |
|---|---|---|---|
| 메모 | `notes` | ID 하나를 고르는 경로(`/api/notes/:id`, 연습 모양 `/notes/:id`)의 읽기(GET) | ID 없는 전체 목록(모든 메서드), 모든 쓰기 |
| 반 공지 | `notices` | 읽기(GET) | 쓰기(POST·PUT·PATCH·DELETE)는 누구에게나 |
| 강사 자료 | `instructor` | 없음 | 읽기 포함 전부 |

- 알 수 없는 서비스·경로, `service`와 경로가 다른 요청, `route`와 `path`가 다른 요청, 쿼리가 있는 요청(`queryLength`가 0이 아님)은 거부합니다.
- 메모 ID의 형식(UUID 여부)은 좁히지 않습니다. 대신 `export`·`all` 같은 기능 이름은 ID가 될 수 없습니다.
- 판정기 요청에는 역할이 없어서 강사의 공지 수정은 판정기가 아니라 서버의 관리 경로가 처리합니다. 메모 주인 비교도 판정기가 아니라 API가 합니다.
- 거부 이유 코드는 이미 쓰던 `starter_not_ready`를 유지하고, 어느 규칙이 거부했는지는 `ruleIds`(`zone_access`)로 구별합니다.
- `aleph.config.json`의 `allowedRoutes`는 판정기가 허용하는 경로만 적습니다: `GET /api/notes/:id`, `GET /api/notices`, `GET /api/notices/:id`. 목록·쓰기·관리 경로는 판정기 허용 경로가 아니라서 적지 않았습니다(이전 단계에서 적었던 `/api/notes` 목록·쓰기 경로는 API가 계속 제공하며 판정기를 거치지 않는 앱 화면이 씁니다).

### 자료 API의 재확인

| 경로 | 확인 |
|---|---|
| `GET·PUT·DELETE /api/notes/:id`, `GET /api/notes` | 조회·수정·삭제는 요청이 아니라 **저장된 `owner_id`와 서버가 검증한 사용자**를 대조(4단계), 목록도 `owner_id` 조건. 거부는 없는 메모와 같은 404 |
| `GET /api/notices`, `/api/notices/:id` | 로그인한 사용자만 읽기. 쓰기는 `403`(`notice_write_not_allowed_here`) |
| `POST /api/admin/notices`, `PUT /api/admin/notices/:id` | 서버 환경변수 `INSTRUCTOR_USER_IDS`(강사 사용자 UUID 목록)에 있는 검증된 **학생** 로그인만. 목록이 비어 있으면 모두 거부, 심판 신원(`kind: judge`)은 강사가 아님 |

- 요청 본문·머리글·쿼리의 `role`, `userId`, `owner_id`, `instructor` 값은 권한 근거로 읽지 않습니다(시험으로 확인).
- 거부 사유는 서버 로그에 자원·동작·사유 코드만 짧게 남깁니다(사용자 ID·토큰·본문은 기록하지 않음). 예: `memo: deny resource=student.memo.item action=read reason=not_owner`.
- 공지 테이블은 `supabase/class_notices.sql`(RLS 켬, `anon`·`authenticated` 권한 없음)이며 서버 함수만 접근합니다.

### 직접 확인할 것

| 확인 | 결과 | 근거 |
|---|---|---|
| 다른 구역 요청이 API에서 거부되는가? | **예** | `test/api-zones.test.mjs`: B의 A 메모 조회·수정·삭제는 404/403이고 A의 메모는 변경 전후 동일, B의 목록에 A의 자료 0건, 학생의 공지 수정은 `role` 위조·쿼리·머리글 포함 403이며 공지 변화 없음, 비로그인·위조 토큰은 공지·관리 경로 모두 401. 판정기는 `test/zones.test.mjs`(메모 목록·공지 쓰기·강사 자료·알 수 없는 경로·route/path 불일치·쿼리 우회 거부) |
| 본인 정상 요청은 유지되는가? | **예** | A의 자기 목록·조회·수정, 본문의 `role`은 무시되고 소유자는 그대로. 판정기는 자기 메모 읽기 `allow`(`/api/notes/:id`, `/notes/demo` 연습 모양, UUID가 아닌 ID 포함). `npm run decider:test` 네 항목, `npm run fixture:7` 통과 |

### 확인 순서

```bash
node --test test/zones.test.mjs test/api-zones.test.mjs test/resources.test.mjs   # 구역·API·자원 구분표
npm run decider:test      # 네 항목 통과(등록·미등록·복합 이상·다시 확인)
npm run fixture:7         # 정상 allow, 복합 이상 step_up
```

### 확인 범위와 미검증

- **강사의 정상 수정은 가상 사용자 시험(`INSTRUCTOR_USER_IDS`에 가상 UUID를 넣은 로컬 시험)에서만 확인**했고, 운영 환경에는 강사 허용 목록과 공지 테이블이 아직 설정되지 않아 **실제 강사 접속은 미검증**입니다. 목록이 비어 있는 운영 환경에서는 공지를 아무도 수정할 수 없습니다.
- 로그인한 학생의 공지 수정 거부는 가상 사용자 시험으로 확인했고, `npm run bundle`의 배포 점검은 로그인 정보가 없어 비로그인 요청까지만 확인합니다.
- 엔진을 통한 자기 메모 수정은 판정기가 소유자 증거 없이 쓰기를 거부하므로 허용되지 않습니다. 앱 화면의 수정은 판정기를 거치지 않는 API 경로에서 동작하며, 엔진 경유 쓰기는 공식 소유권 계약이 생기기 전까지 미검증입니다.
- 심판이 쓰는 `service`·`route` 표기가 위 가정(`notes`/`notices`/`instructor`, `/api` 접두어 유무)과 다르면 판정 결과가 다를 수 있습니다.

### 100점 항목 확인

| 항목 | 확인 방법과 결과 |
|---|---|
| 저장소를 새로 받아 `npm install` 성공 | 커밋할 파일만 새 폴더에 풀고(`node_modules` 없음) `npm install`을 실행해 오류 없이 끝났습니다(패키지 10개). 같은 폴더에서 `decider:test` 네 항목, `fixture:7`, 구역·API·판정기 시험 63개도 통과했습니다. |
| 판정기가 계약 이름만 읽고 응답 형식이 맞음 | `test/decider.test.mjs`·`test/zones.test.mjs`가 읽는 이름(`requestId`, `deviceRegistered`, `method`, `service`, `route`, `path`, `queryLength`, `signals`, `recentEvents`, `stepUp`)이 계약에 있는지, 응답 5개 이름과 `ruleIds ⊂ RULE_IDS`를 확인. `role`·`identity`·`device`·`geo`는 읽지 않음 |
| `aleph.config.json`의 `step`이 8 이상 | `step: 8`. `src/attack-check.mjs`에 8단계 점검(제출 묶음 점검 상한 20개 안에서 중복을 합치고 구역·공지 점검 6개 추가)을 더했습니다. |

## 9단계: 복합 이상을 찾아 회수를 제안함

`src/detect.mjs`의 `detect(events)`가 가상 사건에서 복합 이상(처음 보는 네트워크 + 다량 조회)을 찾아, 접속 허용·거부 응답과는 **별개의 결과**로 `propose_revocation` 제안을 돌려줍니다. 이 함수는 제안만 하고 회수 API를 부르거나 기기 권한을 바꾸지 않습니다. 실제 회수와 회수까지 걸린 시간은 심판이 확인합니다.

- 입력: 가명 사용자(`identity.sub` 또는 `subjectId`)·기기(`deviceId`)·요청 종류(`method`)·판정(`decision`)·시각(`at`)·네트워크(`network`)만 읽습니다. 메모 내용·토큰·실명·지역은 읽거나 복사하지 않습니다.
- 규칙(학습용 기준값): 같은 사용자의 GET이 10분 구간에서 120건을 넘고, 그 구간에 처음 보는 네트워크가 함께 있을 때만 의심합니다. 정확히 120건, 평소 네트워크의 다량 조회, 지역만 다른 사건은 그대로 둡니다.
- 결과: `{ action: 'propose_revocation', reasonCode: 'burst_read', subject, deviceId? }`. 확인된 가상 기기가 한 개일 때만 `deviceId`를 담고, 기기를 하나로 정할 수 없으면 범위를 넓히지 않고 `observe`로 둡니다.

### 직접 확인할 것

| 확인 | 결과 | 근거 |
|---|---|---|
| 복합 의심 사건만 회수 제안을 내는가? | **예** | `test/detect-rule.test.mjs`·`test/detect-revocation.test.mjs`: 복합 130건은 대상·이유 코드가 있는 제안, 평소 네트워크·적은 조회·정확히 120건·지역만 다름은 `observe` |
| 정상 기기는 유지되는가? | **예** | 정상 기기와 의심 기기가 섞인 사건에서 의심 기기 한 개만 지목하고, 기기를 정할 수 없으면(동률·일부 사건만 기기 값 있음) 제안하지 않음 |

### 확인 순서

```bash
node --test test/detect-input.test.mjs test/detect-rule.test.mjs test/detect-revocation.test.mjs
npm run detect:test       # 탐지 연습 여섯 항목(심판 판정이 아님)
npm run decider:test      # 판정기 응답 형식 그대로
```

### 확인 범위와 미검증

- 이 저장소의 확인은 로컬 가상 사건 시험입니다. 심판의 실제 회수와 회수 시간은 측정하지 않았습니다.
- 사건에 네트워크 값이 전혀 없으면(탐지 연습 계약 모양) 계약대로 다량 조회만 봅니다. 심판 사건이 이와 다른 방식으로 복합 조건을 표시하면 결과가 다를 수 있습니다.

### 100점 항목 확인

| 항목 | 확인 방법과 결과 |
|---|---|
| 저장소를 새로 받아 `npm install` 성공 | 커밋할 파일만 새 폴더에 풀고 `npm install` 후 시험 실행(아래 보고 참고) |
| 판정기가 계약 이름만 읽고 응답 형식이 맞음 | `src/decider.mjs`는 이번 단계에서 바꾸지 않았고 `test/detect-revocation.test.mjs`가 응답 5개 이름을 다시 확인 |
| `aleph.config.json`의 `step`이 9 이상 | `step: 9` |

## 10단계: 백업에서 자료실을 되살림

### 정책 사본과 복원 절차 (제작 1·2)

| 명령 | 하는 일 |
|---|---|
| `npm run policy:diff` | 정책 사본(`backup/policy-snapshot.json`)과 현재 시험 정책의 차이만 보여 줍니다. 사본이 없거나 검증에 실패하면 중단합니다. 아무것도 쓰지 않습니다. |
| `npm run policy:restore` | 바뀔 항목과 복원할 버전을 보여 줍니다(확인 값이 없으면 여기까지만). |
| `npm run policy:restore -- --confirm <사본 digest>` | 확인 값이 맞을 때만 설정 파일의 `allowedRoutes`를 사본 값으로 되돌리고 감사 기록(`backup/restore-audit.jsonl`)에 한 줄을 덧붙인 뒤 소유자·판정기 시험을 실행합니다. |
| `npm run policy:snapshot -- <버전>` | 침해 전에 정책이 올바르다고 확인한 시점에 사본을 만듭니다. 이미 있으면 덮어쓰지 않습니다. |

- 비교하는 정책: 규칙 이름, 허용 경로, 자원 구분표, 탐지 기준값. 단계(`step`)와 다른 서비스 규칙은 비교·복원하지 않습니다.
- 코드가 가진 항목(규칙 이름·구분표·탐지 기준값)은 자동으로 바꾸지 않고, 사본과 다르면 `git diff <커밋> -- <파일>`을 안내합니다.
- 사본의 digest는 무결성 값이며 서명이 아닙니다.

### 메모 한 건 복원 (제작 3)

| 서비스 | 경로 | 본문 | 응답 |
|---|---|---|---|
| `notes` | `POST /api/notes/restore` (`aleph.config.json`의 `restoreRoute`) | `{ "id": "<복원할 메모 UUID>" }` 하나뿐 | 성공 200 `{ id, restored, action, contentSha256, auditRecorded }`, 본문은 싣지 않음 |

- 사본 표 `note_backups`와 감사 표 `note_restore_audit`은 `supabase/note_backups.sql`로 만듭니다. 서버 함수만 접근하며 브라우저 키로는 읽을 수 없습니다. 사본 만들기 SQL은 파일 아래쪽 주석에 있고 시험 계정 B의 사용자 ID를 직접 넣어 한 번 실행합니다(이 파일에 값은 적지 않습니다).
- 대조: 로그인한 사용자와 사본의 소유자가 같고, 사본의 내용 해시가 사본의 제목·본문으로 다시 계산한 값과 같고, 쓴 뒤 다시 읽은 메모의 ID·소유자·내용 해시가 사본과 같을 때만 성공으로 답합니다. 내용 해시는 제목의 UTF-8 바이트 수·`:`·제목·줄바꿈·본문의 SHA-256입니다.
- 거부: 다른 사용자의 사본과 없는 사본은 같은 404, 본문에 `id` 외의 이름이 있으면 400, 사본 해시 불일치 409, 현재 메모의 소유자가 사본과 다르면 409.
- 보존: 복원 대상 한 건 외의 메모는 읽지도 쓰지도 않으며, 감사 표는 덧붙이기만 합니다(수정·삭제는 트리거가 막습니다). 사본 표도 이 경로가 바꾸지 않습니다.
- 판정기(`src/decider.mjs`)는 이 경로를 허용 경로로 두지 않습니다. 복원은 판정기가 아니라 API가 로그인한 사용자와 사본 소유자를 직접 대조해 처리합니다.

### 확인 범위와 미검증

- 위 동작은 가상 DB를 쓰는 로컬 시험(`test/note-restore.test.mjs`, `test/policy-restore.test.mjs`)으로 확인했고, 메모 한 건 복원은 운영에서 시험 계정 B로 한 번 확인했습니다(실행 기록 참고). 복원 뒤 사본 3건의 ID·소유자·내용 해시가 현재 메모와 일치하고 감사 기록이 한 줄 늘었음을 운영 DB 쿼리로 확인했습니다(2026-10-14). A 계정으로 B의 메모·사본 ID를 지정한 조회·수정·삭제·복원 요청이 모두 404 `NOT_FOUND`였고 A의 자기 목록은 200이었습니다(학생이 브라우저 콘솔에서 실행한 결과를 전달받아 기록). 복구 뒤 1~9단계 전체를 순서대로 다시 실행한 것은 아닙니다.
- 심판이 복구 경로에 보내는 본문 모양(`{ "id": ... }`)과 사본을 어디서 가져오는지는 이 저장소에서 확인할 수 없는 가정입니다.

### 복구 뒤 1~9단계 요청을 다시 실행할 순서 (제작 4)

복구한 직후 아래 순서대로 실행합니다. 앞 단계가 실패하면 다음 단계로 넘어가지 말고 그 첫 오류부터 확인하세요.

| 순서 | 무엇을 | 명령 또는 방법 | 정상으로 보일 결과(이전에 막던 요청은 거부) |
|---|---|---|---|
| 1 | 복구 직전 상태 확인 | `npm run policy:diff` | 복원할 버전·커밋·digest와 바뀔 항목이 보입니다. 사본이 없거나 검증에 실패하면 여기서 중단합니다. |
| 2 | 정책 복원 | `npm run policy:restore -- --confirm <digest>` | 되돌린 항목, 감사 기록 한 줄, 복원 뒤 확인(소유자·구역·판정기 시험) 통과 |
| 3 | 메모 한 건 복원 | 시험 계정 B 로그인 후 `POST /api/notes/restore` 본문 `{"id": "<B의 메모 UUID>"}` | 200과 `contentSha256`. 다른 계정으로 같은 ID를 보내면 404 |
| 4 | 정책이 돌아왔는지 | `npm run policy:diff` | `변경 범위: 없음` |
| 5 | 로컬 시험 묶음(1~10단계) | `node --test <test 폴더의 *.test.mjs, package-starter 제외>` | 실패 0 |
| 6 | 판정기·탐지·XDR 연습 | `npm run decider:test` · `npm run fixture:7` · `npm run detect:test` · `npm run xdr:test` | 정상 allow, 복합 이상 step_up, 미등록 기기 deny, 복합 의심만 회수 제안 |
| 7 | 배포된 공개 요청 점검 | `npm run bundle` | 비로그인·위조 토큰 요청 거부, 공개 자료에 메모 0건, `allowedRoutes`·`originalApiUrl` 유지 |
| 8 | 자료 복원 확인(수동) | A·B 계정으로 앱에서 직접 | 복원한 메모의 제목·본문이 사본과 같음, B가 A의 메모 번호로 조회·수정·삭제하면 거부, A의 정상 조회·수정은 유지 |

단계별로 무엇이 다시 거부·유지되는지는 다음 시험이 담당합니다.

| 단계 | 정상 요청(유지) | 금지 요청(거부) | 확인 수단 |
|---|---|---|---|
| 1~2 공개 자료 | 첫 화면, `/aleph.json` | 공개 `/data.json`의 메모 | 순서 7 |
| 3 로그인 | 로그인한 A의 목록 | 비로그인·위조 토큰 401, 빈 로그인 요청 400 | 순서 5·7 |
| 4 소유자 | A의 자기 메모 조회·수정 | B의 A 메모 조회·수정·삭제 404/403 | 순서 5 (`owner-check`, `api-zones`) |
| 5 서버 한곳 | 허용 경로의 메모 한 건 | 키 없는 원본 직접 호출, 브라우저의 키·주소 노출 | 순서 7 |
| 보너스 xdr | 정상·애매한 주소 | 무차별 로그인·웹 주입 | 순서 6 |
| 6 기기 | 등록 기기의 정상 읽기 | 미등록·기기 값 없음 deny | 순서 6 |
| 7 추가 확인 | 정상 사건 allow | 복합 이상 step_up | 순서 6 |
| 8 구역 | 자기 메모 한 건·공지 읽기 | 메모 목록·쓰기·공지 쓰기·강사 자료 deny, 학생의 공지 수정 403 | 순서 5 (`zones`, `api-zones`) |
| 9 탐지 | 정상 사건 observe | 복합 의심 사건만 회수 제안 | 순서 6 (`detect-*`) |

### 실행 기록 (꾸미지 않음)

| 항목 | 상태 | 비고 |
|---|---|---|
| 로컬 시험 묶음(순서 5) | **실행함: 154개 통과, 실패 0** (2026-10-14) | 복구와 무관한 현재 코드 상태입니다. `package-starter.test.mjs`는 시작 틀 기준표 불일치로 제외했습니다. |
| 판정기·탐지·XDR 연습(순서 6) | **실행함: 통과** (2026-10-14) | `decider:test` 4항목, `fixture:7`, `detect:test` 6항목, `xdr:test` 25개 |
| 정책 비교(순서 1·4) | **실행함: 변경 범위 없음** | 복원을 실제로 한 것이 아니라 현재 정책이 사본과 같다는 확인입니다. |
| 정책 복원 절차(순서 2) | 임시로 바꾼 설정으로만 실행함 | 실제 침해 뒤 복구가 아닙니다. |
| 메모 한 건 복원(순서 3) | **실행함(운영, 2026-10-14)** | 운영 `note_backups`·`note_restore_audit` 적용, 시험 계정 B의 메모 3건 사본 생성(건수·해시 일치 확인). B로 로그인해 메모 한 건을 변조한 뒤 `POST /api/notes/restore`를 호출: 200, `restored: true`, `action: updated`, `auditRecorded: true`, 제목이 변조 전과 같음. 학생이 브라우저 콘솔에서 직접 실행한 결과를 전달받아 기록한 것입니다. |
| 배포된 공개 요청 점검(순서 7) | **실행함(운영 복원 뒤, 2026-10-14)** | 운영에서 메모 한 건을 복원한 뒤 배포 주소로 `npm run bundle`을 실행: 비로그인·위조 토큰 거부, 공개 자료에 메모 0건, 키 없는 원본 직접 호출 거부, 비로그인 복원 요청 401. 20개 점검 기록 |
| 앱 화면 수동 확인(순서 8) | **일부 실행함(2026-10-14)** | B 로그인: 복원 뒤 메모 제목이 변조 전과 같음. A 로그인: 자기 목록 200, B의 메모 조회·수정·삭제·복원 요청은 404. 복원한 메모 본문을 화면에서 사본과 비교한 것은 아님 |

### 직접 확인할 것 (10단계)

| 확인 | 결과 | 근거 |
|---|---|---|
| 복원할 버전과 변경 범위가 실행 전에 보이는가? | **예** | `npm run policy:diff`·`npm run policy:restore`(확인 값 없이)가 버전·커밋·digest와 바뀔 항목만 보여 주고 아무것도 쓰지 않음. 사본이 없거나 변조되면 중단 |
| 복구 대상 한 건의 ID·소유자·내용 해시가 사본과 같은가? | **예** | `test/note-restore.test.mjs`(가상 DB)와 운영 확인: 사본 3건의 해시가 현재 메모와 일치, 변조 뒤 복원 호출이 200이고 제목이 돌아옴. 복원 뒤 내용 해시를 운영 DB에서 사본과 직접 대조하지는 않았습니다. |
| 자료와 정책이 돌아오고 이전에 막던 요청이 다시 거부되는지 볼 수 있는가? | **순서 문서화, 복구 뒤 실행은 미실행** | 위 「복구 뒤 1~9단계 요청을 다시 실행할 순서」와 실행 기록 |

### 100점 항목 확인 (10단계)

| 항목 | 확인 방법과 결과 |
|---|---|
| 저장소를 새로 받아 `npm install` 성공 | 커밋할 파일만 새 폴더에 풀어 `npm install`을 실행(아래 보고 참고) |
| `src/decider.mjs`가 계약 이름만 읽고 응답 형식이 맞음 | 이번 단계에서 판정기를 바꾸지 않았고 `decider:test`·`fixture:7`·판정기 시험 통과 |
| `aleph.config.json`의 `step`이 10 이상 | `step: 10` |

## 11단계: 나만의 접속 앱과 기기 승인

내 자료실을 설치형 웹앱 화면으로 다듬고, 서버가 이 기기를 등록 기기로 확인한 뒤에만 자료를 열어 줍니다. 따로 접속 프로그램을 만들거나 설치하지 않았고, 서비스 워커·캐시도 쓰지 않습니다.

### 앱 설정과 화면 (제작 1)

| 파일 | 내용 |
|---|---|
| `public/manifest.webmanifest` | 앱 이름 `BYTE BACK 내 자료실`, 짧은 이름, 시작 주소 `/`, `display: standalone`, 아이콘 |
| `public/icon.svg` | 벡터 아이콘 |
| `vercel.json` | manifest의 `Content-Type: application/manifest+json` 헤더(기존 `nosniff` 유지) |
| `public/index.html` | 「이 기기의 승인 상태」 패널, 설치 표시(참고용), 오프라인 안내 |

설치 표시(설치된 앱 화면으로 열었는지)는 참고용이며 기기 승인과 별개입니다. 설치했다는 표시만으로 기기 확인이 끝났다고 보지 않습니다.

### 기기 승인 흐름 (제작 2)

| 서비스 | 경로 | 하는 일 |
|---|---|---|
| `device` | `GET /api/device/status` | 로그인한 학생의 이 기기 상태: `unrequested`·`pending`·`approved`·`denied` (심판 시험 신원은 `not_applicable`) |
| `device` | `POST /api/device/request` | 이 기기의 승인을 요청(대기 기록만 만듦). 본문은 읽지 않음, 사용자당 대기 5건 제한 |

1. 로그인하면 화면이 서버에 승인 상태를 묻고, 승인 전에는 자료를 부르지 않으며 편집창도 숨깁니다.
2. 「이 기기 승인 요청」 버튼은 요청만 보냅니다. 승인(`approved`)·거부(`denied`)는 앱의 어떤 경로로도 바뀌지 않고 운영자가 DB에서 직접 바꿉니다(`supabase/device_approvals.sql`).
3. 서버는 학생 로그인의 모든 보호 자료 요청(`/api/notes*`·`/api/notices*`·`/api/admin/*`·`/api/notes/restore`)마다 (사용자, 기기) 쌍이 승인됐는지 다시 확인하고 아니면 `403 DEVICE_NOT_APPROVED`로 막습니다. 확인하지 못하면(`DB 오류`) 열어 주지 않습니다(`503`).
4. 기기 식별은 서버가 만든 무작위 핸들을 HttpOnly·Secure·SameSite=Strict 쿠키(`Path=/api`)로 맡깁니다. 화면 스크립트는 읽지 못하며 `localStorage`·`sessionStorage`·`indexedDB`에는 기기 키도 토큰도 넣지 않습니다. DB에는 핸들의 SHA-256만 저장합니다.

운영자가 승인하는 방법: SQL Editor에서 `supabase/device_approvals.sql`의 "운영자가 직접 하는 일"을 따라 요청 목록을 보고 한 건을 `approved`로 바꿉니다.

### 직접 확인할 것

| 확인 | 결과 | 근거 |
|---|---|---|
| 승인 전에는 자료가 없는가? | **예(가상 DB 시험)** | `test/device-approval.test.mjs`: 요청 전·대기·거부·확인 실패·다른 사용자·쿠키 없음은 관문에서 차단. 화면은 승인 전에 자료를 부르지 않음. 운영 환경 확인은 아래 「확인 범위」 참고 |
| 승인된 기기의 기존 화면은 정상인가? | **예(가상 DB 시험)** | 승인된 (사용자, 기기)는 통과하고 기존 보호 요청 시험 154개는 그대로 통과 |

### 확인 순서

```bash
node --test test/device-approval.test.mjs test/pwa-shell.test.mjs   # 기기 승인·앱 설정
node --test test/api-zones.test.mjs test/owner-check.test.mjs       # 기존 보호 요청의 정상·거부
npm run bundle                                                      # 배포된 주소의 비로그인 요청 점검
```

### 확인 범위와 미검증

- 승인 흐름은 가상 DB 시험으로만 확인했습니다. 운영에서는 `device_approvals.sql` 적용, 요청, 운영자 승인, 자료 열림을 아직 직접 확인하지 않았습니다(실행 기록 참고).
- 심판 시험 신원(`judge` 토큰)은 관문 대상이 아닙니다. 심판이 학생 로그인 토큰으로 자료를 부르면 승인 전에는 `403`일 수 있으며, 심판이 기기를 어떻게 가리키는지는 이 저장소에서 확인할 수 없습니다.
- 쿠키는 기기 하드웨어의 증명이 아닙니다. 쿠키가 통째로 복사되면 그 기기로 보일 수 있습니다. 승인은 (사용자, 기기) 쌍에 묶여 다른 사용자 계정으로는 쓸 수 없습니다.
- 판정기(`src/decider.mjs`)는 이번 단계에서 바꾸지 않았고 엔진이 주는 `deviceRegistered`를 그대로 읽습니다. 앱의 기기 승인과 판정기의 기기 등록 값은 서로 연동되지 않았습니다.

### 실행 기록 (꾸미지 않음)

| 항목 | 상태 | 비고 |
|---|---|---|
| 로컬 시험 묶음 | **실행함** | 이 커밋 기준 전체 통과(아래 100점 항목 참고) |
| 운영 `device_approvals.sql` 적용 | **미실행** | 학생이 SQL Editor에서 직접 실행해야 합니다 |
| 운영 승인 요청 → 운영자 승인 → 자료 열림 | **미실행** | 위 SQL 적용 뒤 학생이 직접 확인합니다 |
| 배포된 비로그인 점검(`npm run bundle`) | 아래 제출 전 확인에서 실행 | 결과는 제출 묶음의 `attackAttempts` |

### 100점 항목 확인 (11단계)

| 항목 | 확인 방법과 결과 |
|---|---|
| 저장소를 새로 받아 `npm install` 성공 | 커밋한 파일만 새 폴더에 풀어 설치한 결과를 제출 전 확인 보고에 적습니다 |
| `src/decider.mjs`가 계약 이름만 읽고 응답 형식이 맞음 | 이번 단계에서 판정기를 바꾸지 않았고 `decider:test`·`fixture:7`이 통과 |
| `aleph.config.json`의 `step`이 11 이상 | `step: 11` |
