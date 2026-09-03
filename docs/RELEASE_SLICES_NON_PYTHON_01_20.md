# PeerBridge 릴리즈 개선 실행안 — Non-Python Slice 01–20

- 작성일: 2026-08-26
- 기준 브랜치: main
- 감사 판정 기준: No-Go
- 문서 목적: 이미 검증된 릴리즈 위험을 Python 코드 수정 없이 격리·완화하고, 축소 범위 Conditional Go까지 도달하기 위한 실행 백로그
- 관계 문서: docs/RELEASE_SLICES_NON_PYTHON.md의 기존 사용자 변경을 보존하기 위해 별도 companion 문서로 작성

## 0. 문서 해석 규칙

이 문서는 구현 완료 보고서가 아니다. 각 Slice는 독립적으로 검토·배포·롤백할 수 있는 변경 단위이며, 완료 기준과 검증이 모두 충족되어야만 완료로 간주한다.

근거 라벨:

- [FACT] 저장소 코드, 설정, 로컬 DB 또는 실제 실행 결과로 확인됨
- [INFER] 확인된 사실로부터 도출한 릴리즈 판단
- [UNKNOWN] 현재 접근할 수 없는 배포 환경이나 운영 상태. 확인 전에는 안전하다고 간주하지 않음

절대 범위:

