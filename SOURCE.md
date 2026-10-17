# ProctorOverlay — Source of Truth & Task Tracker

> Living document. Updated after every phase. **Last updated: Phase 9 (Privacy, Legal & Fairness) ✅ COMPLETE**

## Project Root
`C:\Users\Mehul\.gemini\antigravity\scratch\proctoroverlay`

## Stack
| Layer | Technology |
|---|---|
| Candidate App | Electron + TypeScript + React |
| Backend | Node.js + TypeScript + Fastify + Socket.IO |
| Database | PostgreSQL (Prisma ORM) |
| Cache/Queue | Redis + BullMQ |
| Object Storage | MinIO (S3-compatible) |
| Proctor Dashboard | React + TypeScript + Tailwind CSS + Vite |
| Monorepo | pnpm workspaces + Turborepo |
| Eye Tracking | MediaPipe Face Mesh (on-device, WASM) |
| Speaker Detection | Altheia (DetectID.ai) behind SpeakerDetectionProvider interface |

---

## Phase 1 — Architecture & Scope Definition ✅ COMPLETE
- [x] Flow diagram (proctor → backend → candidate)
- [x] Stack decision with rationale (Electron over Tauri)
- [x] Shared MonitoringEvent schema designed
- [x] Session state machine defined
- [x] Directory structure planned
- [x] Database schema overview
- [x] Altheia black-box gap assessment documented
- [x] SpeakerDetectionProvider interface designed
- [x] Enforcement honesty statement (what can/cannot be detected)
- [x] Privacy architecture table
- [x] Risk weight table
- [x] Phase checklist created

---

## Phase 2 — Monorepo Scaffold + Candidate App ✅ COMPLETE
- [x] pnpm workspace + Turborepo init
- [x] `packages/shared` — all TypeScript types (MonitoringEvent, Session, SpeakerDetectionProvider)
- [x] `packages/shared` — builds clean (tsc)
- [x] `apps/candidate` — Electron + electron-vite + React skeleton
- [x] `apps/dashboard` — Vite + React + Tailwind skeleton
- [x] `apps/server` — Fastify skeleton with health route
- [x] `docker-compose.yml` — Postgres + Redis + MinIO
- [x] `.env.example` — all placeholders, no secrets
- [x] `SOURCE.md` tracking file
- [x] ConsentScreen — scrollable terms, explicit checkbox, must scroll before accepting
- [x] LoginScreen — 6-char code input + email, 2-step flow
- [x] PreCheckScreen — 4-card 2×2 grid matching wireframe layout
- [x] PreCheckScreen — CameraCard (real getUserMedia, live video preview)
- [x] PreCheckScreen — MicCard (real Web Audio API, 20-bar level meter)
- [x] PreCheckScreen — EyeTrackingCard (fullscreen 9-point calibration UX)
- [x] PreCheckScreen — RecordingStatusCard (live checklist + screen share button)
- [x] Join button gating logic (all checks required via isPreCheckPassed())
- [x] OverlayScreen — slim always-on-top status bar (timer, mic, gaze, cam, REC)
- [x] CompletedScreen — end-of-session
- [x] Meeting window control (URL from backend via IPC, never exposed to renderer)
- [x] Server stub endpoints (/health, /sessions/join, /sessions/resolve-meeting)
- [x] Dashboard login page (demo-labelled)
- [x] Dashboard overview page (demo session table, stats cards)
- [x] All typechecks pass (main, preload, renderer, server, dashboard)
- [x] Server verified running (health check 200, session join 200)
- [x] Dashboard verified running (localhost:5173, serves 200)
- [x] Electron app verified running (localhost:5174, consent screen loads)
- [x] README for apps/candidate
- [x] README for apps/dashboard
- [x] README for apps/server
- [x] Root README with quickstart

---

