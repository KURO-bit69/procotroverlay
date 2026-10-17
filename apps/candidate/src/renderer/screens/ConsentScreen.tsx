import { useState } from 'react'
import styles from './ConsentScreen.module.css'

interface ConsentScreenProps {
  onAccept: () => void
}

const MONITORED_ITEMS = [
  {
    icon: '🎤',
    title: 'Microphone Audio',
    detail:
      'If Detectif voice verification is enabled, you will record a 20-second voice sample and speech clips of at least 3 seconds may be sent to Detectif.ai to compare against that sample. Detectif says uploaded audio is processed and not stored; the enrolled voice profile is stored encrypted until deleted. ProctorOverlay requests profile deletion when the session ends. Results and events are recorded.',
    technique: 'Detectif.ai enrolled-speaker voice verification; speech is segmented on-device before upload',
    limitation: 'A mismatch can result from noise, illness, stress, a different microphone, or another person being audible. It does not count speakers or prove misconduct. A human proctor reviews all results.',
  },
  {
    icon: '🖥️',
    title: 'Screen Sharing',
    detail:
      'You must share your entire screen for the duration of the session. Screen contents are NOT recorded or transmitted. A signal is raised if screen sharing stops.',
    technique: 'Screen Capture API status monitoring',
    limitation: 'Only detects whether sharing is active — cannot prevent screenshots via OS-level tools.',
  },
  {
    icon: '📋',
    title: 'Running Applications',
    detail:
      'The names of running processes are checked against a blocklist (remote desktop tools, AI chat apps, screen-sharing software). Application contents are NOT read.',
    technique: 'Process name matching (tasklist)',
    limitation: 'Cannot detect web-based tools (e.g. browser-based ChatGPT) or sandboxed applications.',
  },
  {
    icon: '🖥️+🖥️',
    title: 'Connected Monitors & Devices',
    detail:
      'The number of connected monitors is detected. Virtual camera and virtual audio devices are flagged.',
    technique: 'WMI queries + device enumeration',
    limitation: 'VM detection is heuristic only — may false-positive on some corporate hardware.',
  },
  {
    icon: '⏱️',
    title: 'Session Timeline',
    detail:
      'All flagged events are recorded with timestamps and shown to your proctor. Each event requires human review before any action is taken.',
    technique: 'Event timeline with severity classification',
    limitation: 'A flag does NOT prove misconduct. All flags are advisory.',
  },
]

