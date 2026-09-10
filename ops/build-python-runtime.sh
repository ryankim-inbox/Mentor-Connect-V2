#!/bin/sh
set -eu

: "${RELEASE_RUNTIME_DIR:?set an absolute build output directory}"
case "$RELEASE_RUNTIME_DIR" in /*) ;; *) exit 2 ;; esac
case "/$RELEASE_RUNTIME_DIR/" in *"/../"*|*"/./"*) exit 2 ;; esac

while [ "$RELEASE_RUNTIME_DIR" != "/" ] && [ "${RELEASE_RUNTIME_DIR%/}" != "$RELEASE_RUNTIME_DIR" ]; do
  RELEASE_RUNTIME_DIR=${RELEASE_RUNTIME_DIR%/}
done

canonicalize_output() {
  existing=$1
  suffix=
  while [ ! -e "$existing" ] && [ ! -L "$existing" ]; do
    suffix="/${existing##*/}$suffix"
    existing=${existing%/*}
    test -n "$existing" || existing=/
  done
  test -d "$existing"
  printf '%s%s\n' "$(cd -P "$existing" && pwd)" "$suffix"
}

repository_root=$(pwd -P)
RELEASE_RUNTIME_DIR=$(canonicalize_output "$RELEASE_RUNTIME_DIR") || exit 2
case "$RELEASE_RUNTIME_DIR" in
  "$repository_root/.release-runtime") ;;
  "$repository_root"|"$repository_root/"*) exit 2 ;;
esac
test ! -e "$RELEASE_RUNTIME_DIR/venv"

uv_version=$(uv --version)
case "$uv_version" in "uv 0.11.16"*) ;; *) echo "uv 0.11.16 is required" >&2; exit 2 ;; esac

mkdir -p "$RELEASE_RUNTIME_DIR"

hash_lock() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$RELEASE_RUNTIME_DIR/requirements.lock" | awk '{print $1}'
  else
    shasum -a 256 "$RELEASE_RUNTIME_DIR/requirements.lock" | awk '{print $1}'
  fi
}

if [ -e "$RELEASE_RUNTIME_DIR/requirements.lock" ] || [ -L "$RELEASE_RUNTIME_DIR/requirements.lock" ]; then
  test -f "$RELEASE_RUNTIME_DIR/requirements.lock"
  test ! -L "$RELEASE_RUNTIME_DIR/requirements.lock"
  test -f "$RELEASE_RUNTIME_DIR/runtime.sha256"
  test ! -L "$RELEASE_RUNTIME_DIR/runtime.sha256"
  test "$(hash_lock)" = "$(cat "$RELEASE_RUNTIME_DIR/runtime.sha256")"
else
  test ! -e "$RELEASE_RUNTIME_DIR/runtime.sha256"
  test ! -L "$RELEASE_RUNTIME_DIR/runtime.sha256"
  uv pip compile Python/requirements.txt --python-version 3.12 --generate-hashes --no-header \
    --output-file "$RELEASE_RUNTIME_DIR/requirements.lock"
  hash_lock > "$RELEASE_RUNTIME_DIR/runtime.sha256"
fi

uv venv --python 3.12 "$RELEASE_RUNTIME_DIR/venv"
uv pip sync --python "$RELEASE_RUNTIME_DIR/venv/bin/python" --require-hashes \
  "$RELEASE_RUNTIME_DIR/requirements.lock"

PYTHONDONTWRITEBYTECODE=1 "$RELEASE_RUNTIME_DIR/venv/bin/python" -B -c \
  'import fastapi, uvicorn, bcrypt, itsdangerous, psycopg, psycopg2'

{
  printf 'uv=%s\n' "$uv_version"
  printf 'python=%s\n' "$("$RELEASE_RUNTIME_DIR/venv/bin/python" --version)"
  printf 'requirements_sha256=%s\n' "$(cat "$RELEASE_RUNTIME_DIR/runtime.sha256")"
} > "$RELEASE_RUNTIME_DIR/build-record.txt"
