# ProctorOverlay Candidate App — Progress

## Slice 1: Project scaffold and tooling — PLAN

### Goal

Compare the existing monorepo and candidate app with the requested Electron, React, TypeScript, browser-preview, Vitest, and Playwright setup. Record only the smallest scaffold and tooling changes needed to support the later candidate-app slices.

### Acceptance criteria

- [ ] Inspect the existing workspace, candidate scripts, TypeScript/Vite configuration, and current test tooling before changing implementation files.
- [ ] Document the candidate app's folder structure and the browser-versus-Electron development entry points.
- [ ] Identify which requested tooling already exists and list only missing scaffold/configuration items for this slice.
- [ ] Add or update `AGENTS.md` with concise repo-specific workflow and safety guidance, without duplicating this task prompt.
- [ ] Ensure root and candidate scripts expose the agreed typecheck, lint, unit-test, and E2E commands; do not claim a command is available unless it runs.
- [ ] Keep Slice 1 limited to scaffold, configuration, and documentation; do not implement state, UI, media, speaker, or join-flow behavior in this slice.
- [ ] Validate Slice 1 using the agreed commands and record their actual results below.
- [ ] Re-read the Slice 1 diff and record what changed, what was learned, and the next slice before marking this slice complete.

### Assumptions and open inputs

- The repo already contains a multi-app pnpm/Turborepo scaffold and an Electron candidate application; this slice will audit and fill gaps rather than recreate them.
- No separate wireframe attachment was present with this request. The existing candidate pre-check screen and the user's earlier Receiver screenshots are the provisional layout references until a wireframe is supplied.
- Slice 1 is a planning checkpoint. No implementation code will be changed until the user has reviewed this plan.

### Run and review notes

- Pending user review of this plan.

## Detectif API integration — PLAN

### Goal

Use the supplied Detectif.ai API key through a server-side adapter, keeping the key out of the Electron renderer and identifying each result according to the API's actual capability.

### Acceptance criteria

- [x] Keep the Detectif key only in ignored local environment configuration; use a placeholder in `.env.example`.
- [x] Keep the mock provider available and label its results as mock.
- [x] Follow Detectif's bearer authentication, multipart audio upload, idempotency, response, and duration requirements.
- [x] Do not claim that Detectif reports the number of people in a recording; its documented API offers AI-generated-speech detection and enrolled-speaker verification.
- [x] Disclose any third-party audio transfer before enabling uploads, and do not send audio during setup or verification.
- [x] Map unavailable scope, invalid credentials, insufficient credits, and service errors to clear non-secret statuses.
- [x] Validate the adapter with fake HTTP responses and run relevant build and type checks without uploading candidate audio.

### API findings and decision

- The supplied key format matches Detectif's documented key format; the documented base URL is `https://platform.detectif.ai/v1`.
- AI-generated-speech detection requires a recording longer than 4 seconds and up to 120 seconds.
- Speaker verification requires an enrolled sample and a 3–60 second comparison recording; enrollment requires 15–60 seconds.
- The selected behavior is candidate voice verification against an enrolled sample.
- Neither capability returns a count of how many people are speaking; the UI and events must not present voice mismatch as proof of an extra speaker.
- Enrollment records must be deleted from Detectif when a session ends; vendor documentation says enrolled profiles persist until deleted.

### Implementation slice: voice enrollment and verification

- [x] Add an authenticated server-side Detectif provider for session-scoped enrollment, verification, health/config errors, and profile deletion.
- [x] Add authenticated session routes that accept bounded audio uploads only from that session's candidate token.
- [x] Add a clear 20-second enrollment step to the candidate mic pre-check; enrollment is required before Join.
- [x] Carry the mic stream into the hidden session controller and submit speech chunks of at least 3 seconds for identity verification.
- [x] Keep the API key on the server; never log the key or raw audio; use per-request idempotency keys.
- [x] Update consent to disclose third-party audio transfer and the vendor's voice-profile retention until deletion.
- [x] Delete the session voice profile on end/interruption and surface non-secret API failures as clear statuses.
- [ ] Run lint and existing backend scenario tests; lint currently cannot start because `eslint` is not installed in this workspace.
