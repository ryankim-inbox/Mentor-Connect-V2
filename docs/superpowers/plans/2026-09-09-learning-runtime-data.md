# Learning Runtime and Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 Python을 그대로 실행할 수 있는 배포 환경과 새 교실 DB, 최소 복구 절차를 만든다.

**Architecture:** package/runtime 선택을 배포 설정에서 고정한다. DB는 기존 checksum ledger와 runner로 새 classroom target만 초기화한다. 운영 도구는 요청을 처리하는 백엔드가 아니며 기존 학생 알고리즘을 변경하지 않는다.

**Tech Stack:** pnpm 10.33.0, Node 24, uv, Python 3.12, PostgreSQL 16, node:test, shell.

**Spec:** [전체 설계](../specs/2026-09-09-full-learning-deployment-design.md), 특히 3·4·8절. [마스터](2026-09-09-full-learning-production.md)의 모든 Global Constraints를 상속한다.

## Global Constraints

- Backend는 Python을 메인으로 쓴다.
- Python 파일은 절대 수정하지 않는다.
- 모든 기능을 공개한다. Python 미완성은 기능을 다시 숨기는 조건으로 사용하지 않는다.
- `Python/**`, 모든 `*.py`, `Python.zip`, 기존 `pyproject.toml`, `requirements.txt`, `uv.lock`은 읽기 전용으로 유지한다.
- 기존 PostgreSQL migration ledger와 `0001`·`0002` migration은 보존한다. merge·startup에서 DB를 자동 변경하지 않는다.
- `minimumReleaseAge: 1440`을 유지한다. 새 서비스·새 업무 백엔드는 추가하지 않는다.

---

## 파일 책임

| 파일 | 책임 |
| --- | --- |
| root package.json / pnpm-workspace.yaml | package manager·release build 범위·Node dependencies |
| scripts/check-python-unchanged.mjs | 선택한 base 이후 Python 동결 위반 검사 |
| ops/build-python-runtime.sh | 기존 requirements 입력을 읽어 별도 배포 runtime 산출물 생성 |
| ops/bootstrap-classroom.mjs | 새 교실 DB에서만 기존 migration runner 실행 |
| database/fixtures/classroom.sql | 현재 schema와 호환되는 소량 교실 기본 데이터 |
| ops/seed-classroom.mjs | 기존 register API로 계정을 만들고 question fixture를 연결 |
| docs/runbooks/classroom-database.md | 환경 지정·초기화·backup/restore 절차 |

### Task 11: 실행 버전과 release build를 고정한다

**Files:**
- Modify: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`
- Modify: `artifacts/peerbridge/package.json`, `.github/workflows/release-surface.yml`
- Modify: `artifacts/api-server/.replit-artifact/artifact.toml`, `.replitignore`
- Create: `.node-version`, `scripts/check-python-unchanged.mjs`, `scripts/test-python-freeze.mjs`, `ops/build-python-runtime.sh`
- Test: 새 임시 checkout/CI의 frozen install, 기존 typecheck/build/DB tests

**Interfaces:**
- Produces: `pnpm build:release`, `node scripts/check-python-unchanged.mjs <base-ref>`
- Produces: `RELEASE_RUNTIME_DIR` 아래 runtime 및 `requirements.lock`, `runtime.sha256`; 원본 Python 파일은 입력 전용.
- Consumes: 기존 `Python/requirements.txt`와 `lib/db/package.json`의 이미 선언된 tsx.

- [ ] **Step 1 — 기존 실패를 확인한다.** `corepack pnpm@10.33.0 run build`는 mockup PORT 때문에 실패한다.
  기존 `lib/db` tsx가 없는 현상은 manifest 누락이 아니라 설치 drift다. 먼저 clean 설치에서 재현 여부를 확인한다.
- [ ] **Step 2 — root package script를 아래 방향으로 변경한다.** `build:all`은 개발 도구까지 검사하는 별도 명령이다.

```json
{
  "packageManager": "pnpm@10.33.0",
  "engines": { "node": ">=24 <25", "pnpm": "10.33.0" },
  "scripts": {
    "build": "pnpm run build:release",
    "build:release": "pnpm run typecheck && pnpm --filter @workspace/api-gateway build && pnpm --filter @workspace/peerbridge build",
    "build:all": "pnpm -r --if-present build"
  }
}
```

  `.node-version`에는 `24.21.0`을 기록하고 CI·Replit runtime 실제 버전을 대조한다.
  이는 검토한 Node 24 공식 문서의 현재 patch다. 실행 시 보안 수정이 추가됐다면 같은 24 계열의
  수정 patch로 파일과 CI를 함께 갱신하고 선택한 정확한 버전을 record에 남긴다.
  gateway/peerbridge의 build script 자체는 재사용한다. root의 Darwin 전용 3개 package는 **optionalDependencies**로
  옮긴다. pnpm platform override를 전부 재설계하지 말고 macOS ARM + Linux x64 clean build부터 검증한다.
  peerbridge에서 React·ReactDOM·wouter·query·workspace client 등 앱 import는 dependencies로 옮기고
  Vite·type·plugin·Tailwind build 도구는 devDependencies에 둔다. lockfile은 pnpm 10.33.0으로 갱신한다.
- [ ] **Step 3 — Python freeze 검사를 작성한다.** `git diff --name-only <base>`로 이미 commit된 변경도 검사한다.
  rename은 원본/목적지 모두 검사하도록 `--no-renames`를 사용한다. untracked 파일도 검사한다.

```js
// scripts/check-python-unchanged.mjs
import { execFileSync } from 'node:child_process';
const base = process.argv[2];
if (!base) throw new Error('base ref is required');
const git = (...args) => execFileSync('git', args, {encoding: 'utf8'}).split('\0').filter(Boolean);
const changed = [...git('diff', '--no-renames', '--name-only', '-z', base, '--'),
  ...git('ls-files', '--others', '--exclude-standard', '-z')];
