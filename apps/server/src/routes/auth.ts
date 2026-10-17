// ============================================================
// ProctorOverlay — Auth Routes
// POST /auth/login  — returns JWT
// POST /auth/register — dev-only seed route
// ============================================================

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/db.js'
import { signToken } from '../lib/jwt.js'

// We use a simple hash comparison. In production, use bcrypt.
// For now, we store passwords as plain SHA-256 hashes for dev speed.
// Phase 9 will add proper bcrypt.
import { createHash } from 'crypto'

function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex')
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(['CANDIDATE', 'PROCTOR']),
})

export async function authRoutes(server: FastifyInstance): Promise<void> {
  // ── Login ─────────────────────────────────────────────────
  server.post('/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        message: 'Invalid request',
        errors: parsed.error.flatten().fieldErrors,
      })
    }

    const { email, password } = parsed.data
    const user = await prisma.user.findUnique({ where: { email } })

    if (!user || user.password !== hashPassword(password)) {
      return reply.status(401).send({ message: 'Invalid credentials' })
    }

    const token = signToken(server, {
      userId: user.id,
      email: user.email,
      role: user.role as 'CANDIDATE' | 'PROCTOR',
    })

    return reply.status(200).send({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    })
  })

  // ── Register (dev/seed only) ──────────────────────────────
  server.post('/auth/register', async (request, reply) => {
    if (process.env.NODE_ENV === 'production') {
      return reply.status(404).send({ message: 'Not found' })
    }

    const parsed = registerSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        message: 'Invalid request',
        errors: parsed.error.flatten().fieldErrors,
      })
    }

    const { email, password, role } = parsed.data

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return reply.status(409).send({ message: 'User already exists' })
    }

    const user = await prisma.user.create({
      data: {
        email,
        password: hashPassword(password),
        role,
      },
    })

    const token = signToken(server, {
      userId: user.id,
      email: user.email,
      role: user.role as 'CANDIDATE' | 'PROCTOR',
    })

    return reply.status(201).send({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      message: '[DEV] User created — this route is disabled in production',
    })
  })
}
