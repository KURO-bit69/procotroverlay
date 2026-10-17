import { useEffect, useRef } from 'react'
import styles from './CameraCard.module.css'

interface CameraCardProps {
  status: 'IDLE' | 'GRANTED' | 'DENIED' | 'ERROR'
  stream: MediaStream | null
  error: string
  onOpenPrivacySettings: () => void
}

export default function CameraCard({ status, stream, error, onOpenPrivacySettings }: CameraCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream
    if (stream && videoRef.current) void videoRef.current.play().catch(() => undefined)
    return () => { if (videoRef.current) videoRef.current.srcObject = null }
  }, [stream])

  const dotClass =
    status === 'GRANTED' ? 'ok'
    : status === 'ERROR' || status === 'DENIED' ? 'error'
    : 'loading'

  return (
    <div className={`card ${styles.card} ${status === 'GRANTED' ? 'ok-border' : status === 'ERROR' ? 'error-border' : ''}`}>
      <div className={styles.header}>
        <div className={styles.title}>
          <span className={`status-dot ${dotClass}`} />
          Camera Preview
        </div>
        <span className={styles.badge}>
          {status === 'GRANTED' ? '✓ Ready'
           : status === 'ERROR' ? '✗ Error'
           : '…'}
        </span>
      </div>

      <div className={styles.videoWrap}>
        {status !== 'ERROR' && status !== 'DENIED' ? (
          <video
            ref={videoRef}
            className={styles.video}
            autoPlay
            muted
            playsInline
            aria-label="Camera preview"
          />
        ) : (
          <div className={styles.errorBox}>
            <span>📷</span>
            <p>{error || 'Camera unavailable'}</p>
            <p className={styles.hint}>
              In Windows, turn on Camera access and Let desktop apps access your camera.
            </p>
            <button className={styles.retryButton} type="button" onClick={onOpenPrivacySettings}>Open camera settings</button>
          </div>
        )}
      </div>

      {status === 'GRANTED' && (
        <p className={styles.faceHint}>Ensure your face is fully visible and well lit</p>
      )}
    </div>
  )
}