const forbidden = changed.filter(p => p.startsWith('Python/') || p.endsWith('.py') ||
  ['Python.zip', 'pyproject.toml', 'requirements.txt', 'uv.lock'].includes(p));
if (forbidden.length) throw new Error('Python freeze violated: ' + forbidden.join(', '));
console.log('Python freeze passed');
```

  `scripts/test-python-freeze.mjs`는 검사 함수에 Git changed-path 목록을 주입하여 modification/add/delete/rename의
  원본·목적지 경로를 검사하고, 실제 CLI는 HEAD 기준 통과와 Python 변경이 존재하는 과거 commit 기준
  거부를 read-only로 확인한다. 테스트 때문에 `.py` 파일을 새로 쓰거나 수정하지 않는다.
  감사 당시 학생의 별도 Python 변경을 소급 차단하지 않도록 **실행 시작 base SHA**를 기록한다.
- [ ] **Step 4 — 원본 파일을 수정하지 않고 runtime을 만든다.** 빌드 산출물 경로를 강제하며 공유 `.venv`를 사용하지 않는다.

```sh
#!/bin/sh
set -eu
: "${RELEASE_RUNTIME_DIR:?set an absolute build output directory}"
case "$RELEASE_RUNTIME_DIR" in /*) ;; *) exit 2 ;; esac
case "$RELEASE_RUNTIME_DIR" in "$(pwd)/Python"|"$(pwd)/Python/"*) exit 2 ;; esac
test ! -e "$RELEASE_RUNTIME_DIR/venv"
mkdir -p "$RELEASE_RUNTIME_DIR"
uv pip compile Python/requirements.txt --python-version 3.12 --generate-hashes \
  --output-file "$RELEASE_RUNTIME_DIR/requirements.lock"
uv venv --python 3.12 "$RELEASE_RUNTIME_DIR/venv"
uv pip sync --python "$RELEASE_RUNTIME_DIR/venv/bin/python" --require-hashes \
  "$RELEASE_RUNTIME_DIR/requirements.lock"
```

  uv 도구 버전도 빌드 record에 고정한다. resolve한 lock을 artifact로 보관하고 재배포는 그 lock으로 sync한다.
  실행기는 `$RELEASE_RUNTIME_DIR/venv/bin/python -m uvicorn main:app --app-dir Python --host 127.0.0.1 --port 8181`
  형태로 기존 artifact run을 연결한다. production startup에서 resolve/install을 반복하지 않는다.
  dependency import 검사는 `python -B -c 'import fastapi, uvicorn, bcrypt, itsdangerous, psycopg, psycopg2'`로 수행한다.
  이 검사는 기존 학생 모듈을 import하지 않고 DB에 연결하지 않는다. runtime SHA는 lock bytes의 SHA-256이다.
- [ ] **Step 5 — 배포 snapshot에서 로컬 자료를 제외한다.** `.replitignore`에 `.env`, `**/.env`, `.idea`,
  `.git`, 테스트 dump·진단 로그를 제외한다. `Python/` 소스는 포함하고 `Python.zip`은 snapshot에서만 제외한다.
  저장소 Python 파일이나 archive를 삭제하지 않는다. 학생이 과제로 보는 현재 source는 그대로 배포한다.
- [ ] **Step 6 — clean Linux x64와 macOS ARM에서 검증한다.** 새 임시 checkout에서 `pnpm install --frozen-lockfile`,
  `pnpm typecheck`, `pnpm build:release`, `pnpm --filter @workspace/db test` 실행. Linux 결과가 없으면 설치 재현 완료로 표시하지 않는다.
  관련 non-Python 파일만 stage하고 `chore: pin classroom release runtime`으로 commit한다.

### Task 12: secret scanner의 테스트 충돌과 교실 secret 준비를 분리한다

**Files:**
- Modify: `lib/db/test/integrity-tool.test.mjs`, `scripts/test-migration-entrypoint.sh`
- Modify: `docs/security/secret-exposure-incident-ledger.md`
- Test: `scripts/check-secrets.sh`, `scripts/test-secret-history.sh`, `scripts/test-secret-workflow-policy.sh` 기존 검사

**Interfaces:**
- Produces: tracked scanner exit 0; credential URL redaction 테스트는 계속 수행.
- External input: classroom DATABASE_URL / SESSION_SECRET, 과거 token 폐기 증빙. 값을 문서나 로그에 쓰지 않는다.

- [ ] **Step 1 — `sh scripts/check-secrets.sh`로 두 테스트 파일 탐지를 재현한다.** 이 결과를 신규 실사용 secret 유출로 단정하지 않는다.
- [ ] **Step 2 — 인증정보 자체가 필요 없는 URL fixture에서는 userinfo를 제거한다.** redaction용 canary가 꼭 필요한 경우에만 URL API로 만든다.

```js
const testDatabaseUrl = new URL('postgresql://staging-db.invalid/classroom');
testDatabaseUrl.username = 'fixture-user';
testDatabaseUrl.password = 'fixture-canary';
// redaction assertion은 .password와 .href가 stderr/stdout에 없는지 검사한다.
```

  shell에서는 hostname/환경 reject 테스트에 암호가 필요 없으므로 `postgresql://staging-db.internal/classroom`으로 바꾼다.
  실제 credential이 있는 문자열을 쪼개 숨기지 않는다. 테스트 디렉터리 전체를 스캐너에서 제외하지 않는다.
