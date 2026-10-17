// ============================================================
// ProctorOverlay — Process Monitor
// Polls running processes, flags blocklisted applications.
// Runs in Electron main process only.
// ============================================================

import { exec } from 'child_process'
import { promisify } from 'util'
import type { MonitoringEvent } from '@proctoroverlay/shared'

const execAsync = promisify(exec)

let _idCounter = 0
const nextId = (): string => `evt-proc-${Date.now()}-${++_idCounter}`

export interface ProcessInfo { name: string; pid: number }

export interface ProcessMonitorConfig {
  pollIntervalMs: number
  blocklist: string[]
}

const DEFAULT_BLOCKLIST = [
  // AI chat
  'chatgpt', 'claude', 'gemini', 'copilot', 'bard',
  // Remote access
  'anydesk', 'teamviewer', 'anyviewer', 'rustdesk', 'mstsc', 'msrdc',
  // Streaming / virtual cam
  'obs64', 'obs32', 'obs', 'streamlabs', 'xsplit', 'loom',
  'manycam', 'splitcam', 'snap camera',
  // Note / knowledge apps
  'notion', 'obsidian', 'notable', 'onenote',
  // IDEs
  'cursor',
  // Comms (outside interview)
  'discord', 'slack', 'telegram', 'whatsapp',
]

export class ProcessMonitor {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private config: ProcessMonitorConfig
  private onEvent: (event: MonitoringEvent) => void
  private lastDetected = new Set<string>()
  private sessionId: string

  constructor(sessionId: string, onEvent: (event: MonitoringEvent) => void, config?: Partial<ProcessMonitorConfig>) {
    this.sessionId = sessionId
    this.onEvent = onEvent
    this.config = { pollIntervalMs: config?.pollIntervalMs ?? 5000, blocklist: config?.blocklist ?? DEFAULT_BLOCKLIST }
  }

  start(): void {
    if (this.intervalId) return
    console.log('[ProcessMonitor] Started')
    this.poll()
    this.intervalId = setInterval(() => this.poll(), this.config.pollIntervalMs)
  }

  stop(): void {
    if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null }
    this.lastDetected.clear()
  }

  updateBlocklist(list: string[]): void { this.config.blocklist = list }

  private async poll(): Promise<void> {
    try {
      const procs = process.platform === 'win32' ? await this.winProcs() : await this.unixProcs()
      const current = new Set<string>()
      for (const p of procs) {
        const n = p.name.toLowerCase()
        // Common coding interview editors are allowed; do not flag their processes.
        if (['code', 'code - insiders', 'idea64', 'webstorm64'].includes(n)) continue
        const hit = this.config.blocklist.find((b) => n.includes(b.toLowerCase()))
        if (hit) {
          current.add(hit)
          if (!this.lastDetected.has(hit)) {
            this.onEvent({
              eventId: nextId(), sessionId: this.sessionId, type: 'BLOCKLISTED_APP_DETECTED',
              severity: 'WARNING', timestamp: new Date().toISOString(), source: 'CANDIDATE_APP',
              metadata: { processName: p.name, pid: p.pid, matchedRule: hit }, reviewStatus: 'UNREVIEWED',
            })
          }
        }
      }
      this.lastDetected = current
    } catch (e) { console.error('[ProcessMonitor]', e) }
  }

  private async winProcs(): Promise<ProcessInfo[]> {
    try {
      const { stdout } = await execAsync('tasklist /FO CSV /NH', { maxBuffer: 2 * 1024 * 1024 })
      return stdout.split('\n').filter(Boolean).map((l) => {
        const m = l.match(/"([^"]*)"/g)
        if (!m || m.length < 2) return null
        return { name: m[0].replace(/"/g, '').replace(/\.exe$/i, ''), pid: +m[1].replace(/"/g, '') }
      }).filter((x): x is ProcessInfo => !!x)
    } catch { return [] }
  }

  private async unixProcs(): Promise<ProcessInfo[]> {
    try {
      const { stdout } = await execAsync('ps -eo comm=,pid=', { maxBuffer: 2 * 1024 * 1024 })
      return stdout.split('\n').filter(Boolean).map((l) => {
        const p = l.trim().split(/\s+/); const pid = +p.pop()!
        return { name: p.join(' '), pid }
      })
    } catch { return [] }
  }
}
