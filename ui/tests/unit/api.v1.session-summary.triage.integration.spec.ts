import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { POST as sessionSummaryPOST } from '../../src/app/api/v1/session-summary/route';

// Mock makeConvex: ensureJob accepted to trigger triage
vi.mock('../../src/app/api/lib/convex', () => ({
  makeConvex: (_url: string) => ({
    mutation: vi.fn(async (_name: string, _args: any) => ({ accepted: true, cutoffIndex: 5 })),
  }),
}));

// Auth ok
vi.mock('../../src/app/api/lib/auth', () => ({ requireAuth: async () => ({ ok: true }) }));

// Metrics minimal
vi.mock('../../src/app/api/lib/metrics', () => ({
  promMetrics: {
    requestsTotal: { labels: () => ({ inc: () => {} }) },
    requestErrorsTotal: { labels: () => ({ inc: () => {} }) },
    requestDurationSeconds: { startTimer: () => ((labels: any) => {}) },
  },
}));

// Summaries lib imports
vi.mock('../../src/app/api/lib/summaries', () => ({ getLatestSummary: (_sid: string) => null, upsertSummary: () => ({}) }));

// Ensure fetch is controllable
const origFetch = global.fetch;

describe('session-summary POST triage pre-step (best-effort)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    global.fetch = origFetch;
  });

  it('calls /api/v1/triage when enabled, ignores errors and proceeds', async () => {
    vi.stubEnv('AI_TRIAGE_ENABLED', '1');
    // New gating: enable legacy pre-summary triage for this test
    vi.stubEnv('TRIAGE_ON_SUMMARY', '1');
    const triageSpy = vi.fn(async () => new Response(JSON.stringify({ updated: 1 }), { status: 200 }));
    global.fetch = vi.fn((input: any, init?: any) => {
      if (typeof input === 'string' && input.startsWith('/api/v1/triage')) return triageSpy();
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    }) as any;

    const body = { sessionId: 's1', prevSummary: '', messages: [] };
    const req = new Request('http://localhost/api/v1/session-summary', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
    const res = await sessionSummaryPOST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    // We expect accepted job with triage called
    expect(json).toMatchObject({ status: 'accepted' });
    expect((global.fetch as any)).toHaveBeenCalled();
    expect(triageSpy).toHaveBeenCalled();
  });

  it('does not call triage when disabled', async () => {
    vi.stubEnv('AI_TRIAGE_ENABLED', '0');
    const spy = vi.spyOn(global as any, 'fetch');

    const body = { sessionId: 's1', prevSummary: '', messages: [] };
    const req = new Request('http://localhost/api/v1/session-summary', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
    const res = await sessionSummaryPOST(req);
    await res.json();

    // No triage calls
    expect(spy).not.toHaveBeenCalledWith(expect.stringContaining('/api/v1/triage'), expect.anything());
    spy.mockRestore();
  });
});
