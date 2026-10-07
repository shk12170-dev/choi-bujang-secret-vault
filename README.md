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
- 빌드는 더 이상 메모를 `public/data.json`으로 복사하지 않습니다. `public/data.json`은 메모 0건이며, 메모가 다시 들어가면 빌드가 실패합니다. `/aleph.json`은 계속 빌드 때 생성됩니다.

### 아직 남은 약점

- **`/api/notes`는 공개 주소입니다.** 로그인 확인이 없어 주소를 아는 누구나 비로그인 요청으로 가상 메모 네 건을 받을 수 있습니다. 화면에서 `data.json`을 뺀 것은 저장 위치를 옮긴 것이지 접근을 막은 것이 아닙니다. 3단계에서 로그인한 본인만 읽도록 막기 전까지 이 테이블에는 가상 메모만 둡니다.

### 메모 문장 검색 확인 절차

가상 메모 문장의 공통 부분을 정규식 `실습용 가[상]`으로 찾습니다. 대괄호를 쓰면 이 README 자체는 검색에 걸리지 않습니다. 배포 주소는 Vercel Domains의 짧은 주소를 씁니다.

1. 현재 배포 파일(비로그인 요청):
   ```bash
   APP=https://choi-bujang-secret-vault-seven-omega.vercel.app
   for p in / /data.json /aleph.json /api/notes; do
     printf '%s %s 메모문장 %s건\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' "$APP$p")" "$(curl -s "$APP$p" | grep -o '실습용 가[상]' | wc -l)"
   done
   ```
   정상: `/`·`/data.json`·`/aleph.json`은 0건입니다. `/api/notes`는 4건이 나오며, 이것이 아래 남은 약점입니다.
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
| `/api/notes` 비로그인 GET | 막지 않음. 3단계 전까지 누구나 가상 메모 네 건을 받을 수 있음 |
| `SUPABASE_SECRET_KEY` | 서버 환경변수에만 있음. 공개 키로 테이블을 직접 읽는 요청은 RLS로 거부되어야 하며, 심판이 확인함 |