- [ ] **Step 3 — `sh scripts/check-secrets.sh --self-test`, `sh scripts/check-secrets.sh`, `pnpm test:migrations`,
  `pnpm test:secrets`를 실행한다.** synthetic secret를 탐지하는 self-test도 계속 통과해야 한다.
- [ ] **Step 4 — 실제 운영 항목을 기록한다.** 배포 담당자가 별도 classroom DB credential/SESSION_SECRET을 발급하고
  secret store에 저장한다. 과거 GitHub token·DB credential·session secret의 폐기/교체 evidence reference를 ledger에 기록한다.
  재사용하지 않는 과거 환경은 폐기 사실을 기록한다. 미확인 계정 reset이나 history 정리를 “완료”로 바꾸지 않는다.
  실제 secret 변경은 별도 운영 실행이며 문서 작성만으로 완료되지 않는다.
- [ ] **Step 5 — `test: keep secret scanner compatible with synthetic fixtures`로 테스트 변경을 commit한다.**
  외부 작업 증빙은 확보된 항목만 별도 docs commit에 넣는다.

### Task 13: 빈 classroom DB를 초기화하고 수업 데이터를 준비한다

**Files:**
- Create: `ops/bootstrap-classroom.mjs`, `ops/seed-classroom.mjs`, `database/fixtures/classroom.sql`
- Create: `lib/db/test/classroom-bootstrap.test.mjs`, `docs/runbooks/classroom-database.md`
- Modify: `lib/db/tools/migration-runner.mjs` — 기존 transaction 내부의 초기화 전 검사 callback만 추가
- Reuse: `lib/db/tools/schema-assets.mjs`, `migration-runner.mjs`, `migration-ledger.mjs`, `test/disposable-postgres.sh`
- Keep unchanged: `scripts/migration-entrypoint.mjs`의 dry-run-only 정책과 기존 schema assets

**Interfaces:**
- `bootstrapClassroom({client, ledger, appSha}): Promise<{applied:string[],alreadyApplied:string[]}>`
- `runMigrationTransaction({client,ledger,appSha,beforeApply = async () => {}})`;
  `beforeApply(client):Promise<void>`는 advisory lock 직후, 첫 schema write 전에 호출한다.
