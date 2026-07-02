import os
import sys
from pathlib import Path

# The FastAPI server and adapters live in Python/ and import each other as
# top-level modules (integration_api, db, api.*), so mirror the server's cwd.
PYTHON_DIR = Path(__file__).resolve().parent.parent / "Python"
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))

# db.py reads DATABASE_URL at import time; tests never open a connection.
os.environ.setdefault("DATABASE_URL", "postgresql://tests@localhost:5432/tests")
