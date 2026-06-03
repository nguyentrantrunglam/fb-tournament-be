# badminton-api

NestJS backend for the badminton tournament platform. Pairs with `badminton-web` (Next.js, separate repo).

**Stack:** NestJS 11 · MongoDB (Mongoose, replica set) · express-session + Passport (local) · Socket.IO · DigitalOcean Spaces (S3) · pnpm · Node 20+.

> Architecture & decisions: see `fb-tournament-fe/docs/system-architecture.md` and the pivot mapping report. Domain logic lives in `src/domain/` (pure — no nest/mongoose imports).

## Quick start (dev)

```bash
cp .env.example .env          # adjust SESSION_SECRET, WEB_ORIGIN, Spaces/SMTP as needed
docker compose up             # mongo (replica set, auto-initiated) + api on :3001
# or run api on host against a local mongo RS:
pnpm install
pnpm start:dev
```

Smoke test: `curl http://localhost:3001/health` → `{ "ok": true, "mongo": "up", ... }`.

## Scripts

| Command | What |
|---|---|
| `pnpm start:dev` | watch mode |
| `pnpm build` | compile to `dist/` |
| `pnpm lint` | eslint --fix |
| `pnpm test` | unit (Jest) |
| `pnpm test:e2e` | e2e (supertest + in-memory replica set) |

## Layout

```
src/
├── main.ts            # session + passport + helmet + CORS(credentials) + Socket.IO adapter
├── app.module.ts      # Config + Mongoose(RS) + Throttler + global guards (deny-by-default)
├── common/            # guards, decorators (@Public/@Roles/@TournamentRoles/@CurrentUser), filter, Socket.IO session adapter
├── config/            # typed env configuration
├── domain/            # PURE business logic (no framework imports)
├── schemas/           # Mongoose schemas (added per phase)
└── modules/
    ├── health/        # GET /health (public)
    └── realtime/      # Socket.IO gateway (emit* helpers, room subscribe)
```

## Notes

- **Replica set is required** (transactions). Dev uses a single-node RS via docker-compose; e2e uses `mongodb-memory-server` replica set.
- **Auth** = email/password session only (no Google OAuth). `connect.sid` cookie is shared by REST and Socket.IO.
- **Prod**: Docker image behind Nginx (`nginx/nginx.conf`, api only); web stays on Vercel → cross-origin cookie `SameSite=None;Secure`.
- Secrets (`.env`) are git-ignored. Never commit `SESSION_SECRET`, Spaces, or SMTP creds.