- `CLASSROOM_DATABASE_URL`, `CLASSROOM_ALLOWED_HOST`, `CLASSROOM_DATABASE_NAME`은 운영자가 제공한다.
- `seed-classroom.mjs`는 `CLASSROOM_ORIGIN`, `CLASSROOM_CREDENTIAL_FILE`을 추가로 받아 기존 register API를 호출한다.
- Produces: schema 0002, 합성 district/tag/room/question 데이터, mode 0600의 테스트 계정 credential 파일.

  credential JSON 계약은 `{accounts:{mentor:{id,email,password},mentee:{id,email,password}},
  fixtures:{questionId,globalRoomId,districtIds}}`다. account fields와 fixture IDs는 실제 생성 응답에서 채운다.
  ops 루트에서 pg를 import할 때는 이미 설치된 db package의 dependency를 다음처럼 해석한다.

```js
import {createRequire} from 'node:module';
const {Client} = createRequire(new URL('../lib/db/package.json', import.meta.url))('pg');
```

  bootstrap과 seed는 이 Client를 사용하고 `finally`에서 `client.end()`를 호출한다.

- [ ] **Step 1 — disposable cluster에서 4가지 검사를 만든다.** 빈 DB는 0001/0002 적용,
  두 번째 bootstrap은 이미 초기화된 DB로 reject, ledger 없이 application table이 있는 DB는 reject,
  허용 host/database와 다른 URL은 connect 이전 reject. 임의 기존 DB를 drop/reset하는 테스트는 금지한다.
- [ ] **Step 2 — bootstrap 검사를 runner 앞에 둔다.** `verifySchemaAssets({rootDir})`의 ledger를 사용한다.

```js
const target = new URL(process.env.CLASSROOM_DATABASE_URL);
if (target.hostname !== process.env.CLASSROOM_ALLOWED_HOST ||
    decodeURIComponent(target.pathname.slice(1)) !== process.env.CLASSROOM_DATABASE_NAME) {
  throw new Error('classroom database target mismatch');
}
const beforeApply = async (client) => {
  const {rows} = await client.query(
    "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname = 'public') AS populated"
  );
  if (rows[0].populated) throw new Error('classroom bootstrap requires an empty database');
};
const result = await runMigrationTransaction({client, ledger, appSha, beforeApply});
```

  첫 schema write는 operational ledger CREATE를 포함한다. 빈 DB 검사도 advisory lock 안에서 실행하여
  두 bootstrap의 check/write 경쟁을 막는다. 일반 runner 호출은 기본 no-op callback으로 기존 동작을 유지한다.
  bootstrap은 새 DB 초기화 전용이며 기존 DB migration/adoption 도구로 확대하지 않는다.
  초기화 후 재배포에는 bootstrap을 호출하지 않는다. 동일 cluster에 동시 bootstrap 두 개를 실행해
  하나만 적용되고 나머지는 아무것도 쓰지 않은 채 reject되는지 추가 검증한다.
- [ ] **Step 3 — 소량 기본 seed SQL을 추가한다.** 새 classroom DB에만 적용하고 이미 seed된 경우 재실행을 거부한다.

```sql
INSERT INTO districts (name, county, type) VALUES
  ('Classroom North', 'Practice County', 'high_school'),
  ('Classroom South', 'Practice County', 'high_school');
INSERT INTO tags (name, color) VALUES ('Math', '#6366f1'), ('Science', '#10b981');
INSERT INTO chat_rooms (type, district_id, name) VALUES ('global', NULL, 'Classroom Lounge');
INSERT INTO chat_rooms (type, district_id, name)
SELECT 'district', id, name || ' Chat' FROM districts;
```

  `mentor_connect_mock_1000.sql`은 사용하지 않는다. 초기화/seed는 post-merge와 startup에 연결하지 않는다.
- [ ] **Step 4 — 기존 Python API로 mentor/mentee 계정을 만든다.** `node:crypto.randomBytes(24).toString('base64url')`
  암호를 사용해 `/api/auth/register`에 각각 요청한다. 이메일은 `mentor@classroom.example.edu`,
  `mentee@classroom.example.edu`라는 합성 fixture로만 사용하고 실제 이메일을 보내지 않는다.
  `Origin`은 CLASSROOM_ORIGIN, JSON body에는 name, password, role, 조회한 districtId를 포함한다.
  실패하면 raw 응답·암호를 로그에 쓰지 않고 상태와 request id만 남긴다.
  성공 응답의 user.id를 이용해 **운영 fixture**로 question 한 개를 parameterized SQL로 만든다.

