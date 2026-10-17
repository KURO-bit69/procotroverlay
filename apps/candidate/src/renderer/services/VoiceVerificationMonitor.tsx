import { useEffect } from 'react'
import { AudioPipeline, type AudioChunk } from './audio-pipeline'
import { uploadVoiceRecording, type EncodedVoiceRecording } from './voice-upload'

interface Props {
  sessionId: string
  sessionToken: string
  stream: MediaStream | null
}

function encodeWav(chunk: AudioChunk): EncodedVoiceRecording {
  const bytes = new ArrayBuffer(44 + chunk.samples.length * 2)
  const view = new DataView(bytes)
  const write = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i))
  }
  write(0, 'RIFF')
  view.setUint32(4, 36 + chunk.samples.length * 2, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, chunk.sampleRate, true)
  view.setUint32(28, chunk.sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, chunk.samples.length * 2, true)
  for (let i = 0; i < chunk.samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, chunk.samples[i]))
    view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  const data = new Uint8Array(bytes)
  let binary = ''
  const stride = 0x8000
  for (let i = 0; i < data.length; i += stride) {
    binary += String.fromCharCode(...data.subarray(i, i + stride))
  }
  return { audioBase64: btoa(binary), mimeType: 'audio/wav' }
}

function emitResult(sessionId: string, decision: 'match' | 'no_match', similarity: number, threshold: number) {
  window.electronAPI?.sendAudioEvent({
    eventId: `evt-voice-${Date.now()}-${crypto.randomUUID()}`,
    sessionId,
    type: decision === 'match' ? 'SPEAKER_VOICE_MATCH' : 'SPEAKER_VOICE_MISMATCH',
    severity: decision === 'match' ? 'INFO' : 'WARNING',
    timestamp: new Date().toISOString(),
    source: 'CANDIDATE_APP',
    metadata: {
      message: decision === 'match' ? 'Voice sample matched the enrolled candidate.' : 'Voice sample did not match the enrolled candidate.',
      decision,
      similarity,
      threshold,
      scoreSemantics: 'Similarity is not a percentage or probability; review this signal with other evidence.',
    },
    reviewStatus: 'UNREVIEWED',
  })
}

function emitUnavailable(sessionId: string, message: string) {
  window.electronAPI?.sendAudioEvent({
    eventId: `evt-voice-unavailable-${Date.now()}`,
    sessionId,
    type: 'SPEAKER_ANALYSIS_UNAVAILABLE',
    severity: 'INFO',
    timestamp: new Date().toISOString(),
    source: 'CANDIDATE_APP',
    metadata: { message },
    reviewStatus: 'UNREVIEWED',
  })
}

export default function VoiceVerificationMonitor({ sessionId, sessionToken, stream }: Props) {
  useEffect(() => {
    if (!stream?.getAudioTracks().some((track) => track.readyState === 'live') || !sessionId || !sessionToken) return
    // Keep verification calls infrequent while staying within Detectif's 60s limit.
    const pipeline = new AudioPipeline({ minChunkLengthMs: 3000, maxChunkLengthMs: 30_000 })
    let inFlight = false
    let lastUnavailableAt = 0
    let lastDecision: 'match' | 'no_match' | null = null
    let disposed = false
    const unsubscribe = pipeline.onChunk((chunk) => {
      if (disposed || inFlight || chunk.durationMs < 3000) return
      inFlight = true
      void uploadVoiceRecording(sessionId, sessionToken, 'verify', encodeWav(chunk))
        .then((result) => {
          const decision = result.decision
          if ((decision === 'match' || decision === 'no_match') && decision !== lastDecision) {
            lastDecision = decision
            emitResult(sessionId, decision, Number(result.similarity), Number(result.threshold))
          }
        })
        .catch((error: unknown) => {
          const now = Date.now()
          if (now - lastUnavailableAt >= 30_000) {
            lastUnavailableAt = now
            emitUnavailable(sessionId, error instanceof Error ? error.message : 'Voice verification is temporarily unavailable.')
          }
        })
        .finally(() => { inFlight = false })
    })
    pipeline.start(stream)
    return () => {
      disposed = true
      unsubscribe()
      pipeline.stop()
    }
  }, [sessionId, sessionToken, stream])

  return null
}
