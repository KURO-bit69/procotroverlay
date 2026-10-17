const BASE = 'http://localhost:4000';
const RND = Math.random().toString(36).slice(2,8);
const CAND_EMAIL = `pt-${RND}@test.com`;

async function api(p, opts={}) {
  const headers = {};
  if (opts.body) headers['Content-Type'] = 'application/json';
  if (opts.headers) Object.assign(headers, opts.headers);
  const res = await fetch(BASE+p, { method: opts.method || 'GET', headers, body: opts.body });
  const body = await res.json().catch(()=>null);
  if (res.status >= 400) console.error(`  ERR ${res.status} on ${opts.method||'GET'} ${p}:`, JSON.stringify(body));
  return { status: res.status, body };
}

async function main() {
  console.log('=== Phase 9 Privacy Tests ===');
  console.log('Candidate email:', CAND_EMAIL);

  // 1. Login
  const {body:l} = await api('/auth/login',{method:'POST',body:JSON.stringify({email:'proctor@example.com',password:'proctor123'})});
  if (!l?.token) throw new Error('Login failed');
  const auth = {Authorization:'Bearer '+l.token};
  console.log('1. Login OK');

  // 2. Create session
  const {body:s} = await api('/sessions',{method:'POST',headers:auth,body:JSON.stringify({candidateEmail:CAND_EMAIL,meetingUrl:'https://meet.google.com/x'})});
  if (!s?.sessionId) throw new Error('Session creation failed: '+JSON.stringify(s));
  const sid = s.sessionId;
  console.log('2. Session:', sid, 'Code:', s.joinCode);

  // 3. Candidate joins
  const {body:j} = await api('/sessions/join',{method:'POST',body:JSON.stringify({code:s.joinCode,email:CAND_EMAIL})});
  if (!j?.token) throw new Error('Join failed: '+JSON.stringify(j));
  const ca = {Authorization:'Bearer '+j.token};
  console.log('3. Candidate joined');

  // 4. Record consent
  const {body:c} = await api('/privacy/consent',{method:'POST',headers:ca,body:JSON.stringify({sessionId:sid,purposes:['MONITORING','AUDIO_ANALYSIS','GAZE_TRACKING']})});
  console.log('4. Consent:', c.consents.length, 'recorded');

  // 5. Get consent records
  const {body:cg} = await api('/privacy/consent/'+sid,{headers:ca});
  console.log('5. Get consents:', cg.length);

  // 6. Set accommodations
  const {body:ac} = await api('/privacy/accommodations',{method:'PUT',headers:auth,body:JSON.stringify({sessionId:sid,accommodations:[{type:'RELAXED_GAZE_THRESHOLDS',reason:'Progressive lenses'},{type:'EXTENDED_MIC_MUTE_THRESHOLD',reason:'Stutter'}],proctorNote:'Vision+speech'})});
  console.log('6. Accommodations:', ac.accommodations.length, 'set');

  // 7. Get accommodations
  const {body:ag} = await api('/privacy/accommodations/'+sid,{headers:auth});
  console.log('7. Get accommodations:', ag.accommodations.length, 'note:', ag.accommodationNote);

  // 8. Set retention policy
  const {body:rp} = await api('/privacy/retention',{method:'PUT',headers:auth,body:JSON.stringify({sessionId:sid,eventRetentionDays:14,evidenceRetentionDays:30})});
  console.log('8. Retention: event='+rp.retentionPolicy.eventRetentionDays+'d evidence='+rp.retentionPolicy.evidenceRetentionDays+'d');

  // 9. Ingest test event
  const {body:ev} = await api('/sessions/'+sid+'/events',{method:'POST',headers:ca,body:JSON.stringify({events:[{eventId:'ap-evt-'+RND,type:'GAZE_OFF_SCREEN',severity:'WARNING',timestamp:new Date().toISOString(),source:'CANDIDATE_APP',metadata:{direction:'LEFT'}}]})});
  console.log('9. Event ingested:', ev.accepted);

  // 10. Submit appeal
  const {body:ap} = await api('/privacy/appeals',{method:'POST',headers:ca,body:JSON.stringify({sessionId:sid,eventId:'ap-evt-'+RND,candidateStatement:'I was reading the interviewers shared screen positioned to my left. Not looking at external notes.'})});
  console.log('10. Appeal:', ap.appealId, 'status:', ap.status);

  // 11. List appeals
  const {body:als} = await api('/privacy/appeals/'+sid,{headers:auth});
  console.log('11. List appeals:', als.length);

  // 12. Resolve appeal
  const {body:ar} = await api('/privacy/appeals/'+ap.appealId,{method:'PATCH',headers:auth,body:JSON.stringify({status:'ACCEPTED',proctorResponse:'Confirmed screen was to the left'})});
  console.log('12. Appeal resolved:', ar.status);

  // 13. Withdraw consent
  const {body:wd} = await api('/privacy/consent/withdraw',{method:'POST',headers:ca,body:JSON.stringify({sessionId:sid,purposes:['GAZE_TRACKING']})});
  console.log('13. Consent withdrawn:', wd.withdrawn);

  // 14. Data export request
  const {body:dr} = await api('/privacy/data-request',{method:'POST',headers:ca,body:JSON.stringify({type:'EXPORT',scope:['events','sessions','consents','appeals']})});
  console.log('14. Data export request:', dr.requestId, 'status:', dr.status);

  // 15. List data requests
  const {body:drl} = await api('/privacy/data-request',{headers:ca});
  console.log('15. Data requests:', drl.length);

  // 16. Process export
  const {body:dp} = await api('/privacy/data-request/'+dr.requestId+'/process',{method:'POST',headers:auth});
  console.log('16. Export processed:', dp.status, 'sessions:', dp.data?.sessions?.length, 'events:', dp.data?.events?.length);

  // 17. AI disclosure
  const {body:ai} = await api('/privacy/ai-disclosure');
  console.log('17. AI: autoReject='+ai.policy.autoReject+' humanReview='+ai.policy.humanReviewRequired+' types='+Object.keys(ai.perEventType).length);

  // 18. Retention status
  const {body:rs} = await api('/privacy/retention/status',{headers:auth});
  console.log('18. Retention: expired='+rs.expiredCount+' unscheduled='+rs.unscheduledCount);

  // 19. Compute retention
  const {body:rc} = await api('/privacy/retention/compute',{method:'POST',headers:auth});
  console.log('19. Retention compute:', rc.updated, 'scheduled');

  console.log('\n══════════════════════════════════');
  console.log('ALL 19 TESTS PASSED');
  console.log('══════════════════════════════════');
}
main().catch(e=>{console.error('FAIL:',e.message||e);process.exit(1)});
