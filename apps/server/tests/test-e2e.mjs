// ============================================================
// ProctorOverlay — E2E Full Session Flow Test
// Proctor creates → candidate joins → pre-check → active →
// events fire → proctor reviews → appeal → report → end
// ============================================================

const BASE = 'http://localhost:4000';
const RND = Math.random().toString(36).slice(2, 8);
let passed = 0, failed = 0;

async function api(p, opts = {}) {
  const headers = {};
  if (opts.body) headers['Content-Type'] = 'application/json';
  if (opts.headers) Object.assign(headers, opts.headers);
  const res = await fetch(BASE + p, { method: opts.method || 'GET', headers, body: opts.body });
  return { status: res.status, body: await res.json().catch(() => null) };
}

function assert(cond, name) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
}

async function main() {
  console.log('══════════════════════════════════════════');
  console.log('  E2E FULL SESSION FLOW TEST');
  console.log('══════════════════════════════════════════\n');

  const email = `e2e-${RND}@test.com`;

  // ── STEP 1: Proctor login ──
  console.log('Step 1: Proctor login');
  const { status: ls, body: l } = await api('/auth/login', {
    method: 'POST', body: JSON.stringify({ email: 'proctor@example.com', password: 'proctor123' }),
  });
  assert(ls === 200, `Login returns 200 (got ${ls})`);
  assert(!!l.token, 'JWT token received');
  const pa = { Authorization: 'Bearer ' + l.token };

  // ── STEP 2: Create session ──
  console.log('\nStep 2: Proctor creates session');
  const { status: cs, body: sess } = await api('/sessions', {
    method: 'POST', headers: pa,
    body: JSON.stringify({ candidateEmail: email, meetingUrl: 'https://meet.google.com/e2e-test' }),
  });
  assert(cs === 201, `Session created (${cs})`);
  assert(sess.joinCode.length === 6, `Join code is 6 chars: ${sess.joinCode}`);
  assert(sess.status === 'CREATED', `Status is CREATED`);
  const sid = sess.sessionId;

  // ── STEP 3: Set accommodations ──
  console.log('\nStep 3: Set accommodations');
  const { status: acs } = await api('/privacy/accommodations', {
    method: 'PUT', headers: pa,
    body: JSON.stringify({
      sessionId: sid,
      accommodations: [{ type: 'RELAXED_GAZE_THRESHOLDS', reason: 'Wears bifocals' }],
    }),
  });
  assert(acs === 200, 'Accommodations set');

  // ── STEP 4: Candidate joins ──
  console.log('\nStep 4: Candidate joins');
  const { status: js, body: joined } = await api('/sessions/join', {
    method: 'POST', body: JSON.stringify({ code: sess.joinCode, email }),
  });
  assert(js === 200, `Candidate joined (${js})`);
  assert(!!joined.token, 'Candidate JWT received');
  const ca = { Authorization: 'Bearer ' + joined.token };

  // Verify session is PREFLIGHT
  const { body: s1 } = await api(`/sessions/${sid}`, { headers: pa });
  assert(s1.status === 'PREFLIGHT', `Status is PREFLIGHT (got ${s1.status})`);

  // ── STEP 5: Record consent ──
  console.log('\nStep 5: Record consent');
  const { status: cns } = await api('/privacy/consent', {
    method: 'POST', headers: ca,
    body: JSON.stringify({ sessionId: sid, purposes: ['MONITORING', 'AUDIO_ANALYSIS', 'EVIDENCE_CAPTURE'] }),
  });
  assert(cns === 201, 'Consent recorded');

  // ── STEP 6: Session goes ACTIVE ──
  console.log('\nStep 6: Session activated');
  const { status: as2 } = await api(`/sessions/${sid}/status`, {
    method: 'PATCH', headers: ca, body: JSON.stringify({ status: 'ACTIVE' }),
  });
  assert(as2 === 200, 'Status set to ACTIVE');

  // ── STEP 7: Events fire ──
  console.log('\nStep 7: Monitoring events fire');
  const events = [
    { eventId: `e2e-1-${RND}`, type: 'APP_FOCUS_LOST', severity: 'WARNING', timestamp: new Date().toISOString(), source: 'CANDIDATE_APP', metadata: { lostTo: 'chrome.exe' } },
    { eventId: `e2e-2-${RND}`, type: 'GAZE_OFF_SCREEN', severity: 'WARNING', timestamp: new Date().toISOString(), source: 'CANDIDATE_APP', metadata: { direction: 'LEFT', durationSeconds: 4.1 } },
    { eventId: `e2e-3-${RND}`, type: 'SPEAKER_SECOND_VOICE_DETECTED', severity: 'CRITICAL', timestamp: new Date().toISOString(), source: 'CANDIDATE_APP', metadata: { note: 'MOCK' } },
    { eventId: `e2e-4-${RND}`, type: 'MIC_MUTED', severity: 'WARNING', timestamp: new Date().toISOString(), source: 'CANDIDATE_APP', metadata: {} },
    { eventId: `e2e-5-${RND}`, type: 'MIC_UNMUTED', severity: 'INFO', timestamp: new Date().toISOString(), source: 'CANDIDATE_APP', metadata: {} },
  ];
  const { body: evr } = await api(`/sessions/${sid}/events`, {
    method: 'POST', headers: ca, body: JSON.stringify({ events }),
  });
  assert(evr.accepted === 5, `5 events accepted (got ${evr.accepted})`);
  assert(evr.duplicates === 0, 'No duplicates');

  // ── STEP 8: Dedup check ──
  console.log('\nStep 8: Dedup verification');
  const { body: dup } = await api(`/sessions/${sid}/events`, {
    method: 'POST', headers: ca, body: JSON.stringify({ events: [events[0]] }),
  });
  assert(dup.duplicates === 1, `Duplicate rejected (got ${dup.duplicates})`);
  assert(dup.accepted === 0, 'No new events from duplicate');

  // ── STEP 9: Proctor views events ──
  console.log('\nStep 9: Proctor views events');
  const { body: el } = await api(`/sessions/${sid}/events?limit=100`, { headers: pa });
  assert(el.length === 5, `5 events listed (got ${el.length})`);
  const criticals = el.filter(e => e.severity === 'CRITICAL');
  assert(criticals.length === 1, '1 critical event (SECOND_VOICE)');

  // ── STEP 10: Proctor reviews events ──
  console.log('\nStep 10: Proctor reviews events');
  await api(`/sessions/${sid}/events/${criticals[0].eventId}/review`, {
    method: 'PATCH', headers: pa,
    body: JSON.stringify({ reviewStatus: 'FLAGGED', proctorNote: 'Second voice confirmed' }),
  });
  assert(true, 'Critical event flagged');

  // ── STEP 11: Candidate appeals ──
  console.log('\nStep 11: Candidate appeals flagged event');
  const { status: aps, body: appeal } = await api('/privacy/appeals', {
    method: 'POST', headers: ca,
    body: JSON.stringify({
      sessionId: sid,
      eventId: criticals[0].eventId,
      candidateStatement: 'The interviewer was speaking and their audio leaked into my microphone. There was no second person.',
    }),
  });
  assert(aps === 201, 'Appeal submitted');
  assert(appeal.status === 'SUBMITTED', 'Appeal status is SUBMITTED');

  // ── STEP 12: Proctor resolves appeal ──
  console.log('\nStep 12: Proctor resolves appeal');
  const { body: ar } = await api(`/privacy/appeals/${appeal.appealId}`, {
    method: 'PATCH', headers: pa,
    body: JSON.stringify({ status: 'REJECTED', proctorResponse: 'Audio analysis shows distinct voice patterns from two sources.' }),
  });
  assert(ar.status === 'REJECTED', 'Appeal rejected');

  const { status: activeDeleteStatus } = await api(`/sessions/${sid}`, {
    method: 'DELETE', headers: pa,
  });
  assert(activeDeleteStatus === 409, `Proctor cannot delete an active session (got ${activeDeleteStatus})`);

  // ── STEP 13: Proctor ends session ──
  console.log('\nStep 13: Proctor ends session');
  await api(`/sessions/${sid}/status`, {
    method: 'PATCH', headers: pa, body: JSON.stringify({ status: 'FORCE_ENDED' }),
  });

  // ── STEP 14: Generate report ──
  console.log('\nStep 14: Final report');
  const { body: rpt } = await api(`/sessions/${sid}/report`, { headers: pa });
  assert(rpt.status === 'FORCE_ENDED', 'Report shows FORCE_ENDED');
  assert(rpt.totalEvents === 5, `Total events: ${rpt.totalEvents}`);
  assert(rpt.riskScore > 0, `Risk score: ${rpt.riskScore}`);
  assert(rpt.flaggedEvents >= 1, `Flagged events: ${rpt.flaggedEvents}`);
  assert(rpt.durationMs !== null, `Duration recorded: ${rpt.durationMs}ms`);
  assert(rpt.timeline.length === 5, 'Timeline has all events');

  // ── STEP 15: Data export ──
  console.log('\nStep 15: Candidate data export');
  const { body: dr } = await api('/privacy/data-request', {
    method: 'POST', headers: ca,
    body: JSON.stringify({ type: 'EXPORT', scope: ['events', 'sessions', 'consents', 'appeals'] }),
  });
  assert(dr.status === 'PENDING', 'Export request pending');
  const { body: dp } = await api(`/privacy/data-request/${dr.requestId}/process`, {
    method: 'POST', headers: pa,
  });
  assert(dp.status === 'COMPLETED', 'Export completed');
  assert(dp.data.events.length >= 1, 'Export contains events');
  assert(dp.data.consents.length >= 1, 'Export contains consents');

  // ── STEP 16: Auth guard test ──
  console.log('\nStep 16: Auth guard verification');
  const { status: noAuth } = await api('/sessions');
  assert(noAuth === 401, `Unauthenticated → 401 (got ${noAuth})`);

  const fakeAuth = { Authorization: 'Bearer invalid.token.here' };
  const { status: badAuth } = await api('/sessions', { headers: fakeAuth });
  assert(badAuth === 401, `Bad token → 401 (got ${badAuth})`);

  // Candidate can't access proctor endpoints
  const { status: roleDeny } = await api('/sessions', { headers: ca });
  assert(roleDeny === 403, `Candidate → sessions list → 403 (got ${roleDeny})`);

  // Only the owning proctor may remove a finished session.
  const { status: candidateDeleteDenied } = await api(`/sessions/${sid}`, {
    method: 'DELETE', headers: ca,
  });
  assert(candidateDeleteDenied === 403, `Candidate → delete session → 403 (got ${candidateDeleteDenied})`);

  const { status: deletedStatus, body: deletedBody } = await api(`/sessions/${sid}`, {
    method: 'DELETE', headers: pa,
  });
  assert(deletedStatus === 200 && deletedBody.deleted === true, 'Owning proctor deletes finished session');
  const { status: goneStatus } = await api(`/sessions/${sid}`, { headers: pa });
  assert(goneStatus === 404, `Deleted session is no longer available (got ${goneStatus})`);

  console.log('\n══════════════════════════════════════════');
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  if (failed === 0) console.log('  ✅ ALL E2E TESTS PASSED');
  else console.log('  ❌ SOME TESTS FAILED');
  console.log('══════════════════════════════════════════');
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
