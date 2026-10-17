// ============================================================
// ProctorOverlay — Meeting Detector
// Detects meeting applications and their call state using
// process names and window titles. Platform-independent of
// any specific meeting SDK — works with any provider.
// Runs in Electron main process only.
// ============================================================

import { exec } from 'child_process'
import { promisify } from 'util'
import type { MonitoringEvent } from '@proctoroverlay/shared'

const execAsync = promisify(exec)

let _idCounter = 0
const nextId = (): string => `evt-mtg-${Date.now()}-${++_idCounter}`

// ── Meeting platform definitions ────────────────────────────────

export interface MeetingPlatform {
  name: string
  /** Process names to match (case-insensitive, partial match) */
  processPatterns: string[]
  /** Window title patterns that indicate app is open */
  appTitlePatterns: RegExp[]
  /** Window title patterns that indicate an active call */
  callActiveTitlePatterns: RegExp[]
}

const PLATFORMS: MeetingPlatform[] = [
  {
    name: 'Zoom',
    processPatterns: ['zoom', 'zoomit'],
    appTitlePatterns: [/zoom/i],
    callActiveTitlePatterns: [
      /zoom meeting/i,
      /zoom webinar/i,
      /zoom -.+meeting/i,
    ],
  },
  {
    name: 'Microsoft Teams',
    processPatterns: ['teams', 'ms-teams'],
    appTitlePatterns: [/microsoft teams/i, /teams/i],
    callActiveTitlePatterns: [
      /microsoft teams .* meeting/i,
      /teams .* call/i,
      /meeting with/i,
    ],
  },
  {
    name: 'Google Meet',
    processPatterns: [], // Meet runs in browser — detect via window title
    appTitlePatterns: [/google meet/i, /meet\.google\.com/i],
    callActiveTitlePatterns: [
      /meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i,
      /google meet .* - /i,
    ],
  },
  {
    name: 'Webex',
    processPatterns: ['webexmta', 'ciscowebex', 'webex', 'atmgr'],
    appTitlePatterns: [/webex/i, /cisco webex/i],
    callActiveTitlePatterns: [
      /webex meeting/i,
      /webex .* meeting/i,
    ],
  },
  {
    name: 'Discord',
    processPatterns: ['discord'],
    appTitlePatterns: [/discord/i],
    callActiveTitlePatterns: [
      /discord .* voice/i,
    ],
  },
]

export interface MeetingDetectorConfig {
  pollIntervalMs: number
  /** Extra platforms to detect beyond defaults */
  extraPlatforms?: MeetingPlatform[]
}

export interface MeetingState {
  /** Is any known meeting app currently running */
  appDetected: boolean
  /** Name of the detected platform (null if none) */
  platform: string | null
  /** Is a call/meeting currently active (not just app open) */
  callActive: boolean
  /** When the current state was last verified */
  lastChecked: string
}

interface WindowInfo {
  title: string
  processName: string
}

export class MeetingDetector {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private config: MeetingDetectorConfig
  private onEvent: (event: MonitoringEvent) => void
  private sessionId: string
  private platforms: MeetingPlatform[]

  private currentState: MeetingState = {
    appDetected: false,
    platform: null,
    callActive: false,
    lastChecked: new Date().toISOString(),
  }

  constructor(
    sessionId: string,
    onEvent: (event: MonitoringEvent) => void,
    config?: Partial<MeetingDetectorConfig>,
  ) {
    this.sessionId = sessionId
    this.onEvent = onEvent
    this.config = {
      pollIntervalMs: config?.pollIntervalMs ?? 5000,
    }
    this.platforms = [...PLATFORMS, ...(config?.extraPlatforms ?? [])]
  }

  start(): void {
    if (this.intervalId) return
    console.log('[MeetingDetector] Started')
    this.poll()
    this.intervalId = setInterval(() => this.poll(), this.config.pollIntervalMs)
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    console.log('[MeetingDetector] Stopped')
  }

  /** Current meeting state — callable via IPC */
  getState(): MeetingState {
    return { ...this.currentState }
  }

  // ── Polling ─────────────────────────────────────────────────

  private async poll(): Promise<void> {
    try {
      const windows = await this.getWindows()
      const processes = await this.getProcessNames()

      let detectedPlatform: string | null = null
      let callActive = false

      for (const platform of this.platforms) {
        // Check 1: process names
        const processMatch = platform.processPatterns.some((pattern) =>
          processes.some((p) => p.toLowerCase().includes(pattern.toLowerCase())),
        )

        // Check 2: window titles matching app patterns
        const appTitleMatch = platform.appTitlePatterns.some((regex) =>
          windows.some((w) => regex.test(w.title)),
        )

        if (processMatch || appTitleMatch) {
          detectedPlatform = platform.name

          // Check if call is active via title patterns
          const callTitleMatch = platform.callActiveTitlePatterns.some(
            (regex) => windows.some((w) => regex.test(w.title)),
          )
          if (callTitleMatch) {
            callActive = true
          }

          break // Use first match
        }
      }

      // Also check if our own meeting BrowserWindow is running
      // (controlled meeting window is always considered active)
      const ownMeetingWindow = windows.some(
        (w) =>
          w.title.toLowerCase().includes('meet.google.com') ||
          w.title.toLowerCase().includes('zoom.us/j') ||
          w.title.toLowerCase().includes('teams.microsoft.com'),
      )
      if (ownMeetingWindow && !detectedPlatform) {
        detectedPlatform = 'Browser Meeting'
        callActive = true
      }

      // Emit state change events
      this.processStateChange(detectedPlatform, callActive)
    } catch (err) {
      console.error('[MeetingDetector] Poll error:', err)
    }
  }

