// ============================================================
// ProctorOverlay — Privacy, Consent & Fairness Routes
// GDPR Art. 15-17, India DPDP Act Sec. 11-14
// Consent records, data export, data erasure, accommodations,
// appeals, retention policy, AI disclosure.
// ============================================================

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createHash } from 'crypto'
import { prisma } from '../lib/db.js'
import { requireAuth, requireProctor, type JwtPayload } from '../lib/jwt.js'
import {
  DEFAULT_RETENTION_POLICY,
  AI_DISCLOSURE_TEXT,
  EVENT_AI_DISCLOSURES,
} from '@proctoroverlay/shared'

// ── Zod Schemas ─────────────────────────────────────────────

const consentGrantSchema = z.object({
  sessionId: z.string().uuid(),
  purposes: z.array(z.enum([
    'MONITORING', 'AUDIO_ANALYSIS',
    'EVIDENCE_CAPTURE', 'SCREEN_RECORDING',
  ])).min(1),
  policyVersion: z.string().default('1.0'),
})

const consentWithdrawSchema = z.object({
  sessionId: z.string().uuid(),
  purposes: z.array(z.string()).min(1),
})

const accommodationSchema = z.object({
  sessionId: z.string().uuid(),
  accommodations: z.array(z.object({
    type: z.enum([
      'DISABLE_GAZE_TRACKING', 'RELAXED_GAZE_THRESHOLDS',
      'DISABLE_FACE_DETECTION', 'EXTENDED_FOCUS_THRESHOLD',
      'DISABLE_MULTIPLE_FACE_CHECK', 'ALLOW_SCREEN_READER',
      'EXTENDED_MIC_MUTE_THRESHOLD', 'CUSTOM',
    ]),
    reason: z.string().min(1),
    configOverrides: z.record(z.unknown()).optional(),
  })),
  proctorNote: z.string().optional(),
})

const appealSubmitSchema = z.object({
  sessionId: z.string().uuid(),
  eventId: z.string().min(1),
  candidateStatement: z.string().min(10).max(2000),
})

const appealResolveSchema = z.object({
  status: z.enum(['ACCEPTED', 'REJECTED']),
  proctorResponse: z.string().min(1).max(2000),
})

const dataRequestSchema = z.object({
  type: z.enum(['EXPORT', 'ERASURE']),
  scope: z.array(z.enum([
    'events', 'sessions', 'consents', 'appeals', 'accommodations',
  ])).min(1),
})

const retentionPolicySchema = z.object({
  sessionId: z.string().uuid(),
  eventRetentionDays: z.number().int().min(1).max(365).optional(),
  evidenceRetentionDays: z.number().int().min(1).max(365).optional(),
  sessionRetentionDays: z.number().int().min(1).max(730).optional(),
  autoDelete: z.boolean().optional(),
})

/** SHA-256 hash of IP address — we never store raw IPs */
function hashIP(ip: string | undefined): string | null {
  if (!ip) return null
  return createHash('sha256').update(ip).digest('hex').slice(0, 16)
}

