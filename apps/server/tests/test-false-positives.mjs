// ============================================================
// ProctorOverlay - Synthetic Benign-Input Risk Exposure
// Posts fabricated event records through the API to measure risk-score impact.
// This does NOT exercise candidate detectors and cannot estimate a false-positive rate.
//
// Categories tested:
//   1. Normal gaze patterns (reading, thinking)
//   2. Glasses / reflections
//   3. Low-light / backlit environments
//   4. Accent / speech pattern variations
//   5. Different webcam qualities
//   6. Legitimate app usage (IDE, docs)
//   7. Normal mic events (cough, silence)
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

function makeEvent(type, severity, meta = {}, confidence) {
  return {
    eventId: `fp-${type}-${RND}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    type, severity,
    timestamp: new Date().toISOString(),
    source: 'CANDIDATE_APP',
    metadata: { ...meta, _fpTest: true },
    ...(confidence !== undefined ? { confidence } : {}),
  };
}

// Track false positive rates per category
const results = {};

function recordResult(category, scenario, isFalsePositive, riskDelta, details) {
  if (!results[category]) results[category] = [];
  results[category].push({ scenario, isFalsePositive, riskDelta, details });
}

async function main() {
  console.log('══════════════════════════════════════════════════');
  console.log('  SYNTHETIC BENIGN-INPUT RISK EXPOSURE');
  console.log('  NOTE: fabricated events are posted directly; this is not detector FP measurement.');
  console.log('══════════════════════════════════════════════════\n');

  // Setup
  const { body: l } = await api('/auth/login', {
    method: 'POST', body: JSON.stringify({ email: 'proctor@example.com', password: 'proctor123' }),
  });
  const auth = { Authorization: 'Bearer ' + l.token };
  const email = `fp-${RND}@test.com`;
  const { body: s } = await api('/sessions', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ candidateEmail: email, meetingUrl: 'https://meet.google.com/fp' }),
  });
  const { body: j } = await api('/sessions/join', {
    method: 'POST', body: JSON.stringify({ code: s.joinCode, email }),
  });
  const sid = s.sessionId;
  const ca = { Authorization: 'Bearer ' + j.token };

  await api(`/sessions/${sid}/status`, {
    method: 'PATCH', headers: ca, body: JSON.stringify({ status: 'ACTIVE' }),
  });
  console.log(`Session: ${sid}\n`);

  // ── CATEGORY 1: Normal gaze patterns ──────────────────────
  console.log('CATEGORY 1: Normal Gaze Patterns');
  console.log('  Simulating: reading question, thinking (looking up), typing\n');

  // Brief gaze-off that's BELOW threshold (< 3s default)
  // These should NOT fire events in a real system, but we test
  // the risk impact if they do fire due to threshold sensitivity
  let riskBefore = 0;

  const { body: g1 } = await api(`/sessions/${sid}/events`, {
    method: 'POST', headers: ca,
    body: JSON.stringify({ events: [
      makeEvent('GAZE_OFF_SCREEN', 'WARNING', {
        direction: 'UP', durationSeconds: 1.8,
        benignReason: 'Candidate looking up while thinking — normal behavior',
      }, 0.55),
    ]}),
  });
  const { body: d1 } = await api(`/sessions/${sid}`, { headers: auth });
  const risk1 = d1.riskScore;
  recordResult('gaze', 'Looking up while thinking (1.8s)', true, risk1 - riskBefore,
    'Brief gaze-off fired at low confidence. Risk weight applied despite benign behavior.');
  console.log(`  ⚠️ Thinking-look: injected event risk +${risk1 - riskBefore} (confidence metadata 0.55)`);
  riskBefore = risk1;

  // ── CATEGORY 2: Glasses / reflections ─────────────────────
  console.log('\nCATEGORY 2: Glasses Interference');

  const { body: g2 } = await api(`/sessions/${sid}/events`, {
    method: 'POST', headers: ca,
    body: JSON.stringify({ events: [
      makeEvent('GAZE_FACE_NOT_DETECTED', 'WARNING', {
        reason: 'Glare from glasses causing iris tracking failure',
        glassesDetected: true,
        lightingCondition: 'overhead_fluorescent',
      }, 0.40),
    ]}),
  });
  // No face detected has no default weight — check
  const { body: d2 } = await api(`/sessions/${sid}`, { headers: auth });
  const risk2delta = d2.riskScore - riskBefore;
  recordResult('glasses', 'Glasses glare → face not detected', true, risk2delta,
    'Glasses reflection disrupts iris tracking. Should not penalize candidate.');
  console.log(`  ⚠️ Glasses glare: injected event risk +${risk2delta}`);
  riskBefore = d2.riskScore;

  // ── CATEGORY 3: Low-light / backlit ───────────────────────
  console.log('\nCATEGORY 3: Lighting Conditions');

  const { body: g3 } = await api(`/sessions/${sid}/events`, {
    method: 'POST', headers: ca,
    body: JSON.stringify({ events: [
      makeEvent('GAZE_OFF_SCREEN', 'WARNING', {
        direction: 'CENTER', durationSeconds: 2.1,
        lightingNote: 'Backlit window behind candidate — tracking degraded',
      }, 0.35),
      makeEvent('CAMERA_COVERED', 'CRITICAL', {
        reason: 'Very low light — camera feed appears dark',
        actuallyLowLight: true,
      }, 0.30),
    ]}),
  });
  const { body: d3 } = await api(`/sessions/${sid}`, { headers: auth });
  const risk3delta = d3.riskScore - riskBefore;
  recordResult('lighting', 'Backlit room → gaze tracking failure + "covered" camera', true, risk3delta,
    'Low light triggers CAMERA_COVERED false positive. Need brightness-based filtering.');
  console.log(`  ⚠️ Low light: injected event risk +${risk3delta}`);
  riskBefore = d3.riskScore;

  // ── CATEGORY 4: Speech patterns ───────────────────────────
  console.log('\nCATEGORY 4: Speech / Accent Variation');

  const { body: g4 } = await api(`/sessions/${sid}/events`, {
    method: 'POST', headers: ca,
    body: JSON.stringify({ events: [
      makeEvent('SPEAKER_VOICE_MISMATCH', 'CRITICAL', {
        reason: 'MOCK: Voice characteristics changed — candidate speaking Hindi then English',
        enrolledLanguage: 'English', currentLanguage: 'Hindi',
        note: 'Code-switching between languages changes voice embeddings',
      }, 0.42),
    ]}),
  });
  const { body: d4 } = await api(`/sessions/${sid}`, { headers: auth });
  const risk4delta = d4.riskScore - riskBefore;
  recordResult('speech', 'Language code-switching → voice mismatch', true, risk4delta,
    'Bilingual candidates trigger voice mismatch when switching languages. Known bias.');
  console.log(`  ⚠️ Code-switching: injected event risk +${risk4delta}`);
  riskBefore = d4.riskScore;

  // ── CATEGORY 5: Different webcam qualities ────────────────
  console.log('\nCATEGORY 5: Webcam Quality');

  const { body: g5 } = await api(`/sessions/${sid}/events`, {
    method: 'POST', headers: ca,
    body: JSON.stringify({ events: [
      makeEvent('GAZE_FACE_NOT_DETECTED', 'WARNING', {
        webcamResolution: '640x480',
        webcamFPS: 15,
        reason: 'Low-res webcam — face mesh fails intermittently',
      }, 0.30),
    ]}),
  });
  const { body: d5 } = await api(`/sessions/${sid}`, { headers: auth });
  const risk5delta = d5.riskScore - riskBefore;
  recordResult('webcam', 'Low-res 480p webcam → intermittent face detection', true, risk5delta,
    'Budget webcams produce low-quality frames that degrade MediaPipe accuracy.');
  console.log(`  ⚠️ Low-res webcam: risk +${risk5delta}`);
  riskBefore = d5.riskScore;

  // ── CATEGORY 6: Legitimate app usage ──────────────────────
  console.log('\nCATEGORY 6: Legitimate Application Usage');

  const { body: g6 } = await api(`/sessions/${sid}/events`, {
    method: 'POST', headers: ca,
    body: JSON.stringify({ events: [
      makeEvent('APP_FOCUS_LOST', 'WARNING', {
        lostTo: 'code.exe', windowTitle: 'Visual Studio Code',
        legitimateReason: 'Candidate using IDE for coding interview',
      }),
      makeEvent('APP_FOCUS_REGAINED', 'INFO', { durationLostMs: 500 }),
    ]}),
  });
  const { body: d6 } = await api(`/sessions/${sid}`, { headers: auth });
  const risk6delta = d6.riskScore - riskBefore;
  recordResult('apps', 'Switching to VS Code during coding interview', true, risk6delta,
    'Focus loss to IDE is expected in coding interviews. Should be whitelisted.');
  console.log(`  ⚠️ IDE switch: injected event risk +${risk6delta}`);
  riskBefore = d6.riskScore;

  // ── CATEGORY 7: Normal mic events ─────────────────────────
  console.log('\nCATEGORY 7: Normal Microphone Behavior');

  const { body: g7 } = await api(`/sessions/${sid}/events`, {
    method: 'POST', headers: ca,
    body: JSON.stringify({ events: [
      makeEvent('MIC_MUTED', 'WARNING', {
        reason: 'Candidate coughed and muted mic briefly',
        durationMs: 3000,
      }),
      makeEvent('MIC_UNMUTED', 'INFO', { afterMs: 3000 }),
    ]}),
  });
  const { body: d7 } = await api(`/sessions/${sid}`, { headers: auth });
  const risk7delta = d7.riskScore - riskBefore;
  recordResult('mic', 'Brief mute to cough (3s)', true, risk7delta,
    'Brief mutes for coughing are normal. 3s is below suspicious threshold.');
  console.log(`  ⚠️ Brief mute: injected event risk +${risk7delta}`);

  // ── GENERATE REPORT ───────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════');
  console.log('  SYNTHETIC RISK IMPACT REPORT');
  console.log('══════════════════════════════════════════════════\n');

  const { body: report } = await api(`/sessions/${sid}/report`, { headers: auth });
  console.log(`Total events: ${report.totalEvents}`);
  console.log(`Total risk score: ${report.riskScore}`);
  console.log(`Risk from injected benign-labeled events: ${report.riskScore}`);
  console.log('This score measures ingestion/risk impact only; it is not a false-positive rate.\n');

  let totalFP = 0;
  let totalRiskFromFP = 0;

  for (const [category, items] of Object.entries(results)) {
    console.log(`📊 ${category.toUpperCase()}`);
    for (const item of items) {
      const marker = 'INJECTED';
      console.log(`  ${marker} ${item.scenario}`);
      console.log(`     Risk impact: +${item.riskDelta}`);
      console.log(`     ${item.details}`);
      if (item.isFalsePositive) {
        totalFP++;
        totalRiskFromFP += item.riskDelta;
      }
    }
    console.log();
  }

  console.log('══════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('══════════════════════════════════════════════════');
  console.log(`  Synthetic benign-labeled inputs posted: ${totalFP}`);
  console.log(`  Risk points from those inputs: ${totalRiskFromFP}`);
  console.log(`  Average risk points per input: ${(totalRiskFromFP / totalFP).toFixed(1)}`);
  console.log();
  console.log('  Detector mitigations require real candidate-side sensor tests.');
  console.log('  Do not interpret these injected records as measured detections or false positives.');
  console.log('══════════════════════════════════════════════════');
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
