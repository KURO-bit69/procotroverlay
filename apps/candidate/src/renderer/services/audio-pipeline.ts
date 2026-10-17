// ============================================================
// ProctorOverlay — Audio Pipeline
// Voice Activity Detection (VAD) + audio chunking + speaker
// detection. Runs in renderer (needs Web Audio API).
//
// Flow: Mic stream → VAD → chunk active speech → send via IPC
// to main process (which forwards to SpeakerDetectionProvider).
// Silence is never sent — reduces API cost and bandwidth.
// ============================================================

export interface AudioPipelineConfig {
  /** VAD threshold — RMS power below this = silence (0-1, default 0.015) */
  vadThreshold: number
  /** How long speech must be active before we start a chunk (ms, default 300) */
  speechStartDelayMs: number
  /** How long silence must persist to end a chunk (ms, default 800) */
  silenceEndDelayMs: number
  /** Max chunk length before forced split (ms, default 10000) */
  maxChunkLengthMs: number
  /** Min chunk length to bother analyzing (ms, default 500) */
  minChunkLengthMs: number
  /** Audio sample rate for chunks (default 16000 — common for speech models) */
  chunkSampleRate: number
}

const DEFAULT_CONFIG: AudioPipelineConfig = {
  vadThreshold: 0.015,
  speechStartDelayMs: 300,
  silenceEndDelayMs: 800,
  maxChunkLengthMs: 10000,
  minChunkLengthMs: 500,
  chunkSampleRate: 16000,
}

export interface AudioChunk {
  chunkId: string
  /** PCM Float32 audio data */
  samples: Float32Array
  sampleRate: number
  durationMs: number
  timestamp: string
}

type ChunkCallback = (chunk: AudioChunk) => void
type VADCallback = (isSpeaking: boolean) => void

let _chunkCounter = 0
const nextChunkId = (): string => `chunk-${Date.now()}-${++_chunkCounter}`

export class AudioPipeline {
  private config: AudioPipelineConfig
  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private workletNode: ScriptProcessorNode | null = null  // Using ScriptProcessor for broad compat
  private silentGain: GainNode | null = null
  private stream: MediaStream | null = null

  private chunkListeners: ChunkCallback[] = []
  private vadListeners: VADCallback[] = []

  // VAD state
  private isSpeaking = false
  private speechStartedAt: number | null = null
  private silenceStartedAt: number | null = null
  private lastVADState = false

  // Chunk buffer
  private chunkBuffer: Float32Array[] = []
  private chunkStartTime: number | null = null

  private running = false

  constructor(config?: Partial<AudioPipelineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /** Subscribe to completed audio chunks (speech segments) */
  onChunk(callback: ChunkCallback): () => void {
    this.chunkListeners.push(callback)
    return () => { this.chunkListeners = this.chunkListeners.filter((l) => l !== callback) }
  }

  /** Subscribe to VAD state changes (speaking / silence) */
  onVAD(callback: VADCallback): () => void {
    this.vadListeners.push(callback)
    return () => { this.vadListeners = this.vadListeners.filter((l) => l !== callback) }
  }

  /** Start processing audio from the given mic stream */
  start(micStream: MediaStream): void {
    if (this.running) return

    this.stream = micStream
    this.audioContext = new AudioContext({ sampleRate: this.config.chunkSampleRate })
    const source = this.audioContext.createMediaStreamSource(micStream)

    // Analyser for VAD (RMS level)
    this.analyser = this.audioContext.createAnalyser()
    this.analyser.fftSize = 2048
    this.analyser.smoothingTimeConstant = 0.3
    source.connect(this.analyser)

    // ScriptProcessor for raw PCM capture
    // (AudioWorklet is better but requires a separate file — keep simple for now)
    const bufferSize = 4096
    this.workletNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1)
    this.workletNode.onaudioprocess = (event) => {
      if (!this.running) return
      this.processAudioFrame(event)
    }
    source.connect(this.workletNode)
    this.silentGain = this.audioContext.createGain()
    this.silentGain.gain.value = 0
    this.workletNode.connect(this.silentGain)
    this.silentGain.connect(this.audioContext.destination) // Keep processing without playing mic audio back.

    this.running = true
    this.resetState()
    console.log('[AudioPipeline] Started, sample rate:', this.audioContext.sampleRate)
  }

  /** Stop processing */
  stop(): void {
    if (!this.running) return
    this.running = false

    // Flush any remaining chunk
    this.flushChunk()

    if (this.workletNode) {
      this.workletNode.onaudioprocess = null
      this.workletNode.disconnect()
      this.workletNode = null
    }
    this.silentGain?.disconnect()
    this.silentGain = null
    if (this.audioContext) {
      this.audioContext.close().catch(() => {})
      this.audioContext = null
    }
    this.analyser = null
    this.stream = null

    console.log('[AudioPipeline] Stopped')
  }