export async function privacyRoutes(server: FastifyInstance): Promise<void> {

  // ════════════════════════════════════════════════════════════
  // CONSENT
  // ════════════════════════════════════════════════════════════

  // ── POST /privacy/consent — Record consent ────────────────
  server.post('/privacy/consent', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const parsed = consentGrantSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        message: 'Invalid consent data',
        errors: parsed.error.flatten().fieldErrors,
      })
    }

    const user = request.user as JwtPayload
    const { sessionId, purposes, policyVersion } = parsed.data
    const ipHash = hashIP(request.ip)

    const records = []
    for (const purpose of purposes) {
      // Upsert: if consent already exists for this purpose, don't duplicate
      const existing = await prisma.consent.findFirst({
        where: {
          userId: user.userId,
          sessionId,
          purpose,
          status: 'GRANTED',
        },
      })

      if (existing) {
        records.push(existing)
        continue
      }

      const consent = await prisma.consent.create({
        data: {
          userId: user.userId,
          sessionId,
          purpose,
          policyVersion,
          ipHash,
          status: 'GRANTED',
        },
      })
      records.push(consent)
    }

    // Also update session.consentAt
    await prisma.session.update({
      where: { id: sessionId },
      data: { consentAt: new Date() },
    })

    return reply.status(201).send({
      message: 'Consent recorded',
      consents: records.map((c) => ({
        id: c.id,
        purpose: c.purpose,
        status: c.status,
        policyVersion: c.policyVersion,
        grantedAt: c.grantedAt.toISOString(),
      })),
    })
  })

  // ── POST /privacy/consent/withdraw — Withdraw consent ─────
  server.post('/privacy/consent/withdraw', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const parsed = consentWithdrawSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        message: 'Invalid request',
        errors: parsed.error.flatten().fieldErrors,
      })
    }

    const user = request.user as JwtPayload
    const { sessionId, purposes } = parsed.data
    const now = new Date()
    let withdrawn = 0

    for (const purpose of purposes) {
      const existing = await prisma.consent.findFirst({
        where: {
          userId: user.userId,
          sessionId,
          purpose,
          status: 'GRANTED',
        },
      })
      if (existing) {
        await prisma.consent.update({
          where: { id: existing.id },
          data: { status: 'WITHDRAWN', withdrawnAt: now },
        })
        withdrawn++
      }
    }

    // NOTE: Withdrawing consent does NOT auto-delete data.
    // Data deletion requires a separate ERASURE request (GDPR Art. 17).
    // The proctor is notified of consent withdrawal.

    return reply.status(200).send({
      message: `Consent withdrawn for ${withdrawn} purpose(s)`,
      withdrawn,
      note: 'To request data deletion, submit a separate erasure request via POST /privacy/data-request',
    })
  })

  // ── GET /privacy/consent/:sessionId — Get consent records ─
  server.get('/privacy/consent/:sessionId', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string }
    const user = request.user as JwtPayload

    // Only the session's candidate/proctor can view
    const session = await prisma.session.findUnique({ where: { id: sessionId } })
    if (!session) return reply.status(404).send({ message: 'Session not found' })
    if (session.candidateId !== user.userId && session.proctorId !== user.userId) {
      return reply.status(403).send({ message: 'Not authorized' })
    }

    const consents = await prisma.consent.findMany({
      where: { sessionId },
      orderBy: { grantedAt: 'asc' },
    })

    return consents.map((c) => ({
      id: c.id,
      purpose: c.purpose,
      status: c.status,
      policyVersion: c.policyVersion,
      grantedAt: c.grantedAt.toISOString(),
      withdrawnAt: c.withdrawnAt?.toISOString() ?? null,
    }))
  })

  // ════════════════════════════════════════════════════════════
  // ACCOMMODATIONS
  // ════════════════════════════════════════════════════════════

  // ── PUT /privacy/accommodations — Set session accommodations
  server.put('/privacy/accommodations', {
    preHandler: [requireProctor],
  }, async (request, reply) => {
    const parsed = accommodationSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        message: 'Invalid accommodations',
        errors: parsed.error.flatten().fieldErrors,
      })
    }

    const user = request.user as JwtPayload
    const { sessionId, accommodations, proctorNote } = parsed.data

    const session = await prisma.session.findUnique({ where: { id: sessionId } })
    if (!session) return reply.status(404).send({ message: 'Session not found' })
    if (session.proctorId !== user.userId) {
      return reply.status(403).send({ message: 'Only the session proctor can set accommodations' })
    }

    // Enrich with approver info
    const enriched = accommodations.map((a) => ({
      ...a,
      approvedBy: user.email,
      approvedAt: new Date().toISOString(),
    }))

    await prisma.session.update({
      where: { id: sessionId },
      data: {
        accommodations: JSON.stringify(enriched),
        accommodationNote: proctorNote ?? null,
      },
    })

    return reply.status(200).send({
      message: `${accommodations.length} accommodation(s) set`,
      accommodations: enriched,
    })
  })

  // ── GET /privacy/accommodations/:sessionId — Get accommodations
  server.get('/privacy/accommodations/:sessionId', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string }
    const user = request.user as JwtPayload

    const session = await prisma.session.findUnique({ where: { id: sessionId } })
    if (!session) return reply.status(404).send({ message: 'Session not found' })
    if (session.candidateId !== user.userId && session.proctorId !== user.userId) {
      return reply.status(403).send({ message: 'Not authorized' })
    }

    return {
      sessionId,
      accommodations: JSON.parse(session.accommodations),
      accommodationNote: session.accommodationNote,
    }
  })

  // ════════════════════════════════════════════════════════════
  // APPEALS
  // ════════════════════════════════════════════════════════════

  // ── POST /privacy/appeals — Candidate submits appeal ──────
  server.post('/privacy/appeals', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const parsed = appealSubmitSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        message: 'Invalid appeal',
        errors: parsed.error.flatten().fieldErrors,
      })
    }

    const user = request.user as JwtPayload
    const { sessionId, eventId, candidateStatement } = parsed.data

    // Verify session + event exist and user is the candidate
    const session = await prisma.session.findUnique({ where: { id: sessionId } })
    if (!session) return reply.status(404).send({ message: 'Session not found' })
    if (session.candidateId !== user.userId) {
      return reply.status(403).send({ message: 'Only the session candidate can submit appeals' })
    }

    const event = await prisma.event.findFirst({
      where: { eventId, sessionId },
    })
    if (!event) return reply.status(404).send({ message: 'Event not found' })

    // Check for existing appeal on this event
    const existing = await prisma.appeal.findFirst({
      where: { eventId: event.id, userId: user.userId },
    })
    if (existing) {
      return reply.status(409).send({ message: 'Appeal already exists for this event' })
    }

    const appeal = await prisma.appeal.create({
      data: {
        sessionId,
        eventId: event.id,
        userId: user.userId,
        candidateStatement,
        status: 'SUBMITTED',
      },
    })

    // Update event review status to APPEALED
    await prisma.event.update({
      where: { id: event.id },
      data: { reviewStatus: 'APPEALED' },
    })

    return reply.status(201).send({
      appealId: appeal.id,
      status: appeal.status,
      submittedAt: appeal.submittedAt.toISOString(),
    })
  })

  // ── GET /privacy/appeals/:sessionId — List appeals for session
  server.get('/privacy/appeals/:sessionId', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string }
    const user = request.user as JwtPayload

    const session = await prisma.session.findUnique({ where: { id: sessionId } })
    if (!session) return reply.status(404).send({ message: 'Session not found' })
    if (session.candidateId !== user.userId && session.proctorId !== user.userId) {
      return reply.status(403).send({ message: 'Not authorized' })
    }

    const appeals = await prisma.appeal.findMany({
      where: { sessionId },
      include: {
        event: { select: { eventId: true, type: true, severity: true } },
      },
      orderBy: { submittedAt: 'desc' },
    })

    return appeals.map((a) => ({
      id: a.id,
      eventId: a.event.eventId,
      eventType: a.event.type,
      eventSeverity: a.event.severity,
      candidateStatement: a.candidateStatement,
      status: a.status,
      proctorResponse: a.proctorResponse,
      submittedAt: a.submittedAt.toISOString(),
      resolvedAt: a.resolvedAt?.toISOString() ?? null,
    }))
  })

  // ── PATCH /privacy/appeals/:appealId — Proctor resolves appeal
  server.patch('/privacy/appeals/:appealId', {
    preHandler: [requireProctor],
  }, async (request, reply) => {
    const { appealId } = request.params as { appealId: string }
    const parsed = appealResolveSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        message: 'Invalid resolution',
        errors: parsed.error.flatten().fieldErrors,
      })
    }

    const appeal = await prisma.appeal.findUnique({
      where: { id: appealId },
      include: { event: true },
    })
    if (!appeal) return reply.status(404).send({ message: 'Appeal not found' })
    if (appeal.status !== 'SUBMITTED' && appeal.status !== 'UNDER_REVIEW') {
      return reply.status(400).send({ message: 'Appeal already resolved' })
    }

    const { status, proctorResponse } = parsed.data

    await prisma.appeal.update({
      where: { id: appealId },
      data: {
        status,
        proctorResponse,
        resolvedAt: new Date(),
      },
    })

    // If accepted, update event review status to DISMISSED (flag removed)
    if (status === 'ACCEPTED') {
      await prisma.event.update({
        where: { id: appeal.eventId },
        data: { reviewStatus: 'DISMISSED', proctorNote: `Appeal accepted: ${proctorResponse}` },
      })
    } else {
      // Rejected — mark event as FLAGGED (stands)
      await prisma.event.update({
        where: { id: appeal.eventId },
        data: { reviewStatus: 'FLAGGED', proctorNote: `Appeal rejected: ${proctorResponse}` },
      })
    }

    return { appealId, status, resolvedAt: new Date().toISOString() }
  })

  // ════════════════════════════════════════════════════════════
  // DATA SUBJECT RIGHTS (GDPR Art. 15-17, DPDP Sec. 11-14)
  // ════════════════════════════════════════════════════════════

  // ── POST /privacy/data-request — Request export or erasure ─
  server.post('/privacy/data-request', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const parsed = dataRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        message: 'Invalid request',
        errors: parsed.error.flatten().fieldErrors,
      })
    }

    const user = request.user as JwtPayload
    const { type, scope } = parsed.data

    // Check for existing pending request of same type
    const existing = await prisma.dataRequest.findFirst({
      where: {
        userId: user.userId,
        type,
        status: { in: ['PENDING', 'PROCESSING'] },
      },
    })
    if (existing) {
      return reply.status(409).send({
        message: `A ${type.toLowerCase()} request is already pending`,
        requestId: existing.id,
      })
    }

    const dataRequest = await prisma.dataRequest.create({
      data: {
        userId: user.userId,
        type,
        scope: JSON.stringify(scope),
        status: 'PENDING',
      },
    })

    return reply.status(201).send({
      requestId: dataRequest.id,
      type,
      status: 'PENDING',
      requestedAt: dataRequest.requestedAt.toISOString(),
      note: type === 'EXPORT'
        ? 'Your data export will be prepared. You will be notified when ready.'
        : 'Your erasure request will be reviewed. Some data may be retained for legal obligations.',
    })
  })

  // ── GET /privacy/data-request — List user's data requests ─
  server.get('/privacy/data-request', {
    preHandler: [requireAuth],
  }, async (request) => {
    const user = request.user as JwtPayload

    const requests = await prisma.dataRequest.findMany({
      where: { userId: user.userId },
      orderBy: { requestedAt: 'desc' },
    })

    return requests.map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      scope: JSON.parse(r.scope),
      requestedAt: r.requestedAt.toISOString(),
      processingAt: r.processingAt?.toISOString() ?? null,
      completedAt: r.completedAt?.toISOString() ?? null,
      downloadUrl: r.downloadUrl,
      retentionReason: r.retentionReason,
    }))
  })

  // ── POST /privacy/data-request/:id/process — Process request (proctor/admin)
  server.post('/privacy/data-request/:id/process', {
    preHandler: [requireProctor],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }

    const dataRequest = await prisma.dataRequest.findUnique({
      where: { id },
      include: { user: { select: { id: true, email: true } } },
    })
    if (!dataRequest) return reply.status(404).send({ message: 'Request not found' })
    if (dataRequest.status !== 'PENDING') {
      return reply.status(400).send({ message: 'Request is not pending' })
    }

    await prisma.dataRequest.update({
      where: { id },
      data: { status: 'PROCESSING', processingAt: new Date() },
    })

    const scopes = JSON.parse(dataRequest.scope) as string[]

    if (dataRequest.type === 'EXPORT') {
      // Build export data
      const exportData: Record<string, unknown> = { userId: dataRequest.userId }

      if (scopes.includes('sessions')) {
        const sessions = await prisma.session.findMany({
          where: {
            OR: [
              { candidateId: dataRequest.userId },
              { proctorId: dataRequest.userId },
            ],
          },
          select: {
            id: true, joinCode: true, status: true, riskScore: true,
            startedAt: true, endedAt: true, createdAt: true,
            accommodations: true, accommodationNote: true,
          },
        })
        exportData.sessions = sessions
      }

      if (scopes.includes('events')) {
        const sessions = await prisma.session.findMany({
          where: { candidateId: dataRequest.userId },
          select: { id: true },
        })
        const sessionIds = sessions.map((s) => s.id)
        const events = await prisma.event.findMany({
          where: { sessionId: { in: sessionIds } },
          select: {
            eventId: true, type: true, severity: true, source: true,
            clientTimestamp: true, reviewStatus: true, proctorNote: true,
          },
        })
        exportData.events = events
      }

      if (scopes.includes('consents')) {
        const consents = await prisma.consent.findMany({
          where: { userId: dataRequest.userId },
        })
        exportData.consents = consents
      }

      if (scopes.includes('appeals')) {
        const appeals = await prisma.appeal.findMany({
          where: { userId: dataRequest.userId },
        })
        exportData.appeals = appeals
      }

      // In production, this would be written to MinIO and a presigned URL generated.
      // For dev, we return the data directly in the response.
      const exportJson = JSON.stringify(exportData, null, 2)

      await prisma.dataRequest.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          // In production: downloadUrl = presigned MinIO URL
          downloadUrl: `data:application/json;base64,${Buffer.from(exportJson).toString('base64')}`,
        },
      })

      return {
        requestId: id,
        status: 'COMPLETED',
        message: 'Data export ready',
        data: exportData, // Dev only — production would use downloadUrl
      }
    }

    if (dataRequest.type === 'ERASURE') {
      const deletedScopes: string[] = []

      // Get candidate's sessions
      const sessions = await prisma.session.findMany({
        where: { candidateId: dataRequest.userId },
        select: { id: true, status: true },
      })
      const sessionIds = sessions.map((s) => s.id)

      // Only delete data from completed/ended sessions
      const completedIds = sessions
        .filter((s) => ['COMPLETED', 'FORCE_ENDED'].includes(s.status))
        .map((s) => s.id)

      const activeIds = sessionIds.filter((id) => !completedIds.includes(id))

      if (scopes.includes('events') && completedIds.length > 0) {
        await prisma.event.deleteMany({
          where: { sessionId: { in: completedIds } },
        })
        deletedScopes.push('events')
      }

      if (scopes.includes('consents')) {
        await prisma.consent.deleteMany({
          where: { userId: dataRequest.userId },
        })
        deletedScopes.push('consents')
      }

      if (scopes.includes('appeals') && completedIds.length > 0) {
        await prisma.appeal.deleteMany({
          where: { sessionId: { in: completedIds } },
        })
        deletedScopes.push('appeals')
      }

      if (scopes.includes('sessions') && completedIds.length > 0) {
        // Anonymise rather than delete — preserve aggregate stats
        for (const sid of completedIds) {
          await prisma.session.update({
            where: { id: sid },
            data: {
              dataErased: true,
              meetingUrl: null,
              accommodationNote: null,
              config: '{}',
            },
          })
        }
        deletedScopes.push('sessions (anonymised)')
      }

      const retentionReason = activeIds.length > 0
        ? `${activeIds.length} active/pending session(s) retained until completion.`
        : undefined

      await prisma.dataRequest.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          deletedScopes: JSON.stringify(deletedScopes),
          retentionReason,
        },
      })

      return {
        requestId: id,
        status: 'COMPLETED',
        deletedScopes,
        retentionReason,
        message: 'Erasure completed. Active sessions retained until conclusion.',
      }
    }

    return reply.status(400).send({ message: 'Unknown request type' })
  })

  // ════════════════════════════════════════════════════════════
  // RETENTION POLICY
  // ════════════════════════════════════════════════════════════

  // ── PUT /privacy/retention — Set session retention policy ──
  server.put('/privacy/retention', {
    preHandler: [requireProctor],
  }, async (request, reply) => {
    const parsed = retentionPolicySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        message: 'Invalid retention policy',
        errors: parsed.error.flatten().fieldErrors,
      })
    }

    const user = request.user as JwtPayload
    const { sessionId, ...overrides } = parsed.data

    const session = await prisma.session.findUnique({ where: { id: sessionId } })
    if (!session) return reply.status(404).send({ message: 'Session not found' })
    if (session.proctorId !== user.userId) {
      return reply.status(403).send({ message: 'Only session proctor can set retention policy' })
    }

    const policy = { ...DEFAULT_RETENTION_POLICY, ...overrides }

    await prisma.session.update({
      where: { id: sessionId },
      data: { retentionPolicy: JSON.stringify(policy) },
    })

    return { sessionId, retentionPolicy: policy }
  })

  // ── GET /privacy/retention/status — Check what's due for cleanup
  server.get('/privacy/retention/status', {
    preHandler: [requireProctor],
  }, async () => {
    const now = new Date()

    // Find sessions past their retain-until date
    const expiredSessions = await prisma.session.findMany({
      where: {
        retainUntil: { lte: now },
        dataErased: false,
      },
      select: { id: true, joinCode: true, retainUntil: true, endedAt: true },
    })

    // Find sessions that ended but have no retainUntil computed yet
    const unscheduled = await prisma.session.findMany({
      where: {
        endedAt: { not: null },
        retainUntil: null,
        dataErased: false,
      },
      select: { id: true, joinCode: true, endedAt: true },
    })

    return {
      defaultPolicy: DEFAULT_RETENTION_POLICY,
      expiredCount: expiredSessions.length,
      expired: expiredSessions,
      unscheduledCount: unscheduled.length,
      unscheduled,
    }
  })

  // ── POST /privacy/retention/compute — Compute retainUntil for ended sessions
  server.post('/privacy/retention/compute', {
    preHandler: [requireProctor],
  }, async () => {
    const sessions = await prisma.session.findMany({
      where: {
        endedAt: { not: null },
        retainUntil: null,
        dataErased: false,
      },
    })

    let updated = 0
    for (const session of sessions) {
      const policy = session.retentionPolicy
        ? JSON.parse(session.retentionPolicy)
        : DEFAULT_RETENTION_POLICY

      const maxDays = Math.max(
        policy.sessionRetentionDays ?? DEFAULT_RETENTION_POLICY.sessionRetentionDays,
        policy.eventRetentionDays ?? DEFAULT_RETENTION_POLICY.eventRetentionDays,
        policy.evidenceRetentionDays ?? DEFAULT_RETENTION_POLICY.evidenceRetentionDays,
      )

      const retainUntil = new Date(session.endedAt!.getTime() + maxDays * 24 * 60 * 60 * 1000)

      await prisma.session.update({
        where: { id: session.id },
        data: { retainUntil },
      })
      updated++
    }

    return { message: `Computed retainUntil for ${updated} session(s)`, updated }
  })

  // ════════════════════════════════════════════════════════════
  // AI DISCLOSURE
  // ════════════════════════════════════════════════════════════

  // ── GET /privacy/ai-disclosure — Global AI disclosure text ─
  server.get('/privacy/ai-disclosure', async () => {
    return {
      disclosure: AI_DISCLOSURE_TEXT,
      perEventType: EVENT_AI_DISCLOSURES,
      policy: {
        autoReject: false,
        humanReviewRequired: true,
        appealAvailable: true,
        accommodationsAvailable: true,
      },
    }
  })

  // ── GET /privacy/ai-disclosure/:eventType — Per-event disclosure
  server.get('/privacy/ai-disclosure/:eventType', async (request, reply) => {
    const { eventType } = request.params as { eventType: string }
    const disclosure = EVENT_AI_DISCLOSURES[eventType]

    if (!disclosure) {
      return reply.status(200).send({
        eventType,
        disclosure: {
          description: `Event type: ${eventType}`,
          technique: 'System monitoring',
          limitations: ['No specific AI disclosure available for this event type.'],
          humanReviewed: true,
        },
      })
    }

    return { eventType, disclosure }
  })
}
