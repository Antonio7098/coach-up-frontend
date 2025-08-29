import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET as sessionSummaryGET } from '../../src/app/api/v1/session-summary/route';
import { setConvexMockBehavior } from '../setup.vitest';
import { __rateLimitTestReset } from '../../src/app/api/lib/ratelimit';
import * as mockConvex from '../../src/app/api/lib/mockConvex';

const withQuery = (url: string, params: Record<string, string | number | undefined>) => {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) u.searchParams.set(k, String(v));
  }
  return u.toString();
};

describe('API: /api/v1/session-summary', () => {
  beforeEach(async () => {
    setConvexMockBehavior({ queryReturn: undefined, queryThrow: null });
    delete (process.env as any).CONVEX_URL;
    delete (process.env as any).NEXT_PUBLIC_CONVEX_URL;
    delete (process.env as any).MOCK_CONVEX;
    delete (process.env as any).RATE_LIMIT_MAX_RPS;
    delete (process.env as any).RATE_LIMIT_BURST;
    await mockConvex.__resetAllForTests();
    __rateLimitTestReset({ burst: 1, maxRps: 1 });
  });
  afterEach(async () => {
    await mockConvex.__resetAllForTests();
  });

  it('returns 400 without sessionId', async () => {
    const res = await sessionSummaryGET(new Request('http://localhost:3000/api/v1/session-summary'));
    expect(res.status).toBe(400);
  });

  it('MOCK: returns 404 when no summary, includes headers and echoes Idempotency-Key; returns 200 when seeded', async () => {
    (process.env as any).MOCK_CONVEX = '1';
    const sessionId = 'sess-404';

    // 404 path
    const url404 = withQuery('http://localhost:3000/api/v1/session-summary', { sessionId });
    const res404 = await sessionSummaryGET(new Request(url404, { headers: { 'Idempotency-Key': 'abc123', 'x-forwarded-for': '9.9.9.9', 'user-agent': 'ua-404' } }));
    expect(res404.status).toBe(404);
    expect(res404.headers.get('Idempotency-Key')).toBe('abc123');
    expect(res404.headers.get('X-RateLimit-Limit')).toBeTruthy();
    expect(res404.headers.get('X-RateLimit-Remaining')).toBeTruthy();
    expect(res404.headers.get('X-RateLimit-Reset')).toBeTruthy();

    // Seed a summary and expect 200
    const groupId = 'g1';
    await mockConvex.createAssessmentGroup({ sessionId, groupId, rubricVersion: 'v1' });
    await mockConvex.finalizeAssessmentSummary({ sessionId, groupId, rubricVersion: 'v1', summary: {
      highlights: ['h1'],
      recommendations: ['r1'],
      rubricKeyPoints: ['k1'],
    }});

    const url200 = withQuery('http://localhost:3000/api/v1/session-summary', { sessionId });
    const res200 = await sessionSummaryGET(new Request(url200, { headers: { 'Idempotency-Key': 'xyz789', 'x-forwarded-for': '8.8.8.8', 'user-agent': 'ua-200' } }));
    expect(res200.status).toBe(200);
    expect(res200.headers.get('Idempotency-Key')).toBe('xyz789');
    expect(res200.headers.get('X-RateLimit-Limit')).toBeTruthy();
    expect(res200.headers.get('X-RateLimit-Remaining')).toBeTruthy();
    expect(res200.headers.get('X-RateLimit-Reset')).toBeTruthy();
    const json = await res200.json();
    expect(json.sessionId).toBe(sessionId);
    expect(typeof json.text).toBe('string');
    expect(json.text.length).toBeGreaterThan(0);
  });

  it('rate limits with 429 and Retry-After when burst exhausted (same client key)', async () => {
    (process.env as any).MOCK_CONVEX = '1';
    (process.env as any).RATE_LIMIT_BURST = '1';
    (process.env as any).RATE_LIMIT_MAX_RPS = '1';

    const sessionId = 'sess-rate-limit';
    const url = withQuery('http://localhost:3000/api/v1/session-summary', { sessionId });
    const commonHeaders = { 'x-forwarded-for': '1.2.3.4', 'user-agent': 'vitest', 'Idempotency-Key': 'same' };

    // First request should consume the only token (likely 404 since not seeded)
    const res1 = await sessionSummaryGET(new Request(url, { headers: commonHeaders }));
    expect([200, 404]).toContain(res1.status);

    // Second request immediately should be rate limited
    const res2 = await sessionSummaryGET(new Request(url, { headers: commonHeaders }));
    expect(res2.status).toBe(429);
    expect(res2.headers.get('Retry-After')).toBeTruthy();
    expect(res2.headers.get('X-RateLimit-Limit')).toBeTruthy();
    expect(res2.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(res2.headers.get('X-RateLimit-Reset')).toBeTruthy();
  });

  it('REAL: uses Convex client in non-mock mode', async () => {
    // Provide a realistic Convex query return shape
    const sessionId = 'sess-real';
    setConvexMockBehavior({ queryReturn: {
      sessionId,
      latestGroupId: 'g-real',
      summary: {
        highlights: ['A'],
        recommendations: ['B'],
        rubricKeyPoints: ['C'],
      },
      rubricVersion: 'v2'
    }});

    const url = withQuery('http://localhost:3000/api/v1/session-summary', { sessionId });
    const res = await sessionSummaryGET(new Request(url, { headers: { 'user-agent': 'vitest-real' } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sessionId).toBe(sessionId);
    expect(typeof json.text).toBe('string');
  });
});
