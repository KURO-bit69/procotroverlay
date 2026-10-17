import { useEffect, useState } from 'react'
import styles from './LoginScreen.module.css'

interface LoginScreenProps {
  onJoined: (token: string, sessionId: string, email: string) => void
}

type LoginStep = 'code' | 'email' | 'joining' | 'error'

export default function LoginScreen({ onJoined }: LoginScreenProps) {
  const [step, setStep] = useState<LoginStep>('code')
  const [code, setCode] = useState('')
  const [email, setEmail] = useState('')
  const [backendUrl, setBackendUrl] = useState('http://localhost:4000')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    void window.electronAPI?.getBackendUrl().then(setBackendUrl)
  }, [])

  const handleCodeSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const clean = code.trim().toUpperCase()
    if (clean.length !== 6) {
      setError('Session code must be exactly 6 characters.')
      return
    }
    setError('')
    setStep('email')
  }

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !email.includes('@')) {
      setError('Enter a valid email address.')
      return
    }

    setIsLoading(true)
    setStep('joining')
    setError('')

    try {
      const normalizedBackendUrl = backendUrl.trim().replace(/\/+$/, '')
      const saved = await window.electronAPI?.setBackendUrl(normalizedBackendUrl)
      if (!saved) throw new Error('Enter a valid server address, such as http://192.168.1.10:4000.')

      const res = await fetch(`${normalizedBackendUrl}/sessions/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim().toUpperCase(), email: email.trim() }),
      })

      if (!res.ok) {
        const body = (await res.json()) as { message?: string }
        throw new Error(body.message ?? `Server error ${res.status}`)
      }

      const data = (await res.json()) as {
        token: string
        sessionId: string
      }

      onJoined(data.token, data.sessionId, email.trim())
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err))
      setStep('error')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className={styles.container}>
      {/* Top bar */}
      <div className={styles.topBar}>
        <span className={styles.role}>Receiver (default)</span>
        <span className={styles.logo}>⬡ ProctorOverlay</span>
        <span />
      </div>

      <div className={styles.content}>
        <div className={styles.card}>
          <h2 className={styles.heading}>Join Interview Session</h2>
          <p className={styles.sub}>
            Enter the session code provided by your proctor.
          </p>

          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor="proctor-server-url">Proctor server</label>
            <input
              id="proctor-server-url"
              className={styles.input}
              type="url"
              value={backendUrl}
              onChange={(e) => setBackendUrl(e.target.value)}
              placeholder="http://192.168.1.10:4000"
              autoComplete="url"
              disabled={isLoading}
              aria-label="Proctor server address"
            />
            <p className={styles.hint}>Enter the server computer’s LAN address, or the hosted HTTPS address.</p>
          </div>

          {/* Step 1: Code */}
          {(step === 'code' || step === 'email') && (
            <form onSubmit={step === 'code' ? handleCodeSubmit : handleJoin}>
              <div className={styles.fieldGroup}>
                <label className={styles.label} htmlFor="session-code">
                  Session Code
                </label>
                <input
                  id="session-code"
                  className={styles.codeInput}
                  type="text"
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))
                  }
                  maxLength={6}
                  placeholder="A1B2C3"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={step === 'email'}
                  aria-label="Session code"
                />
              </div>

              {/* Step 2: Email — shown after code validated */}
              {step === 'email' && (
                <div className={styles.fieldGroup}>
                  <label className={styles.label} htmlFor="candidate-email">
                    Your Email
                  </label>
                  <input
                    id="candidate-email"
                    className={styles.input}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    autoFocus
                    aria-label="Candidate email"
                  />
                  <p className={styles.hint}>
                    This must match the email your proctor registered for this session.
                  </p>
                </div>
              )}

              {error && <p className={styles.error}>{error}</p>}

              <button
                type="submit"
                className="btn-rhombus"
                disabled={code.length !== 6}
                aria-label={step === 'code' ? 'Verify code' : 'Join session'}
              >
                {step === 'code' ? 'Verify Code →' : 'Join Session →'}
              </button>
            </form>
          )}

          {/* Joining spinner */}
          {step === 'joining' && (
            <div className={styles.spinner}>
              <div className={styles.spinnerDot} />
              <span>Connecting to session…</span>
            </div>
          )}

          {/* Error state */}
          {step === 'error' && (
            <div>
              <p className={styles.error}>{error}</p>
              <button
                className={styles.retryBtn}
                onClick={() => {
                  setStep('code')
                  setCode('')
                  setEmail('')
                  setError('')
                }}
              >
                ← Try again
              </button>
            </div>
          )}
        </div>

        <p className={styles.privacy}>
          The meeting link is resolved by the server and is never shown in this app.
        </p>
      </div>
    </div>
  )
}