  private processStateChange(
    detectedPlatform: string | null,
    callActive: boolean,
  ): void {
    const prev = this.currentState
    const now = new Date().toISOString()

    // App detected (was not before)
    if (detectedPlatform && !prev.appDetected) {
      this.emitEvent('MEETING_APP_DETECTED', 'INFO', {
        platform: detectedPlatform,
        message: `${detectedPlatform} detected`,
      })
    }

    // App closed (was detected before)
    if (!detectedPlatform && prev.appDetected) {
      this.emitEvent('MEETING_APP_CLOSED', 'WARNING', {
        platform: prev.platform,
        message: `${prev.platform} no longer detected`,
      })
    }

    // Call became active
    if (callActive && !prev.callActive) {
      this.emitEvent('MEETING_CALL_ACTIVE', 'INFO', {
        platform: detectedPlatform,
        message: `Active call detected on ${detectedPlatform}`,
      })
    }

    // Call ended (was active)
    if (!callActive && prev.callActive && detectedPlatform) {
      this.emitEvent('MEETING_CALL_ENDED', 'WARNING', {
        platform: detectedPlatform,
        message: `Call ended on ${detectedPlatform}`,
      })
    }

    // Update state
    this.currentState = {
      appDetected: !!detectedPlatform,
      platform: detectedPlatform,
      callActive,
      lastChecked: now,
    }
  }

  private emitEvent(
    type: MonitoringEvent['type'],
    severity: MonitoringEvent['severity'],
    metadata: Record<string, unknown>,
  ): void {
    this.onEvent({
      eventId: nextId(),
      sessionId: this.sessionId,
      type,
      severity,
      timestamp: new Date().toISOString(),
      source: 'CANDIDATE_APP',
      metadata,
      reviewStatus: 'UNREVIEWED',
    })
  }

  // ── Platform-specific process / window queries ──────────────

  private async getProcessNames(): Promise<string[]> {
    if (process.platform === 'win32') {
      return this.winProcessNames()
    }
    return this.unixProcessNames()
  }

  private async winProcessNames(): Promise<string[]> {
    try {
      const { stdout } = await execAsync('tasklist /FO CSV /NH', {
        maxBuffer: 2 * 1024 * 1024,
      })
      return stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const match = line.match(/"([^"]*)"/)
          return match ? match[1].replace(/\.exe$/i, '') : ''
        })
        .filter(Boolean)
    } catch {
      return []
    }
  }

  private async unixProcessNames(): Promise<string[]> {
    try {
      const { stdout } = await execAsync('ps -eo comm=', {
        maxBuffer: 2 * 1024 * 1024,
      })
      return stdout.split('\n').filter(Boolean).map((l) => l.trim())
    } catch {
      return []
    }
  }

  private async getWindows(): Promise<WindowInfo[]> {
    if (process.platform === 'win32') {
      return this.winWindows()
    }
    return this.unixWindows()
  }

  private async winWindows(): Promise<WindowInfo[]> {
    try {
      // PowerShell one-liner: get all visible windows with titles
      const psScript = `
        Get-Process | Where-Object { $_.MainWindowTitle -ne '' } |
        Select-Object ProcessName, MainWindowTitle |
        ForEach-Object { "$($_.ProcessName)|$($_.MainWindowTitle)" }
      `.replace(/\n/g, ' ')

      const { stdout } = await execAsync(
        `powershell -NoProfile -Command "${psScript}"`,
        { maxBuffer: 2 * 1024 * 1024, timeout: 5000 },
      )

      return stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const sepIdx = line.indexOf('|')
          if (sepIdx === -1) return null
          return {
            processName: line.substring(0, sepIdx).trim(),
            title: line.substring(sepIdx + 1).trim(),
          }
        })
        .filter((w): w is WindowInfo => !!w && w.title.length > 0)
    } catch {
      return []
    }
  }

  private async unixWindows(): Promise<WindowInfo[]> {
    try {
      // macOS: use osascript; Linux: use wmctrl or xdotool
      if (process.platform === 'darwin') {
        const { stdout } = await execAsync(
          `osascript -e 'tell application "System Events" to get {name, title} of every process whose background only is false'`,
          { maxBuffer: 1024 * 1024, timeout: 5000 },
        )
        // Basic parsing — just get window titles
        return stdout
          .split(',')
          .map((t) => ({
            processName: 'unknown',
            title: t.trim(),
          }))
          .filter((w) => w.title.length > 0)
      }

      // Linux fallback — wmctrl
      const { stdout } = await execAsync('wmctrl -l', {
        maxBuffer: 1024 * 1024,
        timeout: 5000,
      })
      return stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const parts = line.split(/\s+/)
          const title = parts.slice(3).join(' ')
          return { processName: 'unknown', title }
        })
        .filter((w) => w.title.length > 0)
    } catch {
      return []
    }
  }
}
