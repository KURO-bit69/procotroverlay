// ============================================================
// ProctorOverlay — Server Entry Point
// Fastify + Socket.IO + JWT + Prisma + Redis + MinIO
// ============================================================

import Fastify from 'fastify'
import cors from '@fastify/cors'
import dotenv from 'dotenv'
import { createServer } from 'http'

import { prisma } from './lib/db.js'
import { redis } from './lib/redis.js'
import { registerJwt } from './lib/jwt.js'
import { ensureBucket } from './lib/minio.js'
import { initSocketIO } from './lib/socket.js'

import { healthRoutes } from './routes/health.js'
import { authRoutes } from './routes/auth.js'
import { sessionRoutes } from './routes/sessions.js'
import { privacyRoutes } from './routes/privacy.js'
import { voiceVerificationRoutes } from './routes/voice-verification.js'

dotenv.config()

// ── Create Fastify with custom http server (for Socket.IO) ──
const server = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'development' ? 'info' : 'warn',
    transport:
      process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
  // We'll use server.server (the underlying http.Server) for Socket.IO
})

// ── CORS ──────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:5174,http://localhost:5175')
  .split(',')
  .map((s) => s.trim())

await server.register(cors, {
  origin: allowedOrigins,
  credentials: true,
})

// ── JWT ───────────────────────────────────────────────────
await registerJwt(server)

// ── Routes ────────────────────────────────────────────────
await server.register(healthRoutes)
await server.register(authRoutes)
await server.register(sessionRoutes)
await server.register(privacyRoutes)
await server.register(voiceVerificationRoutes)

// ── Start ─────────────────────────────────────────────────
// Listen on every interface by default so proctor and candidate devices on
// the same LAN can reach this server. Restrict HOST explicitly when needed.
const HOST = process.env.HOST ?? '0.0.0.0'
const PORT = parseInt(process.env.PORT ?? '4000', 10)

try {
  // Connect to services
  await redis.connect().catch((err: Error) => {
    console.warn(`[Redis] Connection failed (non-fatal): ${err.message}`)
    console.warn('[Redis] Server will run without Redis — session tokens will only use JWT')
  })

  // Verify DB connection
  await prisma.$connect()
  console.log('[DB] Connected to PostgreSQL')

  // Ensure MinIO bucket (non-fatal if MinIO is down)
  await ensureBucket().catch((err: Error) => {
    console.warn(`[MinIO] Bucket check failed (non-fatal): ${err.message}`)
  })

  // Start Fastify
  await server.listen({ port: PORT, host: HOST })

  // Initialize Socket.IO on the underlying http server
  const httpServer = server.server
  initSocketIO(httpServer)

  console.log(`\n✅ ProctorOverlay Server running at http://${HOST}:${PORT}`)
  console.log(`   Socket.IO gateway attached\n`)
} catch (err) {
  server.log.error(err)
  process.exit(1)
}

// ── Graceful shutdown ─────────────────────────────────────
const shutdown = async () => {
  console.log('\n[Server] Shutting down...')
  await prisma.$disconnect()
  redis.disconnect()
  await server.close()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
