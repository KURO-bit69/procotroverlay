// ============================================================
// ProctorOverlay — Monitor Manager
// Orchestrator: creates, starts/stops all 4 monitors as a unit,
// funnels events into a single stream with a bounded buffer,
// and exposes accessors for focus history & env snapshot.
// ============================================================

import type { MonitoringEvent } from '@proctoroverlay/shared'
import { ProcessMonitor } from './process-monitor'
import { FocusMonitor } from './focus-monitor'
import { EnvironmentMonitor, type EnvironmentSnapshot } from './environment-monitor'
import { ClipboardMonitor } from './clipboard-monitor'
import { MeetingDetector, type MeetingState } from './meeting-detector'

let _idC = 0
const nextId = (): string => `evt-mgr-${Date.now()}-${++_idC}`

export interface MonitorManagerConfig {
  sessionId: string
  processMonitor?: { pollIntervalMs?: number; blocklist?: string[] }
  focusMonitor?: { pollIntervalMs?: number; allowedWindows?: string[] }
  environmentMonitor?: { pollIntervalMs?: number }
  clipboardMonitor?: { pollIntervalMs?: number; blockCopy?: boolean }
  meetingDetector?: { pollIntervalMs?: number }
}

export class MonitorManager {
  private processMonitor: ProcessMonitor
  private focusMonitor: FocusMonitor
  private environmentMonitor: EnvironmentMonitor
  private clipboardMonitor: ClipboardMonitor
  private meetingDetector: MeetingDetector

  private eventListeners: Array<(event: MonitoringEvent) => void> = []
  private eventBuffer: MonitoringEvent[] = []
  private readonly MAX_BUFFER = 2000
  private running = false
  private sessionId: string

  constructor(config: MonitorManagerConfig) {
    this.sessionId = config.sessionId

    // Shared event handler — funnels into unified stream
    const handleEvent = (event: MonitoringEvent): void => {
      this.bufferEvent(event)
      for (const listener of this.eventListeners) {
        try { listener(event) } catch (err) { console.error('[MonitorManager] Listener error:', err) }
      }
    }

    this.processMonitor = new ProcessMonitor(
      config.sessionId,
      handleEvent,
      config.processMonitor,
    )

    this.focusMonitor = new FocusMonitor(
      config.sessionId,
      handleEvent,
      config.focusMonitor,
    )

    this.environmentMonitor = new EnvironmentMonitor(
      config.sessionId,
      handleEvent,
      config.environmentMonitor?.pollIntervalMs,
    )

    this.clipboardMonitor = new ClipboardMonitor(
      config.sessionId,
      handleEvent,
      config.clipboardMonitor,
    )

    this.meetingDetector = new MeetingDetector(
      config.sessionId,
      handleEvent,
      config.meetingDetector,
    )
  }

  /** Subscribe to all monitor events */
  onEvent(listener: (event: MonitoringEvent) => void): void {
    this.eventListeners.push(listener)
  }

  /** Remove a previously added listener */
  offEvent(listener: (event: MonitoringEvent) => void): void {
    this.eventListeners = this.eventListeners.filter((l) => l !== listener)
  }

  /** Start all monitors. Emits SESSION_STARTED event. */
  startAll(): void {
    if (this.running) return
    this.running = true
    console.log('[MonitorManager] Starting all monitors for session', this.sessionId)

    this.processMonitor.start()
    this.focusMonitor.start()
    this.environmentMonitor.start()
    this.clipboardMonitor.start()
    this.meetingDetector.start()

    const startEvent: MonitoringEvent = {
      eventId: nextId(),
      sessionId: this.sessionId,
      type: 'SESSION_STARTED',
      severity: 'INFO',
      timestamp: new Date().toISOString(),
      source: 'CANDIDATE_APP',
      metadata: { message: 'All monitors started' },
      reviewStatus: 'UNREVIEWED',
    }
    this.bufferEvent(startEvent)
    for (const listener of this.eventListeners) {
      try { listener(startEvent) } catch (err) { console.error('[MonitorManager] Listener error:', err) }
    }
  }

  /** Stop all monitors. Emits SESSION_ENDED event. */
  stopAll(): void {
    if (!this.running) return
    console.log('[MonitorManager] Stopping all monitors for session', this.sessionId)

    this.processMonitor.stop()
    this.focusMonitor.stop()
    this.environmentMonitor.stop()
    this.clipboardMonitor.stop()
    this.meetingDetector.stop()

    const endEvent: MonitoringEvent = {
      eventId: nextId(),
      sessionId: this.sessionId,
      type: 'SESSION_ENDED',
      severity: 'INFO',
      timestamp: new Date().toISOString(),
      source: 'CANDIDATE_APP',
      metadata: { message: 'All monitors stopped' },
      reviewStatus: 'UNREVIEWED',
    }
    this.bufferEvent(endEvent)
    for (const listener of this.eventListeners) {
      try { listener(endEvent) } catch (err) { console.error('[MonitorManager] Listener error:', err) }
    }

    this.running = false
  }

  isRunning(): boolean { return this.running }

  // ── Accessors ──────────────────────────────────────────────

  /** Focus monitor's window-switch history */
  getFocusHistory(n = 50) { return this.focusMonitor.getHistory(n) }

  /** Latest environment snapshot */
  getEnvironmentSnapshot(): EnvironmentSnapshot | null {
    return this.environmentMonitor.getLastSnapshot()
  }

  /** Current meeting detection state */
  getMeetingState(): MeetingState {
    return this.meetingDetector.getState()
  }

  /** All buffered events (for batch sync to server in Phase 5) */
  getBufferedEvents(): MonitoringEvent[] { return [...this.eventBuffer] }

  /** Clear buffer after successful sync */
  clearBuffer(): void { this.eventBuffer = [] }

  /** Recent events for UI display */
  getRecentEvents(count = 50): MonitoringEvent[] {
    return this.eventBuffer.slice(-count)
  }

  // ── Internal ───────────────────────────────────────────────

  private bufferEvent(event: MonitoringEvent): void {
    this.eventBuffer.push(event)
    if (this.eventBuffer.length > this.MAX_BUFFER) {
      this.eventBuffer = this.eventBuffer.slice(-Math.floor(this.MAX_BUFFER / 2))
    }
  }
}
