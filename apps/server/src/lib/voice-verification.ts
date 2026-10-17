import { randomUUID } from 'crypto'

export interface VoiceVerificationResult {
  provider: 'Detectif.ai' | 'Mock voice verification'
  decision: 'match' | 'no_match'
  /** Similarity from -1 to 1; it is not a probability or percentage. */
  similarity: number
  threshold: number
  requestId?: string
  latencyMs?: number
}

export interface VoiceVerificationProvider {
  readonly name: VoiceVerificationResult['provider']
  enroll(sessionId: string, audio: Buffer, mimeType: string): Promise<void>
  verify(sessionId: string, audio: Buffer, mimeType: string): Promise<VoiceVerificationResult>
  dispose(sessionId: string): Promise<void>
}

export class VoiceVerificationError extends Error {
  constructor(message: string, readonly statusCode = 502, readonly code = 'provider_error') {
    super(message)
    this.name = 'VoiceVerificationError'
  }
}

const speakerIdForSession = (sessionId: string): string => `proctoroverlay-${sessionId}`

export class DetectifVoiceVerificationProvider implements VoiceVerificationProvider {
  readonly name = 'Detectif.ai' as const
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(apiKey: string, baseUrl: string) {
    this.apiKey = apiKey
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  async enroll(sessionId: string, audio: Buffer, mimeType: string): Promise<void> {
    const form = this.audioForm(audio, mimeType)
    form.append('speaker_id', speakerIdForSession(sessionId))
    form.append('display_name', `Candidate session ${sessionId}`)
    await this.request('/speakers/enroll', form, `enroll-${randomUUID()}`)
  }

  async verify(sessionId: string, audio: Buffer, mimeType: string): Promise<VoiceVerificationResult> {
    const form = this.audioForm(audio, mimeType)
    form.append('speaker_id', speakerIdForSession(sessionId))
    const payload = await this.request('/speakers/verify', form, `verify-${randomUUID()}`)
    const result = payload.result as Record<string, unknown> | undefined
    if (!result || (result.decision !== 'match' && result.decision !== 'no_match') ||
      typeof result.similarity !== 'number' || !Number.isFinite(result.similarity) ||
      result.similarity < -1 || result.similarity > 1 || typeof result.threshold !== 'number' ||
      !Number.isFinite(result.threshold)) {
      throw new VoiceVerificationError('Detectif returned an unsupported verification response.', 502, 'invalid_provider_response')
    }

    return {
      provider: this.name,
      decision: result.decision,
      similarity: result.similarity,
      threshold: result.threshold,
      requestId: typeof payload.request_id === 'string' ? payload.request_id : undefined,
      latencyMs: typeof payload.latency_ms === 'number' ? payload.latency_ms : undefined,
    }
  }

  async dispose(sessionId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/speakers/${encodeURIComponent(speakerIdForSession(sessionId))}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(30_000),
    })
    if (response.ok || response.status === 404) return
    throw this.errorForStatus(response.status)
  }

  private audioForm(audio: Buffer, mimeType: string): FormData {
    const form = new FormData()
    const filename = mimeType.includes('webm') ? 'voice.webm' : 'voice.wav'
    form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), filename)
    return form
  }

  private async request(path: string, form: FormData, idempotencyKey: string): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Idempotency-Key': idempotencyKey,
      },
      body: form,
      signal: AbortSignal.timeout(300_000),
    })

    const payload = await response.json().catch(() => ({})) as Record<string, unknown>
    if (!response.ok) throw this.errorForStatus(response.status, payload)
    return payload
  }

  private errorForStatus(status: number, payload: Record<string, unknown> = {}): VoiceVerificationError {
    const error = payload.error as Record<string, unknown> | undefined
    const code = typeof error?.code === 'string' ? error.code : 'provider_error'
    const messages: Record<number, string> = {
      401: 'Voice verification credentials were rejected.',
      402: 'Voice verification has no remaining credits.',
      403: 'The Detectif key lacks the voice verification permission.',
      404: 'No enrolled voice profile exists for this session.',
      409: 'A voice verification request is already being processed.',
      413: 'The voice recording is too large.',
      415: 'The voice recording format is not supported.',
      422: 'The recording was too short, silent, or unclear. Please try again with clear speech.',
      429: 'Voice verification is rate limited. Please wait and try again.',
      503: 'Detectif is busy. Please try again shortly.',
    }
    const safeMessage = messages[status] ?? 'Voice verification is temporarily unavailable.'
    return new VoiceVerificationError(safeMessage, status === 401 || status === 403 ? 503 : 502, code)
  }
}

class MockVoiceVerificationProvider implements VoiceVerificationProvider {
  readonly name = 'Mock voice verification' as const
  private enrolled = new Set<string>()

  async enroll(sessionId: string): Promise<void> {
    this.enrolled.add(sessionId)
  }

  async verify(sessionId: string): Promise<VoiceVerificationResult> {
    if (!this.enrolled.has(sessionId)) {
      throw new VoiceVerificationError('Enroll a voice sample before verification.', 409, 'profile_missing')
    }
    return { provider: this.name, decision: 'match', similarity: 1, threshold: 0 }
  }

  async dispose(sessionId: string): Promise<void> {
    this.enrolled.delete(sessionId)
  }
}

let provider: VoiceVerificationProvider | null = null

export function getVoiceVerificationProvider(): VoiceVerificationProvider {
  if (provider) return provider
  const selection = (process.env.SPEAKER_DETECTION_PROVIDER ?? 'mock').toLowerCase()
  if (selection === 'detectif') {
    const apiKey = process.env.DETECTIF_API_KEY?.trim()
    if (!apiKey) throw new VoiceVerificationError('Detectif is selected but DETECTIF_API_KEY is not configured.', 503, 'provider_not_configured')
    provider = new DetectifVoiceVerificationProvider(
      apiKey,
      process.env.DETECTIF_API_URL ?? 'https://platform.detectif.ai/v1',
    )
  } else {
    provider = new MockVoiceVerificationProvider()
  }
  return provider
}

export function resetVoiceVerificationProviderForTests(): void {
  provider = null
}
