// ============================================================
// ProctorOverlay Dashboard — Session Report Page
// Post-session report: timeline, flagged events, risk score, stats
// ============================================================

import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { apiFetch } from '../store/auth'

interface TimelineEntry {
  eventId: string
  type: string
  severity: string
  timestamp: string
  reviewStatus: string
  proctorNote: string | null
}

interface Report {
  sessionId: string
  candidateEmail: string | null
  proctorEmail: string | null
  status: string
  riskScore: number
  durationMs: number | null
  totalEvents: number
  eventsByType: Record<string, number>
  flaggedEvents: number
  timeline: TimelineEntry[]
  startedAt: string | null
  endedAt: string | null
}

const SEVERITY_STYLES: Record<string, string> = {
  CRITICAL: 'border-l-red-500 bg-red-500/5',
  WARNING: 'border-l-yellow-500 bg-yellow-500/5',
  INFO: 'border-l-gray-600 bg-transparent',
}

const REVIEW_STYLES: Record<string, string> = {
  FLAGGED: 'bg-red-900/50 text-red-300',
  ACKNOWLEDGED: 'bg-green-900/50 text-green-300',
  DISMISSED: 'bg-gray-700 text-gray-400',
  UNREVIEWED: 'bg-gray-800 text-gray-500',
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

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function riskLabel(score: number): { text: string; color: string } {
  if (score >= 50) return { text: 'High Risk', color: 'text-red-400' }
  if (score >= 25) return { text: 'Moderate Risk', color: 'text-yellow-400' }
  return { text: 'Low Risk', color: 'text-green-400' }
}

export default function SessionReportPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'ALL' | 'FLAGGED' | 'WARNING' | 'CRITICAL'>('ALL')

  useEffect(() => {
    if (!sessionId) return
    apiFetch(`/sessions/${sessionId}/report`).then(async (res) => {
      if (res.ok) {
        setReport(await res.json())
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.message || 'Failed to load report')
      }
    }).catch(() => setError('Network error'))
  }, [sessionId])

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <button onClick={() => navigate('/dashboard')}
            className="text-blue-400 hover:underline text-sm">← Back to Dashboard</button>
        </div>
      </div>
    )
  }

  if (!report) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-500">Loading report…</div>
  }

  const risk = riskLabel(report.riskScore)

  // Sort event types by count descending for the breakdown chart
  const sortedTypes = Object.entries(report.eventsByType)
    .sort(([, a], [, b]) => b - a)
  const maxCount = sortedTypes.length > 0 ? sortedTypes[0][1] : 1

  // Filter timeline
  const filteredTimeline = report.timeline.filter((e) => {
    if (filter === 'ALL') return true
    if (filter === 'FLAGGED') return e.reviewStatus === 'FLAGGED'
    return e.severity === filter
  })

  const warningCount = report.timeline.filter((e) => e.severity === 'WARNING').length
  const criticalCount = report.timeline.filter((e) => e.severity === 'CRITICAL').length

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <button onClick={() => navigate(`/dashboard/session/${sessionId}`)}
            className="text-gray-400 hover:text-white text-sm">← Back to Session</button>
          <h1 className="text-lg font-bold text-white flex-1">📊 Session Report</h1>
          <span className="text-xs text-gray-500">{report.candidateEmail}</span>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-5 gap-4 mb-6">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <p className="text-xs text-gray-500 uppercase tracking-widest font-semibold mb-1">Risk Score</p>
            <p className={`text-4xl font-bold ${risk.color}`}>{report.riskScore}</p>
            <p className={`text-xs mt-1 ${risk.color}`}>{risk.text}</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <p className="text-xs text-gray-500 uppercase tracking-widest font-semibold mb-1">Duration</p>
            <p className="text-2xl font-bold text-white">
              {report.durationMs ? formatDuration(report.durationMs) : '—'}
            </p>
            <p className="text-xs text-gray-500 mt-1">Session length</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <p className="text-xs text-gray-500 uppercase tracking-widest font-semibold mb-1">Total Events</p>
            <p className="text-2xl font-bold text-white">{report.totalEvents}</p>
            <p className="text-xs text-gray-500 mt-1">All events</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <p className="text-xs text-gray-500 uppercase tracking-widest font-semibold mb-1">Warnings</p>
            <p className="text-2xl font-bold text-yellow-400">{warningCount}</p>
            <p className="text-xs text-gray-500 mt-1">
              <span className="text-red-400 font-semibold">{criticalCount}</span> critical
            </p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <p className="text-xs text-gray-500 uppercase tracking-widest font-semibold mb-1">Flagged</p>
            <p className="text-2xl font-bold text-red-400">{report.flaggedEvents}</p>
            <p className="text-xs text-gray-500 mt-1">By proctor</p>
          </div>
        </div>

        {/* Session Info */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
          <div className="grid grid-cols-4 gap-6 text-sm">
            <div>
              <p className="text-xs text-gray-500 mb-1">Status</p>
              <p className="text-white font-semibold">{report.status}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Candidate</p>
              <p className="text-white">{report.candidateEmail ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Started</p>
              <p className="text-white">{report.startedAt ? new Date(report.startedAt).toLocaleString() : '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Ended</p>
              <p className="text-white">{report.endedAt ? new Date(report.endedAt).toLocaleString() : '—'}</p>
            </div>
          </div>
        </div>

        {/* Event Type Breakdown */}
        {sortedTypes.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
            <h2 className="text-sm font-semibold text-white mb-4">Event Breakdown by Type</h2>
            <div className="space-y-2">
              {sortedTypes.map(([type, count]) => (
                <div key={type} className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 w-44 truncate" title={type}>
                    {EVENT_LABELS[type] ?? type}
                  </span>
                  <div className="flex-1 h-5 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        type.includes('CRITICAL') || type.includes('SECOND_VOICE') || type.includes('MISMATCH')
                          ? 'bg-red-500/60' : type.includes('GAZE') || type.includes('FOCUS')
                          ? 'bg-yellow-500/60' : 'bg-blue-500/40'
                      }`}
                      style={{ width: `${Math.max((count / maxCount) * 100, 2)}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-300 font-mono w-8 text-right">{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Timeline */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
            <h2 className="font-semibold text-sm text-white">
              Timeline <span className="text-gray-500 font-normal ml-1">{filteredTimeline.length}</span>
            </h2>
            <div className="flex gap-1">
              {(['ALL', 'WARNING', 'CRITICAL', 'FLAGGED'] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`text-xs px-3 py-1 rounded-lg transition-colors ${
                    filter === f
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}>
                  {f === 'ALL' ? 'All' : f === 'FLAGGED' ? '🚩 Flagged' : f === 'CRITICAL' ? '🔴 Critical' : '🟡 Warning'}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {filteredTimeline.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-8">No events match filter</p>
            ) : (
              <div className="p-3 space-y-1">
                {filteredTimeline.map((evt) => (
                  <div key={evt.eventId}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg border-l-2 text-sm ${
                      SEVERITY_STYLES[evt.severity] ?? SEVERITY_STYLES.INFO
                    }`}>
                    <span className="text-xs text-gray-500 font-mono w-20 shrink-0">
                      {new Date(evt.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="font-semibold text-gray-200 flex-1">
                      {EVENT_LABELS[evt.type] ?? evt.type}
                    </span>
                    {evt.reviewStatus !== 'UNREVIEWED' && (
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        REVIEW_STYLES[evt.reviewStatus] ?? REVIEW_STYLES.UNREVIEWED
                      }`}>{evt.reviewStatus}</span>
                    )}
                    {evt.proctorNote && (
                      <span className="text-xs text-gray-400 italic max-w-48 truncate" title={evt.proctorNote}>
                        💬 {evt.proctorNote}
                      </span>
                    )}
                    <span className={`w-2 h-2 rounded-full shrink-0 ${
                      evt.severity === 'CRITICAL' ? 'bg-red-400'
                        : evt.severity === 'WARNING' ? 'bg-yellow-400'
                        : 'bg-gray-600'
                    }`} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* AI Disclosure */}
        <div className="bg-yellow-900/10 border border-yellow-800/30 rounded-xl p-5 mt-6">
          <h2 className="text-sm font-semibold text-yellow-400 mb-3">🤖 AI-Assisted Monitoring Disclosure</h2>
          <div className="text-xs text-gray-400 space-y-2 leading-relaxed">
            <p>
              This session was monitored using algorithmic detection tools. These tools flag
              potential integrity concerns for human review. <strong className="text-gray-300">A flag does NOT prove misconduct.</strong>
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Gaze tracking accuracy varies by lighting, glasses, skin tone, and camera angle.</li>
              <li>Speaker detection may produce false positives with background audio or meeting audio.</li>
              <li>Process monitoring detects names only — cannot read application content or determine intent.</li>
              <li>VM detection is heuristic — may false-positive on certain hardware configurations.</li>
            </ul>
            <p>
              <strong className="text-gray-300">No candidate was automatically rejected.</strong> Under GDPR Article 22
              and India's DPDP Act Section 12, candidates have the right to not be subject to decisions based
              solely on automated processing. This system enforces that right by design — all decisions are
              made by the human proctor.
            </p>
            <p>
              Candidates may submit appeals for any flagged event and may request accommodations for
              medical conditions that affect monitoring accuracy.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-4 mb-8 text-center text-xs text-gray-600 space-y-1">
          <p>ProctorOverlay Report — Generated {new Date().toLocaleString()}</p>
          <p>⚠️ This report is advisory. Final decisions must be made by the proctor.</p>
          <p>Data retained per session retention policy. GDPR + DPDP Act compliant. Policy v1.0</p>
        </div>
      </div>
    </div>
  )
}