- Python/** 아래의 모든 파일을 생성·수정·삭제·이동하지 않는다.
- 저장소 어디에서든 확장자가 .py인 파일을 생성·수정·삭제·이동하지 않는다.
- backend/**/*.py, artifacts/api-server/python/**, 루트 main.py, tests/**/*.py도 변경하지 않는다.
- Python/create_tables.sql과 Python/migrations/**도 Python 런타임의 일부로 취급해 변경하지 않는다.
- 이 트랙에서 허용하는 대상은 프론트엔드 TypeScript/React, 별도 TypeScript gateway, OpenAPI/생성물, CI, 루트 배포 설정, 루트 의존성 메타데이터, database/ 아래의 새 비-Python 스키마 자산, 셸/Node 스크립트, 운영 문서다.
- 프로덕션 데이터 변경은 백업, dry-run, 승인, 롤백 리허설 전에는 수행하지 않는다.
- UI에서 링크를 숨기는 것은 보안 통제가 아니다. 공개 Python 포트에 직접 접근할 수 있으면 Slice 02가 완료되지 않은 것이다.

## 1. 검증 결과 요약과 이 계획의 한계

- [FACT] 익명 요청으로 /api/admin/flagged-users가 200을 반환했고, 로컬 검증 데이터에서는 이메일을 포함한 182개 행이 노출됐다.
- [FACT] 익명 GET /api/users/{id}가 200을 반환하며 이메일, 학군, 소개 등 프로필 정보를 노출했다.
- [FACT] 차단된 멘토, 미검증 멘토, 신고된 멘토가 practice matching 후보에 포함되는 fail-open 동작이 재현됐다.
- [FACT] 인증된 chat room 생성은 500을 반환했고, DM 및 WebSocket 경로에는 익명 접근 가능한 scaffold/TODO 동작이 남아 있었다.
- [FACT] 런타임 HTTP 경로 48개와 OpenAPI 경로 29개 사이에 구현 전용 경로 19개가 있었고, FastAPI의 detail 오류와 명세의 error 오류 형식이 달랐다.
- [FACT] 프론트엔드 typecheck와 임시 production build는 통과했지만, 서버 API 인가를 보장하지 않는다.
- [FACT] 정적 health check만 있고 DB readiness, CI, 모니터링, 복구 리허설이 확인되지 않았다.
- [FACT] pnpm audit 전체 결과는 36건이었고, production 범위에는 drizzle-orm 0.45.1 관련 high 1건이 있었다.
- [FACT] Git 이력에 과거 .env와 비밀값 또는 해시가 포함된 흔적이 확인됐으며, 실제 회전 여부는 [UNKNOWN]이다.
- [FACT] 로컬 HEAD와 원격 main 기준 배포 명령이 달랐고, 실제 배포 SHA와 환경 변수 상태는 [UNKNOWN]이다.
- [INFER] 현재 상태의 전체 기능 공개는 No-Go다.
- [INFER] 아래 Slice만으로 가능한 목표는 위험 기능을 외부에서 완전히 차단한 축소 범위 Conditional Go다.
- [INFER] admin, matching, chat을 정상 기능으로 재활성화하려면 별도의 Python 수정 트랙 또는 해당 동작을 완전히 소유하는 새 비-Python 서비스가 필요하다.

## 2. 목표 릴리즈 표면

축소 릴리즈에서 허용할 기능은 명시적 allowlist로 관리한다.

허용 후보:

- 정적 프론트엔드 자산
- GET /api/healthz 또는 gateway가 제공하는 /livez
- gateway가 안전성을 검증한 최소 인증 경로
- 세션 소유자 자신의 최소 프로필 조회·수정
- 공개를 명시적으로 승인한 비민감 reference data

기본 차단:

- /api/admin/**
- /api/python-reports/**
- /api/matches/**
- /api/practice/**
- /api/requests/*/match
- /api/chat/**
- /api/dms/**
- /ws/**
- 소유자가 아닌 /api/users/{id}
- 명세와 테스트에 포함되지 않은 모든 경로

중요한 배포 전제:

- Python 서버는 인터넷에서 직접 접근할 수 없는 내부 포트 또는 사설 네트워크에만 바인딩한다.
- 외부 /api와 /ws 트래픽은 모두 TypeScript gateway를 통과한다.
- 이 전제를 플랫폼에서 보장할 수 없으면 Slice 02는 실패이며 릴리즈는 계속 No-Go다.

## 3. Slice 개요

| Slice | 우선순위 | 결과물 | 선행 조건 | 예상 공수 |
|---|---:|---|---|---:|
| 01 | P0 | 릴리즈 표면 동결과 feature flag | 없음 | 0.5–1일 |
| 02 | P0 | 외부 API Shield와 backend 비공개화 | 01 | 2–4일 |
| 03 | P0 | admin/report 완전 격리 | 02 | 0.5–1일 |
| 04 | P0 | 프로필 PII self-only 정책 | 02 | 1–2일 |
| 05 | P0 | matching/Connect kill switch | 02 | 0.5–1일 |
| 06 | P0 | chat/DM/WS kill switch | 02 | 0.5–1일 |
| 07 | P0 | 비밀 유출 사고 종결 증빙 | 없음 | 1–2일 |
| 08 | P1 | merge 시 자동 DDL 제거 | 없음 | 0.5일 |
| 09 | P1 | 단일 schema SoT와 migration ledger | 08 | 2–4일 |
| 10 | P1 | 무결성 제약·인덱스 수렴 | 09 | 2–4일 |
| 11 | P1 | 백업·복구·롤백 리허설 | 09 | 1–2일 |
| 12 | P1 | 공개 API 계약 재정의 | 02–06 | 2–3일 |
| 13 | P1 | 인증·401·오류 UX 정합화 | 12 | 1–2일 |
| 14 | P1 | 미성년자 개인정보 UX 최소화 | 01, 03–06 | 1–2일 |
| 15 | P1 | gateway 보안 통제 | 02, 12 | 2–3일 |
| 16 | P1 | readiness·관측성·redaction | 02 | 2–3일 |
| 17 | P1 | CI/CD 릴리즈 게이트 | 08, 12, 15 | 2–3일 |
| 18 | P1 | 의존성·런타임 재현성 | 없음 | 1–2일 |
| 19 | P1 | 비-Python 보안 E2E 회귀 테스트 | 02–06, 12, 15 | 2–4일 |
| 20 | P0 | staging·canary·Go/No-Go 판정 | 01–19 | 1–2일 |

권장 의존 순서:

    01 -> 02 -> 03, 04, 05, 06
    08 -> 09 -> 10, 11
    02, 03, 04, 05, 06 -> 12 -> 13, 14, 15
    02 -> 16
    07, 10, 11, 13, 14, 15, 16, 17, 18, 19 -> 20

---

## Slice 01 — 릴리즈 표면 동결과 feature flag

우선순위: P0  
변경 허용 영역: artifacts/peerbridge/**, 루트 배포 환경 설정, docs/**  
선행 조건: 없음

목표:

- 검증되지 않은 기능이 새 배포에서 우연히 다시 노출되지 않도록 기본값이 닫힌 feature flag를 만든다.
- 릴리즈 범위와 책임자를 한 장의 매트릭스로 고정한다.

조치:

- production 기본값이 false인 admin, matching, practice, connect, chat, analytics, scheduling flag를 한 곳에서 정의한다.
- 해당 route, navigation, dashboard card, deep link 진입점에서 동일 flag를 사용한다.
- 비활성 route는 빈 화면 대신 기능 준비 중 메시지와 안전한 복귀 링크를 표시한다.
- 개발 환경에서만 명시적으로 opt-in할 수 있게 하고, production 빌드에서는 누락된 flag를 false로 해석한다.
- docs/release-surface.md에 기능, 공개 여부, 데이터 민감도, 서버 통제, 책임자, 재활성화 조건을 기록한다.

완료 기준:

- production 설정 없이 빌드하면 위험 기능 7종이 모두 비활성화된다.
- URL 직접 입력으로도 위험 페이지의 API 호출이 발생하지 않는다.
- 공개 allowlist와 차단 목록이 코드·문서에서 일치한다.

검증:

    pnpm --filter peerbridge typecheck
    pnpm --filter peerbridge build
    rg -n "admin|matching|practice|connect|chat|analytics|scheduling" artifacts/peerbridge/src

잔여 위험과 롤백:

- UI flag만으로 API는 보호되지 않는다. Slice 02가 완료되기 전에는 릴리즈 불가다.
- 롤백은 모든 flag를 false로 고정한 마지막 안전 빌드로 되돌린다.

---

## Slice 02 — 비-Python API Shield와 backend 비공개화

우선순위: P0  
변경 허용 영역: 새 artifacts/api-gateway/** TypeScript 서비스, .replit, package.json, pnpm-workspace.yaml, 배포 설정, docs/**  
선행 조건: Slice 01

목표:

- 외부 요청이 취약한 Python route에 직접 도달하지 못하도록 fail-closed gateway를 둔다.
- 명시적으로 허용·검증된 경로만 내부 Python 서비스로 전달한다.

조치:

- 별도 TypeScript gateway를 외부 8080 포트의 유일한 진입점으로 둔다.
- Python 서버는 loopback 또는 플랫폼의 private port에만 바인딩하고 외부 포트 매핑을 제거한다.
- gateway route는 deny-by-default로 구현하고, method와 normalized path를 함께 allowlist한다.
- 인증 필요 요청은 동일 Cookie를 내부 /api/auth/me에 전달해 세션 사용자 id를 확인한 뒤 처리한다.
- upstream의 status, response body, Set-Cookie를 의도적으로 전달하되 Cookie, Authorization, 세션, 이메일, 요청 본문은 로그에 남기지 않는다.
- timeout, body size limit, connection abort, malformed URL, duplicate header 처리를 명시한다.
- /ws는 Slice 06 완료 정책에 따라 upgrade 단계에서 거부한다.
- 내부 Python 주소가 외부 DNS, public port, 프론트 bundle에 노출되지 않도록 배포 검사를 추가한다.

완료 기준:

- 인터넷에서 Python 포트 직접 접근이 불가능하다.
- 미등록 경로와 method는 404 또는 403으로 닫히며 upstream에 전달되지 않는다.
- 인증 쿠키가 없는 보호 경로는 일관된 401을 반환한다.
- backend 비공개화가 불가능하면 완료로 표시하지 않는다.

검증:

    curl -i https://staging.example/api/admin/flagged-users
    curl -i https://staging.example/api/users/1
    curl -i https://staging.example/api/unknown-route
    curl -i https://staging.example:8081/api/healthz

- access log에서 위 차단 요청의 upstream 호출 수가 0인지 확인한다.
- 인코딩 우회 경로, 이중 slash, dot segment, 대소문자, query string을 포함한 allowlist 우회 테스트를 실행한다.

잔여 위험과 롤백:

- gateway가 우회 가능하거나 Python 포트가 공개되어 있으면 통제 전체가 무효다.
- 롤백 시 위험 기능을 살리는 대신 전체 API를 maintenance deny 상태로 전환한다.

---

## Slice 03 — admin 및 report API 완전 격리

우선순위: P0  
변경 허용 영역: artifacts/api-gateway/**, artifacts/peerbridge/**, API 계약, docs/**  
선행 조건: Slice 02

목표:

- 관리자 권한 모델이 서버에 구현되기 전까지 개인정보·모더레이션 데이터를 공개 표면에서 제거한다.

조치:

- gateway에서 method와 무관하게 /api/admin/** 및 /api/python-reports/**를 차단한다.
- encoded slash, trailing slash, path parameter 변형도 동일하게 차단한다.
- AdminReports route, navigation, lazy chunk prefetch, 관련 query를 production에서 제거한다.
- 프론트의 관리자처럼 보이는 role 또는 local state를 인가 근거로 사용하지 않는다.
- 차단 이벤트는 개인정보 없이 route family, correlation id, 결과만 보안 metric으로 기록한다.

완료 기준:

- 익명·일반 사용자·임의 쿠키 모두 admin/report 경로에서 데이터가 없는 403 또는 404를 받는다.
- 응답 크기와 body가 사용자 존재 여부나 flagged row 수를 누설하지 않는다.
- production bundle에서 AdminReports API 호출 문자열이 검출되지 않는다.

검증:

    curl -i https://staging.example/api/admin/flagged-users
    curl -i -H "Cookie: session=invalid" https://staging.example/api/admin/flagged-users
    curl -i https://staging.example/api/python-reports/
    rg -n "/api/admin|/api/python-reports" artifacts/peerbridge/dist

잔여 위험과 재활성화 조건:

- Python 측 admin role과 서버 인가가 없는 상태에서는 기능 재활성화 금지다.
- 별도 관리자 identity, 최소 권한, 감사 로그, 역할별 E2E가 증명돼야 재검토한다.

---

## Slice 04 — 프로필 PII self-only 격리

우선순위: P0  
변경 허용 영역: artifacts/api-gateway/**, artifacts/peerbridge/**, API 계약, docs/**  
선행 조건: Slice 02

목표:

- /api/users/{id}의 익명 및 타인 조회를 차단하고, 자신의 최소 정보만 접근하게 한다.

조치:

- gateway가 /api/auth/me에서 확인한 session user id와 path id가 정확히 일치할 때만 GET/PATCH를 전달한다.
- 인증 확인 실패, id mismatch, 비정상 id는 upstream 호출 없이 401 또는 존재를 숨기는 404로 처리한다.
- self 검증 구현이 불확실하면 /api/users/** 전체를 임시 차단한다.
- gateway 응답 schema를 allowlist 방식으로 제한해 email, district, bio 등 필드가 의도 없이 공개 route로 전파되지 않게 한다.
- 다른 사용자 상세 프로필을 전제로 한 UI를 제거하고, 필요한 경우 익명화된 mentor card 전용 계약을 별도 설계한다.
- PATCH는 허용 필드만 통과시키고 role, is_verified, id, email 등 권한·신원 필드를 거부한다.

완료 기준:

- 익명 조회는 401, 사용자 A의 사용자 B 조회는 404 또는 403, A의 자기 조회만 최소 schema로 200을 반환한다.
- PATCH에서 allowlist 밖의 필드는 400을 반환하고 upstream에 전달되지 않는다.
- 응답 snapshot에 타인의 이메일과 자유 입력 bio가 포함되지 않는다.

검증:

    curl -i https://staging.example/api/users/1
    curl -i -H "Cookie: session=user-a" https://staging.example/api/users/2
    curl -i -H "Cookie: session=user-a" https://staging.example/api/users/1
    curl -i -X PATCH -H "Content-Type: application/json" -H "Cookie: session=user-a" --data '{"role":"admin"}' https://staging.example/api/users/1

잔여 위험과 재활성화 조건:

- mentor discovery에 필요한 공개 프로필은 기존 user schema를 재사용하지 않는다.
- Python 자체 인가가 보강되기 전 gateway 우회 가능성이 0임을 배포 설정으로 보장해야 한다.

---

## Slice 05 — matching, practice, Connect kill switch

우선순위: P0  
변경 허용 영역: artifacts/api-gateway/**, artifacts/peerbridge/**, API 계약, docs/**  
선행 조건: Slice 02

목표:

- 차단·신고·검증 상태를 무시하는 fail-open 매칭이 사용자에게 노출되지 않게 한다.

조치:

- /api/matches/**, /api/practice/**, /api/requests/*/match를 gateway에서 전면 차단한다.
- Recommendations, PracticeLab, Connect, request match action을 production에서 비활성화한다.
- 기존 매치 레코드는 삭제하거나 상태를 변경하지 않는다.
- 기능 중단 문구는 개인의 신고·차단 여부를 노출하지 않고 일시적 이용 불가만 알린다.
- 재활성화 체크리스트에 block 양방향 제외, report 정책, verified mentor 필터, self-match 방지, 상태 전이, 동시성, tie-break를 포함한다.

