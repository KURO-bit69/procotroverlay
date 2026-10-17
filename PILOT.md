# ProctorOverlay — Pilot Deployment & Threshold Tuning Guide

> **Phase 10**: Testing and rollout. Start small, measure, iterate.

## Current Validation Status (2026-10-17)

- Scenario simulation: `apps/server/tests/test-scenarios.mjs` passed 27/27 assertions against the local API. It injects fabricated event records; it does not exercise the camera, microphone, operating-system monitors, or a physical second display.
- Benign-input exercise: `apps/server/tests/test-false-positives.mjs` submitted seven fabricated benign-labeled event inputs. They added 82 risk points (11.7 average) in this run. This is risk-score exposure for injected data, **not** a detector false-positive rate.
- Coverage represented in the scripts: second monitor, phone limitation, whisper limitation, ChatGPT window, OBS virtual-camera event, glasses, low light, accent/code-switching, webcam quality, IDE focus, and short mic mute. These conditions are represented by event metadata, not reproduced with real hardware or people.
- Physical testing and the candidate pilot have not been run. Do not treat these simulations as evidence that the detectors reliably identify cheating or as a deployment readiness sign-off.
- Recent mitigations now in code: gaze confidence gate (<0.50), VS Code/IntelliJ allowance, and a 5-second track-mute grace period. Run controlled detector-level and hardware checks before recalibrating thresholds.

### Required next validation

1. Run supervised internal sessions on supported OS versions with consent, including actual second display, varied webcams/lighting/glasses, and brief/long mic mutes. Log detector outputs and the physical condition independently.
2. Use volunteers for whisper and phone scenarios; record misses as well as detections. A phone lying on a desk remains outside the current system's detection capability.
3. Test browser ChatGPT and OBS virtual-camera detection on real processes/devices, verifying both event generation and proctor display.
4. Only after internal results are reviewed, conduct a small advisory-only pilot with informed participants, accommodations, human review, and a documented stop procedure. Expand only after reviewing false positives, missed events, alert burden, and candidate feedback.

## Pilot Rollout Plan

### Stage 1: Internal Testing (Week 1-2)
- [ ] Run all automated tests (`npm run test:all`)
- [ ] 5 internal mock sessions with team members acting as candidates
- [ ] Measure false positive rate per category (see test results)
- [ ] Adjust thresholds based on internal results
- [ ] Document all false positives and their root causes

### Stage 2: Small Pilot (Week 3-4)
- [ ] Select 10-20 real candidate sessions
- [ ] Enable all monitors in **advisory mode** (proctor sees alerts but told to not act on them alone)
- [ ] Collect proctor feedback on alert accuracy
- [ ] Measure:
  - False positive rate (events flagged that proctor dismisses)
  - False negative rate (cheating proctor notices but system missed)
  - Proctor workload (too many alerts? too few?)
  - Candidate feedback on consent/accommodation experience

### Stage 3: Controlled Rollout (Week 5-8)
- [ ] Expand to 50-100 sessions
- [ ] Enable proctor actions (warn, pause, end)
- [ ] Monitor appeal rate (should be < 5% of sessions)
- [ ] Adjust risk weights based on pilot data
- [ ] A/B test threshold variations

### Stage 4: Full Deployment
- [ ] All sessions use ProctorOverlay
- [ ] Monthly false positive review
- [ ] Quarterly threshold calibration
- [ ] Ongoing bias auditing

---

## Threshold Configuration

### Current Default Thresholds

| Parameter | Default | Recommended Pilot | Notes |
|---|---|---|---|
| `gazeOffScreenThresholdSeconds` | 3s | **5s** | Reduce FP for thinking/reading |
| `gazeRepeatedDirectionCount` | 5 | **7** | Reduce FP for normal glancing |
| `micMuteThresholdSeconds` | 5s | **8s** | Ignore brief cough-mutes |
| `faceNotDetectedThresholdSeconds` | 2s | **4s** | Reduce FP for glasses/lighting |
| `headTurnYawThreshold` | 30° | **40°** | Reduce FP for reading off-screen |
| `confidenceFilterThreshold` | 0.0 | **0.50** | Ignore low-confidence events |

### Risk Weight Tuning

Current weights (from `DEFAULT_RISK_WEIGHTS`):

