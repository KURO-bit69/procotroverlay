// ============================================================
// ProctorOverlay — Cheating Scenario Simulations
// Tests against real-world cheating patterns:
//   1. Second monitor with notes
//   2. Phone on desk (detection limits)
//   3. Someone whispering answers
//   4. ChatGPT in another window
//   5. Virtual camera (OBS)
//   6. Multiple people in room
//   7. Network drop to avoid detection
//   8. Screen share stopped to browse
// ============================================================

const BASE = 'http://localhost:4000';
const RND = Math.random().toString(36).slice(2, 8);

async function api(p, opts = {}) {
  const headers = {};
  if (opts.body) headers['Content-Type'] = 'application/json';
  if (opts.headers) Object.assign(headers, opts.headers);
  const res = await fetch(BASE + p, { method: opts.method || 'GET', headers, body: opts.body });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function setupSession() {
  const { body: l } = await api('/auth/login', {
    method: 'POST', body: JSON.stringify({ email: 'proctor@example.com', password: 'proctor123' }),
  });
  const auth = { Authorization: 'Bearer ' + l.token };
  const email = `scenario-${RND}@test.com`;
  const { body: s } = await api('/sessions', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ candidateEmail: email, meetingUrl: 'https://meet.google.com/scenario' }),
  });
  const { body: j } = await api('/sessions/join', {
    method: 'POST', body: JSON.stringify({ code: s.joinCode, email }),
  });
  // Activate session
  await api(`/sessions/${s.sessionId}/status`, {
    method: 'PATCH', headers: { Authorization: 'Bearer ' + j.token },
    body: JSON.stringify({ status: 'ACTIVE' }),
  });
  return {
    sessionId: s.sessionId,
    proctorAuth: auth,
    candidateAuth: { Authorization: 'Bearer ' + j.token },
  };
}

async function ingestEvents(sessionId, candAuth, events) {
  const { body } = await api(`/sessions/${sessionId}/events`, {
    method: 'POST', headers: candAuth,
    body: JSON.stringify({ events }),
  });
  return body;
}

function makeEvent(type, severity, meta = {}, confidence) {
  return {
    eventId: `${type}-${RND}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    type, severity,
    timestamp: new Date().toISOString(),
    source: 'CANDIDATE_APP',
    metadata: meta,
    ...(confidence !== undefined ? { confidence } : {}),
  };
}

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ FAIL: ${name}`); }
}

