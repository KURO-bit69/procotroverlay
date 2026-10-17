// ============================================================
// ProctorOverlay — Focus Monitor
// Tracks active window. Fires APP_FOCUS_LOST / REGAINED.
// Uses Win32 GetForegroundWindow via PowerShell on Windows.
// ============================================================

import { exec } from 'child_process'
import { promisify } from 'util'
import type { MonitoringEvent } from '@proctoroverlay/shared'

const execAsync = promisify(exec)
let _idC = 0
const nextId = (): string => `evt-focus-${Date.now()}-${++_idC}`

export interface ActiveWindowInfo { title: string; owner: string; pid: number }

export interface FocusMonitorConfig {
  pollIntervalMs: number
  allowedWindows: string[]
}

const DEFAULT_ALLOWED = [
  'proctoroverlay', 'proctor overlay', 'google meet', 'zoom', 'zoom meeting',
  'microsoft teams', 'electron', 'chromium',
  // Coding interview mode: common editors are permitted during the interview.
  'visual studio code', 'vscode', 'code.exe', 'intellij', 'idea64', 'webstorm',
]

export class FocusMonitor {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private config: FocusMonitorConfig
  private onEvent: (event: MonitoringEvent) => void
  private sessionId: string
  private isFocusLost = false
  private focusLostAt = 0
  private history: Array<{ owner: string; title: string; ts: string }> = []

  constructor(sessionId: string, onEvent: (event: MonitoringEvent) => void, config?: Partial<FocusMonitorConfig>) {
    this.sessionId = sessionId
    this.onEvent = onEvent
    this.config = { pollIntervalMs: config?.pollIntervalMs ?? 1000, allowedWindows: config?.allowedWindows ?? DEFAULT_ALLOWED }
  }

  start(): void {
    if (this.intervalId) return
    console.log('[FocusMonitor] Started')
    this.poll()
    this.intervalId = setInterval(() => this.poll(), this.config.pollIntervalMs)
  }

  stop(): void {
    if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null }
  }

  getHistory(n = 50) { return this.history.slice(-n) }

  private async poll(): Promise<void> {
    try {
      const win = await this.getActiveWindow()
      if (!win) return

      const ownerL = win.owner.toLowerCase()
      const titleL = win.title.toLowerCase()
      const allowed = this.config.allowedWindows.some((a) =>
        ownerL.includes(a.toLowerCase()) || titleL.includes(a.toLowerCase())
      )

      // Log every distinct switch
      const last = this.history[this.history.length - 1]
      if (!last || last.owner !== win.owner || last.title !== win.title) {
        this.history.push({ owner: win.owner, title: win.title, ts: new Date().toISOString() })
        if (this.history.length > 200) this.history = this.history.slice(-100)
      }

      if (!allowed && !this.isFocusLost) {
        this.isFocusLost = true
        this.focusLostAt = Date.now()
        this.onEvent({
          eventId: nextId(), sessionId: this.sessionId, type: 'APP_FOCUS_LOST',
          severity: 'WARNING', timestamp: new Date().toISOString(), source: 'CANDIDATE_APP',
          metadata: { switchedTo: win.owner, windowTitle: win.title, pid: win.pid },
          reviewStatus: 'UNREVIEWED',
        })
      } else if (allowed && this.isFocusLost) {
        const away = Date.now() - this.focusLostAt
        this.isFocusLost = false
        this.onEvent({
          eventId: nextId(), sessionId: this.sessionId, type: 'APP_FOCUS_REGAINED',
          severity: 'INFO', timestamp: new Date().toISOString(), source: 'CANDIDATE_APP',
          metadata: { awayDurationMs: away, returnedTo: win.owner }, reviewStatus: 'UNREVIEWED',
        })
      }
    } catch (e) { console.error('[FocusMonitor]', e) }
  }

  private async getActiveWindow(): Promise<ActiveWindowInfo | null> {
    if (process.platform === 'win32') return this.getWin32()
    if (process.platform === 'darwin') return this.getMac()
    return null // Linux: would need xdotool
  }

  private async getWin32(): Promise<ActiveWindowInfo | null> {
    try {
      // Use a compiled PowerShell snippet via a single -Command call
      const cmd = `powershell -NoProfile -NonInteractive -Command "Add-Type 'using System;using System.Runtime.InteropServices;using System.Text;public class W{[DllImport(\\\"user32.dll\\\")]public static extern IntPtr GetForegroundWindow();[DllImport(\\\"user32.dll\\\")]public static extern int GetWindowText(IntPtr h,StringBuilder t,int c);[DllImport(\\\"user32.dll\\\")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);}';$h=[W]::GetForegroundWindow();$s=New-Object Text.StringBuilder 256;[W]::GetWindowText($h,$s,256)|Out-Null;$p=0;[W]::GetWindowThreadProcessId($h,[ref]$p)|Out-Null;$n=(Get-Process -Id $p -EA SilentlyContinue).ProcessName;Write-Output \\"$n|$($s.ToString())|$p\\""`
      const { stdout } = await execAsync(cmd, { timeout: 4000 })
      const [owner, title, pid] = stdout.trim().split('|')
      return { owner: owner || 'Unknown', title: title || '', pid: parseInt(pid, 10) || 0 }
    } catch { return null }
  }

  private async getMac(): Promise<ActiveWindowInfo | null> {
    try {
      const { stdout } = await execAsync(
        `osascript -e 'tell application "System Events" to get {name, unix id} of first application process whose frontmost is true'`,
        { timeout: 3000 },
      )
      const [owner, pid] = stdout.trim().split(', ')
      return { owner: owner || 'Unknown', title: '', pid: parseInt(pid, 10) || 0 }
    } catch { return null }
  }
}
