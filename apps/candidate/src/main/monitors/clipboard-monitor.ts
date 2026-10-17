// ============================================================
// ProctorOverlay — Clipboard Monitor
// Intercepts clipboard read/write during the session.
// Logs all paste events and can optionally block copy.
// Runs in Electron main process.
// ============================================================

import { clipboard, globalShortcut } from 'electron'
import type { MonitoringEvent } from '@proctoroverlay/shared'

let _idC = 0
const nextId = (): string => `evt-clip-${Date.now()}-${++_idC}`

export interface ClipboardMonitorConfig {
  /** If true, clear clipboard on copy attempts during session */
  blockCopy: boolean
  /** Poll interval to detect clipboard changes (ms) */
  pollIntervalMs: number
}

export class ClipboardMonitor {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private onEvent: (event: MonitoringEvent) => void
  private sessionId: string
  private config: ClipboardMonitorConfig
  private lastClipboardContent = ''
  private registeredShortcuts: string[] = []

  constructor(
    sessionId: string,
    onEvent: (event: MonitoringEvent) => void,
    config?: Partial<ClipboardMonitorConfig>,
  ) {
    this.sessionId = sessionId
    this.onEvent = onEvent
    this.config = {
      blockCopy: config?.blockCopy ?? false, // default: log only, don't block
      pollIntervalMs: config?.pollIntervalMs ?? 2000,
    }
  }

  start(): void {
    if (this.intervalId) return
    console.log('[ClipboardMonitor] Started')

    // Capture initial clipboard content
    this.lastClipboardContent = clipboard.readText()

    // Poll for clipboard changes
    this.intervalId = setInterval(() => this.checkClipboard(), this.config.pollIntervalMs)

    // Register global shortcut intercepts for PrintScreen
    try {
      // Detect screenshot attempts
      const shortcuts = ['PrintScreen', 'Alt+PrintScreen', 'CommandOrControl+Shift+S']
      for (const sc of shortcuts) {
        try {
          const ok = globalShortcut.register(sc, () => {
            this.onEvent({
              eventId: nextId(), sessionId: this.sessionId,
              type: 'SCREEN_SHARE_STOPPED', // Repurposed: screenshot attempt detected
              severity: 'WARNING', timestamp: new Date().toISOString(), source: 'CANDIDATE_APP',
              metadata: { action: 'screenshot_attempt', shortcut: sc,
                note: 'Screenshot hotkey was intercepted. Some system-level screenshot tools cannot be blocked.' },
              reviewStatus: 'UNREVIEWED',
            })
          })
          if (ok) this.registeredShortcuts.push(sc)
        } catch { /* Some shortcuts may not be registerable */ }
      }
    } catch { /* globalShortcut may fail if app not focused */ }
  }

  stop(): void {
    if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null }
    // Unregister shortcuts
    for (const sc of this.registeredShortcuts) {
      try { globalShortcut.unregister(sc) } catch { /* ignore */ }
    }
    this.registeredShortcuts = []
    console.log('[ClipboardMonitor] Stopped')
  }

  private checkClipboard(): void {
    try {
      const current = clipboard.readText()
      if (current !== this.lastClipboardContent && current.length > 0) {
        // Clipboard content changed — log it
        this.onEvent({
          eventId: nextId(), sessionId: this.sessionId,
          type: 'APP_FOCUS_LOST', // Using generic event type — clipboard events added in future
          severity: 'INFO', timestamp: new Date().toISOString(), source: 'CANDIDATE_APP',
          metadata: {
            action: 'clipboard_changed',
            contentLength: current.length,
            contentPreview: current.substring(0, 50) + (current.length > 50 ? '…' : ''),
          },
          reviewStatus: 'UNREVIEWED',
        })

        if (this.config.blockCopy) {
          // Clear the clipboard
          clipboard.writeText('')
        }

        this.lastClipboardContent = this.config.blockCopy ? '' : current
      }
    } catch { /* clipboard may be locked by another app */ }
  }
}
