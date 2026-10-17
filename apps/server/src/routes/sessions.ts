// ============================================================
// ProctorOverlay — Session Routes
// Full CRUD + candidate join + event ingestion + status management
// ============================================================

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomBytes } from 'crypto'
import { prisma } from '../lib/db.js'
import { requireAuth, requireProctor, type JwtPayload } from '../lib/jwt.js'
import { getIO } from '../lib/socket.js'
import { getVoiceVerificationProvider } from '../lib/voice-verification.js'

// ── Zod Schemas ─────────────────────────────────────────────

const createSessionSchema = z.object({
  candidateEmail: z.string().email(),
  meetingUrl: z.string().url(),
  config: z.record(z.unknown()).optional(),
  riskWeights: z.record(z.number()).optional(),
})

const joinSessionSchema = z.object({
  code: z.string().length(6),
  email: z.string().email(),
})

const statusUpdateSchema = z.object({
  status: z.enum([
    'PREFLIGHT', 'ACTIVE', 'PAUSED', 'INTERRUPTED',
    'COMPLETING', 'COMPLETED', 'FORCE_ENDED',
  ]),
})

const eventBatchSchema = z.object({
  events: z.array(z.object({
    eventId: z.string().min(1),
    type: z.string().min(1),
    severity: z.enum(['INFO', 'WARNING', 'CRITICAL']),
    timestamp: z.string().datetime(),
    source: z.string().min(1),
    confidence: z.number().min(0).max(1).optional(),
    metadata: z.record(z.unknown()).optional(),
    evidenceRef: z.string().optional(),
    reviewStatus: z.string().optional(),
  })),
})

const eventReviewSchema = z.object({
  reviewStatus: z.enum(['ACKNOWLEDGED', 'DISMISSED', 'FLAGGED', 'APPEALED']),
  proctorNote: z.string().optional(),
})

/** Generate a 6-char uppercase join code */
function generateJoinCode(): string {
  return randomBytes(3).toString('hex').toUpperCase().slice(0, 6)
}

