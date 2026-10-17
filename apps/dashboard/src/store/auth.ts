// ============================================================
// ProctorOverlay Dashboard — Auth Store (Zustand)
// ============================================================

import { create } from 'zustand'

interface AuthState {
  token: string | null
  user: { id: string; email: string; role: string } | null
  setAuth: (token: string, user: { id: string; email: string; role: string }) => void
  logout: () => void
  isAuthenticated: () => boolean
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: localStorage.getItem('proctor_token'),
  user: JSON.parse(localStorage.getItem('proctor_user') || 'null'),

  setAuth: (token, user) => {
    localStorage.setItem('proctor_token', token)
    localStorage.setItem('proctor_user', JSON.stringify(user))
    set({ token, user })
  },

  logout: () => {
    localStorage.removeItem('proctor_token')
    localStorage.removeItem('proctor_user')
    set({ token: null, user: null })
  },

  isAuthenticated: () => !!get().token,
}))

export const API_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000'

/** Helper: fetch with auth header */
export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = useAuthStore.getState().token
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
}
