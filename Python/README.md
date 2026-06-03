
## What this project does

1. Reads users from PostgreSQL.
2. Reads a student's question/request from PostgreSQL.
3. Finds mentors who match the question.
4. Skips blocked users.
5. Applies a small safety penalty for reported users.
6. Returns JSON-friendly output that React/Node can use.

## File roles

| File | Job |
|---|---|
| `database.py` | Opens the PostgreSQL connection |
| `get_users.py` | Gets user/account data from DB |
| `get_questions.py` | Gets question/request data from DB |
| `get_blocks.py` | Checks blocked users and reports |
| `find_matches.py` | Main matching algorithm |
| `app.py` | FastAPI server |
| `main.py` | Terminal test runner |
| `create_tables.sql` | SQL schema |
| `seed_demo_data.sql` | Demo data |
| `.env.example` | Example environment file |
| `frontend_fetch_example.js` | Example frontend API call |

## Setup

### 1. Create virtual environment

```bash
python -m venv .venv
```

Mac/Linux:

```bash
source .venv/bin/activate
```

Windows PowerShell:

```powershell
.venv\Scripts\Activate.ps1
```

### 2. Install packages

```bash
pip install -r requirements.txt
```

### 3. Create `.env`

Copy `.env.example` to `.env`.

```bash
cp .env.example .env
```

Then edit:

```env
DATABASE_URL=postgresql://your_username:your_password@127.0.0.1:5432/mentor_connect
```

### 4. Run SQL

Open your PostgreSQL database and run:

```sql
\i create_tables.sql
\i seed_demo_data.sql
```

Or paste the SQL into your DB console.

### 5. Test in terminal

```bash
python main2.py
```

### 6. Run API server

```bash
uvicorn app:app --reload --port 8000
```

Then open:

```text
http://localhost:8000/matches/1
```

## Example output

```json
{
  "success": true,
  "message": "Matches found successfully",
  "question_id": 1,
  "student_id": 1,
  "student_name": "Bob Student",
  "requested_subject": "math",
  "requested_topic": "algebra",
  "matches": [
    {
      "mentor_id": 2,
      "mentor_name": "Alice Mentor",
      "score": 110,
      "match_level": "strong",
      "reasons": [
        "Mentor teaches the requested subject",
        "Mentor is available at the preferred time",
        "Mentor is in the same location",
        "Mentor speaks the preferred language",
        "Mentor matches the preferred teaching style"
      ]
    }
  ]
}
```

## Important beginner concept

`print()` only shows the result in the terminal.

`return` gives the result to another part of the program.

For a real web app, the matching algorithm should `return` a dictionary/list that can become JSON.
