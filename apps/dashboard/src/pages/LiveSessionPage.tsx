import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { io, type Socket } from 'socket.io-client'
import { useAuthStore, apiFetch, API_URL } from '../store/auth'
import type { MonitoringEvent, EventReviewStatus } from '@proctoroverlay/shared'

interface SessionDetail {
  id: string; joinCode: string; status: string; riskScore: number
  candidate: { email: string } | null
  startedAt: string | null; endedAt: string | null
}

interface LiveEvent extends MonitoringEvent { serverTimestamp?: string }

const SEVERITY_STYLES: Record<string, string> = {
  CRITICAL: 'border-l-red-500 bg-red-500/5',
  WARNING: 'border-l-yellow-500 bg-yellow-500/5',
  INFO: 'border-l-gray-600 bg-transparent',
}

const EVENT_LABELS: Record<string, string> = {
  APP_FOCUS_LOST: '⚠️ Focus Lost', APP_FOCUS_REGAINED: '✅ Focus Back',
  BLOCKLISTED_APP_DETECTED: '🚫 Blocked App', GAZE_OFF_SCREEN: '👁️ Gaze Off',
  GAZE_REPEATED_DIRECTION: '👁️ Repeated Glance', GAZE_FACE_NOT_DETECTED: '🚫 No Face',
  GAZE_MULTIPLE_FACES: '👥 Multiple Faces', GAZE_HEAD_TURNED: '↩️ Head Turned',
  MIC_MUTED: '🔇 Mic Muted', MIC_UNMUTED: '🔊 Mic Unmuted',
  MIC_DISCONNECTED: '🔌 Mic Off', MIC_DEVICE_CHANGED: '🎤 Mic Changed',
  SPEAKER_SECOND_VOICE_DETECTED: '🗣️ Extra Voice', SPEAKER_VOICE_MISMATCH: '🗣️ Voice Mismatch',
  CAMERA_COVERED: '🔲 Camera Covered', CAMERA_DISCONNECTED: '📷 Camera Off',
  MEETING_APP_DETECTED: '📹 Meeting App', MEETING_CALL_ACTIVE: '📞 In Call',
  MEETING_CALL_ENDED: '📞 Call Ended', MEETING_APP_CLOSED: '📹 Meeting Closed',
  MULTIPLE_MONITORS_DETECTED: '🖥️ Multi-Monitor', VIRTUAL_MACHINE_DETECTED: '⚠️ VM',
  CANDIDATE_NETWORK_DROPPED: '📡 Network Drop',
  SESSION_STARTED: '▶️ Started', SESSION_ENDED: '⏹️ Ended',
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 5) return 'now'
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h`
}

export default function LiveSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const token = useAuthStore((s) => s.token)

  const [session, setSession] = useState<SessionDetail | null>(null)
  const [events, setEvents] = useState<LiveEvent[]>([])
  const [candidateOnline, setCandidateOnline] = useState(false)
  const [riskScore, setRiskScore] = useState(0)
  const [warningText, setWarningText] = useState('')
  const [sendingAction, setSendingAction] = useState('')
  const feedRef = useRef<HTMLDivElement>(null)
  const socketRef = useRef<Socket | null>(null)

  // Fetch session detail
  useEffect(() => {
    if (!sessionId) return
    apiFetch(`/sessions/${sessionId}`).then(async (res) => {
      if (res.ok) {
        const data = await res.json()
        setSession(data)
        setRiskScore(data.riskScore)
      }
    })
  }, [sessionId])

  // Fetch historical events
  useEffect(() => {
    if (!sessionId) return
    apiFetch(`/sessions/${sessionId}/events?limit=500`).then(async (res) => {
      if (res.ok) {
        const data = await res.json()
        setEvents(data)
      }
    })
  }, [sessionId])

  // Connect Socket.IO for live events
  useEffect(() => {
    if (!sessionId || !token) return

    const socket = io(API_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
    })

    socket.on('connect', () => {
      socket.emit('session:join', {
        sessionId, token, role: 'PROCTOR',
      }, (res: { success: boolean }) => {
        if (res.success) console.log('[Dashboard] Joined session room')
      })
    })

    socket.on('event:new' as string, (event: LiveEvent) => {
      setEvents((prev) => {
        const next = [...prev, event]
        return next.length > 500 ? next.slice(-500) : next
      })
      // Increment risk score based on severity
      if (event.severity === 'WARNING') setRiskScore((r) => r + 5)
      if (event.severity === 'CRITICAL') setRiskScore((r) => r + 15)
    })

    socket.on('candidate:connectionState' as string, (data: { connected: boolean }) => {
      setCandidateOnline(data.connected)
    })

    socket.on('session:statusChanged' as string, (data: { status: string }) => {
      setSession((prev) => prev ? { ...prev, status: data.status } : prev)
    })

    socketRef.current = socket
    return () => { socket.disconnect() }
  }, [sessionId, token])

  // Auto-scroll feed
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight
  }, [events])

  // Proctor actions
  const handleAction = useCallback(async (action: string) => {
    if (!sessionId) return
    setSendingAction(action)
    try {
      if (action === 'warn') {
        // Send warning via Socket.IO
        socketRef.current?.emit('proctor:warning', {
          sessionId, message: warningText || 'Please focus on the interview.',
          severity: 'WARNING',
        })
        setWarningText('')
      } else if (action === 'pause') {
        await apiFetch(`/sessions/${sessionId}/status`, {
          method: 'PATCH', body: JSON.stringify({ status: 'PAUSED' }),
        })
      } else if (action === 'resume') {
        await apiFetch(`/sessions/${sessionId}/status`, {
          method: 'PATCH', body: JSON.stringify({ status: 'ACTIVE' }),
        })
      } else if (action === 'end') {
        await apiFetch(`/sessions/${sessionId}/status`, {
          method: 'PATCH', body: JSON.stringify({ status: 'FORCE_ENDED' }),
        })
      }
    } catch { /* ignore */ }
    finally { setSendingAction('') }
  }, [sessionId, warningText])

  // Review event
  const handleReview = useCallback(async (eventId: string, reviewStatus: string) => {
    if (!sessionId) return
    await apiFetch(`/sessions/${sessionId}/events/${eventId}/review`, {
      method: 'PATCH', body: JSON.stringify({ reviewStatus }),
    })
    setEvents((prev) => prev.map((e) =>
      e.eventId === eventId ? { ...e, reviewStatus: reviewStatus as EventReviewStatus } : e
    ))
  }, [sessionId])

  if (!session) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-500">Loading…</div>
  }

  const isLive = session.status === 'ACTIVE' || session.status === 'PREFLIGHT'
  const warnings = events.filter((e) => e.severity === 'WARNING' || e.severity === 'CRITICAL')

  return (
    <div className="min-h-screen bg-gray-950 p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-4">
          <button onClick={() => navigate('/dashboard')} className="text-gray-400 hover:text-white text-sm">← Back</button>
          <h1 className="text-lg font-bold text-white flex-1">
            Session {session.joinCode}
            <span className="text-gray-500 text-sm font-normal ml-2">
              {session.candidate?.email ?? 'No candidate'}
            </span>
          </h1>
          <div className={`flex items-center gap-2 text-xs font-semibold px-3 py-1 rounded-full border ${
            isLive ? 'bg-green-500/10 text-green-400 border-green-500/30' : 'bg-gray-700/50 text-gray-400 border-gray-700'
          }`}>
            {isLive && <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />}
            {session.status}
          </div>
        </div>

        <div className="grid grid-cols-12 gap-4">
          {/* Left: Status + Actions */}
          <div className="col-span-4 flex flex-col gap-4">
            {/* Risk Score */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <p className="text-xs text-gray-500 uppercase tracking-widest font-semibold mb-2">Risk Score</p>
              <p className={`text-5xl font-bold ${riskScore >= 50 ? 'text-red-400' : riskScore >= 25 ? 'text-yellow-400' : 'text-green-400'}`}>
                {riskScore}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {riskScore >= 50 ? 'High risk — review recommended' : riskScore >= 25 ? 'Moderate — monitor closely' : 'Low risk'}
              </p>
            </div>

            {/* Candidate Status */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <p className="text-xs text-gray-500 uppercase tracking-widest font-semibold mb-3">Candidate</p>
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-2.5 h-2.5 rounded-full ${candidateOnline ? 'bg-green-400' : 'bg-red-400'}`} />
                <span className="text-sm text-gray-300">{candidateOnline ? 'Online' : 'Offline'}</span>
              </div>
              <div className="text-xs text-gray-500 space-y-1">
                <p>Total events: {events.length}</p>
                <p>Warnings: {warnings.length}</p>
                {session.startedAt && <p>Started: {new Date(session.startedAt).toLocaleTimeString()}</p>}
              </div>
            </div>

            {/* Proctor Actions */}
            {isLive && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <p className="text-xs text-gray-500 uppercase tracking-widest font-semibold mb-3">Actions</p>
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <input placeholder="Warning message…" value={warningText}
                      onChange={(e) => setWarningText(e.target.value)}
                      className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-yellow-500" />
                    <button onClick={() => handleAction('warn')} disabled={!!sendingAction}
                      className="bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-white text-xs px-3 py-2 rounded-lg font-semibold">
                      ⚠️ Warn
                    </button>
                  </div>
                  <div className="flex gap-2">
                    {session.status === 'ACTIVE' ? (
                      <button onClick={() => handleAction('pause')} disabled={!!sendingAction}
                        className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white text-xs py-2 rounded-lg font-semibold">
                        ⏸ Pause
                      </button>
                    ) : (
                      <button onClick={() => handleAction('resume')} disabled={!!sendingAction}
                        className="flex-1 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-xs py-2 rounded-lg font-semibold">
                        ▶ Resume
                      </button>
                    )}
                    <button onClick={() => { if (confirm('End this session?')) handleAction('end') }}
                      disabled={!!sendingAction}
                      className="flex-1 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-xs py-2 rounded-lg font-semibold">
                      ⏹ End Session
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* View Report (post-session) */}
            {!isLive && session.status !== 'CREATED' && (
              <button onClick={() => navigate(`/dashboard/session/${sessionId}/report`)}
                className="bg-blue-600 hover:bg-blue-500 text-white text-sm py-3 rounded-xl font-semibold">
                📊 View Report
              </button>
            )}
          </div>

          {/* Right: Event Feed */}
          <div className="col-span-8 bg-gray-900 border border-gray-800 rounded-xl flex flex-col" style={{ maxHeight: 'calc(100vh - 8rem)' }}>
            <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
              <h2 className="font-semibold text-sm text-white">
                Event Feed <span className="text-gray-500 font-normal ml-1">{events.length}</span>
              </h2>
              {isLive && <span className="text-xs text-green-400 animate-pulse">● Live</span>}
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1" ref={feedRef}>
              {events.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-8">No events yet</p>
              ) : events.map((evt, i) => (
                <div key={evt.eventId || i}
                  className={`flex items-start gap-3 px-3 py-2 rounded-lg border-l-2 text-sm ${SEVERITY_STYLES[evt.severity] ?? SEVERITY_STYLES.INFO}`}>
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-gray-200 mr-2">
                      {EVENT_LABELS[evt.type] ?? evt.type}
                    </span>
                    <span className="text-gray-500 text-xs">
                      {typeof evt.metadata === 'object' && evt.metadata
                        ? ((evt.metadata as Record<string, unknown>).message as string) || ''
                        : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {evt.reviewStatus === 'UNREVIEWED' && (evt.severity === 'WARNING' || evt.severity === 'CRITICAL') && (
                      <div className="flex gap-1">
                        <button onClick={() => handleReview(evt.eventId, 'ACKNOWLEDGED')}
                          title="Acknowledge"
                          className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-0.5 rounded">✓</button>
                        <button onClick={() => handleReview(evt.eventId, 'FLAGGED')}
                          title="Flag"
                          className="text-xs bg-red-900/50 hover:bg-red-800/50 text-red-300 px-2 py-0.5 rounded">🚩</button>
                        <button onClick={() => handleReview(evt.eventId, 'DISMISSED')}
                          title="Dismiss"
                          className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-0.5 rounded">✕</button>
                      </div>
                    )}
                    {evt.reviewStatus !== 'UNREVIEWED' && (
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        evt.reviewStatus === 'FLAGGED' ? 'bg-red-900/50 text-red-300'
                          : evt.reviewStatus === 'ACKNOWLEDGED' ? 'bg-green-900/50 text-green-300'
                          : 'bg-gray-700 text-gray-400'
                      }`}>{evt.reviewStatus}</span>
                    )}
                    <span className="text-xs text-gray-600 w-8 text-right">{timeAgo(evt.timestamp)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
