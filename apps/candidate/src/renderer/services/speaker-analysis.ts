// ============================================================
// ProctorOverlay — Speaker Analysis Service
// Connects AudioPipeline speech chunks to the speaker detection
// provider (mock for now, Altheia later). Emits events when
// extra voices or voice mismatches are detected.
// Runs in the renderer process.
// ============================================================

import type { AudioChunk } from './audio-pipeline'
import type { MicEvent } from './mic-monitor'

let _idC = 0
const nextId = (): string => `evt-spk-${Date.now()}-${++_idC}`

export interface SpeakerAnalysisConfig {
  sessionId: string
  /** Max concurrent analysis requests (default 2) */
  maxConcurrent: number
  /** Cooldown between speaker alerts (ms, default 20000) */
  alertCooldownMs: number
}

// ── Mock speaker analysis (local, no server needed yet) ─────
// In Phase 6, this will call the real Altheia API via the server.
// For now, we simulate analysis locally with honest mock labels.

interface MockAnalysisResult {
  speakerCount: number
  voiceMatchesBaseline: boolean | null
  confidence: number
}

function mockAnalyze(samples: Float32Array): MockAnalysisResult {
  // Calculate some audio features for basic heuristics
  let rms = 0
  for (let i = 0; i < samples.length; i++) rms += samples[i] * samples[i]
  rms = Math.sqrt(rms / samples.length)

  // Simple pitch variance estimation (zero-crossing rate)
  let zeroCrossings = 0
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i] >= 0) !== (samples[i - 1] >= 0)) zeroCrossings++
  }
  const zcr = zeroCrossings / samples.length

  // Mock logic: simulate second speaker ~8% of time for testing
  // In production this would be a real ML model or API call
  const simulateAlert = Math.random() < 0.08
  const simulateMismatch = Math.random() < 0.05

  return {
    speakerCount: simulateAlert ? 2 : 1,
    voiceMatchesBaseline: simulateMismatch ? false : true,
    confidence: simulateAlert ? 0.65 + Math.random() * 0.2 : 0.9 + Math.random() * 0.1,
  }
}

export class SpeakerAnalysisService {
  private config: SpeakerAnalysisConfig
  private listeners: Array<(event: MicEvent) => void> = []
  private lastAlertTime: Map<string, number> = new Map()
  private activeRequests = 0
  private isEnrolled = false

  constructor(config: Partial<SpeakerAnalysisConfig> & { sessionId: string }) {
    this.config = {
      maxConcurrent: config.maxConcurrent ?? 2,
      alertCooldownMs: config.alertCooldownMs ?? 20000,
      ...config,
    }
  }

  /** Subscribe to speaker analysis events */
  onEvent(callback: (event: MicEvent) => void): () => void {
    this.listeners.push(callback)
    return () => { this.listeners = this.listeners.filter((l) => l !== callback) }
  }

  /** Mark voice baseline as enrolled */
  setEnrolled(enrolled: boolean): void {
    this.isEnrolled = enrolled
  }

  /** Analyze an audio chunk from the pipeline */
  async analyzeChunk(chunk: AudioChunk): Promise<void> {
    // Rate limiting
    if (this.activeRequests >= this.config.maxConcurrent) return

    this.activeRequests++
    try {
      // In production: send chunk.samples to server which calls SpeakerDetectionProvider
      // For now: local mock analysis
      const result = mockAnalyze(chunk.samples)

      // Check for multiple speakers
      if (result.speakerCount > 1) {
        this.emitIfCooled('SPEAKER_SECOND_VOICE_DETECTED', 'WARNING', {
          message: `[MOCK] ${result.speakerCount} speakers detected in audio chunk`,
          chunkId: chunk.chunkId,
          chunkDurationMs: Math.round(chunk.durationMs),
          speakerCount: result.speakerCount,
          confidence: Math.round(result.confidence * 100) / 100,
          note: 'MOCK analysis — not real AI. Will use Altheia API when docs arrive.',
        })
      }

      // Check for voice mismatch (only if enrolled)
      if (this.isEnrolled && result.voiceMatchesBaseline === false) {
        this.emitIfCooled('SPEAKER_VOICE_MISMATCH', 'WARNING', {
          message: '[MOCK] Voice does not match enrolled baseline',
          chunkId: chunk.chunkId,
          confidence: Math.round(result.confidence * 100) / 100,
          note: 'MOCK analysis — not real AI. False positives are common with mock.',
        })
      }
    } catch (err) {
      console.error('[SpeakerAnalysis] Chunk analysis error:', err)
    } finally {
      this.activeRequests--
    }
  }

  // ── Event emission ─────────────────────────────────────────

  private emitIfCooled(
    type: MicEvent['type'],
    severity: MicEvent['severity'],
    metadata: Record<string, unknown>,
  ): void {
    const lastTime = this.lastAlertTime.get(type) ?? 0
    if (Date.now() - lastTime < this.config.alertCooldownMs) return

    this.lastAlertTime.set(type, Date.now())

    const event: MicEvent = {
      eventId: nextId(),
      sessionId: this.config.sessionId,
      type: type as MicEvent['type'],
      severity,
      timestamp: new Date().toISOString(),
      source: 'CANDIDATE_APP',
      metadata,
      reviewStatus: 'UNREVIEWED',
    }

    for (const listener of this.listeners) {
      try { listener(event) } catch (err) { console.error('[SpeakerAnalysis] Listener error:', err) }
    }
  }
}
