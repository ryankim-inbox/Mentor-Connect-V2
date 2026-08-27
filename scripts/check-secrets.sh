#!/usr/bin/env sh
#
# check-secrets.sh — 추적 중인 파일에 실제 자격증명이 들어 있는지 검사한다.
#
# Slice 01(유출된 비밀정보 폐기)의 검증 도구이자, Slice 07에서 CI 게이트로
# 재사용한다. git이 추적하는 파일만 본다 — 무시되는 로컬 .env는 대상이 아니다.
#
#   사용법:  sh scripts/check-secrets.sh
#   자가검사: sh scripts/check-secrets.sh --self-test
#   종료코드: 0 = 통과, 1 = 발견됨
#
# 히스토리는 검사하지 않는다. 과거 커밋의 비밀정보는 별도 정리가 필요하며
# docs/RELEASE_SLICES_NON_PYTHON.md의 Slice 01에 절차가 있다.

set -eu

cd "$(dirname "$0")/.."

SELF="scripts/check-secrets.sh"
FOUND=0
SCAN_ROOT=""   # 비어 있으면 git 추적 파일, 아니면 해당 디렉터리(자가검사용)

report() {
  # $1=심각도  $2=설명  $3=파일목록
  printf '\n[%s] %s\n' "$1" "$2"
  printf '%s\n' "$3" | sed 's/^/    /'
  FOUND=1
}

# 검사 대상 파일 목록. 스캐너 자신은 제외한다(패턴이 자기 자신과 일치하므로).
files() {
  if [ -n "$SCAN_ROOT" ]; then
    find "$SCAN_ROOT" -type f
  else
    git ls-files -z | tr '\0' '\n' | grep -v -x "$SELF" || true
  fi
}

# $1=정규식 → 일치하는 파일 경로를 출력. 일치 없으면 빈 출력 + 종료코드 0.
scan() {
  files | while IFS= read -r f; do
    if [ -f "$f" ] && LC_ALL=C grep -qE "$1" "$f" 2>/dev/null; then
      printf '%s\n' "$f"
    fi
  done
}

# 한 파일 안의 고유 bcrypt 해시가 2개 이상인 파일을 출력.
#
# 합성 시드는 자리표시자 해시 하나를 전 사용자에게 반복 사용하므로 고유 1개다.
# 실제 덤프는 사용자마다 해시가 달라 2개 이상이 된다. 파일명 허용목록을 두지
# 않으므로, 새 덤프가 추가돼도 자동으로 걸린다.
scan_real_hash_dumps() {
  files | while IFS= read -r f; do
    if [ -f "$f" ]; then
      n=$(LC_ALL=C grep -oE '\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}' "$f" 2>/dev/null \
          | sort -u | wc -l | tr -d ' ')
      if [ "$n" -ge 2 ]; then
        printf '%s  (고유 해시 %s개)\n' "$f" "$n"
      fi
    fi
  done
}

run_checks() {
  # 1. 서비스 토큰
  HITS=$(scan 'github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{30,}')
  if [ -n "$HITS" ]; then report P0 "GitHub 토큰으로 보이는 문자열" "$HITS"; fi

  HITS=$(scan 'AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}')
  if [ -n "$HITS" ]; then report P0 "AWS 액세스 키로 보이는 문자열" "$HITS"; fi

  HITS=$(scan 'sk-[A-Za-z0-9]{32,}|sk-proj-[A-Za-z0-9_-]{20,}')
  if [ -n "$HITS" ]; then report P0 "API 키로 보이는 문자열" "$HITS"; fi

  # 앞의 하이픈이 grep의 옵션 종료자로 해석되지 않도록 BEGIN부터 매칭한다.
  HITS=$(scan 'BEGIN [A-Z ]*PRIVATE KEY')
  if [ -n "$HITS" ]; then report P0 "개인키 블록" "$HITS"; fi

  # 2. 비밀번호가 박힌 접속 문자열. 비밀번호 없는 URL은 통과시킨다.
  HITS=$(scan '(postgres(ql)?|mysql|mongodb(\+srv)?|redis|amqp)://[^:@/ ]+:[^@/ ]+@')
  if [ -n "$HITS" ]; then report P0 "비밀번호가 포함된 접속 문자열" "$HITS"; fi

  # 3. 추적되는 .env — .example / .sample / .template 은 허용
  HITS=$(files | grep -E '(^|/)\.env' | grep -vE '\.(example|sample|template)$' || true)
  if [ -n "$HITS" ]; then report P0 "추적 중인 .env 파일" "$HITS"; fi

  # 4. 실제 비밀번호 해시가 담긴 DB 덤프
  HITS=$(scan_real_hash_dumps)
  if [ -n "$HITS" ]; then report P0 "실제 비밀번호 해시가 담긴 것으로 보이는 덤프" "$HITS"; fi
}

