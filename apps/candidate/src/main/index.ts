import { app, shell, BrowserWindow, ipcMain, session } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { is } from '@electron-toolkit/utils'
import { MonitorManager } from './monitors/monitor-manager'
import { EventSyncClient } from './event-sync'
import type { MonitoringEvent } from '@proctoroverlay/shared'

// ── Window references ──────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let meetingWindow: BrowserWindow | null = null

// ── Session state ──────────────────────────────────────────────────
let sessionToken: string | null = null
let sessionId: string | null = null
let resolvedMeetingUrl: string | null = null
let monitorManager: MonitorManager | null = null
let eventSync: EventSyncClient | null = null
let sessionStatusFinalized = false

let SERVER_URL = process.env.SERVER_URL || 'http://localhost:4000'

function restoreServerUrl(): void {
  if (process.env.SERVER_URL) return
  try {
    const configPath = join(app.getPath('userData'), 'receiver-config.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as { serverUrl?: unknown }
    if (typeof config.serverUrl === 'string') {
      const parsed = new URL(config.serverUrl)
      if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.pathname === '/') {
        SERVER_URL = parsed.origin
      }
    }
  } catch {
    // First launch: use the local development server until the candidate sets
    // the proctor server address on the join screen.
  }
}

// ── Create windows ─────────────────────────────────────────────────
function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    show: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function isTrustedCandidateRenderer(contents: Electron.WebContents | null): boolean {
  if (!contents || contents !== mainWindow?.webContents) return false

  const currentUrl = contents.getURL()
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devUrl) {
    try {
      return new URL(currentUrl).origin === new URL(devUrl).origin
    } catch {
      return false
    }
  }

  // A locally launched, built receiver is unpackaged (so is.dev is true) but
  // still loads its trusted file:// renderer when Electron is started without
  // electron-vite's ELECTRON_RENDERER_URL. Allow that exact local entry point.
  return currentUrl === pathToFileURL(join(__dirname, '../renderer/index.html')).href
}

function configureMediaPermissions(): void {
  // Grant camera and microphone only to the candidate app's own main renderer.
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) =>
    isTrustedCandidateRenderer(contents) && (
      (permission === 'media' && (details.mediaType === 'video' || details.mediaType === 'audio'))
    ),
  )

  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (!isTrustedCandidateRenderer(contents)) {
      callback(false)
      return
    }
    const mediaRequest = details as Electron.MediaAccessPermissionRequest
    const needsMedia = mediaRequest.mediaTypes?.some((type) => type === 'video' || type === 'audio') ?? false
    callback(permission === 'media' && needsMedia)
  })
}

function createOverlayWindow(): void {
  overlayWindow = new BrowserWindow({
    width: 320,
    height: 180,
    x: 20,
    y: 20,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  overlayWindow.setIgnoreMouseEvents(true, { forward: true })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    overlayWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#overlay`)
  } else {
    overlayWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: 'overlay',
    })
  }
}

function createMeetingWindow(meetingUrl: string): void {
  meetingWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
    },
  })

  meetingWindow.loadURL(meetingUrl)

  meetingWindow.on('closed', () => {
    meetingWindow = null
    // Notify renderer that meeting was closed
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('meeting:closed')
    }
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('meeting:closed')
    }
    void markCandidateSessionEnded()
  })
}