async function main() {
  console.log('══════════════════════════════════════════');
  console.log('  CHEATING SCENARIO SIMULATIONS');
  console.log('══════════════════════════════════════════\n');

  const { sessionId, proctorAuth, candidateAuth } = await setupSession();
  console.log(`Session: ${sessionId}\n`);

  // ── SCENARIO 1: Second Monitor ────────────────────────────
  console.log('SCENARIO 1: Second monitor with notes/answers');
  console.log('  Candidate has a second monitor showing answers.');
  console.log('  Detection: MULTIPLE_MONITORS_DETECTED + GAZE_REPEATED_DIRECTION\n');

  const s1 = await ingestEvents(sessionId, candidateAuth, [
    makeEvent('MULTIPLE_MONITORS_DETECTED', 'WARNING', {
      monitorCount: 2, primary: 'DELL U2722D', secondary: 'Generic PnP Monitor',
    }),
    makeEvent('GAZE_REPEATED_DIRECTION', 'WARNING', {
      direction: 'RIGHT', count: 7, windowSeconds: 30,
    }, 0.82),
    makeEvent('GAZE_REPEATED_DIRECTION', 'WARNING', {
      direction: 'RIGHT', count: 5, windowSeconds: 30,
    }, 0.78),
    makeEvent('GAZE_OFF_SCREEN', 'WARNING', {
      direction: 'RIGHT', durationSeconds: 4.2,
    }, 0.75),
  ]);
  assert(s1.accepted === 4, 'All 4 events accepted');

  // Check risk score increased
  const { body: d1 } = await api(`/sessions/${sessionId}`, { headers: proctorAuth });
  assert(d1.riskScore >= 30, `Risk score >= 30 (got ${d1.riskScore})`);
  console.log(`  Risk after scenario 1: ${d1.riskScore}\n`);

  // ── SCENARIO 2: Phone on desk ─────────────────────────────
  console.log('SCENARIO 2: Phone on desk');
  console.log('  ⚠️ LIMITATION: System CANNOT detect a phone on desk.');
  console.log('  Can only detect: gaze down, second face if phone has video call.\n');

  const s2 = await ingestEvents(sessionId, candidateAuth, [
    makeEvent('GAZE_OFF_SCREEN', 'WARNING', {
      direction: 'DOWN', durationSeconds: 3.5,
      note: 'HONEST_LIMIT: Could be looking at phone, keyboard, or notes. Cannot distinguish.',
    }, 0.65),
  ]);
  assert(s2.accepted === 1, 'Gaze-down event accepted');
  console.log('  📝 Documented: phone detection is a known limitation\n');

  // ── SCENARIO 3: Someone whispering answers ────────────────
  console.log('SCENARIO 3: Someone whispering answers');
  console.log('  Helper whispers from off-camera.');
  console.log('  Detection: SPEAKER_SECOND_VOICE_DETECTED (if above VAD threshold)\n');

  const s3 = await ingestEvents(sessionId, candidateAuth, [
    makeEvent('SPEAKER_SECOND_VOICE_DETECTED', 'CRITICAL', {
      speakerCount: 2, enrolledSpeakerMatch: true,
      note: 'MOCK: Real detection requires Altheia API. Whispers below VAD threshold will be missed.',
    }, 0.45),
    makeEvent('GAZE_MULTIPLE_FACES', 'WARNING', {
      faceCount: 2,
      note: 'Second face briefly visible at edge of frame',
    }, 0.60),
  ]);
  assert(s3.accepted === 2, 'Both voice + face events accepted');

  const { body: d3 } = await api(`/sessions/${sessionId}`, { headers: proctorAuth });
  console.log(`  Risk after scenario 3: ${d3.riskScore}`);
  assert(d3.riskScore >= 70, `Risk score >= 70 after second voice (got ${d3.riskScore})`);
  console.log('  📝 Documented: whispers below VAD threshold are undetectable\n');

  // ── SCENARIO 4: ChatGPT in another window ─────────────────
  console.log('SCENARIO 4: ChatGPT in another window');
  console.log('  Candidate switches to browser with ChatGPT.\n');

  const s4 = await ingestEvents(sessionId, candidateAuth, [
    makeEvent('APP_FOCUS_LOST', 'WARNING', {
      lostTo: 'chrome.exe', windowTitle: 'ChatGPT — Google Chrome',
    }),
    makeEvent('BLOCKLISTED_APP_DETECTED', 'CRITICAL', {
      processName: 'ChatGPT', windowTitle: 'ChatGPT — Google Chrome',
      matched: 'ChatGPT',
    }),
    makeEvent('APP_FOCUS_REGAINED', 'INFO', {
      durationLostMs: 12400,
    }),
  ]);
  assert(s4.accepted === 3, 'All 3 app events accepted');

  const { body: d4 } = await api(`/sessions/${sessionId}`, { headers: proctorAuth });
  console.log(`  Risk after scenario 4: ${d4.riskScore}`);
  assert(d4.riskScore >= 90, `Risk score >= 90 after blocklisted app (got ${d4.riskScore})`);
  console.log('  📝 Note: web-based ChatGPT only detected via window title matching\n');

  // ── SCENARIO 5: Virtual camera (OBS) ──────────────────────
  console.log('SCENARIO 5: Virtual camera feed (OBS Virtual Camera)');
  console.log('  Candidate uses OBS to replace camera feed.\n');

  const s5 = await ingestEvents(sessionId, candidateAuth, [
    makeEvent('VIRTUAL_CAMERA_DETECTED', 'WARNING', {
      deviceName: 'OBS Virtual Camera',
      deviceId: 'obs-virtual-cam-001',
    }),
  ]);
  assert(s5.accepted === 1, 'Virtual camera event accepted');
  console.log('  📝 Detection is device-name heuristic — sophisticated fakes may bypass\n');

  // ── SCENARIO 6: Multiple people in room ───────────────────
  console.log('SCENARIO 6: Multiple people visible in camera');
  console.log('  3 faces detected — someone coaching from behind.\n');

  const s6 = await ingestEvents(sessionId, candidateAuth, [
    makeEvent('GAZE_MULTIPLE_FACES', 'CRITICAL', {
      faceCount: 3,
      note: 'Persistent: 3 faces visible for >10 seconds',
    }, 0.92),
    makeEvent('GAZE_HEAD_TURNED', 'WARNING', {
      direction: 'BEHIND', yawDegrees: 45, durationSeconds: 3.2,
    }, 0.88),
  ]);
  assert(s6.accepted === 2, 'Face + head turn events accepted');
  console.log('  📝 Cannot determine identity or intent of additional faces\n');

  // ── SCENARIO 7: Network drop to avoid detection ───────────
  console.log('SCENARIO 7: Deliberate network disconnect');
  console.log('  Candidate disconnects WiFi during suspicious activity.\n');

  const s7 = await ingestEvents(sessionId, candidateAuth, [
    makeEvent('CANDIDATE_NETWORK_DROPPED', 'CRITICAL', {
      disconnectedAtMs: Date.now() - 35000,
      reconnectedAtMs: Date.now(),
      durationMs: 35000,
      eventsBufferedDuringDrop: 4,
    }),
  ]);
  assert(s7.accepted === 1, 'Network drop event accepted');
  console.log('  📝 Events are buffered locally and synced on reconnect\n');

  // ── SCENARIO 8: Screen share stopped ──────────────────────
  console.log('SCENARIO 8: Screen share stopped to browse privately');
  const s8 = await ingestEvents(sessionId, candidateAuth, [
    makeEvent('SCREEN_SHARE_STOPPED', 'CRITICAL', {
      stoppedAt: new Date().toISOString(),
      reason: 'user_cancelled',
    }),
  ]);
  assert(s8.accepted === 1, 'Screen share stop event accepted');

  // ── VERIFY FINAL STATE ────────────────────────────────────
  console.log('\n── FINAL STATE ──');
  const { body: report } = await api(`/sessions/${sessionId}/report`, { headers: proctorAuth });
  console.log(`  Total events: ${report.totalEvents}`);
  console.log(`  Risk score: ${report.riskScore}`);
  console.log(`  Events by type:`);
  for (const [type, count] of Object.entries(report.eventsByType)) {
    console.log(`    ${type}: ${count}`);
  }

  assert(report.totalEvents >= 15, `Total events >= 15 (got ${report.totalEvents})`);
  assert(report.riskScore >= 100, `Final risk >= 100 (got ${report.riskScore})`);

  // Verify event types are all present
  const expectedTypes = [
    'MULTIPLE_MONITORS_DETECTED', 'GAZE_REPEATED_DIRECTION', 'GAZE_OFF_SCREEN',
    'SPEAKER_SECOND_VOICE_DETECTED', 'GAZE_MULTIPLE_FACES', 'APP_FOCUS_LOST',
    'BLOCKLISTED_APP_DETECTED', 'VIRTUAL_CAMERA_DETECTED', 'GAZE_HEAD_TURNED',
    'CANDIDATE_NETWORK_DROPPED', 'SCREEN_SHARE_STOPPED',
  ];
  for (const t of expectedTypes) {
    assert(report.eventsByType[t] >= 1, `Event type ${t} present`);
  }

  // ── VERIFY PROCTOR REVIEW ─────────────────────────────────
  console.log('\n── PROCTOR REVIEW FLOW ──');
  const { body: events } = await api(`/sessions/${sessionId}/events?limit=500`, { headers: proctorAuth });
  const critical = events.filter(e => e.severity === 'CRITICAL');
  console.log(`  Critical events: ${critical.length}`);
  assert(critical.length >= 4, `At least 4 critical events (got ${critical.length})`);

  // Proctor reviews 2 events
  if (critical.length >= 2) {
    await api(`/sessions/${sessionId}/events/${critical[0].eventId}/review`, {
      method: 'PATCH', headers: proctorAuth,
      body: JSON.stringify({ reviewStatus: 'FLAGGED', proctorNote: 'Confirmed — second voice clearly audible' }),
    });
    await api(`/sessions/${sessionId}/events/${critical[1].eventId}/review`, {
      method: 'PATCH', headers: proctorAuth,
      body: JSON.stringify({ reviewStatus: 'ACKNOWLEDGED', proctorNote: 'Noted — will discuss in debrief' }),
    });
    console.log('  ✅ Proctor reviewed 2 critical events');
  }

  // Proctor ends session
  await api(`/sessions/${sessionId}/status`, {
    method: 'PATCH', headers: proctorAuth,
    body: JSON.stringify({ status: 'FORCE_ENDED' }),
  });
  console.log('  ✅ Session force-ended by proctor');

  // Final report
  const { body: finalReport } = await api(`/sessions/${sessionId}/report`, { headers: proctorAuth });
  assert(finalReport.status === 'FORCE_ENDED', 'Session status is FORCE_ENDED');
  assert(finalReport.durationMs !== null, 'Duration recorded');

  console.log(`\n  Final report: risk=${finalReport.riskScore}, events=${finalReport.totalEvents}, flagged=${finalReport.flaggedEvents}`);
  console.log(`  Duration: ${finalReport.durationMs}ms`);

  console.log('\n══════════════════════════════════════════');
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════');

  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
