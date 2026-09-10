# Full Learning Production Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Python을 수정하지 않고 Mentor Connect의 모든 학습 기능을 실제 배포에서 접근·실습할 수 있게 한다.

**Architecture:** 기존 React → TypeScript gateway → private Python → PostgreSQL 경로를 유지한다. production kill switch를 명시적인 전체 학습 API 계약으로 교체한다. 미완성 Python 응답도 화면에 표시하며 TypeScript로 업무 로직을 대신 구현하지 않는다.

**Tech Stack:** React 19, Vite, TanStack Query, Node 24, TypeScript, pnpm 10.33.0, 기존 FastAPI/Python 3.12, PostgreSQL 16, Replit artifact 설정.

**Spec:** [재감사·설계](../specs/2026-09-09-full-learning-deployment-design.md). 이 문서의 Global Constraints 전체를 모든 하위 계획에 적용한다.

## Global Constraints

- Backend는 Python을 메인으로 쓴다.
- Python 파일은 절대 수정하지 않는다.
- 모든 기능을 공개한다. Python 미완성은 기능을 다시 숨기는 조건으로 사용하지 않는다.
- Python의 매칭·채팅·인가·DB 업무 로직을 TypeScript, SQL trigger, monkey patch로 대체하지 않는다.
- `Python/**`, 모든 `*.py`, `Python.zip`, 기존 `pyproject.toml`, `requirements.txt`, `uv.lock`은 읽기 전용으로 유지한다.
- 기존 PostgreSQL migration ledger와 `0001`·`0002` migration은 보존한다. merge·startup에서 DB를 자동 변경하지 않는다.
- gateway만 외부 API/WS 진입점으로 유지하고 Python은 `127.0.0.1:8181`에 둔다.
- `minimumReleaseAge: 1440`을 유지한다. 새 서비스·새 업무 백엔드는 추가하지 않는다.

---

## 실행 순서

이것은 기존 11–20번을 그대로 실행하라는 문서가 아니다. 사용자 결정으로 출시 목표가 바뀌었으므로,
아래 **새 Task 11–24**가 다음 구현의 기준이다. 이전 1–10의 checksum, DB 무자동변경, secret 방어,
gateway loopback 보호는 계속 재사용한다. 이전 축소 배포 정책을 유지한 채 env 값만 바꾸는 작업은 완료가 아니다.

| 순서 | 작업 | 선행 | 감사 항목 | 산출물 |
| --- | --- | --- | --- | --- |
| 11 | 실행 버전·release build·Python freeze | 없음 | A05,A06 | 재현 가능한 설치·빌드 명령 |
| 12 | secret 검사 fixture와 실제 교실 secret 분리 | 없음 | A15,A16 | scanner 통과, 교체 증빙 |
| 13 | classroom DB 초기화와 current-schema seed | 11 | A07 | 기존 runner로 새 DB 생성 |
| 14 | 소규모 백업·복구 리허설 | 13 | A07 | 실제 restore 검증 |
| 15 | REST 전체 route/query/method 연결 | 11 | A02,A03 | 48 operations, unknown deny 유지 |
| 16 | OpenAPI·typed errors·응답 projection | 15 | A11,A13,A14 | 공개 계약과 생성물 동기 |
| 17 | Origin·입력 제한·작은 limiter | 15,16 | A12 | 정상 수업 가능, abuse 제한 |
| 18 | Python WS endpoint tunnel | 15,17 | A02,A20 | WS 2개 handshake 연결 |
| 19 | readiness·최소 로그·종료 처리 | 15 | A11,A17 | DB/백엔드 장애 구별 |
| 20 | 전체 화면·navigation·관리자 학습 화면 | 15,16 | A01,A04,A18 | 모든 feature production 접근 |
| 21 | auth·logout·profile 편집 정합성 | 20 | A08,A09,A10 | 세션 전환 race 제거 |
| 22 | 학생 미완성·실패·빈 결과 UX | 20,21 | A18,A20 | 실제 결과/과제 상태 표시 |
| 23 | 브라우저와 실제 Python smoke | 13,18,19,21,22 | A19 | 양성 흐름 + 경계 회귀 |
| 24 | CI와 Replit 출시 절차 연결 | 11–23 | A04,A17,A19 | 전체 기능 배포와 rollback |

- [ ] [A. 실행 환경·데이터·복구 — Task 11–14](2026-09-09-learning-runtime-data.md)
- [ ] [B. API 계약·gateway·WS — Task 15–19](2026-09-09-learning-api-gateway.md)
- [ ] [C. UI·회귀·출시 — Task 20–24](2026-09-09-learning-ui-release.md)

각 작업은 코드 검토와 검증이 끝난 뒤 관련 파일만 commit한다. 하위 계획의 `Files`는 시작 지점이며,
generated 파일은 generator로만 갱신한다. 새 테스트는 JS/TS/shell만 작성한다.
과외용 규모에서는 환경·데이터 → REST → UI/auth → WS/관측 → release gate 순으로 통합하면 된다.
작업을 분할해 수행해도 실제 공개 배포는 최종 전체 surface로 한다.

## 완료 기준

- [ ] 가입/로그인/프로필/지역/요청/매칭/실습/analytics/scheduling/보고/채팅/DM 화면에 접근할 수 있다.
- [ ] REST 48개와 WS 2개가 계약대로 Python에 연결된다. 미완성 endpoint도 의도한 학습 응답을 받는다.
- [ ] 방 채팅은 실제 Python으로 두 계정이 메시지를 조회·작성한다. DM 미완성은 완료로 표시하지 않는다.
- [ ] typecheck, build:release, gateway, DB, 계약, browser tests, tracked secret scanner가 통과한다.
- [ ] clean Linux 환경의 install/build와 배포 runtime dependency 목록·SHA를 보관한다.
- [ ] 원격 배포의 공개 origin, Python 비공개 경계, DB 연결, backup/restore 결과를 기록한다.
- [ ] Python freeze 검증과 최종 diff에서 Python 파일/동결한 선언 파일 변경이 0이다.

이 계획의 완료는 “학습용 전체 기능이 공개되고 실제 상태를 확인 가능”이다.
미완성 Python 미션, 원자적 매칭, 실서비스 moderation, 검증된 학생 신원 보장까지 구현했다는 뜻이 아니다.