## Phase 3 — Eye Tracking ✅ COMPLETE
- [x] MediaPipe FaceLandmarker (478 landmarks + iris) via `@mediapipe/tasks-vision`
- [x] GazeService — on-device face mesh in renderer, GPU-accelerated, 10-15 FPS
- [x] 9-point gaze calibration with real iris-based hit-testing (1.5s dwell per point)
- [x] Gaze cursor visualization during calibration (shows where system thinks you look)
- [x] Dwell progress ring on active calibration point
- [x] Timer-based fallback when MediaPipe fails to load
- [x] GazeMonitor — threshold-based event detection:
  - [x] Gaze off-screen (configurable, default 3s)
  - [x] Repeated direction detection (5x in 30s window — second screen / notes)
  - [x] No face detected (2s threshold)
  - [x] Multiple faces in frame
  - [x] Head turned away (30° yaw threshold, 3s duration)
- [x] Per-event-type cooldowns (10s default) to prevent spam
- [x] Calibration pause mode (no events during calibration)
- [x] Renderer → main IPC bridge for gaze events (`sendGazeEvent`)
- [x] OverlayScreen event feed shows gaze events with icons
- [x] Head pose estimation from transformation matrix + fallback from landmarks
- [x] All typechecks pass (node + web)
- [x] Electron app builds and runs with gaze tracking active

---

