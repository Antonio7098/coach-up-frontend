import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { POST as presignPOST } from '../../src/app/api/v1/storage/audio/presign/route'
import { POST as sttPOST } from '../../src/app/api/v1/stt/route'
import { POST as ttsPOST } from '../../src/app/api/v1/tts/route'
import { S3Client, CreateBucketCommand, PutObjectCommand, ListBucketsCommand } from '@aws-sdk/client-s3'

const ENDPOINT = process.env.S3_ENDPOINT_URL || 'http://localhost:4566'
const REGION = process.env.S3_REGION || 'us-east-1'
const BUCKET = process.env.S3_BUCKET_AUDIO || 'coachup-audio-local'

function jsonReq(url: string, body: any) {
  return new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

function buildMultipart(
  parts: Array<
    | { type: 'field'; name: string; value: string }
    | { type: 'file'; name: string; filename: string; contentType: string; data: Uint8Array }
  >,
) {
  const boundary = '----vitest-boundary-integration-5a2c4f'
  const te = new TextEncoder()
  const chunks: Uint8Array[] = []
  for (const p of parts) {
    chunks.push(te.encode(`--${boundary}\r\n`))
    if (p.type === 'field') {
      chunks.push(te.encode(`Content-Disposition: form-data; name="${p.name}"\r\n\r\n`))
      chunks.push(te.encode(`${p.value}\r\n`))
    } else {
      chunks.push(
        te.encode(
          `Content-Disposition: form-data; name="${p.name}"; filename="${p.filename}"\r\nContent-Type: ${p.contentType}\r\n\r\n`,
        ),
      )
      chunks.push(p.data)
      chunks.push(te.encode(`\r\n`))
    }
  }
  chunks.push(te.encode(`--${boundary}--\r\n`))
  const total = chunks.reduce((n, c) => n + c.byteLength, 0)
  const body = new Uint8Array(total)
  let off = 0
  for (const c of chunks) { body.set(c, off); off += c.byteLength }
  const contentType = `multipart/form-data; boundary=${boundary}`
  return { body, contentType }
}

async function localstackAvailable(): Promise<boolean> {
  try {
    const s3 = new S3Client({ region: REGION, endpoint: ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } })
    await s3.send(new ListBucketsCommand({}))
    return true
  } catch {
    return false
  }
}

describe('Integration (LocalStack): STT/TTS with S3', () => {
  const envBackup = { ...process.env } as Record<string, string | undefined>
  let s3: S3Client
  let available = false

  beforeAll(async () => {
    // Configure env for LocalStack
    process.env.STORAGE_PROVIDER = 's3'
    process.env.S3_BUCKET_AUDIO = BUCKET
    process.env.S3_REGION = REGION
    process.env.S3_ENDPOINT_URL = ENDPOINT
    process.env.S3_FORCE_PATH_STYLE = '1'
    process.env.AWS_ACCESS_KEY_ID = 'local'
    process.env.AWS_SECRET_ACCESS_KEY = 'local'
    process.env.CLERK_ENABLED = '0'

    available = await localstackAvailable()
    if (!available) return

    s3 = new S3Client({ region: REGION, endpoint: ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } })
    try { await s3.send(new CreateBucketCommand({ Bucket: BUCKET })) } catch {}
  })

  afterAll(() => {
    for (const k of Object.keys(process.env)) delete (process.env as any)[k]
    Object.assign(process.env, envBackup)
  })

  it('STT (openai) can fetch audio via S3 objectKey (OpenAI mocked)', async () => {
    if (!available) return expect(true).toBe(true) // skip gracefully

    // 1) Presign an upload
    const presignRes = await presignPOST(jsonReq('http://localhost:3000/api/v1/storage/audio/presign', {
      contentType: 'audio/wav',
      sizeBytes: 5,
    }))
    expect(presignRes.status).toBe(200)
    const presign = await presignRes.json() as any

    // 2) Upload a tiny audio payload via signed URL
    const payload = new Uint8Array([1,2,3,4,5])
    const uploadRes = await fetch(presign.url, { method: 'PUT', headers: { 'Content-Type': 'audio/wav' }, body: payload })
    expect(uploadRes.ok).toBe(true)

    // 3) Mock OpenAI STT endpoint
    const originalFetch = globalThis.fetch
    const mock = vi.fn(async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input?.url
      if (typeof url === 'string' && url.includes('/v1/audio/transcriptions')) {
        return new Response(JSON.stringify({ text: 'hello from openai mock' }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return originalFetch(input, init)
    })
    vi.spyOn(globalThis as any, 'fetch').mockImplementation(mock as any)

    try {
      // 4) STT with objectKey using openai provider
      process.env.STT_PROVIDER = 'openai'
      process.env.OPENAI_API_KEY = 'test'
      const sttRes = await sttPOST(jsonReq('http://localhost:3000/api/v1/stt', { objectKey: presign.objectKey }))
      expect(sttRes.status).toBe(200)
      const body = await sttRes.json() as any
      expect(body.provider).toBe('openai')
      expect(body.text).toContain('openai mock')
      expect(body.objectKey).toBe(presign.objectKey)
    } finally {
      ;(globalThis.fetch as any).mockRestore?.()
    }
  })

  it('TTS (openai) uploads synthesized audio to S3 and returns bucket URL', async () => {
    if (!available) return expect(true).toBe(true) // skip gracefully

    const originalFetch = globalThis.fetch
    const fakeAudio = new Uint8Array([7,7,7,7])
    const mock = vi.fn(async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input?.url
      if (typeof url === 'string' && url.includes('/v1/audio/speech')) {
        return new Response(fakeAudio, { status: 200, headers: { 'content-type': 'audio/mpeg' } })
      }
      return originalFetch(input, init)
    })
    vi.spyOn(globalThis as any, 'fetch').mockImplementation(mock as any)

    try {
      process.env.TTS_PROVIDER = 'openai'
      process.env.OPENAI_API_KEY = 'test'
      process.env.TTS_FORMAT = 'audio/mpeg'
      const ttsRes = await ttsPOST(jsonReq('http://localhost:3000/api/v1/tts', { text: 'hello s3' }))
      expect(ttsRes.status).toBe(200)
      const body = await ttsRes.json() as any
      expect(body.provider).toBe('openai')
      expect(typeof body.audioUrl).toBe('string')
      // With endpoint configured and path-style on, URL should start with endpoint and bucket name
      expect(body.audioUrl.startsWith(ENDPOINT.replace(/\/$/, '') + '/' + BUCKET + '/')).toBe(true)
    } finally {
      ;(globalThis.fetch as any).mockRestore?.()
    }
  })

  it('STT (multipart) uploads file to S3 and returns transcript (mock provider)', async () => {
    if (!available) return expect(true).toBe(true) // skip gracefully

    process.env.STT_PROVIDER = 'mock'
    process.env.CLERK_ENABLED = '0'

    const audio = new Uint8Array([1,2,3,4,5])
    const { body: mpBody, contentType } = buildMultipart([
      { type: 'file', name: 'audio', filename: 'a.wav', contentType: 'audio/wav', data: audio },
      { type: 'field', name: 'sessionId', value: 's1' },
      { type: 'field', name: 'groupId', value: 'g1' },
    ])

    const req = new Request('http://localhost:3000/api/v1/stt', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: mpBody,
    })
    const res = await sttPOST(req)
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.provider).toBe('mock')
    expect(typeof json.text).toBe('string')
    expect(typeof json.objectKey).toBe('string')
    expect(json.objectKey.startsWith('audio/')).toBe(true)
  })
})
