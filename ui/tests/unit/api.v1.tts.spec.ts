import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { POST as ttsPOST } from '../../src/app/api/v1/tts/route'

function makeReq(body: any) {
  return new Request('http://localhost:3000/api/v1/tts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('API: POST /api/v1/tts', () => {
  const envBackup = { ...process.env } as Record<string, string | undefined>

  beforeEach(() => {
    delete (process.env as any).OPENAI_API_KEY
    process.env.TTS_PROVIDER = 'mock'
    process.env.CLERK_ENABLED = '0'
  })

  afterEach(() => {
    for (const k of Object.keys(process.env)) delete (process.env as any)[k]
    Object.assign(process.env, envBackup)
  })

  it('returns 200 with mock provider', async () => {
    const res = await ttsPOST(makeReq({ text: 'hello world' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.provider).toBe('mock')
    expect(typeof json.audioUrl).toBe('string')
  })

  it('returns 501 with openai provider when OPENAI_API_KEY is missing', async () => {
    process.env.TTS_PROVIDER = 'openai'
    delete (process.env as any).OPENAI_API_KEY
    const res = await ttsPOST(makeReq({ text: 'hello world' }))
    expect(res.status).toBe(501)
    const json = await res.json()
    expect(json).toEqual({ error: 'TTS provider not configured' })
  })

  it('returns 401 when Clerk gating is enabled and no auth context', async () => {
    process.env.CLERK_ENABLED = '1'
    process.env.TTS_PROVIDER = 'mock'
    const res = await ttsPOST(makeReq({ text: 'hello world' }))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json).toEqual({ error: 'Unauthorized' })
  })
})
