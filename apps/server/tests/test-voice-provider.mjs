import assert from 'node:assert/strict'
import { DetectifVoiceVerificationProvider } from '../src/lib/voice-verification.ts'

const provider = new DetectifVoiceVerificationProvider('test-secret', 'https://detectif.test/v1/')
const calls = []
const originalFetch = globalThis.fetch
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init })
  if (String(url).endsWith('/speakers/verify')) {
    return Response.json({
      result: { decision: 'match', similarity: 0.73, threshold: 0.62 },
      request_id: 'req-test',
      latency_ms: 120,
    })
  }
  if (String(url).endsWith('/speakers/enroll')) return Response.json({ speaker_id: 'proctoroverlay-session-test' })
  return new Response(null, { status: 204 })
}

try {
  await provider.enroll('session-test', Buffer.from('fake-enrollment-audio'), 'audio/wav')
  const enrollment = calls.at(-1)
  assert.equal(enrollment.url, 'https://detectif.test/v1/speakers/enroll')
  assert.equal(enrollment.init.headers.Authorization, 'Bearer test-secret')
  assert.ok(enrollment.init.headers['Idempotency-Key'].startsWith('enroll-'))
  assert.ok(enrollment.init.body instanceof FormData)
  assert.equal(enrollment.init.body.get('speaker_id'), 'proctoroverlay-session-test')
  assert.equal(enrollment.init.body.get('display_name'), 'Candidate session session-test')
  assert.equal(enrollment.init.body.get('file').type, 'audio/wav')

  const result = await provider.verify('session-test', Buffer.from('fake-verification-audio'), 'audio/wav')
  assert.deepEqual(result, {
    provider: 'Detectif.ai', decision: 'match', similarity: 0.73,
    threshold: 0.62, requestId: 'req-test', latencyMs: 120,
  })

  await provider.dispose('session-test')
  assert.equal(calls.at(-1).url, 'https://detectif.test/v1/speakers/proctoroverlay-session-test')
  assert.equal(calls.at(-1).init.method, 'DELETE')
  assert.equal(calls.at(-1).init.headers.Authorization, 'Bearer test-secret')

  globalThis.fetch = async () => Response.json({ error: { code: 'bad_key', message: 'sensitive provider detail' } }, { status: 401 })
  await assert.rejects(
    provider.verify('session-test', Buffer.from('audio'), 'audio/wav'),
    (error) => error.message === 'Voice verification credentials were rejected.' && error.statusCode === 503 && error.code === 'bad_key',
  )
} finally {
  globalThis.fetch = originalFetch
}

console.log('Voice provider tests passed (mocked Detectif API).')