# ---------------------------------------------------------------------------
# 자가검사 — 스캐너가 실제로 탐지하는지 확인한다.
# 통과만 보고 안심하지 않도록, 각 규칙에 대한 양성 표본을 임시로 만들어 검사한다.
# ---------------------------------------------------------------------------
if [ "${1:-}" = "--self-test" ]; then
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT
  mkdir -p "$TMP/fixtures"

  # 각 규칙의 양성 표본. 실제 비밀이 아닌, 형식만 맞춘 가짜 값이다.
  printf 'token: github_pat_%s\n' "$(printf 'A%.0s' 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2)" \
    > "$TMP/fixtures/tok.txt"
  printf 'aws: AKIA%s\n' "IOSFODNN7EXAMPLE" > "$TMP/fixtures/aws.txt"
  printf 'url: postgresql://admin:hunter2@db.internal:5432/app\n' > "$TMP/fixtures/url.txt"
  {
    printf 'a\t$2b$10$'; printf 'a%.0s' $(seq 53); printf '\n'
    printf 'b\t$2b$12$'; printf 'b%.0s' $(seq 53); printf '\n'
  } > "$TMP/fixtures/dump.sql"
  printf -- '-----BEGIN RSA PRIVATE KEY-----\nAAAA\n' > "$TMP/fixtures/key.pem"
  printf 'DATABASE_URL=postgresql://localhost/x\n' > "$TMP/fixtures/.env"

  # 음성 표본: 합성 시드처럼 고유 해시가 1개뿐인 덤프는 걸리면 안 된다.
  {
    printf 'a\t$2b$10$'; printf 'c%.0s' $(seq 53); printf '\n'
    printf 'b\t$2b$10$'; printf 'c%.0s' $(seq 53); printf '\n'
  } > "$TMP/negative.sql"

  SCAN_ROOT="$TMP/fixtures"
  echo "자가검사 — 양성 표본 6종에 대해 탐지 여부 확인"
  run_checks

  POSITIVE=$FOUND

  # 음성 대조: 고유 해시 1개짜리 합성 덤프는 걸리지 않아야 한다.
  FOUND=0
  SCAN_ROOT="$TMP"
  NEG=$(scan_real_hash_dumps | grep 'negative.sql' || true)

  echo ""
  if [ "$POSITIVE" -eq 1 ] && [ -z "$NEG" ]; then
    echo "자가검사 통과 — 양성 6종을 탐지하고, 합성 덤프(고유 해시 1개)는 통과시킨다."
    exit 0
  fi
  [ "$POSITIVE" -eq 1 ] || echo "자가검사 실패 — 양성 표본을 놓쳤다."
  [ -z "$NEG" ] || echo "자가검사 실패 — 합성 덤프를 오탐했다: $NEG"
  exit 1
fi

# ---------------------------------------------------------------------------
# 본 검사
# ---------------------------------------------------------------------------
echo "추적 파일 $(files | wc -l | tr -d ' ')개 검사 중..."
run_checks

if [ "$FOUND" -eq 0 ]; then
  echo ""
  echo "통과 — 추적 파일에서 자격증명이 발견되지 않았다."
  echo "주의: 과거 커밋은 검사 대상이 아니다."
  exit 0
fi

echo ""
echo "실패 — 위 항목을 제거한 뒤 다시 실행할 것."
echo "이미 푸시된 경우, 파일 제거만으로는 부족하다. 먼저 해당 자격증명을 폐기하라."
exit 1
