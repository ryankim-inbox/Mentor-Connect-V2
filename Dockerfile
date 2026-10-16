# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS javascript
WORKDIR /build
RUN npm install --global pnpm@10.33.0
COPY . .
ARG RELEASE_SHA
ARG RENDER_GIT_COMMIT
RUN pnpm install --frozen-lockfile \
    && RELEASE_SHA="${RELEASE_SHA:-$RENDER_GIT_COMMIT}" pnpm build:release \
    && pnpm --filter @workspace/api-gateway deploy --prod --legacy /runtime/gateway

FROM python:3.12-slim-bookworm AS python-deps
COPY --from=ghcr.io/astral-sh/uv:0.11.16 /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project --no-cache \
    && .venv/bin/python -c 'import fastapi, uvicorn, bcrypt, itsdangerous, psycopg, psycopg2'

FROM python:3.12-slim-bookworm AS runtime
WORKDIR /app
COPY --from=javascript /usr/local/bin/node /usr/local/bin/node
COPY --from=python-deps /app/.venv /app/.venv
COPY --from=javascript /runtime/gateway /app/artifacts/api-gateway
COPY --from=javascript /build/artifacts/peerbridge/dist/public /app/artifacts/peerbridge/dist/public
COPY Python /app/Python
COPY ops/run-service.py /app/ops/run-service.py
ENV NODE_ENV=production PORT=10000 PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    PATH="/app/.venv/bin:$PATH" NODE_OPTIONS=--max-old-space-size=192
RUN useradd --uid 10001 --no-create-home app
USER app
EXPOSE 10000
STOPSIGNAL SIGTERM
CMD ["python", "ops/run-service.py"]
