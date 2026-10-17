# ProctorOverlay

AI-powered interview integrity and proctoring platform.

## Monorepo Structure

```
apps/candidate   — Electron desktop overlay (candidate)
apps/dashboard   — React web dashboard (proctor)
apps/server      — Fastify backend + WebSockets
packages/shared  — Shared TypeScript types and schemas
packages/config  — Shared tooling config
```

## Quick Start

### Prerequisites
- Node.js ≥ 20
- pnpm ≥ 9
- Docker (for Postgres, Redis, MinIO)

### 1. Environment
```bash
cp .env.example .env
# Edit .env with your values
```

### 2. Start infrastructure
```bash
docker-compose up -d
```

### 3. Install dependencies
```bash
pnpm install
```

### 4. Run all apps in dev mode
```bash
# Server
pnpm --filter @proctoroverlay/server dev

# Dashboard (new terminal)
pnpm --filter @proctoroverlay/dashboard dev

# Candidate Electron app (new terminal)
pnpm --filter @proctoroverlay/candidate dev
```

## Run proctor and candidate on separate devices (LAN)

The backend and dashboard can run on one always-on computer; the candidate
receiver runs on the candidate's computer. Find the host computer's private
LAN IPv4 address (for example, `192.168.1.10`) and use that same address below.

1. Copy `.env.example` to `.env` on the host computer. Set `HOST=0.0.0.0`,
   then replace `192.168.1.10` in `CORS_ORIGINS`, `VITE_BACKEND_URL`, and
   `VITE_WS_URL` with the host's actual LAN address.
2. Start the database services and backend on the host:
   `docker compose up -d postgres redis minio`, then
   `pnpm --filter @proctoroverlay/server dev`.
3. Start the dashboard on the host with
   `pnpm --filter @proctoroverlay/dashboard dev`. On the proctor device open
   `http://<host-LAN-IP>:5173`.
4. Start the receiver on the candidate device. On its join screen, enter
   `http://<host-LAN-IP>:4000` in **Proctor server**. The receiver remembers
   that address. Allow ports 4000 and 5173 through the host computer's
   private-network firewall.

This LAN setup is for the same trusted network. A public deployable link needs
a hosted backend, database, HTTPS domain, and the candidate receiver configured
to use that HTTPS backend URL. No hosting provider or Git remote is configured
in this workspace yet. Do not expose the development HTTP server directly to
the public internet.

## Phase Status

| Phase | Description | Status |
|---|---|---|
| 1 | Architecture & scope | ✅ Complete |
| 2 | Monorepo + candidate app + pre-check UI | ✅ Complete |
| 3 | Eye tracking (MediaPipe) | ⬜ Pending |
| 4 | Process/environment monitoring | ⬜ Pending |
| 5 | Backend + database + WebSockets | ⬜ Pending |
| 6 | Audio + speaker detection | ⬜ Pending |
| 7 | Proctor dashboard live | ⬜ Pending |
| 8 | Risk engine + reports | ⬜ Pending |
| 9 | Testing | ⬜ Pending |

See [SOURCE.md](./SOURCE.md) for detailed task tracking.

## Architecture

```
Candidate App (Electron)
  ├── Main process: window management, IPC, process monitor
  ├── Preload: typed IPC bridge (no raw ipcRenderer in renderer)
  └── Renderer: React screens (Consent → Login → PreCheck → Overlay)

Backend (Fastify)
  ├── REST: auth, sessions, events, reports
  ├── Socket.IO: real-time event delivery
  ├── Prisma: PostgreSQL ORM
  └── MinIO: evidence clip storage

Proctor Dashboard (React + Tailwind)
  ├── Session management
  ├── Live monitoring feed (Socket.IO)
  └── Event review and reports
```

## Security Notes
- Meeting URLs are resolved server-side. The candidate renderer never sees them.
- `contextIsolation: true`, `nodeIntegration: false` in all renderer windows.
- All secrets via environment variables only. See `.env.example`.
- Candidate consent is required and timestamped before monitoring begins.
