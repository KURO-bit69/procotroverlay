import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/db.js'
import { requireAuth, type JwtPayload } from '../lib/jwt.js'
import { getVoiceVerificationProvider, VoiceVerificationError } from '../lib/voice-verification.js'

const uploadSchema = z.object({
  audioBase64: z.string().min(1).max(1_200_000),
  mimeType: z.enum(['audio/webm', 'audio/wav', 'audio/webm;codecs=opus']),
})

async function requireCandidateSession(
  request: FastifyRequest,
  reply: FastifyReply,
  allowedStatuses: string[],
): Promise<{ sessionId: string; user: JwtPayload } | null> {
  const { id } = request.params as { id: string }
  const user = request.user as JwtPayload
  if (user.role !== 'CANDIDATE' || user.sessionId !== id) {
    await reply.status(403).send({ message: 'This candidate session is not authorized for voice verification.' })
    return null
  }

  const session = await prisma.session.findUnique({ where: { id } })
  if (!session || session.candidateId !== user.userId) {
    await reply.status(404).send({ message: 'Candidate session not found.' })
    return null
  }
  if (!allowedStatuses.includes(session.status)) {
    await reply.status(409).send({ message: 'Voice verification is not available in this session state.' })
    return null
  }
  return { sessionId: id, user }
}

function decodeAudio(audioBase64: string): Buffer | null {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(audioBase64)) return null
  const audio = Buffer.from(audioBase64, 'base64')
  return audio.length > 0 && audio.length <= 900_000 ? audio : null
}

function sendProviderError(reply: FastifyReply, error: unknown) {
  if (error instanceof VoiceVerificationError) {
    return reply.status(error.statusCode).send({ message: error.message, code: error.code })
  }
  return reply.status(502).send({ message: 'Voice verification is temporarily unavailable.', code: 'provider_error' })
}

export async function voiceVerificationRoutes(server: FastifyInstance): Promise<void> {
  server.post('/sessions/:id/voice/enroll', {
    preHandler: [requireAuth],
    bodyLimit: 1_500_000,
  }, async (request, reply) => {
    const session = await requireCandidateSession(request, reply, ['PREFLIGHT'])
    if (!session) return
    const parsed = uploadSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ message: 'Provide a supported voice recording.' })
    const audio = decodeAudio(parsed.data.audioBase64)
    if (!audio) return reply.status(400).send({ message: 'Voice recording is empty or too large.' })

    try {
      const provider = getVoiceVerificationProvider()
      await provider.enroll(session.sessionId, audio, parsed.data.mimeType)
      return reply.status(200).send({ enrolled: true, provider: provider.name })
    } catch (error) {
      return sendProviderError(reply, error)
    }
  })

  server.post('/sessions/:id/voice/verify', {
    preHandler: [requireAuth],
    bodyLimit: 1_500_000,
  }, async (request, reply) => {
    const session = await requireCandidateSession(request, reply, ['PREFLIGHT', 'ACTIVE'])
    if (!session) return
    const parsed = uploadSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ message: 'Provide a supported voice recording.' })
    const audio = decodeAudio(parsed.data.audioBase64)
    if (!audio) return reply.status(400).send({ message: 'Voice recording is empty or too large.' })

    try {
      const provider = getVoiceVerificationProvider()
      return await provider.verify(session.sessionId, audio, parsed.data.mimeType)
    } catch (error) {
      return sendProviderError(reply, error)
    }
  })

  server.delete('/sessions/:id/voice/enrollment', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const session = await requireCandidateSession(request, reply, ['PREFLIGHT', 'ACTIVE', 'INTERRUPTED', 'COMPLETED', 'FORCE_ENDED'])
    if (!session) return
    try {
      await getVoiceVerificationProvider().dispose(session.sessionId)
      return reply.status(200).send({ deleted: true })
    } catch (error) {
      return sendProviderError(reply, error)
    }
  })
}
