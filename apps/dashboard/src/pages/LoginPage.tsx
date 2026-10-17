import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, API_URL } from '../store/auth'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({ message: 'Login failed' }))
        setError(data.message || 'Login failed')
        return
      }

      const data = await res.json()
      if (data.user.role !== 'PROCTOR') {
        setError('Only proctor accounts can access the dashboard')
        return
      }

      setAuth(data.token, data.user)
      navigate('/dashboard')
    } catch {
      setError('Could not connect to server')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 w-full max-w-sm flex flex-col gap-6">
        <div className="text-center">
          <span className="text-3xl">⬡</span>
          <h1 className="text-lg font-bold mt-2 text-white">ProctorOverlay</h1>
          <p className="text-xs text-gray-500 mt-1">Proctor Dashboard</p>
        </div>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 uppercase tracking-widest font-semibold" htmlFor="email">Email</label>
            <input id="email" type="email" placeholder="proctor@company.com"
              value={email} onChange={(e) => setEmail(e.target.value)} required
              className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 uppercase tracking-widest font-semibold" htmlFor="password">Password</label>
            <input id="password" type="password" placeholder="••••••••"
              value={password} onChange={(e) => setPassword(e.target.value)} required
              className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500" />
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">{error}</p>
          )}

          <button type="submit" disabled={loading}
            className="mt-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors">
            {loading ? 'Signing in…' : 'Sign in →'}
          </button>
        </form>

        <p className="text-xs text-center text-gray-600">
          Test: proctor@example.com / proctor123
        </p>
      </div>
    </div>
  )
}
