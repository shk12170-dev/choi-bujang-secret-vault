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
- 심판이 재현할 수 없는 `authenticated` 역할의 직접 Data API 접근은 점수에서 제외되지만 위 RLS로 막아 두었습니다. 직접 Data API 확인은 `anon` 키로만 합니다.
- **과거 노출은 그대로입니다.** 2단계의 `notes` 테이블(가상 메모 네 건)과 옛 공개 커밋 `80aae74`, 1단계 배포의 노출은 해소되지 않았습니다. `notes` 테이블의 `owner_id`만 연결했습니다.
- 가상 메모만 쓰며, 실제 개인정보·비밀번호를 메모에 적지 않습니다.

### 100점 항목 확인 (4단계에서도 유지)

| 항목 | 확인 방법 |
|---|---|
| 로그인 없이 목록 요청 시 401 또는 403 + JSON 오류 문구 | `curl -i $APP/api/notes` → `401`, `application/json`, `{"error":"LOGIN_REQUIRED",…}` |
| `/aleph.json`이 열림 | `curl -s $APP/aleph.json` → `step 4`와 현재 커밋 |
| 첫 화면에 보안 헤더 | `curl -I $APP/` → `X-Content-Type-Options: nosniff` |