export async function sessionRoutes(server: FastifyInstance): Promise<void> {

  // ── POST /sessions — Proctor creates session ──────────────
  server.post('/sessions', {
    preHandler: [requireProctor],
  }, async (request, reply) => {
    const parsed = createSessionSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        message: 'Invalid request',
        errors: parsed.error.flatten().fieldErrors,
      })
    }

    const user = request.user as JwtPayload
    const { candidateEmail, meetingUrl, config, riskWeights } = parsed.data

    // Find or create candidate user
    let candidate = await prisma.user.findUnique({
      where: { email: candidateEmail },
    })
    if (!candidate) {
      candidate = await prisma.user.create({
        data: {
          email: candidateEmail,
          password: '', // candidate doesn't login with password — uses join code
          role: 'CANDIDATE',
        },
      })
    }

    // Generate unique join code
    let joinCode: string
    let attempts = 0
    do {
      joinCode = generateJoinCode()
      const existing = await prisma.session.findUnique({
        where: { joinCode },
      })
      if (!existing) break
      attempts++
    } while (attempts < 10)

    const session = await prisma.session.create({
      data: {
        joinCode,
        proctorId: user.userId,
        candidateId: candidate.id,
        meetingUrl,
        config: JSON.stringify(config ?? {}),
        riskWeights: JSON.stringify(riskWeights ?? {}),
      },
    })

    return reply.status(201).send({
      sessionId: session.id,
      joinCode: session.joinCode,
      status: session.status,
      candidateEmail,
    })
  })

  // ── POST /sessions/join — Candidate joins with code ───────
  server.post('/sessions/join', async (request, reply) => {
    const parsed = joinSessionSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        message: 'Invalid request',
        errors: parsed.error.flatten().fieldErrors,
      })
    }

    const { code, email } = parsed.data

    const session = await prisma.session.findUnique({
      where: { joinCode: code.toUpperCase() },
      include: { candidate: true },
    })

    if (!session) {
      return reply.status(404).send({ message: 'Invalid session code' })
    }

    if (session.status !== 'CREATED' && session.status !== 'PREFLIGHT') {
      return reply.status(400).send({ message: 'Session is not accepting candidates' })
    }

    // Verify candidate email matches
    if (session.candidate && session.candidate.email !== email) {
      return reply.status(403).send({ message: 'Email does not match session' })
    }

    // Update session status to PREFLIGHT
    await prisma.session.update({
      where: { id: session.id },
      data: { status: 'PREFLIGHT' },
    })

    // Generate JWT for candidate
    const token = server.jwt.sign({
      userId: session.candidateId ?? 'unknown',
      email,
      role: 'CANDIDATE',
      sessionId: session.id,
    })

    return reply.status(200).send({
      token,
      sessionId: session.id,
    })
  })

  // ── POST /sessions/resolve-meeting — Get meeting URL ──────
  server.post('/sessions/resolve-meeting', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const user = request.user as JwtPayload
    const body = request.body as { sessionId?: string }

    if (!body.sessionId) {
      return reply.status(400).send({ message: 'sessionId required' })
    }

    const session = await prisma.session.findUnique({
      where: { id: body.sessionId },
    })

    if (!session) {
      return reply.status(404).send({ message: 'Session not found' })
    }

    // Only the session's candidate or proctor can resolve meeting URL
    if (session.candidateId !== user.userId && session.proctorId !== user.userId) {
      return reply.status(403).send({ message: 'Not authorized for this session' })
    }

    if (!session.meetingUrl) {
      return reply.status(400).send({ message: 'No meeting URL configured' })
    }

    return reply.status(200).send({
      meetingUrl: session.meetingUrl,
    })
  })

  // ── GET /sessions — List sessions (proctor) ───────────────
  server.get('/sessions', {
    preHandler: [requireProctor],
  }, async (request) => {
    const user = request.user as JwtPayload
    const query = request.query as { status?: string; limit?: string }

    const where: Record<string, unknown> = { proctorId: user.userId }
    if (query.status) {
      where.status = query.status
    }

    const sessions = await prisma.session.findMany({
      where,
      include: {
        candidate: { select: { id: true, email: true } },
        _count: { select: { events: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(query.limit ?? '50', 10),
    })

    return sessions.map((s) => ({
      id: s.id,
      joinCode: s.joinCode,
      status: s.status,
      candidateEmail: s.candidate?.email ?? null,
      riskScore: s.riskScore,
      eventCount: s._count.events,
      startedAt: s.startedAt?.toISOString() ?? null,
      endedAt: s.endedAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
    }))
  })

  // ── DELETE /sessions/:id — Remove a finished session and its records ──
  server.delete('/sessions/:id', {
    preHandler: [requireProctor],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const user = request.user as JwtPayload
    const session = await prisma.session.findUnique({ where: { id } })

    if (!session) return reply.status(404).send({ message: 'Session not found' })
    if (session.proctorId !== user.userId) return reply.status(403).send({ message: 'Not authorized for this session' })
    if (!['COMPLETED', 'FORCE_ENDED', 'INTERRUPTED'].includes(session.status)) {
      return reply.status(409).send({ message: 'Only finished sessions can be removed.' })
    }

    try {
      await getVoiceVerificationProvider().dispose(id)
    } catch {
      server.log.warn({ sessionId: id }, 'Could not delete the external voice profile before session removal')
    }

    await prisma.$transaction([
      prisma.consent.deleteMany({ where: { sessionId: id } }),
      prisma.session.delete({ where: { id } }),
    ])
    return reply.status(200).send({ deleted: true, sessionId: id })
  })

  // ── GET /sessions/:id — Session detail ────────────────────
  server.get('/sessions/:id', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const user = request.user as JwtPayload

    const session = await prisma.session.findUnique({
      where: { id },
      include: {
        candidate: { select: { id: true, email: true } },
        proctor: { select: { id: true, email: true } },
      },
    })

    if (!session) {
      return reply.status(404).send({ message: 'Session not found' })
    }

    // Authorization: only session's proctor or candidate
    if (session.candidateId !== user.userId && session.proctorId !== user.userId) {
      return reply.status(403).send({ message: 'Not authorized' })
    }

    return {
      id: session.id,
      joinCode: session.joinCode,
      status: session.status,
      candidate: session.candidate,
      proctor: session.proctor,
      riskScore: session.riskScore,
      config: JSON.parse(session.config as string),
      consentAt: session.consentAt?.toISOString() ?? null,
      startedAt: session.startedAt?.toISOString() ?? null,
      endedAt: session.endedAt?.toISOString() ?? null,
      createdAt: session.createdAt.toISOString(),
    }
  })

  // ── PATCH /sessions/:id/status — Update session status ────
  server.patch('/sessions/:id/status', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const user = request.user as JwtPayload
    const parsed = statusUpdateSchema.safeParse(request.body)

    if (!parsed.success) {
      return reply.status(400).send({
        message: 'Invalid status',
        errors: parsed.error.flatten().fieldErrors,
      })
    }

    const session = await prisma.session.findUnique({ where: { id } })
    if (!session) {
      return reply.status(404).send({ message: 'Session not found' })
    }

    // Only proctor can force-end; candidate can mark ACTIVE or INTERRUPTED
    const { status } = parsed.data
    const isProctor = session.proctorId === user.userId
    const isCandidate = session.candidateId === user.userId
    if (!isProctor && !isCandidate) {
      return reply.status(403).send({ message: 'Not authorized for this session' })
    }

    if (['FORCE_ENDED', 'PAUSED', 'COMPLETED'].includes(status) && !isProctor) {
      return reply.status(403).send({ message: 'Only proctor can set this status' })
    }

    const updateData: Record<string, unknown> = { status }

    if (status === 'ACTIVE' && !session.startedAt) {
      updateData.startedAt = new Date()
    }
    if (['COMPLETED', 'FORCE_ENDED'].includes(status)) {
      updateData.endedAt = new Date()
    }

    const updated = await prisma.session.update({
      where: { id },
      data: updateData,
    })

    if (['INTERRUPTED', 'COMPLETED', 'FORCE_ENDED'].includes(status)) {
      try {
        await getVoiceVerificationProvider().dispose(id)
      } catch {
        // Do not fail session completion if the external provider is unavailable.
        server.log.warn({ sessionId: id }, 'Could not delete the external voice profile')
      }
    }

    // Notify via Socket.IO
    const io = getIO()
    if (io) {
      io.to(`session:${id}`).emit('session:statusChanged', {
        sessionId: id,
        status: updated.status,
      })
    }

    return { sessionId: id, status: updated.status }
  })

  // ── POST /sessions/:id/events — HTTP event ingestion ──────
  // (fallback when WebSocket is unavailable)
  server.post('/sessions/:id/events', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const user = request.user as JwtPayload
    const parsed = eventBatchSchema.safeParse(request.body)

    if (!parsed.success) {
      return reply.status(400).send({
        message: 'Invalid events',
        errors: parsed.error.flatten().fieldErrors,
      })
    }

    const session = await prisma.session.findUnique({ where: { id } })
    if (!session) {
      return reply.status(404).send({ message: 'Session not found' })
    }
    if (session.candidateId !== user.userId && session.proctorId !== user.userId) {
      return reply.status(403).send({ message: 'Not authorized' })
    }

    let accepted = 0
    let duplicates = 0
    const { DEFAULT_RISK_WEIGHTS } = await import('@proctoroverlay/shared')

    for (const event of parsed.data.events) {
      try {
        const existing = await prisma.event.findUnique({
          where: { eventId: event.eventId },
        })
        if (existing) {
          duplicates++
          continue
        }

        await prisma.event.create({
          data: {
            eventId: event.eventId,
            sessionId: id,
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

        // Update risk score
        const weight = DEFAULT_RISK_WEIGHTS[event.type as keyof typeof DEFAULT_RISK_WEIGHTS] ?? 0
        if (weight > 0) {
          await prisma.session.update({
            where: { id },
            data: { riskScore: { increment: weight } },
          })
        }

        // Broadcast to proctors via Socket.IO
        const io = getIO()
        if (io) {
          io.to(`session:${id}`).emit('event:new', {
            eventId: event.eventId,
            sessionId: id,
            type: event.type as any,
            severity: event.severity as any,
            timestamp: event.timestamp,
            source: event.source as any,
            confidence: event.confidence,
            metadata: event.metadata ?? {},
            evidenceRef: event.evidenceRef,
            reviewStatus: (event.reviewStatus ?? 'UNREVIEWED') as any,
            serverTimestamp: new Date().toISOString(),
          })
        }

        accepted++
      } catch (err) {
        console.error(`[Events] Failed to store ${event.eventId}:`, err)
      }
    }

    return reply.status(200).send({ accepted, duplicates })
  })

  // ── GET /sessions/:id/events — Fetch events (proctor) ─────
  server.get('/sessions/:id/events', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const user = request.user as JwtPayload
    const query = request.query as {
      type?: string
      severity?: string
      limit?: string
      offset?: string
    }

    const session = await prisma.session.findUnique({ where: { id } })
    if (!session) {
      return reply.status(404).send({ message: 'Session not found' })
    }
    if (session.candidateId !== user.userId && session.proctorId !== user.userId) {
      return reply.status(403).send({ message: 'Not authorized' })
    }

    const where: Record<string, unknown> = { sessionId: id }
    if (query.type) where.type = query.type
    if (query.severity) where.severity = query.severity

    const events = await prisma.event.findMany({
      where,
      orderBy: { clientTimestamp: 'asc' },
      take: parseInt(query.limit ?? '200', 10),
      skip: parseInt(query.offset ?? '0', 10),
    })

    return events.map((e) => ({
      id: e.id,
      eventId: e.eventId,
      sessionId: e.sessionId,
      type: e.type,
      severity: e.severity,
      source: e.source,
      timestamp: e.clientTimestamp.toISOString(),
      serverTimestamp: e.serverTimestamp.toISOString(),
      confidence: e.confidence,
      metadata: JSON.parse(e.metadata as string),
      evidenceRef: e.evidenceRef,
      reviewStatus: e.reviewStatus,
      proctorNote: e.proctorNote,
    }))
  })

  // ── PATCH /sessions/:id/events/:eventId/review — Proctor reviews event ──
  server.patch('/sessions/:id/events/:eventId/review', {
    preHandler: [requireProctor],
  }, async (request, reply) => {
    const { id, eventId } = request.params as { id: string; eventId: string }
    const parsed = eventReviewSchema.safeParse(request.body)

    if (!parsed.success) {
      return reply.status(400).send({
        message: 'Invalid review',
        errors: parsed.error.flatten().fieldErrors,
      })
    }

    const event = await prisma.event.findFirst({
      where: { eventId, sessionId: id },
    })
    if (!event) {
      return reply.status(404).send({ message: 'Event not found' })
    }

    const updated = await prisma.event.update({
      where: { id: event.id },
      data: {
        reviewStatus: parsed.data.reviewStatus,
        proctorNote: parsed.data.proctorNote ?? event.proctorNote,
      },
    })

    return {
      eventId: updated.eventId,
      reviewStatus: updated.reviewStatus,
      proctorNote: updated.proctorNote,
    }
  })

  // ── GET /sessions/:id/report — Session report ─────────────
  server.get('/sessions/:id/report', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const user = request.user as JwtPayload

    const session = await prisma.session.findUnique({
      where: { id },
      include: {
        candidate: { select: { email: true } },
        proctor: { select: { email: true } },
      },
    })
    if (!session) {
      return reply.status(404).send({ message: 'Session not found' })
    }
    if (session.proctorId !== user.userId) {
      return reply.status(403).send({ message: 'Only proctor can view report' })
    }

    // Event summary by type
    const events = await prisma.event.findMany({
      where: { sessionId: id },
      orderBy: { clientTimestamp: 'asc' },
    })

    const eventsByType: Record<string, number> = {}
    const flaggedEvents = events.filter((e) => e.reviewStatus === 'FLAGGED')
    for (const e of events) {
      eventsByType[e.type] = (eventsByType[e.type] ?? 0) + 1
    }

    const durationMs = session.startedAt && session.endedAt
      ? session.endedAt.getTime() - session.startedAt.getTime()
      : null

    return {
      sessionId: session.id,
      candidateEmail: session.candidate?.email ?? null,
      proctorEmail: session.proctor?.email ?? null,
      status: session.status,
      riskScore: session.riskScore,
      durationMs,
      totalEvents: events.length,
      eventsByType,
      flaggedEvents: flaggedEvents.length,
      timeline: events.map((e) => ({
        eventId: e.eventId,
        type: e.type,
        severity: e.severity,
        timestamp: e.clientTimestamp.toISOString(),
        reviewStatus: e.reviewStatus,
        proctorNote: e.proctorNote,
      })),
      startedAt: session.startedAt?.toISOString() ?? null,
      endedAt: session.endedAt?.toISOString() ?? null,
    }
  })
}
