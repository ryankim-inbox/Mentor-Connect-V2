"""
Tester class without starting FastAPI


How to : In Console
cd Python
python main.py    or     python3 main.py
"""

from pprint import pprint

from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def home():
    return {"message": "Python Backend is running"}

@app.get("/health")
def health():
    return {"status": "ok"}

def main():
    '''
    question_id = 1
    result = find_matches(question_id=question_id, limit=5)
    pprint(result)
    '''

if __name__ == "__main__":
    main()
