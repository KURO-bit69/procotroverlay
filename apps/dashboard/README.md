# Dashboard — ProctorOverlay

Proctor web dashboard.

## Stack
- React 18 + TypeScript + Vite
- Tailwind CSS
- Socket.IO client (Phase 7)
- React Query + Zustand (Phase 7)

## Dev

```bash
pnpm --filter @proctoroverlay/dashboard dev
# Opens at http://localhost:5173
```

## Build

```bash
pnpm --filter @proctoroverlay/dashboard build
```

## Pages

| Route | Description |
|---|---|
| /login | Proctor login (stub — Phase 5) |
| /dashboard | Session overview (demo data — Phase 7) |

> [DEMO MODE] Live data and real auth are wired in Phases 5 and 7.
