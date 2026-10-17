// ============================================================
// ProctorOverlay — Redis Client
// ============================================================

import { Redis } from 'ioredis'

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
})

redis.on('error', (err: Error) => {
  console.error('[Redis] Connection error:', err.message)
})

redis.on('connect', () => {
  console.log('[Redis] Connected')
})

/** Store session token → sessionId + role mapping with TTL */
export async function storeSessionToken(
  token: string,
  data: { userId: string; sessionId: string; role: string },
  ttlSeconds = 28800, // 8 hours
): Promise<void> {
  await redis.set(
    `session-token:${token}`,
    JSON.stringify(data),
    'EX',
    ttlSeconds,
  )
}

/** Look up a session token */
export async function getSessionToken(
  token: string,
): Promise<{ userId: string; sessionId: string; role: string } | null> {
  const raw = await redis.get(`session-token:${token}`)
  if (!raw) return null
  return JSON.parse(raw)
}

/** Invalidate a session token */
export async function deleteSessionToken(token: string): Promise<void> {
  await redis.del(`session-token:${token}`)
}
