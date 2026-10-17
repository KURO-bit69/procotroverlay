# Server — ProctorOverlay

Fastify backend with WebSocket support.

## Stack
- Fastify 4 + TypeScript
- Socket.IO (Phase 5)
- Prisma + PostgreSQL (Phase 5)
- MinIO (Phase 5)
- Redis + BullMQ (Phase 5)

## Dev

```bash
# From repo root:
cp .env.example .env   # fill in values
docker-compose up -d    # start Postgres, Redis, MinIO
pnpm --filter @proctoroverlay/server dev
```

Server starts on `http://localhost:4000`.

## Endpoints (Phase 2 stubs)

| Method | Path | Description |
|---|---|---|
| GET | /health | Health check |
| POST | /sessions/join | Candidate joins with code + email |
| POST | /sessions/resolve-meeting | Resolves meeting URL (server-side) |

> Phase 5 will add full auth, DB-backed sessions, and WebSocket gateway.

## Environment Variables

See root `.env.example` for all required variables.