async function markCandidateSessionEnded(): Promise<void> {
  if (!sessionId || !sessionToken || sessionStatusFinalized) return
  sessionStatusFinalized = true
  try {
    const response = await fetch(`${SERVER_URL}/sessions/${encodeURIComponent(sessionId)}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ status: 'INTERRUPTED' }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error('Session cleanup request was rejected')
  } catch {
    sessionStatusFinalized = false
    console.warn('[Session] Could not mark session ended; profile cleanup will retry on restart')
  }
}

// ── Broadcast monitor event to all renderer windows + sync to server ──
function broadcastMonitorEvent(event: MonitoringEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('monitor:event', event)
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('monitor:event', event)
  }
  // Push to server sync
  if (eventSync) {
    eventSync.pushEvent(event)
  }
}

// ── Start / stop monitors ──────────────────────────────────────────
function startMonitors(sid: string): void {
  if (monitorManager) {
    monitorManager.stopAll()
  }

  monitorManager = new MonitorManager({ sessionId: sid })

  monitorManager.onEvent((event) => {
    broadcastMonitorEvent(event)
  })

  monitorManager.startAll()
  console.log('[Main] Monitor manager started for session', sid)

  // Start event sync to server
  if (sessionToken) {
    eventSync = new EventSyncClient({
      serverUrl: SERVER_URL,
      sessionId: sid,
      token: sessionToken,
    })

    eventSync.onDisconnect((durationMs) => {
      console.warn(`[EventSync] Disconnected for ${Math.round(durationMs / 1000)}s — flagging`)
      // Emit a disconnect event so it shows up in the feed
      const disconnectEvent: MonitoringEvent = {
        eventId: `evt-disconnect-${Date.now()}`,
        sessionId: sid,
        type: 'CANDIDATE_NETWORK_DROPPED',
        severity: 'WARNING',
        timestamp: new Date().toISOString(),
        source: 'CANDIDATE_APP',
        metadata: { durationMs, message: `Network disconnected for ${Math.round(durationMs / 1000)}s` },
        reviewStatus: 'UNREVIEWED',
      }
      broadcastMonitorEvent(disconnectEvent)
    })

    eventSync.onStateChange((state) => {
      console.log(`[EventSync] Connection state: ${state}`)
    })

    eventSync.connect()
  }
}

function stopMonitors(): void {
  if (monitorManager) {
    monitorManager.stopAll()
    monitorManager = null
    console.log('[Main] Monitor manager stopped')
  }
  if (eventSync) {
    eventSync.disconnect()
    eventSync = null
    console.log('[Main] Event sync disconnected')
  }
}

// ── IPC handlers ───────────────────────────────────────────────────
function registerIpcHandlers(): void {

  // ── App-level ──────────────────────────────────────────────────
  ipcMain.handle('app:getBackendUrl', async () => {
    return SERVER_URL
  })

  ipcMain.handle('app:setBackendUrl', async (event, value: unknown) => {
    if (!isTrustedCandidateRenderer(event.sender) || typeof value !== 'string') return false
    try {
      const parsed = new URL(value.trim())
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return false
      SERVER_URL = parsed.origin
      writeFileSync(join(app.getPath('userData'), 'receiver-config.json'), JSON.stringify({ serverUrl: SERVER_URL }), 'utf8')
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('session:setCandidateSession', async (_event, token: string, id: string) => {
    if (typeof token !== 'string' || !token || typeof id !== 'string' || !id) {
      throw new Error('Candidate session details are incomplete')
    }
    sessionToken = token
    sessionId = id
    sessionStatusFinalized = false
  })

  // ── Session: join (used by LoginScreen's direct fetch fallback) ──
  ipcMain.handle('session:join', async (_event, code: string) => {
    try {
      const res = await fetch(`${SERVER_URL}/sessions/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Join failed' }))
        return { success: false, error: err.message || 'Join failed' }
      }
      const data = await res.json()
      sessionToken = data.token
      sessionId = data.sessionId
      return { success: true, sessionId: data.sessionId }
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error' }
    }
  })

  // ── Meeting lifecycle (used by PreCheckScreen) ──────────────────
  // Step 1: Resolve meeting URL server-side (candidate never sees it)
  ipcMain.handle('session:resolveMeetingUrl', async (_event, token: string) => {
    const tkn = token || sessionToken
    if (!tkn || !sessionId) throw new Error('No active session')

    const res = await fetch(`${SERVER_URL}/sessions/resolve-meeting`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tkn}`,
      },
      body: JSON.stringify({ sessionId }),
    })
    if (!res.ok) throw new Error('Failed to resolve meeting URL')
    const data = await res.json()
    resolvedMeetingUrl = data.meetingUrl
  })

  // Step 2: Open meeting in controlled BrowserWindow
  ipcMain.handle('session:openMeeting', async () => {
    if (!resolvedMeetingUrl) throw new Error('Meeting URL not resolved')
    createMeetingWindow(resolvedMeetingUrl)
  })

  // Step 3: Show overlay window
  ipcMain.handle('session:showOverlay', async () => {
    if (!sessionId || !sessionToken) throw new Error('No active candidate session')
    const statusResponse = await fetch(`${SERVER_URL}/sessions/${encodeURIComponent(sessionId)}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ status: 'ACTIVE' }),
    })
    if (!statusResponse.ok) throw new Error('Could not activate candidate session')
    createOverlayWindow()
    // Start monitors when overlay is shown
    if (sessionId) {
      startMonitors(sessionId)
    }
  })

  // Step 4: Hide main window (candidate only sees overlay + meeting)
  ipcMain.handle('session:closeMain', async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide()
    }
  })

  // ── Session: combined start monitoring (alternative path) ───────
  ipcMain.handle('session:startMonitoring', async () => {
    if (!sessionId || !sessionToken) {
      return { success: false, error: 'No active session' }
    }

    try {
      const res = await fetch(`${SERVER_URL}/sessions/resolve-meeting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ sessionId }),
      })
      if (!res.ok) {
        return { success: false, error: 'Failed to resolve meeting URL' }
      }
      const data = await res.json()
      const meetingUrl: string = data.meetingUrl

      createMeetingWindow(meetingUrl)
      createOverlayWindow()
      startMonitors(sessionId)

      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error' }
    }
  })

  // ── Session: end ───────────────────────────────────────────────
  ipcMain.handle('session:end', async () => {
    stopMonitors()
    await markCandidateSessionEnded()

    if (meetingWindow) {
      meetingWindow.close()
      meetingWindow = null
    }
    if (overlayWindow) {
      overlayWindow.close()
      overlayWindow = null
    }
    sessionToken = null
    sessionId = null
    resolvedMeetingUrl = null
    return { success: true }
  })

  ipcMain.handle('system:openPrivacySettings', async (event, setting: unknown) => {
    if (!isTrustedCandidateRenderer(event.sender)) return false
    const settingsUriByKey = {
      camera: 'ms-settings:privacy-webcam',
      microphone: 'ms-settings:privacy-microphone',
    } as const
    if (typeof setting !== 'string' || !(setting in settingsUriByKey)) return false
    try {
      await shell.openExternal(settingsUriByKey[setting as keyof typeof settingsUriByKey])
      return true
    } catch {
      return false
    }
  })

  // ── Monitor IPC handlers ──────────────────────────────────────
  ipcMain.handle('monitor:getRecentEvents', async (_event, count?: number) => {
    if (!monitorManager) return []
    return monitorManager.getRecentEvents(count ?? 50)
  })

  ipcMain.handle('monitor:getFocusHistory', async () => {
    if (!monitorManager) return []
    return monitorManager.getFocusHistory()
  })

  ipcMain.handle('monitor:getEnvironmentSnapshot', async () => {
    if (!monitorManager) return null
    return monitorManager.getEnvironmentSnapshot()
  })

  ipcMain.handle('monitor:getMeetingState', async () => {
    if (!monitorManager) return null
    return monitorManager.getMeetingState()
  })

  // ── Audio/mic events from renderer (audio pipeline runs in renderer) ──
  ipcMain.on('monitor:audioEvent', (_event, audioEvent) => {
    broadcastMonitorEvent(audioEvent)
  })
}

// ── App lifecycle ──────────────────────────────────────────────────
app.whenReady().then(() => {
  restoreServerUrl()
  configureMediaPermissions()
  registerIpcHandlers()
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  stopMonitors()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
