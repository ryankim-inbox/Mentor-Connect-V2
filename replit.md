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

The gateway exposes the approved full classroom REST contract under `/api`,
including auth, profiles, districts, requests, matching, chat, DM, practice,
analysis, analytics, reports, scheduling, and health. Its literal method/path
allowlist is the authority; unknown routes have no forwarding fallback.

## Deployment

Deployment is split between the root `.replit` deployment/router selection and
`artifacts/*/.replit-artifact/artifact.toml` service definitions. Replit's path router
(`router = "application"` in `.replit`) mounts each service under its `paths`
so everything shares one origin:

| Service | Path | Port | Production |
|---|---|---|---|
| `peerbridge` | `/` | 21288 | `serve = "static"` from `artifacts/peerbridge/dist/public`, with explicit SPA-route rewrites |
| `api-gateway` | `/api`, `/livez`, `/readyz`, `/ws` | 8080 | TypeScript API Shield, with explicit route/method allowlist |
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

The repository does not encode unverified Replit response-header or Reserved
VM settings. Until provider WebSocket routing is verified, set Autoscale
**Max machines to 1** in Publishing. Configure CSP, HSTS, Referrer-Policy, and
Permissions-Policy at an ingress that actually supports response headers; the
HTML CSP meta fallback does not prove HSTS or `frame-ancestors`. See the
[classroom release runbook](docs/runbooks/classroom-release.md) for the exact
header values, external boundary checks, release record, and rollback.

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm test:gateway` — API Shield allowlist, private-upstream, normalization, and quarantine regression tests
- `pnpm verify:release` — ordered local/CI classroom release gate
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `cd Python && python main.py` — run the FastAPI backend for **development** (port 8000; enables autoreload — see `Python/README.md`). Production does not use this entrypoint; see [Deployment](#deployment).

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
