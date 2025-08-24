/* eslint-disable no-console */
import { S3Client, CreateBucketCommand, HeadBucketCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3'
import fs from 'node:fs'
import path from 'node:path'

function loadDotEnvLocal() {
  try {
    const p = path.resolve(process.cwd(), '.env.local')
    if (!fs.existsSync(p)) return
    const txt = fs.readFileSync(p, 'utf8')
    for (const raw of txt.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
      if (!m) continue
      const key = m[1]
      let val = m[2]
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (process.env[key] === undefined) process.env[key] = val
    }
  } catch {}
}

function env(name, def = '') {
  const v = process.env[name]
  return (v === undefined || v === null || v === '') ? def : v
}

async function ensureBucket(s3, bucket) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }))
    return 'exists'
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404) {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }))
      return 'created'
    }
    // LocalStack returns 301 for non-existing bucket sometimes; try create on any error
    try {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }))
      return 'created'
    } catch (e2) {
      throw e2
    }
  }
}

async function main() {
  // Load env from .env.local if present
  loadDotEnvLocal()
  const bucket = env('S3_BUCKET_AUDIO', 'coachup-audio-local')
  const region = env('S3_REGION', 'us-east-1')
  const endpoint = env('S3_ENDPOINT_URL', '') || undefined
  const forcePathStyle = env('S3_FORCE_PATH_STYLE', '0') === '1'
  const accessKeyId = env('AWS_ACCESS_KEY_ID') || undefined
  const secretAccessKey = env('AWS_SECRET_ACCESS_KEY') || undefined

  const s3 = new S3Client({
    region,
    endpoint,
    forcePathStyle,
    credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })

  const state = await ensureBucket(s3, bucket)
  console.log(JSON.stringify({ level: 'info', message: 'bucket_state', bucket, state, region, endpoint: !!endpoint, forcePathStyle }))

  const cors = {
    CORSRules: [
      {
        AllowedOrigins: ['*'],
        AllowedMethods: ['GET', 'PUT', 'HEAD', 'POST', 'DELETE'],
        AllowedHeaders: ['*'],
        ExposeHeaders: ['ETag', 'x-amz-request-id'],
        MaxAgeSeconds: 300,
      },
    ],
  }
  await s3.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: cors }))
  console.log(JSON.stringify({ level: 'info', message: 'bucket_cors_applied', bucket }))
}

main().catch((err) => { console.error(err); process.exit(1) })