  /** Get current speaking state */
  getIsSpeaking(): boolean { return this.isSpeaking }

  /** Capture a voice enrollment sample (records for durationMs, returns PCM) */
  async captureEnrollmentSample(micStream: MediaStream, durationMs = 5000): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const ctx = new AudioContext({ sampleRate: this.config.chunkSampleRate })
      const source = ctx.createMediaStreamSource(micStream)
      const bufferSize = 4096
      const processor = ctx.createScriptProcessor(bufferSize, 1, 1)
      const chunks: Float32Array[] = []
      let elapsed = 0

      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0)
        chunks.push(new Float32Array(input))
        elapsed += (bufferSize / ctx.sampleRate) * 1000

        if (elapsed >= durationMs) {
          processor.onaudioprocess = null
          processor.disconnect()
          source.disconnect()
          ctx.close().catch(() => {})

          // Merge chunks into single buffer
          const totalLength = chunks.reduce((sum, c) => sum + c.length, 0)
          const merged = new Float32Array(totalLength)
          let offset = 0
          for (const chunk of chunks) {
            merged.set(chunk, offset)
            offset += chunk.length
          }

          resolve(merged.buffer)
        }
      }

      source.connect(processor)
      processor.connect(ctx.destination)

      // Timeout safety
      setTimeout(() => {
        if (elapsed < durationMs) {
          processor.onaudioprocess = null
          processor.disconnect()
          ctx.close().catch(() => {})
          reject(new Error('Enrollment capture timed out'))
        }
      }, durationMs + 2000)
    })
  }

  // ── Internal ───────────────────────────────────────────────

  private processAudioFrame(event: AudioProcessingEvent): void {
    const input = event.inputBuffer.getChannelData(0)

    // VAD: compute RMS
    let sum = 0
    for (let i = 0; i < input.length; i++) {
      sum += input[i] * input[i]
    }
    const rms = Math.sqrt(sum / input.length)
    const isVoice = rms > this.config.vadThreshold

    const now = Date.now()

    if (isVoice) {
      this.silenceStartedAt = null

      if (!this.isSpeaking) {
        // Voice detected — wait for speechStartDelay
        if (this.speechStartedAt === null) {
          this.speechStartedAt = now
        } else if (now - this.speechStartedAt >= this.config.speechStartDelayMs) {
          // Confirmed speech start
          this.isSpeaking = true
          this.chunkStartTime = now
          this.emitVAD(true)
        }
      }
    } else {
      this.speechStartedAt = null

      if (this.isSpeaking) {
        // Silence during speech — wait for silenceEndDelay
        if (this.silenceStartedAt === null) {
          this.silenceStartedAt = now
        } else if (now - this.silenceStartedAt >= this.config.silenceEndDelayMs) {
          // Confirmed speech end
          this.isSpeaking = false
          this.emitVAD(false)
          this.flushChunk()
        }
      }
    }

    // Buffer audio during speech
    if (this.isSpeaking) {
      this.chunkBuffer.push(new Float32Array(input))

      // Check max chunk length
      if (this.chunkStartTime && now - this.chunkStartTime >= this.config.maxChunkLengthMs) {
        this.flushChunk()
        // Start a new chunk immediately (speech is still ongoing)
        this.chunkStartTime = now
      }
    }
  }

  private flushChunk(): void {
    if (this.chunkBuffer.length === 0) return

    const totalLength = this.chunkBuffer.reduce((sum, c) => sum + c.length, 0)
    const sampleRate = this.audioContext?.sampleRate ?? this.config.chunkSampleRate
    const durationMs = (totalLength / sampleRate) * 1000

    // Skip chunks that are too short
    if (durationMs < this.config.minChunkLengthMs) {
      this.chunkBuffer = []
      this.chunkStartTime = null
      return
    }

    // Merge buffers
    const merged = new Float32Array(totalLength)
    let offset = 0
    for (const buf of this.chunkBuffer) {
      merged.set(buf, offset)
      offset += buf.length
    }

    const chunk: AudioChunk = {
      chunkId: nextChunkId(),
      samples: merged,
      sampleRate,
      durationMs,
      timestamp: new Date().toISOString(),
    }

    this.chunkBuffer = []
    this.chunkStartTime = Date.now()

    for (const listener of this.chunkListeners) {
      try { listener(chunk) } catch (err) { console.error('[AudioPipeline] Chunk listener error:', err) }
    }
  }

  private emitVAD(speaking: boolean): void {
    if (speaking === this.lastVADState) return
    this.lastVADState = speaking
    for (const listener of this.vadListeners) {
      try { listener(speaking) } catch (err) { console.error('[AudioPipeline] VAD listener error:', err) }
    }
  }

  private resetState(): void {
    this.isSpeaking = false
    this.speechStartedAt = null
    this.silenceStartedAt = null
    this.lastVADState = false
    this.chunkBuffer = []
    this.chunkStartTime = null
  }
}
