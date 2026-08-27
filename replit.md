# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: FastAPI (Python 3.12+) — replaces original Express 5 backend; main backend lives in the repo-root `Python/` folder (`artifacts/api-server/python/` is legacy)
- **Python packages**: fastapi, uvicorn, psycopg2-binary, bcrypt, itsdangerous, starlette
- **Database**: PostgreSQL (accessed via psycopg2 raw SQL in Python)
- **Validation**: Pydantic v2 (Python backend), Zod (frontend type safety)
- **API codegen**: Orval (from OpenAPI spec) — generates React Query hooks
- **Frontend**: React + Vite (artifacts/peerbridge)
- **Auth**: Session-based with starlette SessionMiddleware + bcrypt
- **Password hashing**: bcrypt (Python)

## Artifacts

### PeerBridge — Student Mentorship Platform (artifacts/peerbridge)

A full-stack app for California high school students to connect as mentors and mentees.

**Key features:**
- Registration requires a `.edu` school email (validated on both frontend and backend)
- Students choose their role: mentor, mentee, or both
- School district channels (79 seeded CA districts, organized by type: high school, unified, etc.)
- Mentorship requests with tag-based categorization (20 subject tags)
- Report/block functionality for community safety
- Session-based authentication

**Frontend pages:**
- `/` — Landing page
- `/login`, `/register` — Auth pages
- `/dashboard` — Post-login overview with stats
- `/districts` — Browse/search all districts with filters
- `/districts/:id` — District channel with requests and stats
- `/requests` — Browse all open requests (filter by tag/role)
- `/requests/new` — Post a new mentorship request
- `/requests/:id` — Request detail with match/report actions
- `/profile/:id` — User profiles with bio, subjects, requests
- `/settings` — Edit profile, manage blocked users

**Public API routes (gateway allowlist, all under /api):**
- Auth: `/auth/register`, `/auth/login`, `/auth/logout`, `/auth/me`
- Health: `/healthz`

The Python service still contains additional internal routes, but the API
Shield does not forward them unless they are explicitly allowlisted. In
particular, the admin and Python-report route families are quarantined at the
gateway and return a fixed external 404 for every method and encoded-path
variant. They are not public API contracts.

## Deployment

Deployment is **not** configured in `.replit`. It is defined per artifact in
`artifacts/*/.replit-artifact/artifact.toml`, and Replit's path router
(`router = "application"` in `.replit`) mounts each service under its `paths`
so everything shares one origin:

| Service | Path | Port | Production |
|---|---|---|---|
| `peerbridge` | `/` | 21288 | `serve = "static"` from `artifacts/peerbridge/dist/public`, with `/* → /index.html` rewrite |
| `api-gateway` | `/api`, `/livez`, `/ws` | 8080 | TypeScript API Shield, with explicit route/method allowlist |
| `api-server` | no public path | 8181 (loopback only) | Private `uvicorn` upstream for the API Shield |
| `mockup-sandbox` | `/__mockup` | 8081 | no `[services.production]` block — development only |

Same origin is a requirement, not a convenience: the SPA calls the API with
relative paths plus `credentials: "include"`, so a cross-origin split would
drop the session cookie.

**Environment variables come from artifact service settings**, not from your
shell. `peerbridge` gets `PORT=21288` and `BASE_PATH=/`; `api-gateway` gets
`PORT=8080` and a loopback `GATEWAY_UPSTREAM_ORIGIN`; `api-server` binds only
to `127.0.0.1:8181`. `NODE_ENV=production` remains set for the Python process,
which turns on `https_only` for the session cookie in `Python/main.py`.

Running the same commands *outside* Replit means supplying those yourself:

```
# build (no port needed; BASE_PATH defaults to "/")
pnpm --filter @workspace/peerbridge run build

# serve the built SPA and proxy /api to the local API Shield
PORT=4173 pnpm --filter @workspace/peerbridge exec vite preview
VITE_API_PROXY_TARGET=http://127.0.0.1:8080   # optional; this is the API Shield default
```

`vite dev` and `vite preview` both proxy `/api`, which is what reproduces the
deployed same-origin layout locally.

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm test:gateway` — API Shield allowlist, private-upstream, normalization, and quarantine regression tests
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `cd Python && python main.py` — run the FastAPI backend for **development** (port 8000; enables autoreload — see `Python/README.md`). Production does not use this entrypoint; see [Deployment](#deployment).

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
