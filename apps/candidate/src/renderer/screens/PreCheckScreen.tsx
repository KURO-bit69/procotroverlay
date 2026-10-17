import { useState, useEffect, useRef, useCallback } from 'react'
import type { SessionState } from '../App'
import type { PreCheckStatus } from '@proctoroverlay/shared'
import { isPreCheckPassed } from '@proctoroverlay/shared'
import styles from './PreCheckScreen.module.css'
import CameraCard from '../components/precheck/CameraCard'
import MicCard from '../components/precheck/MicCard'
import RecordingStatusCard from '../components/precheck/RecordingStatusCard'

interface PreCheckScreenProps {
  session: SessionState
  onSessionStart: () => void
  onMediaStream: (stream: MediaStream) => void
}

export default function PreCheckScreen({ session, onSessionStart, onMediaStream }: PreCheckScreenProps) {
  const [status, setStatus] = useState<PreCheckStatus>({
    camera: 'IDLE',
    microphone: 'IDLE',
    voiceBaseline: 'IDLE',
    codeValidated: true, // already validated on login screen
    consentGiven: true,  // already given on consent screen
  })

  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  const [cameraError, setCameraError] = useState('')
  const [isJoining, setIsJoining] = useState(false)

  const updateStatus = useCallback(
    (patch: Partial<PreCheckStatus>) =>
      setStatus((prev) => ({ ...prev, ...patch })),
    [],
  )

  // Ask Windows for one combined camera + microphone capture. Some drivers
  // reject simultaneous independent getUserMedia requests for the same device.
  useEffect(() => {
    let mounted = true
    let stream: MediaStream | null = null
    const cameraConstraints: MediaTrackConstraints = {
      width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user',
    }
    const explainCameraError = (err: unknown) => {
      const name = err instanceof DOMException ? err.name : ''
      const msg = err instanceof Error ? err.message : String(err)
      if (name === 'NotAllowedError' || name === 'SecurityError' || msg.includes('Permission denied')) return 'Camera permission denied. Allow desktop apps to access your camera in Windows Privacy settings, then restart the Receiver.'
      if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No camera was found. Connect or enable a camera, then restart the Receiver.'
      if (name === 'NotReadableError' || name === 'TrackStartError') return 'Windows could not start the camera. Close other apps using it, then retry.'
      return `Camera unavailable (${name || msg || 'unknown error'})`
    }
    const startCapture = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: cameraConstraints, audio: true })
        if (!mounted) { stream.getTracks().forEach(t => t.stop()); return }
        setCameraStream(stream)
        onMediaStream(stream)
        updateStatus({ camera: 'GRANTED', microphone: 'GRANTED' })
      } catch (err) {
        if (!mounted) return
        setCameraError(explainCameraError(err))
        updateStatus({ camera: 'ERROR' })
        // Keep the working microphone check available when the camera itself
        // cannot start, while clearly leaving camera access failed.
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
          if (!mounted) { stream.getTracks().forEach(t => t.stop()); return }
          setCameraStream(stream)
          onMediaStream(stream)
          updateStatus({ microphone: 'GRANTED' })
        } catch {
          if (mounted) updateStatus({ microphone: 'ERROR' })
        }
      }
    }
    void startCapture()
    return () => { mounted = false; stream?.getTracks().forEach(t => t.stop()) }
  }, [onMediaStream, updateStatus])

  const handleVoiceEnrollmentChange = (state: 'RECORDING' | 'ENROLLED' | 'ERROR') => {
    updateStatus({ voiceBaseline: state })
  }

  const openPrivacySettings = async (setting: 'camera' | 'microphone') => {
    try {
      const opened = await window.electronAPI?.openWindowsPrivacySettings(setting)
      if (!opened) throw new Error('Windows Settings could not be opened from this receiver.')
    } catch (error) {
      console.error('Could not open Windows privacy settings:', error)
    }
  }

  const canJoin = isPreCheckPassed(status)

  const handleJoin = async () => {
    if (!canJoin || isJoining) return
    setIsJoining(true)

    try {
      await window.electronAPI?.setCandidateSession(session.sessionToken ?? '', session.sessionId ?? '')
      // 1. Tell main process to resolve meeting URL (server-side)
      await window.electronAPI?.resolveMeetingUrl(session.sessionToken ?? '')
      // 2. Tell main process to open the meeting window (URL stays in main)
      await window.electronAPI?.openMeeting()
      // 3. Show overlay window
      await window.electronAPI?.showOverlay()
      // 4. Hide main window
      await window.electronAPI?.closeMain()

      onSessionStart()
    } catch (err) {
      console.error('Failed to start session:', err)
      setIsJoining(false)
    }
  }

  return (
    <div className={styles.container}>
      {/* Top bar */}
      <div className={styles.topBar}>
        <span className={styles.role}>Receiver (default)</span>
        <span className={styles.logo}>⬡ ProctorOverlay</span>
        <button
          className="btn-rhombus"
          disabled={!canJoin || isJoining}
          onClick={handleJoin}
          aria-label="Join meet"
        >
          {isJoining ? 'Starting…' : '⬡ Join Meet'}
        </button>
      </div>

      {/* Setup cards */}
      <div className={styles.grid}>
        {/* Camera */}
        <CameraCard
          status={status.camera}
          stream={cameraStream?.getVideoTracks().length ? cameraStream : null}
          error={cameraError}
          onOpenPrivacySettings={() => void openPrivacySettings('camera')}
        />

        {/* Microphone */}
        <MicCard
          status={status.microphone}
          stream={cameraStream?.getAudioTracks().length ? cameraStream : null}
          sessionId={session.sessionId ?? ''}
          sessionToken={session.sessionToken ?? ''}
          onEnrollmentChange={handleVoiceEnrollmentChange}
          onOpenPrivacySettings={() => void openPrivacySettings('microphone')}
        />

        {/* Recording Status */}
        <RecordingStatusCard
          status={status}
        />
      </div>

      {/* Bottom bar: session code (display only — already validated) */}
      <div className={styles.bottomBar}>
        <span className={styles.sessionLabel}>Session</span>
        <span className={styles.sessionCode}>
          {session.sessionId
            ? '● Active — code verified'
            : 'No active session'}
        </span>
        {!canJoin && (
          <span className={styles.hint}>
            Complete all checks above to enable Join Meet
          </span>
        )}
      </div>
    </div>
  )
}