| Event | Default Weight | Pilot Recommendation | Rationale |
|---|---|---|---|
| SPEAKER_SECOND_VOICE_DETECTED | 30 | **20** | High FP rate in mock — interviewer audio |
| SPEAKER_VOICE_MISMATCH | 25 | **15** | FP with accent/language switching |
| BLOCKLISTED_APP_DETECTED | 20 | **20** | Keep — strong signal |
| SCREEN_SHARE_STOPPED | 15 | **15** | Keep — strong signal |
| GAZE_OFF_SCREEN | 15 | **8** | Reduce — high FP for normal behavior |
| CAMERA_COVERED | 12 | **5** | Reduce — lighting causes FP |
| APP_FOCUS_LOST | 10 | **5** | Reduce — IDE usage in coding interviews |
| MULTIPLE_MONITORS_DETECTED | 10 | **10** | Keep — strong signal |
| GAZE_MULTIPLE_FACES | 10 | **10** | Keep — strong signal |
| VIRTUAL_CAMERA_DETECTED | 8 | **8** | Keep — suspicious by nature |
| MIC_MUTED | 5 | **2** | Reduce — brief mutes are normal |

### Per-Session Overrides

Proctors can override weights when creating a session:

```json
POST /sessions
{
  "candidateEmail": "...",
  "meetingUrl": "...",
  "riskWeights": {
    "APP_FOCUS_LOST": 0,       // Coding interview — IDE switching expected
    "MIC_MUTED": 0,            // Panel interview — muting between questions
    "GAZE_OFF_SCREEN": 5       // Lower weight for this session
  }
}
```

### Accommodation-Based Overrides

When accommodations are set, the system should apply automatic overrides:

| Accommodation | Auto-Override |
|---|---|
| DISABLE_GAZE_TRACKING | Set all GAZE_* weights to 0 |
| RELAXED_GAZE_THRESHOLDS | Double gaze thresholds, halve weights |
| DISABLE_FACE_DETECTION | Set GAZE_FACE_NOT_DETECTED weight to 0 |
| EXTENDED_FOCUS_THRESHOLD | Set APP_FOCUS_LOST weight to 0 |
| DISABLE_MULTIPLE_FACE_CHECK | Set GAZE_MULTIPLE_FACES weight to 0 |
| EXTENDED_MIC_MUTE_THRESHOLD | Triple mic mute threshold, zero MIC_MUTED weight |

---

## Metrics to Track

### Key Metrics (Dashboard)
- **False Positive Rate**: `dismissed_events / total_warning_critical_events`
- **Alert Fatigue Index**: `total_events_per_session / session_duration_minutes`
- **Appeal Rate**: `appeals_submitted / completed_sessions`
- **Appeal Acceptance Rate**: `appeals_accepted / appeals_resolved`
- **Proctor Action Rate**: `(warns + pauses + ends) / completed_sessions`

### Fairness Metrics (Quarterly Audit)
- FP rate by candidate demographics (if available)
- FP rate by webcam quality tier
- FP rate by lighting conditions
- FP rate for glasses-wearing candidates
- FP rate for multilingual candidates
- Appeal outcomes by demographic

### Targets
| Metric | Target | Action if Exceeded |
|---|---|---|
| False Positive Rate | < 15% | Increase thresholds |
| Alert Fatigue (events/min) | < 2 | Increase cooldowns |
| Appeal Rate | < 5% | Review flagging criteria |
| Appeal Acceptance Rate | < 30% | FP rate is acceptable |
| Appeal Acceptance Rate | > 50% | Thresholds too aggressive |

---

## Known Detection Limits (Honest Documentation)

| Scenario | Can Detect? | Method | Limitation |
|---|---|---|---|
| Second monitor | ✅ Yes | WMI monitor enumeration | Cannot see what's on the screen |
| Phone on desk | ❌ No | — | No hardware detection possible |
| Phone held to ear | ⚠️ Partial | Head turn + gaze off | Could be scratching ear |
| Whispered answers | ⚠️ Partial | VAD + speaker diarization | Below-threshold whispers missed |
| ChatGPT (browser) | ⚠️ Partial | Window title matching | Only if title contains "ChatGPT" |
| ChatGPT (app) | ✅ Yes | Process name matching | Desktop app name in blocklist |
| Virtual camera | ✅ Yes | Device name heuristic | Sophisticated fakes bypass |
| Notes on wall | ❌ No | — | Not detectable |
| Someone in room | ⚠️ Partial | Multiple face detection | Only if visible to camera |
| Remote desktop | ✅ Yes | Process name matching | Custom RDP tools may bypass |
| Screen capture | ⚠️ Partial | Focus loss + process check | OS-level tools bypass |
| VM usage | ⚠️ Partial | WMI heuristic | Some hardware looks like VM |

---

## Test Commands

```bash
# Run all tests (from project root)
node apps/server/tests/test-e2e.mjs          # Full E2E flow (16 steps)
node apps/server/tests/test-scenarios.mjs     # 8 cheating scenarios
node apps/server/tests/test-false-positives.mjs  # False positive analysis
node test-privacy.mjs                          # 19 privacy/consent tests

# Run all at once
node apps/server/tests/test-e2e.mjs && node apps/server/tests/test-scenarios.mjs && node apps/server/tests/test-false-positives.mjs && node test-privacy.mjs
```

---

*Last updated: Phase 10 — Testing & Rollout*