```js
await client.query(
  'INSERT INTO questions (student_id, subject, topic, message) VALUES ($1,$2,$3,$4)',
  [menteeId, 'Math', 'Algebra', 'Classroom practice question']
);
```

  mentorId/menteeId는 두 register 성공 JSON의 user.id를 검증해 얻는다. id를 1/2로 가정하지 않는다.
  mentor subjects는 기존 PATCH `/api/users/{self}`와 같은 cookie로 `['Math']`를 저장한다.
  fixture용 SQL과 계정 생성은 업무 backend 대체가 아니다. 요청을 question으로 복제하는 trigger는 만들지 않는다.
- [ ] **Step 5 — schema/constraints와 앱 데이터를 검증한다.** `schema:check`, `schema:diff -- --read-only`,
  `constraints:verify -- --env staging`를 정확한 classroom target allowlist로 실행한다.
  room 목록·합성 question matching·register/login이 성공하거나 학생 실패 envelope를 반환하는지 확인한다.
- [ ] **Step 6 — 관련 파일과 runner 변경/테스트를 `ops: bootstrap isolated classroom data`로 commit한다.**
  credential 파일·실제 URL은 stage하지 않는다.

### Task 14: 수업 snapshot의 복구 가능성을 증명한다

**Files:**
- Modify: `docs/runbooks/classroom-database.md`
- Create: `ops/backup-classroom.mjs`, `ops/restore-classroom.mjs`, `lib/db/test/classroom-restore.test.mjs`
- Reuse: PostgreSQL `pg_dump`, `pg_restore`, 기존 catalog/constraint 비교 도구

**Interfaces:**
- backup input: `CLASSROOM_DATABASE_URL`, `BACKUP_OUTPUT_DIR`; output: dump + SHA-256 + schemaVersion + capturedAt.
- restore input: `RESTORE_DATABASE_URL`, `RESTORE_EXPECTED_DATABASE`, dump file; output: 검증 결과와 elapsedMs.
- restore는 source와 다른 host/database 조합의 **비어 있는** DB만 허용한다.

- [ ] **Step 1 — disposable 원본/복구 DB 두 개로 failing test를 작성한다.** 잘못된 target과 checksum은
  `pg_restore` spawn 전 reject; 정상 restore는 table counts·ledger checksum·FK/unique/check catalog 일치.
- [ ] **Step 2 — native 도구만 감싼다.** URL userinfo를 command argument나 로그에 넣지 않는다.

```js
const dumpArgs = ['--format=custom', '--no-owner', '--no-acl', '--file', dumpPath];
const restoreArgs = ['--exit-on-error', '--single-transaction', '--no-owner', '--no-acl',
  '--dbname', expectedDatabase, dumpPath];
// spawn('pg_dump', dumpArgs, {env: pgEnvironment})
// spawn('pg_restore', restoreArgs, {env: restorePgEnvironment})
```

  `dumpPath`는 mode 0700의 BACKUP_OUTPUT_DIR 아래 새 파일 경로. `expectedDatabase`는 검증된 환경변수.
  `pgEnvironment`는 URL에서 읽은 PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD 및 provider TLS 설정을
  child env로 전달한 객체다. stderr raw 연결 오류도 저장 전 URL/canary 노출을 제거한다.
  dump manifest의 hash 검증 뒤 restore한다. arbitrary target에 `--clean`을 사용하지 않는다.
- [ ] **Step 3 — 정상 복구에서 기존 검증기를 실행한다.** 원본이 기록한 schemaVersion/ledger checksum과
  모든 13개 application table의 COUNT를 비교한다. 원본 count 캡처는 쓰기 중지된 수업 종료 시점 또는
  동일 snapshot으로 수행해 서로 다른 시점을 비교하지 않는다.
- [ ] **Step 4 — 운영 리허설을 기록한다.** 수업 전 snapshot, 최근 7개 보관, 복구 30분 목표;
  암호화된 provider 저장소에 보관하고 배포 filesystem만 영구 backup으로 쓰지 않는다.
  실제 복구 시간·backup reference·확인자를 기록한다. 불필요한 복구 오케스트레이터/새 cloud SDK는 추가하지 않는다.
- [ ] **Step 5 — test 통과 후 `ops: rehearse classroom database restore`로 commit한다.**

## 이 계획의 검증 마감

- [ ] fresh install/build 결과와 runtime lock artifact를 남겼다.
- [ ] 원본 Python 파일/의존성 선언 diff는 0이다.
- [ ] 기존 DB schema tests와 새로운 classroom bootstrap/restore 검사가 모두 통과했다.
- [ ] secret fixture 수정으로 scanner를 약화하지 않았다.
