import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { POST as sttPOST } from '../../src/app/api/v1/stt/route'

function buildMultipart(
  parts: Array<
    | { type: 'field'; name: string; value: string }
    | { type: 'file'; name: string; filename: string; contentType: string; data: Uint8Array }
  >,
) {
  const boundary = '----vitest-boundary-7f8a0d9b'
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
  // concat
  const total = chunks.reduce((n, c) => n + c.byteLength, 0)
  const body = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    body.set(c, off)
    off += c.byteLength
  }
  const contentType = `multipart/form-data; boundary=${boundary}`
  return { body, contentType }
}

function makeReq(body: any) {
  return new Request('http://localhost:3000/api/v1/stt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('API: POST /api/v1/stt', () => {
  const envBackup = { ...process.env } as Record<string, string | undefined>

  beforeEach(() => {
    // Default to mock provider and no auth gating
    delete (process.env as any).OPENAI_API_KEY
    process.env.STT_PROVIDER = 'mock'
    process.env.CLERK_ENABLED = '0'
  })

  afterEach(() => {
    // Restore env to avoid leaking into other tests
    for (const k of Object.keys(process.env)) delete (process.env as any)[k]
    Object.assign(process.env, envBackup)
  })

  it('returns 200 with mock provider', async () => {
    const res = await sttPOST(makeReq({ audioUrl: 'https://example.com/a.wav' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.provider).toBe('mock')
    expect(typeof json.text).toBe('string')
  })

  it('returns 501 with openai provider when OPENAI_API_KEY is missing', async () => {
    process.env.STT_PROVIDER = 'openai'
    delete (process.env as any).OPENAI_API_KEY
    const res = await sttPOST(makeReq({ audioUrl: 'https://example.com/a.wav' }))
    expect(res.status).toBe(501)
    const json = await res.json()
    expect(json).toEqual({ error: 'STT provider not configured' })
  })

  it('returns 401 when Clerk gating is enabled and no auth context', async () => {
    process.env.CLERK_ENABLED = '1'
    process.env.STT_PROVIDER = 'mock'
    const res = await sttPOST(makeReq({ audioUrl: 'https://example.com/a.wav' }))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe('Unauthorized')
    expect(json.reason).toBeDefined()
  })
  
  it('multipart: returns 400 when audio file is missing', async () => {
    process.env.CLERK_ENABLED = '0'
    process.env.STT_PROVIDER = 'mock'
    const { body, contentType } = buildMultipart([
      { type: 'field', name: 'sessionId', value: 's1' },
      { type: 'field', name: 'groupId', value: 'g1' },
    ])
    const req = new Request('http://localhost:3000/api/v1/stt', { method: 'POST', headers: { 'content-type': contentType }, body })
    const res = await sttPOST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json).toEqual({ error: "audio file is required in form field 'audio'" })
  })

  it('multipart: returns 400 for unsupported contentType', async () => {
    process.env.CLERK_ENABLED = '0'
    process.env.STT_PROVIDER = 'mock'
    const audio = new Uint8Array([1, 2, 3])
    const { body, contentType } = buildMultipart([
      { type: 'file', name: 'audio', filename: 'a.ogg', contentType: 'audio/ogg', data: audio },
    ])
    const req = new Request('http://localhost:3000/api/v1/stt', { method: 'POST', headers: { 'content-type': contentType }, body })
    const res = await sttPOST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json).toEqual({ error: 'Unsupported contentType' })
  })

  it('multipart: returns 413 when audio exceeds STT_MAX_AUDIO_BYTES', async () => {
    process.env.CLERK_ENABLED = '0'
    process.env.STT_PROVIDER = 'mock'
    process.env.STT_MAX_AUDIO_BYTES = '5'
    const big = new Uint8Array(10).fill(1)
    const { body, contentType } = buildMultipart([
      { type: 'file', name: 'audio', filename: 'a.wav', contentType: 'audio/wav', data: big },
    ])
    const req = new Request('http://localhost:3000/api/v1/stt', { method: 'POST', headers: { 'content-type': contentType }, body })
    const res = await sttPOST(req)
    expect(res.status).toBe(413)
    const json = await res.json()
    expect(json.error).toBe('Audio too large')
    expect(json.maxBytes).toBe(5)
  })

  it('multipart: returns 501 when storage is not configured', async () => {
    process.env.CLERK_ENABLED = '0'
    process.env.STT_PROVIDER = 'mock'
    delete (process.env as any).STORAGE_PROVIDER
    delete (process.env as any).S3_BUCKET_AUDIO
    const audio = new Uint8Array([1, 2, 3, 4])
    const { body, contentType } = buildMultipart([
      { type: 'file', name: 'audio', filename: 'a.wav', contentType: 'audio/wav', data: audio },
    ])
    const req = new Request('http://localhost:3000/api/v1/stt', { method: 'POST', headers: { 'content-type': contentType }, body })
    const res = await sttPOST(req)
    expect(res.status).toBe(501)
    const json = await res.json()
    expect(json).toEqual({ error: 'Storage not configured' })
  })
})
