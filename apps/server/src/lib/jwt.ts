// ============================================================
// ProctorOverlay — JWT Helpers
// ============================================================

import type { FastifyInstance, FastifyRequest } from 'fastify'

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me-in-production'
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '8h'

export interface JwtPayload {
  userId: string
  email: string
  role: 'CANDIDATE' | 'PROCTOR'
  sessionId?: string
}

/** Register @fastify/jwt with the server */
export async function registerJwt(server: FastifyInstance): Promise<void> {
  const jwt = await import('@fastify/jwt')
  await server.register(jwt.default, {
    secret: JWT_SECRET,
    sign: { expiresIn: JWT_EXPIRES_IN },
  })
}

/** Sign a JWT token */
export function signToken(
  server: FastifyInstance,
  payload: JwtPayload,
): string {
  return server.jwt.sign(payload)
}

/** Verify and decode a JWT token */
export async function verifyToken(
  request: FastifyRequest,
): Promise<JwtPayload> {
  await request.jwtVerify()
  return request.user as JwtPayload
}

/** Fastify preHandler hook that requires a valid JWT */
export async function requireAuth(
  request: FastifyRequest,
): Promise<void> {
  try {
    await request.jwtVerify()
  } catch {
    throw { statusCode: 401, message: 'Unauthorized' }
  }
}

/** Fastify preHandler hook that requires PROCTOR role */
export async function requireProctor(
  request: FastifyRequest,
): Promise<void> {
  await requireAuth(request)
  const user = request.user as JwtPayload
  if (user.role !== 'PROCTOR') {
    throw { statusCode: 403, message: 'Proctor access required' }
  }
}
