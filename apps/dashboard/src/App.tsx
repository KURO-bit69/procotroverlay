// ============================================================
// ProctorOverlay Dashboard — App Router
// Auth-guarded routing for all dashboard pages
// ============================================================

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/auth'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import LiveSessionPage from './pages/LiveSessionPage'
import SessionReportPage from './pages/SessionReportPage'
import './index.css'

/** Redirect to /login if no token */
function AuthGuard({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token)
  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        {/* Protected routes */}
        <Route path="/dashboard" element={<AuthGuard><DashboardPage /></AuthGuard>} />
        <Route path="/dashboard/session/:sessionId" element={<AuthGuard><LiveSessionPage /></AuthGuard>} />
        <Route path="/dashboard/session/:sessionId/report" element={<AuthGuard><SessionReportPage /></AuthGuard>} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
