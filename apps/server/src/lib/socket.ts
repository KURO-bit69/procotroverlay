// ============================================================
// ProctorOverlay — Socket.IO Gateway
// Real-time event pipeline: candidate pushes events, proctor
// receives them live. Session-based rooms for isolation.
// ============================================================

import { Server as HttpServer } from 'http'
import { Server, Socket } from 'socket.io'
import { prisma } from './db.js'
import type { MonitoringEvent } from '@proctoroverlay/shared'

let io: Server | null = null

export interface ServerToClientEvents {
  /** Server pushes a new event to proctors watching this session */
  'event:new': (event: MonitoringEvent & { serverTimestamp: string }) => void
  /** Session status changed */
  'session:statusChanged': (data: { sessionId: string; status: string }) => void
  /** Proctor sends warning to candidate */
  'proctor:warning': (data: { message: string; severity: string }) => void
  /** Candidate connection state changed */
  'candidate:connectionState': (data: { sessionId: string; connected: boolean }) => void
}

export interface ClientToServerEvents {
  /** Candidate pushes a batch of events */
  'events:push': (
    data: { sessionId: string; events: MonitoringEvent[] },
    ack: (response: { accepted: number; duplicates: number }) => void,
  ) => void
  /** Join a session room (candidate or proctor) */
  'session:join': (
    data: { sessionId: string; token: string; role: string },
    ack: (response: { success: boolean; error?: string }) => void,
  ) => void
  /** Candidate heartbeat — absence = disconnection flag */
  'heartbeat': (data: { sessionId: string; timestamp: string }) => void
}

export function getIO(): Server | null {
  return io
}

/** Initialize Socket.IO on the Fastify http server */
export function initSocketIO(httpServer: HttpServer): Server {
  io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: {
      origin: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:5174,http://localhost:5175')
        .split(',')
        .map((s) => s.trim()),
      credentials: true,
    },
    pingInterval: 10000,
    pingTimeout: 20000,
  })

  io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
    console.log(`[Socket.IO] Client connected: ${socket.id}`)

    // ── Join session room ──────────────────────────────────
    socket.on('session:join', async (data, ack) => {
      try {
        // Verify the session exists
        const session = await prisma.session.findUnique({
          where: { id: data.sessionId },
        })
        if (!session) {
          ack({ success: false, error: 'Session not found' })
          return
        }

        // Join the session room
        const room = `session:${data.sessionId}`
        await socket.join(room)

        // Store metadata on socket
        ;(socket.data as Record<string, unknown>).sessionId = data.sessionId
        ;(socket.data as Record<string, unknown>).role = data.role

        console.log(`[Socket.IO] ${socket.id} joined room ${room} as ${data.role}`)

        // Notify proctors that candidate connected
        if (data.role === 'CANDIDATE') {
          socket.to(room).emit('candidate:connectionState', {
            sessionId: data.sessionId,
            connected: true,
          })
        }

        ack({ success: true })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        ack({ success: false, error: msg })
      }
    })

    // ── Event push (candidate → server → proctor) ──────────
    socket.on('events:push', async (data, ack) => {
      const { sessionId, events } = data
      let accepted = 0
      let duplicates = 0

      for (const event of events) {
        try {
          // Dedup by client-generated eventId
          const existing = await prisma.event.findUnique({
            where: { eventId: event.eventId },
          })
          if (existing) {
            duplicates++
            continue
          }

          // Store in DB
          const stored = await prisma.event.create({
            data: {
              eventId: event.eventId,
              sessionId,
              type: event.type,
              severity: event.severity,
              source: event.source,
              clientTimestamp: new Date(event.timestamp),
              confidence: event.confidence ?? null,
              metadata: JSON.stringify(event.metadata ?? {}),
              evidenceRef: event.evidenceRef ?? null,
              reviewStatus: event.reviewStatus ?? 'UNREVIEWED',
            },
          })

          // Broadcast to proctor room
          const room = `session:${sessionId}`
          socket.to(room).emit('event:new', {
            ...event,
            serverTimestamp: stored.serverTimestamp.toISOString(),
          })

          // Update risk score (simple additive for now — Phase 8 will refine)
          const { DEFAULT_RISK_WEIGHTS } = await import('@proctoroverlay/shared')
          const weight = DEFAULT_RISK_WEIGHTS[event.type as keyof typeof DEFAULT_RISK_WEIGHTS] ?? 0
          if (weight > 0) {
            await prisma.session.update({
              where: { id: sessionId },
              data: { riskScore: { increment: weight } },
            })
          }

          accepted++
        } catch (err) {
          console.error(`[Socket.IO] Failed to store event ${event.eventId}:`, err)
        }
      }

      ack({ accepted, duplicates })
    })

    // ── Heartbeat ──────────────────────────────────────────
    socket.on('heartbeat', (data) => {
      // Update last-seen timestamp in socket data
      ;(socket.data as Record<string, unknown>).lastHeartbeat = data.timestamp
    })

    // ── Disconnect ─────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      const sid = (socket.data as Record<string, unknown>).sessionId as string | undefined
      const role = (socket.data as Record<string, unknown>).role as string | undefined
      console.log(`[Socket.IO] ${socket.id} disconnected (${reason}), session=${sid}`)

      if (sid && role === 'CANDIDATE') {
        const room = `session:${sid}`
        socket.to(room).emit('candidate:connectionState', {
          sessionId: sid,
          connected: false,
        })
      }
    })
  })

  console.log('[Socket.IO] Gateway initialized')
  return io
}
