# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: FastAPI (Python 3.12) — replaces original Express 5 backend
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

**API routes (all under /api):**
- Auth: `/auth/register`, `/auth/login`, `/auth/logout`, `/auth/me`
- Users: `/users/:id` (GET, PATCH)
- Districts: `/districts` (GET), `/districts/:id` (GET)
- Requests: `/requests` (GET, POST), `/requests/:id` (GET, PATCH, DELETE), `/requests/:id/match` (POST)
- Tags: `/tags` (GET)
- Reports: `/reports` (POST)
- Blocks: `/blocks` (GET, POST, DELETE)
- Stats: `/stats/overview` (GET), `/stats/district/:id` (GET)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