완료 기준:

- 모든 matching 변형 경로가 upstream 호출 없이 차단된다.
- 차단된 멘토 id를 이용한 회귀 요청에서도 후보 목록이나 존재 여부가 반환되지 않는다.
- 프론트 production bundle이 matching mutation을 실행하지 않는다.

검증:

    curl -i "https://staging.example/api/practice/matching/1?limit=1000"
    curl -i https://staging.example/api/matches/1
    curl -i -X POST https://staging.example/api/requests/1/match
    rg -n "/api/(matches|practice)|/match" artifacts/peerbridge/dist

잔여 위험과 재활성화 조건:

- 이 Slice는 취약 동작을 고치지 않고 격리한다.
- Python 트랙에서 안전 필터와 원자적 상태 전이가 검증되거나 새 서비스가 해당 동작을 완전히 소유하기 전에는 재활성화하지 않는다.

---

## Slice 06 — chat, DM, WebSocket kill switch

우선순위: P0  
변경 허용 영역: artifacts/api-gateway/**, artifacts/peerbridge/**, API 계약, docs/**  
선행 조건: Slice 02

목표:

- 500 오류와 익명 scaffold가 존재하는 메시징 표면을 완전히 닫는다.

조치:

- /api/chat/**, /api/dms/** 및 /ws/**를 gateway에서 차단한다.
- HTTP upgrade 요청은 upstream 연결 전에 403으로 종료한다.
- ChatWidget mount, chat navigation, background polling, reconnect loop를 production에서 제거한다.
- 기존 메시지나 room 데이터를 삭제하지 않으며, 비활성화가 데이터 보존 정책을 대신하지 않음을 문서화한다.
- 브라우저에 메시지 draft가 남지 않도록 disabled UI의 local storage 사용을 점검한다.

완료 기준:

- 익명·인증 사용자 모두 REST 및 WS 연결을 만들 수 없다.
- production 브라우저에서 chat polling, reconnect, console error가 발생하지 않는다.
- gateway metric에서 upstream chat 연결 수가 0이다.

검증:

    curl -i https://staging.example/api/chat/rooms
    curl -i https://staging.example/api/dms/1
    npx wscat -c wss://staging.example/ws/chat/1
    rg -n "/api/(chat|dms)|/ws/" artifacts/peerbridge/dist

잔여 위험과 재활성화 조건:

- 인증된 room 생성, participant-only 조회, WS 세션 검증, 저장, XSS, spam, rate limit E2E가 모두 통과해야 재활성화한다.
- 추적되지 않은 대체 Python 파일의 존재는 구현 완료 증거로 사용하지 않는다.

---

## Slice 07 — 비밀 유출 사고 종결과 이력 감시

우선순위: P0  
변경 허용 영역: .github/**, 비-Python 스크립트, .gitignore, docs/**, 외부 secret manager  
선행 조건: 없음

목표:

- Git 이력에서 확인된 비밀 노출을 실제 회전과 탐지 통제로 종결한다.

조치:

- 과거 노출된 GitHub token, DB credential, SESSION_SECRET을 공급자 측에서 폐기·회전한다.
- 노출된 비밀번호 해시가 실제 계정과 연결될 가능성을 확인하고 필요한 계정 reset 절차를 수행한다.
- 회전 증빙에는 secret 값이 아니라 secret 종류, owner, rotated_at, ticket id, 검증 결과만 기록한다.
- 일반 root .env에 광범위 token을 두는 흐름을 없애고 최소 권한 secret store로 옮긴다.
- gitleaks 또는 동등한 scanner를 pre-commit이 아닌 CI 필수 gate로 추가하고 전체 Git history도 검사한다.
- Git history rewrite는 협업자 영향과 force push가 있으므로 별도 승인된 incident 작업으로 분리한다.

완료 기준:

- 각 노출 자격 증명의 이전 값이 공급자 API에서 실패하고 새 값만 동작한다.
- main의 CI가 신규 secret과 고엔트로피 credential을 차단한다.
- rotation ledger에 미확인 항목이 0개다.

검증:

    git ls-files | rg -i '(^|/)\.env|secret|credential|private.?key'
    gitleaks git --redact --no-banner
    git log --all --oneline -- '*.env'

잔여 위험과 롤백:

- scanner 통과는 과거 credential 회전을 대체하지 않는다.
- secret 값은 문서, issue, CI log에 복사하지 않는다. 잘못된 회전은 secret manager의 이전 안전 버전으로만 복구한다.

---

## Slice 08 — merge 시 자동 DB 변경 제거

우선순위: P1  
변경 허용 영역: .replit, package.json, 비-Python 배포 스크립트, docs/**  
선행 조건: 없음

목표:

- 코드 merge나 workspace 설치가 예고 없이 schema DDL을 실행하지 않게 한다.

조치:

- postMerge에서 pnpm --filter db push를 제거한다.
- postMerge는 dependency install과 read-only validation까지만 수행한다.
- schema 변경은 승인된 migration command, 환경 선택, backup id, dry-run 결과가 있어야 별도 단계에서 실행되게 한다.
- 개발자가 실수로 production DATABASE_URL을 사용하지 않도록 환경 이름과 host allowlist 검사를 추가한다.

완료 기준:

- merge, checkout, install, build 어느 경로에서도 DDL이 실행되지 않는다.
- DB 변경 로그에 actor, exact migration id, target environment, start/end, 결과가 남는다.

검증:

    rg -n "db push|drizzle-kit push|CREATE TABLE|ALTER TABLE|DROP TABLE" .replit package.json pnpm-workspace.yaml scripts artifacts
    pnpm install --frozen-lockfile

잔여 위험과 롤백:

- 기존 환경 drift는 자동으로 해결되지 않는다. Slice 09와 10에서 명시적으로 수렴한다.

---

## Slice 09 — 단일 schema SoT와 migration ledger

우선순위: P1  
변경 허용 영역: database/schema/**, database/migrations/**의 새 비-Python 자산, lib/db/**, Node/SQL tooling, docs/**  
선행 조건: Slice 08

목표:

- 서로 다른 SQL과 Drizzle 정의 대신 배포용 단일 schema source of truth를 확정한다.

조치:

- 현재 로컬 catalog의 13개 table, column, type, default, constraint, index를 read-only introspection 결과로 고정한다.
- database/schema/에 canonical schema와 schema version을 두고, lib/db가 이를 표현하거나 생성되도록 정리한다.
- Python/create_tables.sql과 Python/migrations/**는 변경하지 않고 legacy input으로만 inventory에 기록한다.
- 순번이 단조 증가하는 migration ledger, checksum, 적용 시간, app SHA를 기록한다.
- migration runner는 advisory lock을 잡고 checksum mismatch와 out-of-order 적용을 거부한다.
- production schema는 [UNKNOWN]이므로 접근 권한을 얻기 전 local 결과를 production 사실로 간주하지 않는다.

완료 기준:

- canonical schema에서 새 빈 DB를 재현할 수 있다.
- local catalog와 canonical schema diff가 0이다.
- production read-only introspection과의 차이가 승인된 migration plan으로 설명된다.

검증:

    pnpm --filter db schema:check
    pnpm --filter db migration:status
    pnpm --filter db schema:diff -- --read-only

잔여 위험과 롤백:

- schema SoT 확정만으로 데이터가 정합해지지 않는다.
- canonical baseline 변경은 migration을 삭제·수정하지 않고 새 forward migration으로 보정한다.

---

## Slice 10 — 무결성 제약, 인덱스, preflight 수렴

우선순위: P1  
변경 허용 영역: database/migrations/**의 새 SQL, lib/db/**, Node/SQL 검사 도구, docs/**  
선행 조건: Slice 09

목표:

- 앱 코드가 실패해도 DB가 핵심 관계와 상태 불변식을 지키도록 한다.

조치:

- role과 status 값에 CHECK 또는 참조 테이블 제약을 설계한다.
- block pair와 request-tag pair에 UNIQUE를 추가하고 self-block, self-report를 금지한다.
- tag 관계 FK, user 관계 FK, 삭제 정책을 명시한다.
- DM participant pair는 순서를 canonicalize하고 중복 room을 막는다.
- email, district_id, status, tag join, matching 조회에 필요한 인덱스를 EXPLAIN 근거로 추가한다.
- 각 제약 전에는 duplicate, orphan, invalid enum, self relation을 세는 read-only preflight query를 제공한다.
- 데이터 정리 필요 시 자동 삭제하지 않고 quarantine 목록과 별도 승인 작업을 만든다.
- 모든 migration에 forward, verification, rollback 또는 roll-forward 전략을 기록한다.

완료 기준:

- staging preflight에서 예상치 못한 위반이 0개다.
- migration 후 constraint catalog와 index plan이 기대값과 일치한다.
- 대표 조회의 p95와 query plan이 기준보다 악화되지 않는다.

검증:

    pnpm --filter db migration:preflight -- --env staging
    pnpm --filter db migration:apply -- --env staging --dry-run
    pnpm --filter db constraints:verify -- --env staging
    pnpm --filter db explain:verify -- --env staging

잔여 위험과 롤백:

- production 적용은 Slice 11 복구 리허설 전 금지다.
- 대형 인덱스는 lock 시간을 측정하고 online 또는 concurrent 전략을 사용한다.

---

## Slice 11 — 백업, 복구, migration rollback 리허설

우선순위: P1  
변경 허용 영역: ops/**, 비-Python 스크립트, docs/runbooks/**, 외부 backup storage  
선행 조건: Slice 09

목표:

- 백업이 존재한다는 주장 대신 실제 복구 가능한 시간을 증명한다.

조치:

- 운영 owner, RPO, RTO, 암호화, 보존 기간, 접근 권한을 runbook에 정의한다.
- staging에 production-like snapshot을 마스킹하여 복구한다.
- schema version, row count, FK/constraint, 대표 query, application smoke를 복구 후 확인한다.
- Slice 10 migration 적용 전후 backup id와 restore point를 남기고 rollback 또는 roll-forward를 리허설한다.
- backup 파일은 저장소와 개발자 laptop에 평문으로 두지 않는다.

완료 기준:

- 독립된 operator가 문서만 보고 RTO 내 staging 복구를 완료한다.
- 복구된 DB의 schema checksum과 핵심 row count 검증이 통과한다.
- 마지막 성공 시간, 실패 알림, 다음 훈련일이 기록된다.

검증:

    ops/backup.sh --env staging --dry-run
    ops/restore.sh --env isolated-restore --backup-id REDACTED
    pnpm --filter db restore:verify -- --env isolated-restore

잔여 위험과 롤백:

- destructive restore를 production에 직접 실행하지 않는다.
- backup provider 자체 장애를 고려해 계정과 지역이 분리된 복사본 정책을 둔다.

---

## Slice 12 — 공개 API 계약 재정의와 codegen gate

우선순위: P1  
변경 허용 영역: lib/api-spec/**, lib/api-client-react/**, lib/api-zod/**, artifacts/api-gateway/**, 생성 스크립트, docs/**  
선행 조건: Slice 02–06

목표:

- 실제 외부 공개 표면과 OpenAPI, client, runtime validation을 하나의 계약으로 맞춘다.

조치:

- 내부 Python route inventory와 외부 gateway route inventory를 별도 산출물로 만든다.
- 구현 전용 19개 경로를 무조건 공개하지 않고 allow, quarantine, internal-only 중 하나로 분류한다.
- cookieAuth, 401, 403, 404, 409, 422, 429, 5xx 응답을 명세한다.
- gateway에서 FastAPI detail을 공개 error envelope로 정규화하되 내부 stack이나 SQL을 노출하지 않는다.
- request와 response에 Zod runtime validation을 적용한다.
- WebSocket 계약은 OpenAPI와 별도 문서로 유지하며 현재 disabled 상태를 명시한다.
- Orval과 Zod 생성물은 deterministic하게 재생성하고 diff가 남으면 CI가 실패하게 한다.

완료 기준:

- public runtime inventory와 public OpenAPI 경로가 method 단위로 정확히 일치한다.
- quarantine 경로는 명세에서 disabled 또는 internal로 표시되고 외부 호출이 차단된다.
- 생성 후 working tree diff가 0이다.

검증:

    pnpm api:inventory
    pnpm api:generate
    pnpm api:contract-test
    git diff --exit-code -- lib/api-client-react lib/api-zod

잔여 위험과 롤백:

- 계약 일치는 올바른 인가를 자동 보장하지 않는다. Slice 19의 역할별 테스트가 필요하다.

---

## Slice 13 — 인증, 401, 오류 UX 정합화

우선순위: P1  
변경 허용 영역: artifacts/peerbridge/**, lib/api-client-react/**, lib/api-zod/**  
선행 조건: Slice 12

목표:

- 미인증, 네트워크 장애, 서버 오류를 구분해 잘못된 logout과 오해를 줄인다.

조치:

- auth context가 401만 unauthenticated로 처리하고 network timeout과 5xx는 recoverable error로 유지한다.
- 401에서만 로그인으로 이동하고, 돌아올 안전한 same-origin path를 저장한다.
- 403은 권한 없음, 404는 리소스 비공개, 409는 충돌, 422는 필드 검증, 429는 재시도 안내로 매핑한다.
- error, detail, raw string 혼용을 없애고 Slice 12의 typed envelope만 소비한다.
- 중복 submit을 막고 mutation pending 상태에서 버튼과 form을 안정적으로 잠근다.
- 인증 실패 UI에 계정 존재 여부를 노출하는 문구를 사용하지 않는다.

완료 기준:

- /auth/me 401, timeout, 500 각각의 UI snapshot과 동작이 다르고 의도와 일치한다.
- network 장애가 사용자를 즉시 logout시키지 않는다.
- 오류 렌더링에 stack trace, SQL, 내부 URL이 나타나지 않는다.

검증:

    pnpm --filter peerbridge test
    pnpm --filter peerbridge typecheck
    pnpm --filter peerbridge build

잔여 위험과 롤백:

- 서버측 계정 열거, 비밀번호 정책, 세션 고정 문제는 이 Slice로 해결되지 않는다.
- UX 변경이 auth bypass로 이어지지 않도록 RequireAuth 회귀 테스트를 유지한다.

---

## Slice 14 — 미성년자 개인정보 UX와 문구 최소화

우선순위: P1  
변경 허용 영역: artifacts/peerbridge/**, 정적 privacy 문서, docs/**  
선행 조건: Slice 01, 03–06

목표:

- 구현되지 않은 신원 보장을 주장하지 않고, 화면과 번들의 개인정보 노출을 최소화한다.

조치:

- 이메일 소유 확인 없이 verified student 또는 인증된 학생으로 표현하는 문구를 제거한다.
- 신고·차단이 matching과 chat에 즉시 반영된다고 단정하는 문구를 현재 동작에 맞게 수정한다.
- 이메일은 자신의 account 화면 외에는 표시하지 않는다.
- production에서 demo credential, test user, seed 설명, 내부 endpoint 예시를 제거한다.
- 비활성 기능은 이유를 과도하게 설명하거나 신고 상태를 노출하지 않고 안전하게 안내한다.
- 개인정보 수집 항목, 목적, 보존, 삭제 요청, 미성년자·보호자 정책의 owner와 미결 항목을 공개 전 체크리스트로 만든다.

완료 기준:

- production UI와 bundle에 demo email/password가 없다.
- 신원 인증과 moderation 효력에 대한 과장된 문구가 없다.
- privacy 검토 owner가 삭제·보존·보호자 정책을 승인하거나 미승인 시 릴리즈를 차단한다.

검증:

    rg -ni "verified student|demo|password|seed user|test@" artifacts/peerbridge/src artifacts/peerbridge/dist
    pnpm --filter peerbridge test

잔여 위험과 롤백:

- 문구 수정은 실제 이메일 인증이나 미성년자 동의를 구현하지 않는다.
- 법률·정책 검토 결과는 [UNKNOWN] 상태로 출시 승인에서 별도 확인한다.

---

## Slice 15 — gateway 보안 통제

우선순위: P1  
변경 허용 영역: artifacts/api-gateway/**, 배포 proxy 설정, docs/**  
선행 조건: Slice 02, 12

목표:

- 쿠키 기반 세션의 공개 경계에서 CSRF, brute force, browser hardening, resource abuse를 통제한다.

조치:

- 상태 변경 요청은 same-origin Origin 또는 Referer를 검증하고 JSON Content-Type을 요구한다.
- login, register, public lookup, mutation에 IP와 account key를 조합한 rate limit을 적용한다.
- 429에 Retry-After를 포함하고 limiter 장애 시 보호 경로는 fail-closed 정책을 따른다.
- HSTS, CSP, X-Content-Type-Options, frame-ancestors 또는 X-Frame-Options, Referrer-Policy, Permissions-Policy를 정적 자산과 API에 적용한다.
- CORS는 실제 production origin allowlist만 허용하고 credentials와 wildcard를 함께 쓰지 않는다.
- request body, header count, URL length, upstream connect/read timeout을 제한한다.
- redirect URL과 forwarded header를 신뢰할 proxy hop에만 제한한다.

완료 기준:

- cross-site mutation이 upstream 호출 없이 차단된다.
- login/register burst가 429로 제한되고 정상 사용자 기준은 문서화된다.
- 주요 응답에서 보안 헤더 자동 검사가 통과한다.

검증:

    curl -i -X POST -H "Origin: https://evil.example" -H "Content-Type: application/json" https://staging.example/api/auth/login
    curl -I https://staging.example/
    curl -I https://staging.example/api/healthz
    pnpm --filter api-gateway test:security

잔여 위험과 롤백:

- SameSite=Lax만으로 CSRF 완료를 주장하지 않는다.
- CSP 도입은 report-only 관찰 후 enforce로 전환하되, 전환 지연을 무기한 허용하지 않는다.

---

## Slice 16 — readiness, 관측성, 개인정보 redaction

우선순위: P1  
변경 허용 영역: artifacts/api-gateway/**, observability 설정, docs/runbooks/**  
선행 조건: Slice 02

목표:

- process 생존과 실제 서비스 준비 상태를 구분하고, 장애를 개인정보 없이 진단한다.

조치:

- /livez는 gateway process만 확인하고 /readyz는 내부 API 및 read-only DB probe의 시간 제한 결과를 확인한다.
- 배포 SHA, build time, schema version은 인증 없는 민감정보가 되지 않는 범위에서 deployment metadata로 노출한다.
- 모든 요청에 correlation id를 부여하고 upstream과 응답에 전달한다.
- 구조화 로그에서 Cookie, Authorization, Set-Cookie, email, bio, message body, password, token을 redaction한다.
- route family별 latency, status, timeout, rate-limit, denied request, readiness를 metric으로 만든다.
- 5xx, readiness failure, auth anomaly, admin probe 급증에 alert와 owner를 연결한다.
- client error tracking도 사용자 입력과 session 정보를 전송하지 않게 scrubber를 적용한다.

완료 기준:

- DB 연결 불가 시 livez는 200, readyz는 503을 반환하고 배포 대상에서 제외된다.
- 하나의 staging 요청을 correlation id로 gateway부터 내부 API까지 추적할 수 있다.
- redaction test fixture의 모든 민감값이 log와 error tracker에서 검출되지 않는다.

검증:

    curl -i https://staging.example/livez
    curl -i https://staging.example/readyz
    pnpm --filter api-gateway test:observability
    pnpm logs:scan-pii -- --env staging

잔여 위험과 롤백:

- 실제 production monitoring account와 alert 전달 성공은 [UNKNOWN]이므로 canary 전에 test alert를 발송한다.

---

## Slice 17 — CI/CD 릴리즈 게이트

우선순위: P1  
변경 허용 영역: .github/workflows/**, 비-Python scripts/**, package.json, docs/**  
선행 조건: Slice 08, 12, 15

목표:

- 로컬에서 한 번 성공한 검사를 main과 배포 artifact의 필수 조건으로 만든다.

조치:

- Node 24, Python 3.12, pnpm 버전을 고정하고 frozen lockfile로 설치한다.
- typecheck, production build, gateway unit/security test, OpenAPI codegen diff, schema diff, secret scan, dependency audit를 필수 job으로 둔다.
- 임시 outDir로 production build하여 추적되지 않는 dist 상태에 의존하지 않는다.
- git diff -- Python과 모든 .py 파일 hash 비교를 수행해 이 트랙의 Python 무변경을 강제한다.
- 기존 pytest와 Python AST 결과는 읽기 전용 검사로 실행하되, 실패를 숨기지 않고 Python-track blocker로 분리한다.
- 배포는 branch 이름이 아니라 immutable commit SHA와 artifact digest를 사용한다.
- production 승인은 backup id, schema status, feature flag snapshot, canary plan이 있어야 열리게 한다.

완료 기준:

- 필수 job 하나라도 실패하면 main 보호와 배포가 중단된다.
- 생성물 drift와 Python 파일 변경이 CI에서 재현 가능하게 차단된다.
- 배포 화면에서 exact SHA와 artifact digest를 확인할 수 있다.

검증:

    pnpm install --frozen-lockfile
    pnpm run typecheck
    pnpm run build
    pnpm api:generate
    git diff --exit-code -- Python
    git diff --exit-code -- '*.py'

잔여 위험과 롤백:

- 현재 확인된 Python test 또는 AST 실패를 green으로 위장하지 않는다.
- 긴급 배포 bypass는 2인 승인, 만료 시간, 사후 incident review가 없으면 허용하지 않는다.

---

## Slice 18 — 의존성 및 런타임 재현성

우선순위: P1  
변경 허용 영역: package.json, pnpm-lock.yaml, 루트 pyproject.toml, 루트 requirements.txt, uv.lock, .tool-versions 또는 동등 설정, docs/**  
선행 조건: 없음

목표:

- 알려진 production 취약점을 제거하고 선언이 다른 런타임을 재현 가능하게 만든다.

조치:

- drizzle-orm을 보안 수정 버전 0.45.2 이상으로 올리고 migration/codegen 회귀를 실행한다.
- pnpm audit의 나머지 35건을 runtime, dev-only, transitive로 분류하고 exploitability와 upgrade owner를 기록한다.
- packageManager, engines, lockfile, Replit runtime의 Node와 pnpm 버전을 일치시킨다.
- root Python 의존성 선언은 실제 import inventory와 맞추고 psycopg driver 누락과 사용하지 않는 Flask를 정리한다.
- Python/requirements.txt는 변경하지 않고 선언 불일치를 residual risk로 기록한다.
- pip dependency 변경은 .py 수정이 아니더라도 Python runtime 영향이 있으므로 staging import와 startup 검사 없이는 배포하지 않는다.
- lockfile이 없는 설치와 floating major version을 CI에서 거부한다.

완료 기준:

- production 범위 pnpm audit high/critical이 0이다.
- clean environment에서 동일 lockfile로 build artifact hash가 재현된다.
- 세 의존성 선언의 차이가 0이거나 승인된 residual 목록에 owner와 해소일이 있다.

검증:

    pnpm audit --prod
    pnpm install --frozen-lockfile
    uv lock --check
    pnpm deps:inventory

잔여 위험과 롤백:

- dependency upgrade는 기능 회귀 가능성이 있으므로 단독 Slice로 배포하고 lockfile revert로 롤백한다.
- Python/requirements.txt 불일치가 남으면 전체 Python backend의 재현 가능성은 보장하지 않는다.

---

## Slice 19 — 비-Python 보안 E2E 회귀 테스트

우선순위: P1  
변경 허용 영역: e2e/**의 TypeScript/JavaScript, artifacts/api-gateway/** tests, Playwright/Vitest 설정, CI  
선행 조건: Slice 02–06, 12, 15

목표:

- 이번 감사에서 재현한 P0 실패를 Node/TypeScript 기반 자동 회귀 테스트로 고정한다.

조치:

- 익명 admin 403/404, 익명 profile 401, 타인 profile 403/404, self profile 최소 schema 200을 테스트한다.
- matching, practice, match mutation, chat, DM, WS가 upstream에 도달하지 않는지 spy metric과 함께 검증한다.
- Cookie와 Set-Cookie forwarding, auth/me 실패, timeout, malformed response를 테스트한다.
- CORS, Origin, Content-Type, rate limit, body limit, security header를 공격 입력으로 검증한다.
- error envelope가 내부 detail, stack, SQL, host를 노출하지 않는지 snapshot을 둔다.
- PII canary 값을 fixture에 넣고 응답, 로그, client error에서 검색한다.
- disposable staging DB 또는 mock upstream을 사용하며 기존 로컬·production 데이터를 변경하지 않는다.
- tests/**/*.py를 추가하거나 수정하지 않는다.

