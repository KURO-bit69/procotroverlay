import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, apiFetch } from '../store/auth'

interface SessionRow {
  id: string
  joinCode: string
  status: string
  candidateEmail: string | null
  riskScore: number
  eventCount: number
  startedAt: string | null
  createdAt: string
}

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-green-500/10 text-green-400 border-green-500/30',
  PREFLIGHT: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  PAUSED: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
  CREATED: 'bg-gray-700/50 text-gray-400 border-gray-700',
  COMPLETED: 'bg-gray-700/50 text-gray-400 border-gray-700',
  FORCE_ENDED: 'bg-red-500/10 text-red-400 border-red-500/30',
}

function riskColor(score: number): string {
  if (score >= 50) return 'text-red-400'
  if (score >= 25) return 'text-yellow-400'
  return 'text-green-400'
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const logout = useAuthStore((s) => s.logout)
  const user = useAuthStore((s) => s.user)
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [createEmail, setCreateEmail] = useState('')
  const [createUrl, setCreateUrl] = useState('')
  const [creating, setCreating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const fetchSessions = useCallback(async () => {
    try {
      const res = await apiFetch('/sessions')
      if (res.ok) {
        const data = await res.json()
        setSessions(data)
      }
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    fetchSessions()
    const interval = setInterval(fetchSessions, 10000)
    return () => clearInterval(interval)
  }, [fetchSessions])

  const handleCreate = async () => {
    if (!createEmail || !createUrl) return
    setCreating(true)
    try {
      const res = await apiFetch('/sessions', {
        method: 'POST',
        body: JSON.stringify({ candidateEmail: createEmail, meetingUrl: createUrl }),
      })
      if (res.ok) {
        setShowCreate(false)
        setCreateEmail('')
        setCreateUrl('')
        fetchSessions()
      }
    } catch { /* ignore */ }
    finally { setCreating(false) }
  }

  const handleDelete = async (session: SessionRow) => {
    if (!['COMPLETED', 'FORCE_ENDED', 'INTERRUPTED'].includes(session.status)) return
    if (!window.confirm(`Remove session ${session.joinCode}? Its events and report will also be deleted.`)) return
    setDeletingId(session.id)
    setError('')
    try {
      const res = await apiFetch(`/sessions/${encodeURIComponent(session.id)}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({})) as { message?: string }
      if (!res.ok) throw new Error(data.message || 'Could not remove this session.')
      setSessions((current) => current.filter((item) => item.id !== session.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove this session.')
    } finally {
      setDeletingId(null)
    }
  }

  const handleLogout = () => { logout(); navigate('/login') }

  const active = sessions.filter((s) => s.status === 'ACTIVE').length
  const review = sessions.filter((s) => s.riskScore >= 25 && s.status !== 'COMPLETED').length
  const completed = sessions.filter((s) => ['COMPLETED', 'FORCE_ENDED'].includes(s.status)).length

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-xl font-bold text-white">⬡ ProctorOverlay</h1>
            <p className="text-xs text-gray-500 mt-0.5">Proctor Dashboard — {user?.email}</p>
          </div>
          <button onClick={handleLogout}
            className="text-xs text-gray-400 hover:text-white transition-colors">Logout</button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: 'Active Sessions', value: active, color: 'text-green-400' },
            { label: 'Needs Review', value: review, color: 'text-yellow-400' },
            { label: 'Completed', value: completed, color: 'text-gray-400' },
          ].map((s) => (
            <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <p className="text-xs text-gray-500 uppercase tracking-widest font-semibold mb-1">{s.label}</p>
              <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Create modal */}
        {showCreate && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
            <h3 className="text-sm font-semibold text-white mb-4">Create Session</h3>
            <div className="flex gap-4">
              <input placeholder="candidate@email.com" value={createEmail}
                onChange={(e) => setCreateEmail(e.target.value)}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
              <input placeholder="https://meet.google.com/..." value={createUrl}
                onChange={(e) => setCreateUrl(e.target.value)}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
              <button onClick={handleCreate} disabled={creating}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold">
                {creating ? 'Creating…' : 'Create'}
              </button>
              <button onClick={() => setShowCreate(false)}
                className="text-gray-400 hover:text-white px-3 text-sm">Cancel</button>
            </div>
          </div>
        )}

        {/* Sessions table */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
            <h2 className="font-semibold text-sm text-white">Sessions</h2>
            <button onClick={() => setShowCreate(true)}
              className="text-xs text-blue-400 bg-blue-500/10 border border-blue-500/30 px-3 py-1.5 rounded-lg hover:bg-blue-500/20 transition-colors">
              + New Session
            </button>
          </div>

          {error && <p role="alert" className="px-5 py-3 text-sm text-red-300 bg-red-500/10">{error}</p>}

          {loading ? (
            <div className="p-8 text-center text-gray-500 text-sm">Loading sessions…</div>
          ) : sessions.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-sm">No sessions yet. Create one to get started.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase tracking-widest border-b border-gray-800">
                  <th className="px-5 py-3 text-left">Code</th>
                  <th className="px-5 py-3 text-left">Candidate</th>
                  <th className="px-5 py-3 text-left">Status</th>
                  <th className="px-5 py-3 text-left">Risk</th>
                  <th className="px-5 py-3 text-left">Events</th>
                  <th className="px-5 py-3 text-left">Created</th>
                  <th className="px-5 py-3 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                    <td className="px-5 py-4 font-mono text-xs text-gray-300">{s.joinCode}</td>
                    <td className="px-5 py-4 text-gray-200">{s.candidateEmail ?? '—'}</td>
                    <td className="px-5 py-4">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${STATUS_STYLES[s.status] ?? STATUS_STYLES.CREATED}`}>
                        {s.status}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`font-bold ${riskColor(s.riskScore)}`}>{s.riskScore}</span>
                    </td>
                    <td className="px-5 py-4 text-gray-400">{s.eventCount}</td>
                    <td className="px-5 py-4 text-gray-400 text-xs">{new Date(s.createdAt).toLocaleString()}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <button onClick={() => navigate(`/dashboard/session/${s.id}`)}
                          className="text-xs text-blue-400 hover:underline">
                          {s.status === 'ACTIVE' ? 'Live →' : 'View →'}
                        </button>
                        {['COMPLETED', 'FORCE_ENDED', 'INTERRUPTED'].includes(s.status) && (
                          <button onClick={() => void handleDelete(s)} disabled={deletingId === s.id}
                            className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50">
                            {deletingId === s.id ? 'Removing…' : 'Remove'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
