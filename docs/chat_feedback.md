## Step 1 : 서버 켜보기

```bash
cd Python
source ../.venv/bin/activate
python main.py
```

에러가 나오면 **파일 이름 / 줄 번호 / 에러 종류** 확인

---

## Step 2 : 문법 오류 고치기 (3개)

고칠 때마다 서버를 다시 켜서 다음 에러를 확인

### ① 342번 줄

341번 줄(윗줄)과 같이 보기

- 341번 줄은 `@`로 시작하나요?
- 342번 줄은 `def`로 시작하나요?

> `@` 데코레이터 바로 다음 줄에는 반드시 `def`가 와야 합니다.
> 342·343번 줄의 `import` 문은 어디에 있어야하는가

### ② 429번 줄

점(`.`) 하나만 있음. 필수인가?

### ③ 465번 줄

`.")` — 지우다 만 흔적입니다. 원래는 `return _todo(3, "...")` 였습니다.

**여기까지 하면 서버가 켜짐.**

---

## Step 3 : Mission 2 — 프레임워크 확인

`list_room_messages` 안에 `jsonify`, `g.user`, `g.db`, `abort` 가 있습니다.

```bash
.venv/bin/python -c "import flask"
```

- 결과가 뭐라고 나오나요?
- `auth.py`와 Mission 1은 결과를 어떻게 돌려주나요? 당신 코드와 같나요?
- 우리 프로젝트가 쓰는 프레임워크는 무엇인가요? (`main.py` 확인)

---

## Step 4 : Mission 3 — `db` 사용법

당신 코드: `db.execute("...").fetchone()`

- `Python/db.py`를 여세요. `def db()` 윗줄에 뭐가 붙어 있나요?
- `db`에 `.execute()`가 있나요?
- `auth.py`는 DB를 어떻게 시작하나요? (3줄)

SQL 빈칸 표시:
- 당신: `WHERE id = :room_id`
- `auth.py`: ?

> 가이드 4장: *"always `%s` placeholders — NEVER f-strings"*

---

## Step 5 : Mission 3 — 컬럼 이름 확인

```bash
psql mentor_connect_mock -c "\d chat_messages"
```

- "보낸 사람"을 가리키는 컬럼의 정확한 이름은?
- 당신의 `INSERT INTO chat_messages (room_id, user_id, ...)` 와 같나요?
- `created_at`에 `default now()`가 있나요? 그럼 `NOW()`를 직접 넣어야 하나요?

---

## Step 6 : Mission 3 — 세션 확인

`auth.py`에서 `request.session[` 을 전부 찾으세요.

- 저장되는 키가 몇 개인가요? 이름은?
- 그럼 `request.session.get("district_id")` 는 무엇을 돌려줄까요?

이 비교의 결과를 채워보세요:

```python
if room["district_id"] != user_district_id:
```

| 방 | `room["district_id"]` | `user_district_id` | 결과 |
|---|---|---|---|
| 1번 (글로벌) | `None` | ? | ? |
| 2번 (내 학군) | `1` | ? | ? |

- 정상 사용자가 자기 학군 방에 글을 쓸 수 있나요?
- 사용자의 진짜 `district_id`는 어디서 가져와야 하나요? (Mission 1에서 이미 함)
- `if`문에 방 종류(`type`)를 확인하는 조건이 있나요? 없으면 글로벌 방은 어떻게 되나요?

---

## Step 7 : Mission 3 — 응답 모양

- Mission 2가 만드는 키: `id, roomId, senderId, senderName, body, createdAt`
- `return dict(new_message)` 가 만드는 키: ? (DB 컬럼 이름 그대로)

확인:
- 둘이 같나요?
- `senderName`이 `chat_messages` 테이블에 있나요? `RETURNING *`만으로 가져올 수 있나요?
- 2001자를 보내면 몇 번 코드가 나오나요? 가이드가 요구하는 코드와 같나요?

---

## Step 8 : 헬퍼 사용하기

`chat.py` 위쪽 `SHARED HELPERS` 블록을 보세요. 각 함수 설명에 `Used by:` 줄이 있습니다.

- `Used by:`에 **Mission 3**이 적힌 헬퍼는 몇 개인가요?
- 그중 지금 코드가 쓰고 있는 건 몇 개인가요?
- Mission 1은 몇 개를 쓰고 있나요?

401 처리, 빈 글자 검사, 방 권한 확인(404/403), 저장 후 재조회는 **이미 만들어져 있습니다.**

---

## 완료 체크리스트

로그인 쿠키 먼저:

```bash
curl -c /tmp/pb-cookies.txt -H 'Content-Type: application/json' \
     -d '{"email":"student001@test.edu","password":"Password123!"}' \
     http://localhost:8000/api/auth/login
```

- [ ] `python main.py` 가 에러 없이 켜진다
- [ ] `/api/chat/rooms/1/messages` → 메시지 **4개**
- [ ] 그 결과에 `senderName` 이 있다
- [ ] 쿠키 없이 요청 → **401**
- [ ] `/api/chat/rooms/3/messages` (남의 학군) → **403**
- [ ] `/api/chat/rooms/999/messages` (없는 방) → **404**
- [ ] `POST /api/chat/rooms/1/messages` → **201** + 저장된 메시지
- [ ] 그 응답 키가 Mission 2와 동일 (`roomId`, `senderId`, `senderName`, `createdAt`)
- [ ] `{"body":"   "}` → **400**
- [ ] 방금 보낸 메시지가 조회에서 보인다
- [ ] 서버를 껐다 켜도 남아있다

---

