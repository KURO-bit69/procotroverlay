// ============================================================
// ProctorOverlay — Event Sync Client
// Buffers monitoring events locally, syncs them to the server
// via Socket.IO when connected. Falls back to HTTP POST when
// WebSocket is unavailable. Handles offline/reconnect.
// ============================================================

import { io, Socket } from 'socket.io-client'
import type { MonitoringEvent } from '@proctoroverlay/shared'

export interface EventSyncConfig {
  serverUrl: string
  sessionId: string
  token: string
  /** How often to flush buffered events (ms) */
  flushIntervalMs?: number
  /** Max events to send per batch */
  batchSize?: number
  /** Seconds of disconnect before emitting a disconnect flag */
  disconnectThresholdSec?: number
}

type ConnectionState = 'connecting' | 'connected' | 'disconnected'

export class EventSyncClient {
  private socket: Socket | null = null
  private config: Required<EventSyncConfig>
  private eventBuffer: MonitoringEvent[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private connectionState: ConnectionState = 'disconnected'
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null
  private onDisconnectFlag: ((durationMs: number) => void) | null = null
  private onConnectionChange: ((state: ConnectionState) => void) | null = null
  private disconnectedAt: number | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: EventSyncConfig) {
    this.config = {
      ...config,
      flushIntervalMs: config.flushIntervalMs ?? 3000,
      batchSize: config.batchSize ?? 50,
      disconnectThresholdSec: config.disconnectThresholdSec ?? 30,
    }
  }

  /** Set callback for sustained disconnect flag */
  onDisconnect(cb: (durationMs: number) => void): void {
    this.onDisconnectFlag = cb
  }

  /** Set callback for connection state changes */
  onStateChange(cb: (state: ConnectionState) => void): void {
    this.onConnectionChange = cb
  }

  /** Connect to server and start syncing */
  connect(): void {
    if (this.socket) return

    this.connectionState = 'connecting'
    this.onConnectionChange?.('connecting')

    this.socket = io(this.config.serverUrl, {
      auth: { token: this.config.token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    })

    this.socket.on('connect', () => {
      console.log('[EventSync] Connected to server')
      this.connectionState = 'connected'
      this.onConnectionChange?.('connected')

      // Clear disconnect tracking
      if (this.disconnectTimer) {
        clearTimeout(this.disconnectTimer)
        this.disconnectTimer = null
      }
      this.disconnectedAt = null

      // Join session room
      this.socket!.emit('session:join', {
        sessionId: this.config.sessionId,
        token: this.config.token,
        role: 'CANDIDATE',
      }, (response: { success: boolean; error?: string }) => {
        if (response.success) {
          console.log('[EventSync] Joined session room')
          // Flush any buffered events from offline period
          this.flush()
        } else {
          console.error('[EventSync] Failed to join session room:', response.error)
        }
      })
    })

    this.socket.on('disconnect', (reason) => {
      console.log(`[EventSync] Disconnected: ${reason}`)
      this.connectionState = 'disconnected'
      this.onConnectionChange?.('disconnected')
      this.disconnectedAt = Date.now()

      // Start disconnect threshold timer
      this.disconnectTimer = setTimeout(() => {
        const durationMs = Date.now() - (this.disconnectedAt ?? Date.now())
        this.onDisconnectFlag?.(durationMs)
      }, this.config.disconnectThresholdSec * 1000)
    })

    this.socket.on('connect_error', (err) => {
      console.error('[EventSync] Connection error:', err.message)
    })

    // Listen for proctor warnings
    this.socket.on('proctor:warning' as any, (data: { message: string; severity: string }) => {
      console.log(`[EventSync] Proctor warning: ${data.message}`)
      // Will be forwarded to renderer via IPC in future
    })

    // Start periodic flush
    this.flushTimer = setInterval(() => this.flush(), this.config.flushIntervalMs)

    // Start heartbeat
    this.heartbeatTimer = setInterval(() => {
      if (this.socket?.connected) {
        this.socket.emit('heartbeat', {
          sessionId: this.config.sessionId,
          timestamp: new Date().toISOString(),
        })
      }
    }, 10000)
  }

  /** Queue an event for sync */
  pushEvent(event: MonitoringEvent): void {
    this.eventBuffer.push(event)

    // Immediate flush if buffer is getting large
    if (this.eventBuffer.length >= this.config.batchSize) {
      this.flush()
    }
  }

  /** Flush buffered events to server */
  private async flush(): Promise<void> {
    if (this.eventBuffer.length === 0) return

    const batch = this.eventBuffer.splice(0, this.config.batchSize)

    if (this.socket?.connected) {
      // Primary path: WebSocket
      this.socket.emit('events:push', {
        sessionId: this.config.sessionId,
        events: batch,
      }, (response: { accepted: number; duplicates: number }) => {
        console.log(`[EventSync] Synced ${response.accepted} events (${response.duplicates} dupes)`)
      })
    } else {
      // Fallback: HTTP POST
      try {
        const res = await fetch(
          `${this.config.serverUrl}/sessions/${this.config.sessionId}/events`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.config.token}`,
            },
            body: JSON.stringify({ events: batch }),
          },
        )
        if (!res.ok) {
          // Put events back in buffer for retry
          this.eventBuffer.unshift(...batch)
          console.error('[EventSync] HTTP fallback failed:', res.status)
        } else {
          const result = await res.json()
          console.log(`[EventSync] HTTP synced ${result.accepted} events`)
        }
      } catch {
        // Network error — put events back for retry
        this.eventBuffer.unshift(...batch)
        console.error('[EventSync] HTTP fallback network error — events re-buffered')
      }
    }
  }

  /** Get current connection state */
  getState(): ConnectionState {
    return this.connectionState
  }

  /** Get count of buffered (unsynced) events */
  getBufferSize(): number {
    return this.eventBuffer.length
  }

  /** Disconnect and flush remaining */
  async disconnect(): Promise<void> {
    // Try one final flush
    await this.flush()

    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer)
      this.disconnectTimer = null
    }
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }
    this.connectionState = 'disconnected'
  }
}
