// ============================================================
// ProctorOverlay — Mic Monitor
// Enforces always-on mic. Detects mute, device switches,
// disconnects. Integrates AudioPipeline for VAD + chunking.
// Sends audio chunks to main process for speaker analysis.
// Runs in the renderer process.
// ============================================================

import { AudioPipeline, type AudioChunk } from './audio-pipeline'

// ── Event types (matching shared EventType strings) ──────────
type MicEventType =
  | 'MIC_MUTED'
  | 'MIC_UNMUTED'
  | 'MIC_DISCONNECTED'
  | 'MIC_DEVICE_CHANGED'
  | 'SPEAKER_SECOND_VOICE_DETECTED'
  | 'SPEAKER_VOICE_MISMATCH'
  | 'SPEAKER_ANALYSIS_UNAVAILABLE'

export interface MicEvent {
  eventId: string
  sessionId: string
  type: MicEventType
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
  timestamp: string
  source: 'CANDIDATE_APP'
  metadata: Record<string, unknown>
  reviewStatus: 'UNREVIEWED'
}

export interface MicMonitorConfig {
  sessionId: string
  /** How often to check for mute/disconnect (ms, default 1000) */
  pollIntervalMs: number
  /** RMS threshold below which mic is considered muted (default 0.002) */
  muteThreshold: number
  /** How long mic must be silent to trigger mute alert (ms, default 5000) */
  muteAlertDelayMs: number
  /** Extra delay for track mute events to avoid transient cough/sneeze alerts (ms) */
  muteGracePeriodMs: number
  /** Cooldown between same-type events (ms, default 15000) */
  eventCooldownMs: number
  /** Enable voice enrollment during pre-check */
  enrollmentDurationMs: number
}

const DEFAULT_CONFIG: Omit<MicMonitorConfig, 'sessionId'> = {
  pollIntervalMs: 1000,
  muteThreshold: 0.002,
  muteAlertDelayMs: 5000,
  muteGracePeriodMs: 5000,
  eventCooldownMs: 15000,
  enrollmentDurationMs: 5000,
}

let _idC = 0
const nextId = (): string => `evt-mic-${Date.now()}-${++_idC}`

export class MicMonitor {
  private config: MicMonitorConfig
  private pipeline: AudioPipeline
  private listeners: Array<(event: MicEvent) => void> = []

  // Stream & device tracking
  private stream: MediaStream | null = null
  private currentDeviceId: string | null = null
  private pollIntervalId: ReturnType<typeof setInterval> | null = null

  // Mute detection
  private analyser: AnalyserNode | null = null
  private audioCtx: AudioContext | null = null
  private muteStartedAt: number | null = null
  private isMuted = false
  private trackMuteTimer: ReturnType<typeof setTimeout> | null = null

  // Event cooldowns
  private lastEventTime: Map<MicEventType, number> = new Map()

  // Enrollment state
  private isEnrolled = false

