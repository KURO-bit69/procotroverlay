# Candidate App — ProctorOverlay

Desktop overlay application for interview candidates (receivers).

## Stack
- Electron 32 + electron-vite
- React 18 + TypeScript
- CSS Modules (no CSS framework — clean, customisable)

## Dev

```bash
pnpm dev
```

This starts Electron in dev mode with hot-reload.

## Build

```bash
pnpm build
```

## Screens

| Screen | Route | Description |
|---|---|---|
| ConsentScreen | (initial) | Scrollable consent — must read all and check box |
| LoginScreen | after consent | Session code entry (6-char) + email |
| PreCheckScreen | after login | 4-card grid: eye, camera, mic, recording status |
| OverlayScreen | `#overlay` | Slim always-on-top transparent status bar |
| CompletedScreen | after session | Shown when meeting closes |

## Pre-check Gate

The following checks must be satisfied before Join Meet activates:
- ✅ Camera permission granted + live preview
- ✅ Microphone permission granted + level meter shows signal
- Google Meet screen presentation is started by the candidate after joining: click **Present now → Your entire screen → Share** in Meet.
- ✅ Session code validated by server
- ✅ Consent given

## Security

- Meeting URL resolved server-side via IPC — never shown in renderer
- `contextIsolation: true`, `nodeIntegration: false`
- Typed preload bridge — only `window.electronAPI` methods available
- No raw `ipcRenderer` in renderer code

## Environment

Set via the root `.env`. The candidate app reads:
- `VITE_BACKEND_URL` — backend HTTP URL
- `VITE_WS_URL` — WebSocket URL
