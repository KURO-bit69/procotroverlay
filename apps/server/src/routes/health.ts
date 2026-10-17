// ============================================================
// ProctorOverlay — Health Route
// ============================================================

import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/db.js'
import { redis } from '../lib/redis.js'

export async function healthRoutes(server: FastifyInstance): Promise<void> {
  server.get('/health', async () => {
    let dbOk = false
    let redisOk = false

    try {
      await prisma.$queryRawUnsafe('SELECT 1')
      dbOk = true
    } catch { /* db down */ }

    try {
      await redis.ping()
      redisOk = true
    } catch { /* redis down */ }

    return {
      status: dbOk && redisOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      version: '0.2.0',
      services: {
        database: dbOk ? 'ok' : 'down',
        redis: redisOk ? 'ok' : 'down',
      },
    }
  })
}
