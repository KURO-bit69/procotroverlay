import { useEffect, useRef, useState } from 'react'
import styles from './MicCard.module.css'
import { recordVoiceSample, uploadVoiceRecording } from '../../services/voice-upload'

interface MicCardProps {
  status: 'IDLE' | 'GRANTED' | 'DENIED' | 'ERROR'
  stream: MediaStream | null
  sessionId: string
  sessionToken: string
  onEnrollmentChange: (state: 'RECORDING' | 'ENROLLED' | 'ERROR') => void
  onOpenPrivacySettings: () => void
}

const NUM_BARS = 20

export default function MicCard({ status, stream, sessionId, sessionToken, onEnrollmentChange, onOpenPrivacySettings }: MicCardProps) {
  const [level, setLevel] = useState(0)
  const [enrollmentState, setEnrollmentState] = useState<'idle' | 'recording' | 'uploading' | 'enrolled' | 'error'>('idle')
  const [secondsLeft, setSecondsLeft] = useState(20)
  const [enrollmentError, setEnrollmentError] = useState('')
  const animRef = useRef<number>(0)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const contextRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    const audioTrack = stream?.getAudioTracks()[0]
    if (!audioTrack || !stream) return
    let mounted = true
    const ctx = new AudioContext()
    contextRef.current = ctx
    const source = ctx.createMediaStreamSource(new MediaStream([audioTrack]))
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.6
    source.connect(analyser)
    analyserRef.current = analyser
    const data = new Uint8Array(analyser.frequencyBinCount)
    const tick = () => {
      if (!mounted) return
      analyser.getByteFrequencyData(data)
      const avg = data.reduce((s, v) => s + v, 0) / data.length
      setLevel(avg / 255)
      animRef.current = requestAnimationFrame(tick)
    }
    animRef.current = requestAnimationFrame(tick)
    return () => {
      mounted = false
      cancelAnimationFrame(animRef.current)
      source.disconnect()
      analyser.disconnect()
      void ctx.close()
      contextRef.current = null
    }
  }, [stream])

  const dotClass =
    status === 'GRANTED' ? 'ok'
    : status === 'ERROR' || status === 'DENIED' ? 'error'
    : 'loading'

  const activeBars = Math.round(level * NUM_BARS)

  const enrollVoice = async () => {
    if (!stream || enrollmentState === 'recording' || enrollmentState === 'uploading') return
    setEnrollmentError('')
    setEnrollmentState('recording')
    setSecondsLeft(20)
    onEnrollmentChange('RECORDING')
    try {
      const recording = await recordVoiceSample(stream, 20_000, setSecondsLeft)
      setEnrollmentState('uploading')
      await uploadVoiceRecording(sessionId, sessionToken, 'enroll', recording)
      setEnrollmentState('enrolled')
      onEnrollmentChange('ENROLLED')
    } catch (err) {
      setEnrollmentError(err instanceof Error ? err.message : 'Voice enrollment failed.')
      setEnrollmentState('error')
      onEnrollmentChange('ERROR')
    }
  }

  return (
    <div className={`card ${styles.card} ${status === 'GRANTED' ? 'ok-border' : status === 'ERROR' ? 'error-border' : ''}`}>
      <div className={styles.header}>
        <div className={styles.title}>
          <span className={`status-dot ${dotClass}`} />
          Microphone Test
        </div>
        <span className={styles.badge}>
          {status === 'GRANTED' ? '✓ Ready' : status === 'ERROR' ? '✗ Error' : '…'}
        </span>
      </div>

      {status === 'GRANTED' ? (
        <div className={styles.body}>
          <div className={styles.icon}>🎤</div>
          <div className={styles.levelMeter} role="meter" aria-valuenow={Math.round(level * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Microphone level">
            {Array.from({ length: NUM_BARS }).map((_, i) => (
              <div
                key={i}
                className={styles.bar}
                style={{
                  background: i < activeBars
                    ? i < NUM_BARS * 0.6 ? 'var(--success)'
                      : i < NUM_BARS * 0.85 ? 'var(--warning)'
                      : 'var(--danger)'
                    : 'var(--border)',
                  height: `${30 + (i / NUM_BARS) * 30}px`,
                }}
              />
            ))}
          </div>
          <p className={styles.hint}>
            {level < 0.05 ? 'Say something to test your microphone…' : 'Microphone is picking up sound ✓'}
          </p>
          <p className={styles.note}>
            ⚠ Microphone must stay unmuted for the entire session
          </p>
          <div className={styles.enrollment}>
            <strong>Candidate voice match</strong>
            <p>Record 20 seconds of your clear speech. It is sent securely to Detectif for enrollment and deleted when the session ends.</p>
            {enrollmentState === 'enrolled' ? (
              <span className={styles.enrolled}>✓ Voice sample enrolled</span>
            ) : (
              <button className={styles.enrollButton} onClick={() => void enrollVoice()} disabled={enrollmentState === 'recording' || enrollmentState === 'uploading'}>
                {enrollmentState === 'recording' ? `Recording… ${secondsLeft}s` : enrollmentState === 'uploading' ? 'Enrolling securely…' : 'Record voice sample (20s)'}
              </button>
            )}
            {enrollmentError && <p className={styles.enrollmentError} role="alert">{enrollmentError}</p>}
          </div>
        </div>
      ) : (
        <div className={styles.errorBox}>
          <span>🎤</span>
          <p>{status === 'ERROR' ? 'Microphone unavailable. In Windows, enable Microphone access and Let desktop apps access your microphone.' : 'Requesting microphone…'}</p>
          {status === 'ERROR' && <button className={styles.privacyButton} type="button" onClick={onOpenPrivacySettings}>Open microphone settings</button>}
        </div>
      )}
    </div>
  )
}
