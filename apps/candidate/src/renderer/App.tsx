import { useState, useEffect } from 'react'
import ConsentScreen from './screens/ConsentScreen'
import LoginScreen from './screens/LoginScreen'
import PreCheckScreen from './screens/PreCheckScreen'
import OverlayScreen from './screens/OverlayScreen'
import CompletedScreen from './screens/CompletedScreen'

export type AppScreen = 'consent' | 'login' | 'precheck' | 'overlay' | 'completed'

export interface SessionState {
  sessionToken: string | null
  sessionId: string | null
  candidateEmail: string | null
}

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('consent')
  const [session, setSession] = useState<SessionState>({
    sessionToken: null,
    sessionId: null,
    candidateEmail: null,
  })
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null)

  useEffect(() => {
    if (screen === 'completed' && mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop())
      setMediaStream(null)
    }
  }, [screen, mediaStream])

  // Route to overlay screen if hash is #overlay (set by main process)
  useEffect(() => {
    if (window.location.hash === '#overlay') {
      setScreen('overlay')
    }
  }, [])

  // Listen for meeting closed event from main process
  useEffect(() => {
    const unsub = window.electronAPI?.onMeetingClosed(() => {
      setScreen('completed')
    })
    return () => { unsub?.() }
  }, [])

  switch (screen) {
    case 'consent':
      return (
        <ConsentScreen
          onAccept={() => setScreen('login')}
        />
      )
    case 'login':
      return (
        <LoginScreen
          onJoined={(token, sessionId, email) => {
            setSession({ sessionToken: token, sessionId, candidateEmail: email })
            setScreen('precheck')
          }}
        />
      )
    case 'precheck':
      return (
        <PreCheckScreen
          session={session}
          onSessionStart={() => setScreen('overlay')}
          onMediaStream={setMediaStream}
        />
      )
    case 'overlay':
      return <OverlayScreen session={session} mediaStream={mediaStream} />
    case 'completed':
      return <CompletedScreen />
    default:
      return null
  }
}
