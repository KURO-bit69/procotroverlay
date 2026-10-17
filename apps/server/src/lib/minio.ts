// ============================================================
// ProctorOverlay — MinIO Object Storage Client
// ============================================================

import * as Minio from 'minio'

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT ?? 'localhost'
const MINIO_PORT = parseInt(process.env.MINIO_PORT ?? '9000', 10)
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY ?? 'minioadmin'
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY ?? 'minioadmin'
const MINIO_BUCKET = process.env.MINIO_BUCKET ?? 'proctoroverlay-evidence'
const MINIO_USE_SSL = process.env.MINIO_USE_SSL === 'true'

export const minioClient = new Minio.Client({
  endPoint: MINIO_ENDPOINT,
  port: MINIO_PORT,
  useSSL: MINIO_USE_SSL,
  accessKey: MINIO_ACCESS_KEY,
  secretKey: MINIO_SECRET_KEY,
})

/** Ensure the evidence bucket exists */
export async function ensureBucket(): Promise<void> {
  try {
    const exists = await minioClient.bucketExists(MINIO_BUCKET)
    if (!exists) {
      await minioClient.makeBucket(MINIO_BUCKET)
      console.log(`[MinIO] Created bucket: ${MINIO_BUCKET}`)
    } else {
      console.log(`[MinIO] Bucket exists: ${MINIO_BUCKET}`)
    }
  } catch (err) {
    console.error('[MinIO] Failed to ensure bucket:', err)
    // Non-fatal — evidence uploads will fail but monitoring continues
  }
}

/** Upload an evidence file (screenshot, audio clip, etc.) */
export async function uploadEvidence(
  objectName: string,
  data: Buffer,
  contentType: string,
): Promise<string> {
  await minioClient.putObject(MINIO_BUCKET, objectName, data, data.length, {
    'Content-Type': contentType,
  })
  return `${MINIO_BUCKET}/${objectName}`
}

/** Generate a presigned GET URL for evidence (for proctor dashboard) */
export async function getEvidenceUrl(
  objectName: string,
  expirySeconds = 3600,
): Promise<string> {
  return minioClient.presignedGetObject(
    MINIO_BUCKET,
    objectName,
    expirySeconds,
  )
}