  constructor(config: Partial<MicMonitorConfig> & { sessionId: string }) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.pipeline = new AudioPipeline()
  }

  /** Subscribe to mic events */
  onEvent(callback: (event: MicEvent) => void): () => void {
    this.listeners.push(callback)
    return () => { this.listeners = this.listeners.filter((l) => l !== callback) }
  }

  /** Get the audio pipeline (for connecting to speaker detection) */
  getPipeline(): AudioPipeline { return this.pipeline }

  /** Start monitoring the given mic stream */
  start(micStream: MediaStream): void {
    this.stream = micStream

    // Track current device
    const audioTrack = micStream.getAudioTracks()[0]
    if (audioTrack) {
      this.currentDeviceId = audioTrack.getSettings().deviceId ?? null

      // Listen for track ending (disconnect)
      audioTrack.addEventListener('ended', () => {
        this.emitIfCooled('MIC_DISCONNECTED', 'CRITICAL', {
          message: 'Microphone was disconnected',
          deviceId: this.currentDeviceId,
        })
      })

      // Listen for mute events from the track itself
      audioTrack.addEventListener('mute', () => {
        if (this.trackMuteTimer) clearTimeout(this.trackMuteTimer)
        this.trackMuteTimer = setTimeout(() => {
          this.trackMuteTimer = null
          if (!this.isMuted && this.stream?.getAudioTracks()[0]?.muted) {
            this.isMuted = true
            this.emitIfCooled('MIC_MUTED', 'WARNING', {
              message: 'Microphone remained muted beyond the grace period',
              gracePeriodMs: this.config.muteGracePeriodMs,
              note: 'Brief mute transitions are ignored; proctor review remains required.',
            })
          }
        }, this.config.muteGracePeriodMs)
      })

      audioTrack.addEventListener('unmute', () => {
        if (this.trackMuteTimer) {
          clearTimeout(this.trackMuteTimer)
          this.trackMuteTimer = null
        }
        if (this.isMuted) {
          this.isMuted = false
          this.emitIfCooled('MIC_UNMUTED', 'INFO', {
            message: 'Microphone was unmuted',
          })
        }
      })
    }

    // Setup analyser for RMS-based mute detection (backup — track mute events aren't always reliable)
    this.audioCtx = new AudioContext()
    const source = this.audioCtx.createMediaStreamSource(micStream)
    this.analyser = this.audioCtx.createAnalyser()
    this.analyser.fftSize = 2048
    source.connect(this.analyser)

    // Start audio pipeline (VAD + chunking)
    this.pipeline.start(micStream)

    // Poll for mute detection and device changes
    this.pollIntervalId = setInterval(() => this.poll(), this.config.pollIntervalMs)

    // Listen for device changes
    navigator.mediaDevices.addEventListener('devicechange', this.handleDeviceChange)

    console.log('[MicMonitor] Started, device:', this.currentDeviceId)
  }

  /** Stop monitoring */
  stop(): void {
    if (this.trackMuteTimer) {
      clearTimeout(this.trackMuteTimer)
      this.trackMuteTimer = null
    }
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId)
      this.pollIntervalId = null
    }

    this.pipeline.stop()

    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {})
      this.audioCtx = null
    }
    this.analyser = null

    navigator.mediaDevices.removeEventListener('devicechange', this.handleDeviceChange)

    console.log('[MicMonitor] Stopped')
  }

  /** Capture voice enrollment sample */
  async enrollVoice(micStream: MediaStream): Promise<ArrayBuffer> {
    const sample = await this.pipeline.captureEnrollmentSample(
      micStream,
      this.config.enrollmentDurationMs,
    )
    this.isEnrolled = true
    return sample
  }

  /** Check if voice baseline is enrolled */
  getIsEnrolled(): boolean { return this.isEnrolled }

  // ── Polling ────────────────────────────────────────────────

  private poll(): void {
    this.checkMuteByRMS()
  }

  private checkMuteByRMS(): void {
    if (!this.analyser) return

    const data = new Float32Array(this.analyser.frequencyBinCount)
    this.analyser.getFloatTimeDomainData(data)

    // Calculate RMS
    let sum = 0
    for (let i = 0; i < data.length; i++) {
      sum += data[i] * data[i]
    }
    const rms = Math.sqrt(sum / data.length)

    const now = Date.now()

    if (rms < this.config.muteThreshold) {
      // Possibly muted
      if (this.muteStartedAt === null) {
        this.muteStartedAt = now
      } else if (now - this.muteStartedAt >= this.config.muteAlertDelayMs && !this.isMuted) {
        this.isMuted = true
        this.emitIfCooled('MIC_MUTED', 'WARNING', {
          message: `Microphone appears muted (silence for ${Math.round((now - this.muteStartedAt) / 1000)}s)`,
          rms: Math.round(rms * 10000) / 10000,
          threshold: this.config.muteThreshold,
          note: 'This may be a false positive if the room is genuinely quiet. Proctor should verify.',
        })
      }
    } else {
      if (this.muteStartedAt !== null && this.isMuted) {
        // Was muted, now unmuted
        this.isMuted = false
        this.emitIfCooled('MIC_UNMUTED', 'INFO', {
          message: 'Microphone unmuted — audio detected again',
        })
      }
      this.muteStartedAt = null
    }
  }

  private handleDeviceChange = async (): Promise<void> => {
    try {
      // Check if our current track's device is still the same
      if (!this.stream) return
      const audioTrack = this.stream.getAudioTracks()[0]
      if (!audioTrack) return

      const newDeviceId = audioTrack.getSettings().deviceId ?? null

      if (newDeviceId && newDeviceId !== this.currentDeviceId) {
        const oldDevice = this.currentDeviceId
        this.currentDeviceId = newDeviceId

        // Try to get device labels
        const devices = await navigator.mediaDevices.enumerateDevices()
        const newDevice = devices.find((d) => d.deviceId === newDeviceId)

        this.emitIfCooled('MIC_DEVICE_CHANGED', 'WARNING', {
          message: `Microphone device changed`,
          oldDeviceId: oldDevice,
          newDeviceId: newDeviceId,
          newDeviceLabel: newDevice?.label || 'Unknown',
        })
      }
    } catch (err) {
      console.error('[MicMonitor] Device change check error:', err)
    }
  }

  // ── Event emission ─────────────────────────────────────────

  private emitIfCooled(
    type: MicEventType,
    severity: MicEvent['severity'],
    metadata: Record<string, unknown>,
  ): void {
    const lastTime = this.lastEventTime.get(type) ?? 0
    if (Date.now() - lastTime < this.config.eventCooldownMs) return

    this.lastEventTime.set(type, Date.now())

    const event: MicEvent = {
      eventId: nextId(),
      sessionId: this.config.sessionId,
      type,
      severity,
      timestamp: new Date().toISOString(),
      source: 'CANDIDATE_APP',
      metadata,
      reviewStatus: 'UNREVIEWED',
    }

    for (const listener of this.listeners) {
      try { listener(event) } catch (err) { console.error('[MicMonitor] Listener error:', err) }
    }
  }
}