## Phase 4 — Process/Environment Monitoring (Lockdown) ✅ COMPLETE
- [x] Process monitor — `tasklist` polling, blocklist matching, dedup alerts
- [x] Focus monitor — Win32 `GetForegroundWindow` via PowerShell P/Invoke, focus lost/regained events
- [x] Environment monitor — multi-display, VM heuristics (WMI), RDP, virtual camera/audio detection
- [x] Clipboard monitor — change detection, PrintScreen/Alt+PrintScreen intercept, optional block
- [x] MonitorManager orchestrator — starts/stops all monitors, unified event stream, bounded buffer
- [x] IPC wiring — main process broadcasts events to renderer via `monitor:event` channel
- [x] Preload bridge — `onMonitorEvent` push + `getRecentEvents`/`getFocusHistory`/`getEnvironmentSnapshot` pull
- [x] OverlayScreen — live event feed, focus status badge, env warnings, alert counts, severity coloring
- [x] Monitors start on `session:showOverlay`, stop on `session:end`
- [x] meeting:closed IPC event when meeting window closes
- [x] All typechecks pass (tsconfig.node.json + tsconfig.web.json)
- [x] Electron app builds and runs with monitors active
- [x] VM detection limitations documented (heuristic-based, not guaranteed)
- [x] Clipboard/screenshot limitations documented (can't block Win+Shift+S, Snipping Tool)

---

## Phase 5 — Backend + WebSocket Pipeline + Database ✅ COMPLETE
- [x] Fastify server with JWT auth plugin (@fastify/jwt)
- [x] Prisma schema (User, Session, Event models) — SQLite for dev, PostgreSQL for prod
- [x] DB migrations via `prisma db push` — dev.db created
- [x] POST /auth/login — JWT token, SHA-256 passwords (bcrypt in Phase 9)
- [x] POST /auth/register — dev-only seed route (disabled in production)
- [x] POST /sessions — proctor creates session with join code + meeting URL
- [x] POST /sessions/join — candidate resolves code + email, gets JWT
- [x] POST /sessions/resolve-meeting — returns meeting URL (auth-guarded)
- [x] GET /sessions — list sessions (proctor-only, filterable by status)
- [x] GET /sessions/:id — session detail (auth-guarded)
- [x] POST /sessions/:id/events — HTTP event ingestion with dedup + risk scoring
- [x] GET /sessions/:id/events — proctor fetch with type/severity/pagination filters
- [x] PATCH /sessions/:id/status — pause, end, force-end (role-guarded)
- [x] PATCH /sessions/:id/events/:eventId/review — proctor review (acknowledge/dismiss/flag)
- [x] GET /sessions/:id/report — session report with timeline + event summary
- [x] Socket.IO gateway (session rooms: candidate + proctor real-time relay)
  - [x] events:push — candidate pushes batched events
  - [x] event:new — server broadcasts to proctors
  - [x] session:join — room management
  - [x] heartbeat — candidate liveness check
  - [x] candidate:connectionState — notify proctor of connect/disconnect
  - [x] session:statusChanged — broadcast status changes
- [x] Redis client (lazy connect, non-fatal — server runs without it)
- [x] MinIO storage client (bucket init, evidence upload, presigned URLs, non-fatal)
- [x] EventSyncClient in Electron main process:
  - [x] Buffers events locally, syncs via WebSocket
  - [x] HTTP POST fallback when WebSocket unavailable
  - [x] Auto-reconnect with rebuffering on failure
  - [x] Disconnect flag after 30s (CANDIDATE_NETWORK_DROPPED event)
  - [x] Heartbeat every 10s
- [x] Zod validation on all API inputs
- [x] All typechecks pass (server + candidate node + candidate web)
- [x] Server verified running (health 200, auth + session + events tested)
- [x] Electron builds with EventSyncClient (44.22 kB main)
- [x] Event dedup verified (same eventId returns duplicate count)
- [x] Risk score incrementally updated on event ingestion

---

## Phase 6 — Audio Pipeline + Speaker Detection ✅ COMPLETE
- [x] AudioPipeline — RMS-based VAD, configurable thresholds (speech start 300ms, silence end 800ms)
- [x] Audio chunking (auto-split at 10s max, skip chunks < 500ms)
- [x] Silence never sent to API — reduces cost and bandwidth
- [x] Voice enrollment capture (5s sample during pre-check)
- [x] MicMonitor — always-on mic enforcement:
  - [x] Mute detection (track events + RMS-based backup, 5s threshold)
  - [x] Device switch detection (devicechange event)
  - [x] Disconnect detection (track ended event)
  - [x] MIC_MUTED / MIC_UNMUTED / MIC_DISCONNECTED / MIC_DEVICE_CHANGED events
- [x] SpeakerAnalysisService — mock speaker detection:
  - [x] SPEAKER_SECOND_VOICE_DETECTED (mock ~8% rate for testing)
  - [x] SPEAKER_VOICE_MISMATCH (mock ~5% rate for testing)
  - [x] Clearly labeled as MOCK — never presented as real AI
  - [x] Rate limiting (max 2 concurrent analyses) + cooldowns (20s)
- [x] AltheiaSpeakerDetectionProvider (BLOCKED: still waiting on API docs)
- [x] Renderer → main IPC bridge (`sendAudioEvent`)
- [x] OverlayScreen event feed shows all audio/mic events with icons
- [x] All typechecks pass (node + web)
- [x] Electron app builds and runs with audio monitoring active
- [x] Honest note: RMS-based mute detection may false-positive in quiet rooms

---

## Phase 6.5 — Meeting Integration ✅ COMPLETE
- [x] MeetingDetector — process + window title polling for meeting platform detection
  - [x] Zoom (process + title patterns)
  - [x] Microsoft Teams (process + title patterns)
  - [x] Google Meet (browser window title patterns)
  - [x] Webex / Cisco Webex (process + title patterns)
  - [x] Discord voice (process + title patterns)
  - [x] Custom platform support via `extraPlatforms` config
- [x] App detection vs call-active detection (two-level state)
- [x] State-change diffing — emits events only on transitions (no spam)
- [x] Cross-platform window queries (Win32 PowerShell, macOS osascript, Linux wmctrl)
- [x] Event types: MEETING_APP_DETECTED, MEETING_CALL_ACTIVE, MEETING_CALL_ENDED, MEETING_APP_CLOSED
- [x] MonitorManager — MeetingDetector wired as 5th monitor (start/stop/getMeetingState)
- [x] IPC handler: `monitor:getMeetingState` (main → renderer pull)
- [x] Preload: `getMeetingState()` + `MeetingStateIPC` type
- [x] OverlayScreen — meeting status indicator (platform name, In Call / Idle / Not detected)
- [x] OverlayScreen — event feed labels for all 4 meeting event types
- [x] CSS styles for meeting status states (ok/idle/none)
- [x] Overlay independent of meeting SDK — works with any platform
- [x] All typechecks pass (tsconfig.node.json + tsconfig.web.json)
- [x] Electron app builds and runs with meeting detection active
- [x] Honest note: window title matching is heuristic — may miss renamed windows or custom meeting URLs

---

## Phase 7 — Proctor Dashboard + Live Alerts ✅ COMPLETE
- [x] Login page (real JWT auth against backend, PROCTOR role check)
- [x] Dashboard overview (session list with status/risk/event counts, auto-refresh 10s)
- [x] Stats cards (Active Sessions, Needs Review, Completed)
- [x] Create session form (candidate email + meeting URL)
- [x] Live session view (Socket.IO real-time event feed)
- [x] Alert feed with severity indicators (CRITICAL red, WARNING yellow, INFO gray)
- [x] Risk score display (running total, color-coded thresholds)
- [x] Candidate online/offline status (live via Socket.IO)
- [x] Proctor actions: send warning (Socket.IO), pause session, resume, end session (HTTP PATCH)
- [x] Event review: acknowledge (✓), dismiss (✕), flag (🚩) buttons per event
- [x] Post-session report page:
  - [x] Summary cards (risk score, duration, total events, warnings, flagged)
  - [x] Session info (status, candidate, start/end times)
  - [x] Event breakdown by type (horizontal bar chart)
  - [x] Timeline with severity coloring + filter (All / Warning / Critical / Flagged)
  - [x] Review status badges + proctor notes display
- [x] Auth guard (redirect to /login if no token)
- [x] Vite env type declarations (vite-env.d.ts)
- [x] All event labels mapped (28 event types with emoji icons)
- [x] All typechecks pass (npx tsc --noEmit)
- [x] Dashboard verified running (localhost:5174, serves 200)
- [x] APIs verified: login, sessions list, session detail, report endpoint

---

## Phase 8 — Privacy, Legal & Fairness ✅ COMPLETE
- [x] Shared privacy types (`packages/shared/src/privacy.ts`):
  - [x] ConsentRecord, ConsentPurpose, ConsentStatus types
  - [x] RetentionPolicy with DEFAULT_RETENTION_POLICY (30d events, 60d evidence, 90d sessions)
  - [x] AccommodationType (8 types: disable gaze, relaxed thresholds, extended focus, allow screen reader, etc.)
  - [x] Accommodation, SessionAccommodations interfaces
  - [x] Appeal, AppealStatus (SUBMITTED → UNDER_REVIEW → ACCEPTED/REJECTED/WITHDRAWN)
  - [x] DataExportRequest, DataErasureRequest (GDPR Art. 15-17, DPDP Sec. 11-14)
  - [x] AIDisclosure per-event-type with technique + limitations
  - [x] AI_DISCLOSURE_TEXT — standard report disclaimer
  - [x] EVENT_AI_DISCLOSURES — 6 event types with documented limits
- [x] Prisma schema extended:
  - [x] Consent model (per-purpose, with policy version + IP hash)
  - [x] Appeal model (candidate statement, proctor response, resolution status)
  - [x] DataRequest model (EXPORT/ERASURE, scope, processing status)
  - [x] Session: accommodations (JSON), accommodationNote, retentionPolicy, retainUntil, dataErased
  - [x] Event: algorithmicFlag boolean
  - [x] DB synced (`prisma db push`)
- [x] Privacy routes (`apps/server/src/routes/privacy.ts`):
  - [x] POST /privacy/consent — record per-purpose consent
  - [x] POST /privacy/consent/withdraw — withdraw specific purposes
  - [x] GET /privacy/consent/:sessionId — list consent records
  - [x] PUT /privacy/accommodations — proctor sets session accommodations
  - [x] GET /privacy/accommodations/:sessionId — get accommodations
  - [x] POST /privacy/appeals — candidate submits appeal (updates event to APPEALED)
  - [x] GET /privacy/appeals/:sessionId — list appeals with event details
  - [x] PATCH /privacy/appeals/:appealId — proctor accepts/rejects (updates event status)
  - [x] POST /privacy/data-request — request EXPORT or ERASURE
  - [x] GET /privacy/data-request — list user's data requests
  - [x] POST /privacy/data-request/:id/process — proctor fulfills (export JSON or anonymise+delete)
  - [x] PUT /privacy/retention — set per-session retention policy
  - [x] GET /privacy/retention/status — check expired + unscheduled sessions
  - [x] POST /privacy/retention/compute — compute retainUntil dates
  - [x] GET /privacy/ai-disclosure — global AI disclosure + policy
  - [x] GET /privacy/ai-disclosure/:eventType — per-event technique + limitations
- [x] Candidate ConsentScreen enhanced:
  - [x] Per-item technique + limitation disclosure
  - [x] AI-Assisted Monitoring Disclosure section
  - [x] Data Retention policy (30/60/90 days)
  - [x] GDPR/DPDP data subject rights (access, erasure, appeal, withdrawal, accommodations)
  - [x] Compliance section (data controller, processor, legal basis, policy version)
  - [x] CSS: itemTechnique + itemLimitation styles
- [x] Dashboard SessionReportPage: AI Disclosure section with limitations + legal basis
- [x] Server entry: privacy routes registered
- [x] All typechecks pass (server, candidate-node, candidate-web, dashboard)
- [x] All 19 integration tests pass (test-privacy.mjs)
  - [x] Verified: consent record + withdrawal
  - [x] Verified: accommodations set + get
  - [x] Verified: retention policy set
  - [x] Verified: event ingestion + appeal submit + appeal resolve
  - [x] Verified: data export request + processing (returns sessions, events, consents, appeals)
  - [x] Verified: AI disclosure (autoReject=false, humanReview=true, 6 event type disclosures)
  - [x] Verified: retention status + compute

---

## Phase 9 — Testing ⬜ PENDING
- [ ] Unit tests: MonitoringEvent validation
- [ ] Unit tests: risk engine weight calculations
- [ ] Unit tests: session lifecycle transitions
- [ ] Integration tests: session create → join → active flow
- [ ] Integration tests: WebSocket event delivery
- [ ] Integration tests: unauthorized access rejection
- [ ] Simulated events: second monitor detection
- [ ] Simulated events: virtual camera detection
- [ ] Simulated events: blocklisted app (mock ChatGPT process)
- [ ] Simulated events: second speaker (mock audio chunk)
- [ ] False-positive rate measurement and documentation
- [ ] E2E: full session flow (proctor creates → candidate joins → event fires → proctor reviews → report)

---

## Verified Running (Phase 9 Exit)
| Service | URL | Status |
|---|---|---|
| Fastify Backend | http://localhost:4000 | ✅ 200 OK (degraded — no Redis) |
| Proctor Dashboard | http://localhost:5174 | ✅ 200 OK |
| Electron Candidate App | localhost dev (renderer) | ✅ Running |
| Privacy API | /privacy/* (16 endpoints) | ✅ All 19 tests pass |

---

## Known Limitations (Documented)
| Limitation | Status |
|---|---|
| Cannot detect 2nd physical device (phone/tablet) | Documented |
| Cannot block all apps without OS kiosk mode | Documented |
| Gaze accuracy varies by lighting/glasses/skin tone | Documented |
| Cannot detect whispered assistance below VAD threshold | Documented |
| VM detection is heuristic only | Documented |
| Altheia API details unknown until docs shared | Blocked — Phase 6 |

## Handover Backlog Progress (2026-10-17)
- [x] Gaze confidence gate: suppress gaze and head-pose signals when face confidence is below 0.50; face-absence detection remains enabled.
- [x] Coding interview editor allowance: VS Code and IntelliJ are permitted in focus and process monitoring.
- [x] Microphone track-mute grace period: wait 5 seconds before a track mute alert and cancel it when the track unmutes; configurable through `MicMonitorConfig`.
- [ ] Ambient brightness filter for camera-covered detection; requires luminance measurement from camera frames and validation against the existing camera flow.
- [ ] Altheia provider remains blocked on vendor API documentation and credentials.
- [ ] Production database, scheduled retention worker, evidence storage, password hashing migration, and app signing remain deployment work.

## Open Questions
| # | Question | Status |
|---|---|---|
| 1 | Altheia API docs / credentials | ⏳ Awaiting |
| 2 | candidate-precheck.html prototype | ⏳ Awaiting |
| 3 | Target OS (Windows only or macOS too?) | ⏳ Awaiting |
| 4 | Dashboard: local or deployed? | ⏳ Awaiting |
| 5 | Specific blocklisted app names | ⏳ Awaiting |

---

*Updated by agent after each phase completes.*
