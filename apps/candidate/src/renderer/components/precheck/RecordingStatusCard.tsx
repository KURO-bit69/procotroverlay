import type { PreCheckStatus } from '@proctoroverlay/shared'
import styles from './RecordingStatusCard.module.css'

interface RecordingStatusCardProps {
  status: PreCheckStatus
}

type CheckItem = {
  label: string
  key: keyof PreCheckStatus
  getState: (s: PreCheckStatus) => 'ok' | 'pending' | 'error'
}

const CHECKS: CheckItem[] = [
  {
    label: 'Camera access',
    key: 'camera',
    getState: (s) => s.camera === 'GRANTED' ? 'ok' : s.camera === 'ERROR' || s.camera === 'DENIED' ? 'error' : 'pending',
  },
  {
    label: 'Microphone access',
    key: 'microphone',
    getState: (s) => s.microphone === 'GRANTED' ? 'ok' : s.microphone === 'ERROR' || s.microphone === 'DENIED' ? 'error' : 'pending',
  },
  {
    label: 'Voice sample enrolled',
    key: 'voiceBaseline',
    getState: (s) => s.voiceBaseline === 'ENROLLED' ? 'ok' : s.voiceBaseline === 'ERROR' ? 'error' : 'pending',
  },
]

const STATE_ICONS = { ok: '✓', pending: '○', error: '✗' } as const

export default function RecordingStatusCard({ status }: RecordingStatusCardProps) {
  const allOk = CHECKS.every((c) => c.getState(status) === 'ok')

  return (
    <div className={`card ${styles.card} ${allOk ? 'ok-border' : ''}`}>
      <div className={styles.header}>
        <div className={styles.title}>
          <span className={`status-dot ${allOk ? 'ok' : 'loading'}`} />
          Recording Status
        </div>
        <span className={styles.badge}>{allOk ? '✓ Ready' : 'Incomplete'}</span>
      </div>

      <div className={styles.checklist}>
        {CHECKS.map((check) => {
          const state = check.getState(status)
          return (
            <div key={String(check.key)} className={`${styles.checkItem} ${styles[state]}`}>
              <span className={styles.icon}>{STATE_ICONS[state]}</span>
              <span className={styles.label}>{check.label}</span>
            </div>
          )
        })}
      </div>

      {!allOk && (
        <p className={styles.note}>
          Camera, microphone, and voice checks must be complete before joining.
        </p>
      )}

      {allOk && <p className={styles.ready}>Checks passed — you may join.</p>}
      <p className={styles.meetShareHelp}>
        After joining, start presentation in Google Meet: <strong>Present now → Your entire screen → Share</strong>.
      </p>
    </div>
  )
}