export default function ConsentScreen({ onAccept }: ConsentScreenProps) {
  const [scrolledToBottom, setScrolledToBottom] = useState(false)
  const [accepted, setAccepted] = useState(false)

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8
    if (atBottom) setScrolledToBottom(true)
  }

  return (
    <div className={styles.container}>
      {/* Top bar */}
      <div className={styles.topBar}>
        <span className={styles.role}>Receiver (default)</span>
        <span className={styles.logo}>⬡ ProctorOverlay</span>
        <span />
      </div>

      {/* Content */}
      <div className={styles.content}>
        <h1 className={styles.heading}>Privacy & Monitoring Consent</h1>
        <p className={styles.subheading}>
          Before your interview begins, please read and agree to the following.
          This session will monitor you as described below. You must scroll to
          the bottom and explicitly accept before continuing.
        </p>

        <div className={styles.scrollArea} onScroll={handleScroll}>
          {MONITORED_ITEMS.map((item) => (
            <div className={styles.item} key={item.title}>
              <div className={styles.itemIcon}>{item.icon}</div>
              <div>
                <div className={styles.itemTitle}>{item.title}</div>
                <div className={styles.itemDetail}>{item.detail}</div>
                <div className={styles.itemTechnique}>
                  <em>Technique:</em> {item.technique}
                </div>
                <div className={styles.itemLimitation}>
                  <em>⚠️ Limitation:</em> {item.limitation}
                </div>
              </div>
            </div>
          ))}

          {/* ── AI Disclosure ── */}
          <div className={styles.legalBox}>
            <strong>🤖 AI-Assisted Monitoring Disclosure:</strong> This session
            uses algorithmic detection tools to flag potential integrity concerns.
            These flags are <u>advisory only</u>.{' '}
            <strong>
              No candidate is automatically rejected based on algorithmic flags.
            </strong>{' '}
            Every flag is reviewed by a human proctor who makes all decisions.
            Under GDPR Article 22 and India&apos;s DPDP Act Section 12, you have
            the right to not be subject to decisions based solely on automated
            processing. This system enforces that right by design.
          </div>

          {/* ── Data Retention ── */}
          <div className={styles.legalBox}>
            <strong>📁 Data Retention:</strong> Event metadata is retained for up
            to 30 days. Evidence clips (flagged moments only) are retained for
            up to 60 days. Session records are retained for up to 90 days. After
            these periods, data is scheduled for deletion. Your proctor may
            configure different retention periods for your session.
          </div>

          {/* ── Data Subject Rights ── */}
          <div className={styles.legalBox}>
            <strong>📋 Your Rights (GDPR & DPDP Act):</strong>
            <ul style={{ marginTop: 6, paddingLeft: 20, lineHeight: 1.7 }}>
              <li>
                <strong>Right of Access (GDPR Art. 15 / DPDP Sec. 11):</strong>{' '}
                You may request a copy of all data collected about you during
                this session.
              </li>
              <li>
                <strong>Right to Erasure (GDPR Art. 17 / DPDP Sec. 12):</strong>{' '}
                You may request deletion of your data after the session concludes.
                Some data may be retained for legal obligations.
              </li>
              <li>
                <strong>Right to Appeal (GDPR Art. 22 / DPDP Sec. 12):</strong>{' '}
                You may submit a written appeal for any flagged event. Your proctor
                will review and respond to each appeal.
              </li>
              <li>
                <strong>Right to Withdraw Consent:</strong> You may withdraw
                consent at any time. Note: withdrawing consent during an active
                session will end the session.
              </li>
              <li>
                <strong>Accommodations:</strong> If you have a medical condition
                that may affect monitoring accuracy (e.g. eye conditions,
                neurological conditions, speech impediments), inform your proctor
                before the session. Camera and microphone setup can be adjusted
                with your proctor before the session begins.
              </li>
            </ul>
          </div>

          {/* ── Compliance ── */}
          <div className={styles.legalBox}>
            <strong>🏛️ Compliance:</strong> This system is designed to comply with
            GDPR (EU General Data Protection Regulation) and India&apos;s DPDP Act
            (Digital Personal Data Protection Act, 2023). Raw video and screen
            contents are not transmitted. When Detectif voice verification is
            enabled, the voice enrollment sample and speech clips are sent to
            Detectif.ai for processing. Detectif states uploaded audio is not
            stored, but the enrolled voice profile remains until deleted.
            ProctorOverlay requests its deletion when the session ends. Event
            metadata and timestamps are also collected.
            <br /><br />
            <strong>Data Controller:</strong> Your organisation / employer.
            <br />
            <strong>Data Processor:</strong> ProctorOverlay (on behalf of the
            controller).
            <br />
            <strong>Legal Basis:</strong> Legitimate interest + explicit consent
            (this form).
            <br />
            <strong>Policy Version:</strong> 1.0
          </div>

          {!scrolledToBottom && (
            <p className={styles.scrollHint}>↓ Scroll to read all</p>
          )}
        </div>

        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            disabled={!scrolledToBottom}
            aria-label="I have read and accept the monitoring terms"
          />
          <span>
            I have read and understood the monitoring terms, AI disclosure,
            data retention policy, and my rights above. I give my explicit
            consent to proceed with this monitored session.
          </span>
        </label>

        <button
          className={`btn-rhombus ${styles.acceptBtn}`}
          onClick={onAccept}
          disabled={!accepted || !scrolledToBottom}
          aria-label="Accept and continue"
        >
          Accept & Continue →
        </button>
      </div>
    </div>
  )
}