완료 기준:

- 감사에서 확인된 P0 요청이 모두 자동 테스트에서 차단 상태로 재현된다.
- 테스트가 실제 gateway artifact를 대상으로 실행되고 mock-only 성공으로 끝나지 않는다.
- CI에서 flaky retry 없이 연속 3회 통과한다.

검증:

    pnpm e2e:security
    pnpm e2e:security -- --repeat-each=3
    pnpm test:gateway
    git diff --exit-code -- '*.py'

잔여 위험과 롤백:

- 차단 테스트는 내부 Python 결함이 해결됐다는 증거가 아니다.
- fixture가 실데이터 endpoint를 가리키면 즉시 중단하도록 production host deny guard를 둔다.

---

## Slice 20 — 축소 범위 staging, canary, Go/No-Go 판정

우선순위: P0  
변경 허용 영역: 배포 설정, feature flag, 비-Python smoke 도구, docs/runbooks/**, 저장소 비-Python 정리  
선행 조건: Slice 01–19

목표:

- exact artifact와 축소 기능 범위를 staging에서 반증한 뒤, 작은 canary로 Conditional Go 여부를 판정한다.

조치:

- 배포 SHA, artifact digest, feature flag snapshot, gateway allowlist checksum, schema version을 release record에 고정한다.
- staging에서 익명·일반 사용자·타 사용자·변조 쿠키 역할 매트릭스를 실행한다.
- Python public port, encoded path, alternate host, WS upgrade로 gateway 우회를 공격한다.
- backup/restore 증빙, readiness, alerts, secret rotation, dependency gate를 확인한다.
- canary는 위험 기능이 모두 disabled인 상태로 작은 트래픽부터 시작한다.
- 401/403/404/429/5xx, latency, readiness, denied upstream count, PII log scan을 관찰한다.
- rollback trigger, operator, 이전 artifact digest, maintenance mode 명령을 release record에 적는다.
- .idea 같은 비-Python 저장소 부산물은 별도 정리할 수 있지만 Python.zip과 Python source 제거는 이 트랙에서 수행하지 않고 handoff한다.
- 남은 Python blocker를 별도 backlog에 등록하고, 각 기능 재활성화는 독립 보안 심사를 요구한다.

Conditional Go 완료 기준:

- 외부에서 Python backend에 직접 접근할 수 없다.
- admin/report, matching/practice/connect, chat/DM/WS가 gateway와 UI 양쪽에서 닫혀 있다.
- profile은 인증된 self-only 최소 schema로 제한된다.
- 과거 secret 회전이 증명되고 CI secret scan이 필수다.
- backup restore가 RTO 내 성공했고 readiness와 alert test가 통과했다.
- production dependency high/critical이 0이며 비-Python E2E가 연속 3회 통과했다.
- exact SHA와 rollback이 검증됐다.

즉시 No-Go 또는 rollback 조건:

- Python public port 또는 gateway 우회가 한 번이라도 성공
- admin, 타인 profile, matching 후보, chat 데이터가 응답에 포함
- 로그나 error tracker에서 Cookie, token, email, message body 검출
- readiness 실패, 5xx 급증, rate limiter 무력화
- 실제 배포 SHA 또는 secret 회전 상태를 확인할 수 없음

최종 검증:

    pnpm run typecheck
    pnpm run build
    pnpm api:contract-test
    pnpm e2e:security -- --repeat-each=3
    pnpm audit --prod
    gitleaks git --redact --no-banner
    git diff --exit-code -- Python
    git diff --exit-code -- '*.py'

판정:

- 위 완료 기준을 모두 충족하면 위험 기능을 제거한 축소 범위 Conditional Go만 가능하다.
- admin, matching, chat을 포함한 Full Go는 Python 인가·매칭·채팅·세션 결함이 별도 트랙에서 수정되고 다시 감사되기 전까지 No-Go다.

## 4. 전체 완료 정의

Slice 하나의 완료 정의:

- 변경 범위가 Python 무변경 규칙을 통과한다.
- 코드·설정·문서가 함께 변경되고 owner가 지정된다.
- 자동 테스트와 수동 반증 시나리오가 모두 통과한다.
- staging 증빙에 exact SHA, 명령, 시간, 결과가 남는다.
- rollback 또는 fail-closed 동작이 리허설된다.
- [UNKNOWN]을 추정으로 닫지 않고 확인 증빙 또는 release blocker로 전환한다.

전체 트랙 완료 정의:

- Slice 01–20의 완료 기준이 release record에 연결된다.
- 다음 명령에서 Python 변경이 없어야 한다.

    git status --short
    git diff --exit-code -- Python
    git diff --exit-code -- '*.py'
    git diff --name-only --diff-filter=ACDMRTUXB | rg '(^Python/|\.py$)'

- 기존 사용자 작업과 추적되지 않은 Python 파일은 수정·삭제·stage하지 않는다.
- 이 문서의 생성 자체는 취약점 해결 증거가 아니며, 구현과 검증 기록이 각 Slice에 연결돼야 한다.

## 5. Python 트랙으로 명시적으로 넘길 잔여 블로커

아래 항목은 이 문서의 범위에서 고치지 않는다. gateway 격리로 외부 피해를 막을 뿐, 기능 재활성화 전 별도 수정과 감사를 요구한다.

- 서버측 admin role과 모든 admin endpoint 인가
- users endpoint의 서버측 인증, 소유권, field allowlist
- matching의 block/report/verification 필터와 동시성·상태 전이
- chat room 생성 500, participant-only REST/WS 인가, 메시지 저장·필터
- 이메일 소유 확인, 서버 비밀번호 정책, 계정 열거, reset/change flow
- 세션 고정, 서버측 logout 무효화, production secure cookie 보장
- raw SQL 조립 제거와 DB connection/timeout/transaction 정책
- 현재 pytest 실패 및 Python AST syntax error
- Python/requirements.txt와 다른 의존성 선언의 수렴

이 잔여 블로커가 해결되지 않은 상태에서는 차단된 기능의 flag를 true로 바꾸지 않는다.
