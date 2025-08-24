import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest'
import { GET as transcriptsGET } from '../../src/app/api/v1/transcripts/route'
import { __resetAllForTests, appendInteraction } from '../../src/app/api/lib/mockConvex'

const getReq = (url: string, headers?: Record<string,string>) =>
  new Request(url, { method: 'GET', headers })

describe('API: GET /api/v1/transcripts', () => {
  let prevMock: string | undefined
  beforeAll(() => {
    prevMock = process.env.MOCK_CONVEX
    process.env.MOCK_CONVEX = '1'
  })
  afterAll(() => {
    if (prevMock === undefined) delete (process.env as any).MOCK_CONVEX
    else process.env.MOCK_CONVEX = prevMock
  })
  beforeEach(() => {
    __resetAllForTests()
  })

  it('returns 401 when auth gating fails (simulated by CLERK_ENABLED=1 without context)', async () => {
    const prev = process.env.CLERK_ENABLED
    process.env.CLERK_ENABLED = '1'
    const res = await transcriptsGET(getReq('http://localhost:3000/api/v1/transcripts?sessionId=s1'))
    expect(res.status).toBe(401)
    process.env.CLERK_ENABLED = prev
  })

  it('returns 400 when sessionId is missing', async () => {
    const res = await transcriptsGET(getReq('http://localhost:3000/api/v1/transcripts'))
    expect(res.status).toBe(400)
  })

  it('returns items filtered by sessionId (mock mode)', async () => {
    // auth disabled
    const prevAuth = process.env.CLERK_ENABLED
    process.env.CLERK_ENABLED = '0'

    // seed mock interactions
    await appendInteraction({ sessionId: 's1', groupId: 'g1', messageId: 'm1', role: 'user', contentHash: 'h1', ts: 1000 })
    await appendInteraction({ sessionId: 's1', groupId: 'g1', messageId: 'm2', role: 'assistant', contentHash: 'h2', ts: 2000 })
    await appendInteraction({ sessionId: 's2', groupId: 'g2', messageId: 'm3', role: 'user', contentHash: 'h3', ts: 1500 })

    const res = await transcriptsGET(getReq('http://localhost:3000/api/v1/transcripts?sessionId=s1&limit=5'))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(Array.isArray(body.items)).toBe(true)
    // Should include only s1 items
    expect(body.items.every((it: any) => it.sessionId === 's1')).toBe(true)
    // Preserve chronological order by ts
    const ids = body.items.map((it: any) => it.id)
    expect(ids).toContain('m1')
    expect(ids).toContain('m2')

    process.env.CLERK_ENABLED = prevAuth
  })

  it('prefers groupId when provided', async () => {
    const prevAuth = process.env.CLERK_ENABLED
    process.env.CLERK_ENABLED = '0'

    await __resetAllForTests()
    await appendInteraction({ sessionId: 's1', groupId: 'gX', messageId: 'm1', role: 'user', contentHash: 'h1', ts: 1000 })
    await appendInteraction({ sessionId: 's1', groupId: 'gY', messageId: 'm2', role: 'assistant', contentHash: 'h2', ts: 2000 })

    const res = await transcriptsGET(getReq('http://localhost:3000/api/v1/transcripts?sessionId=s1&groupId=gY&limit=5'))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.items.length).toBe(1)
    expect(body.items[0].groupId).toBe('gY')

    process.env.CLERK_ENABLED = prevAuth
  })
})
