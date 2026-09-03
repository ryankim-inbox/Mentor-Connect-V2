# Slice 02 API Shield 운영 절차

상태: 구현 완료, staging 외부망 반증은 배포 담당자가 실행해야 함  
소유자: Release manager (배포 승인 및 증빙), Platform owner (네트워크 경계)

## 공개 경계

공개 API 및 WebSocket 진입점은 artifacts/api-gateway 하나다.

| 서비스 | 바인딩 | 공개 경로 | 역할 |
|---|---|---|---|
| API Shield | 0.0.0.0:8080 | /api, /livez, /ws | 유일한 외부 API 경계 |
| Python backend | 127.0.0.1:8181 | 없음 | API Shield의 private upstream |

.replit은 8080만 externalPort 80으로 노출한다. 8181은 externalPort가 없고
exposeLocalhost = false다. artifacts/api-server의 paths는 빈 배열이어야 한다.

Replit platform UI나 별도 ingress 규칙으로 8181을 다시 노출하면 이 Slice는 실패다.
그 경우 즉시 배포를 중단하고 gateway maintenance mode로 전환한다.

## 현재 allowlist

다음 method와 정확히 일치하는 canonical path만 Python backend로 전달된다.
query string, trailing slash, double slash, dot segment, percent encoding, 대소문자
변형은 승인된 경로가 아니다.

| Method | Path | 인증 정책 |
|---|---|---|
| GET | /api/healthz | 없음 |
| POST | /api/auth/register | JSON body |
| POST | /api/auth/login | JSON body |
| GET | /api/auth/me | Cookie 필요 |
| POST | /api/auth/logout | Cookie를 /api/auth/me에 확인한 뒤 전달 |
| GET | /api/users/{self} | Cookie를 /api/auth/me에 확인하고 id가 일치할 때만 전달 |
| PATCH | /api/users/{self} | 위 소유권 확인 및 name, bio, subjects allowlist |

GET /livez는 gateway 자체 liveness endpoint이며 upstream을 호출하지 않는다.

그 밖의 모든 API 경로와 method는 404로 닫힌다. 특히 admin, python-reports,
matches, practice, request match, chat, dms, `/ws/**`, 다른 사용자의 users 경로, 그리고 모든 WebSocket upgrade는
upstream 연결 전에 차단된다. `/api/chat/**`, `/api/dms/**`, `/ws/**`의 일반 HTTP 요청은
quarantine 404이며, HTTP WebSocket upgrade는 경로나 인증 상태와 관계없이 upstream 연결 전에 403이다.

새 API를 열려면 gatewayAllowlist에 method, canonical path, body 정책, 인증 정책을
명시하고, 허용되지 않은 경로가 upstream에 도달하지 않는 회귀 테스트를 추가해야 한다.

## 보안 동작

- Cookie와 Authorization은 allowlisted upstream 요청에만 전달한다.
- 보호된 logout은 같은 Cookie를 사용해 private /api/auth/me에서 양의 정수 user id를
  확인한 뒤에만 전달한다.
- upstream의 status, body, Set-Cookie는 의도적으로 전달한다. Hop-by-hop, Server,
  Location, CORS, 압축 길이 관련 헤더는 전달하지 않는다.
- request body 기본 제한은 1 MiB, upstream response 기본 제한은 2 MiB다.
- request body timeout 기본값은 10초, upstream timeout 기본값은 5초다.
- duplicate header, Transfer-Encoding, Expect, malformed URL, encoding 우회는 upstream
  호출 전에 거부한다.
- access log에는 correlation id, canonical path, method, status, 고정된 event만 남긴다.
  Cookie, Authorization, 세션, 이메일, request body, upstream error detail을 기록하지 않는다.

환경 변수는 GATEWAY_MAX_BODY_BYTES, GATEWAY_MAX_RESPONSE_BYTES,
GATEWAY_BODY_TIMEOUT_MS, GATEWAY_UPSTREAM_TIMEOUT_MS로 조정할 수 있다. 값은
양의 정수여야 한다. GATEWAY_UPSTREAM_ORIGIN은 http://127.0.0.1:8181 같은
loopback HTTP origin만 허용한다.

## 로컬 검증

먼저 private backend와 Shield를 각각 실행한다.

    cd Python && python -m uvicorn main:app --host 127.0.0.1 --port 8181
    PORT=8080 pnpm --filter @workspace/api-gateway run dev
    PORT=21288 pnpm --filter @workspace/peerbridge run dev

다음 명령은 gateway의 unit/integration test와 정적 배포 경계를 검사한다.

    pnpm test:gateway
    pnpm --filter @workspace/peerbridge build
    pnpm gateway:verify-boundary

verify-boundary는 .replit, 두 artifact 설정, 그리고 빌드된 프론트 bundle에 private
Python origin이 없는지 확인한다. 이 명령은 hosting provider의 실제 public port 또는
DNS 설정을 관찰할 수 없으므로 staging 반증을 대체하지 않는다.

## Staging 반증 및 승인 증빙

배포 후 아래 명령을 실행하고 요청 시간, deployment SHA, gateway correlation id,
HTTP status를 release record에 남긴다.

    curl -i https://staging.example/livez
    curl -i https://staging.example/api/healthz
    curl -i https://staging.example/api/admin/flagged-users
    curl -i https://staging.example/api/users/1
    curl -i https://staging.example/api/unknown-route
    curl -i https://staging.example:8081/api/healthz

허용되지 않은 네 API 요청은 404 또는 403이어야 하고, gateway access log의 해당
요청별 upstream 호출 수는 0이어야 한다. 마지막 요청은 연결 자체가 불가능해야 한다.
인코딩, double slash, dot segment, 대소문자, query string, duplicate header, WebSocket
upgrade도 같은 기준으로 별도 실행한다.

이 증빙이 없으면 Python backend가 실제로 private이라는 결론을 내리지 않는다. Slice 02
구현은 완료일 수 있어도 release approval은 No-Go 상태다.

## 롤백

gateway를 우회하거나 Python private port가 외부에서 응답하면 다음 환경 변수로 새
gateway artifact를 배포한다.

    GATEWAY_MAINTENANCE_MODE=true

이 상태에서는 GET /livez만 200을 반환하고 allowlisted API는 503 maintenance로
fail-closed 된다. 위험 API를 다시 Python에 직접 연결하는 방식으로 롤백하지 않는다.
