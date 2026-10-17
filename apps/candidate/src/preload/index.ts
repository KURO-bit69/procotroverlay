import { contextBridge, ipcRenderer } from 'electron'

// ── Types matching the real MonitoringEvent shape from @proctoroverlay/shared ──

export interface MonitorEventIPC {
  eventId: string
  sessionId: string
  type: string
  severity: string
  timestamp: string          // ISO 8601
  source: string
  metadata: Record<string, unknown>
  reviewStatus: string
  confidence?: number
}

export interface FocusHistoryEntry {
  owner: string
  title: string
  ts: string                 // ISO 8601
}

export interface EnvironmentSnapshot {
  displayCount: number
  isVM: boolean
  vmIndicators: string[]
  isRemoteDesktop: boolean
  virtualCameras: string[]
  virtualAudioDevices: string[]
}

export interface MeetingStateIPC {
  appDetected: boolean
  platform: string | null
  callActive: boolean
  lastChecked: string
}

export interface ElectronAPI {
  // Session
  joinSession: (code: string) => Promise<{ success: boolean; sessionId?: string; error?: string }>
  setCandidateSession: (token: string, sessionId: string) => Promise<void>
  startMonitoring: () => Promise<{ success: boolean; error?: string }>
  endSession: () => Promise<{ success: boolean }>

  // Backend URL (used by LoginScreen to call fetch directly)
  getBackendUrl: () => Promise<string>
  setBackendUrl: (url: string) => Promise<boolean>

  // Meeting lifecycle (used by PreCheckScreen's handleJoin)
  resolveMeetingUrl: (token: string) => Promise<void>
  openMeeting: () => Promise<void>
  showOverlay: () => Promise<void>
  closeMain: () => Promise<void>

  // Meeting closed event (main → renderer push)
  onMeetingClosed: (callback: () => void) => () => void

  openWindowsPrivacySettings: (setting: 'camera' | 'microphone') => Promise<boolean>

  // Monitor events — real-time push from main process
  onMonitorEvent: (callback: (event: MonitorEventIPC) => void) => () => void

  // Renderer → main: send audio/mic events (audio pipeline runs in renderer)
  sendAudioEvent: (event: MonitorEventIPC) => void

  // Monitor queries — pull from main process
  getRecentEvents: (count?: number) => Promise<MonitorEventIPC[]>
  getFocusHistory: () => Promise<FocusHistoryEntry[]>
  getEnvironmentSnapshot: () => Promise<EnvironmentSnapshot | null>
  getMeetingState: () => Promise<MeetingStateIPC | null>
}

const api: ElectronAPI = {
  joinSession: (code) => ipcRenderer.invoke('session:join', code),
  setCandidateSession: (token, sessionId) => ipcRenderer.invoke('session:setCandidateSession', token, sessionId),
  startMonitoring: () => ipcRenderer.invoke('session:startMonitoring'),
  endSession: () => ipcRenderer.invoke('session:end'),

  getBackendUrl: () => ipcRenderer.invoke('app:getBackendUrl'),
  setBackendUrl: (url) => ipcRenderer.invoke('app:setBackendUrl', url),

  resolveMeetingUrl: (token) => ipcRenderer.invoke('session:resolveMeetingUrl', token),
  openMeeting: () => ipcRenderer.invoke('session:openMeeting'),
  showOverlay: () => ipcRenderer.invoke('session:showOverlay'),
  closeMain: () => ipcRenderer.invoke('session:closeMain'),

  onMeetingClosed: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('meeting:closed', handler)
    return () => { ipcRenderer.removeListener('meeting:closed', handler) }
  },

  openWindowsPrivacySettings: (setting) => ipcRenderer.invoke('system:openPrivacySettings', setting),

  onMonitorEvent: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, monitorEvent: MonitorEventIPC) => {
      callback(monitorEvent)
    }
    ipcRenderer.on('monitor:event', handler)
    return () => { ipcRenderer.removeListener('monitor:event', handler) }
  },

  sendAudioEvent: (event) => {
    ipcRenderer.send('monitor:audioEvent', event)
  },

  getRecentEvents: (count) => ipcRenderer.invoke('monitor:getRecentEvents', count),
  getFocusHistory: () => ipcRenderer.invoke('monitor:getFocusHistory'),
  getEnvironmentSnapshot: () => ipcRenderer.invoke('monitor:getEnvironmentSnapshot'),
  getMeetingState: () => ipcRenderer.invoke('monitor:getMeetingState'),
}

contextBridge.exposeInMainWorld('electronAPI', api)
