import { describe, it, expect, vi, beforeEach } from 'vitest';

import { POST as triagePOST } from '../../src/app/api/v1/triage/route';

// Mock makeConvex to control action results
vi.mock('../../src/app/api/lib/convex', () => ({
  makeConvex: (_url: string) => ({
    action: vi.fn(async (_name: string, _args: any) => ({ updated: 2, provider: 'mock', inferred: 'general_chatter' })),
  }),
}));

// Mock auth to always allow
vi.mock('../../src/app/api/lib/auth', () => ({
  requireAuth: async () => ({ ok: true }),
}));

// Mock prom metrics
vi.mock('../../src/app/api/lib/metrics', () => ({
  promMetrics: {
    requestsTotal: { labels: () => ({ inc: () => {} }) },
    requestErrorsTotal: { labels: () => ({ inc: () => {} }) },
    requestDurationSeconds: { startTimer: () => ((labels: any) => {}) },
  },
}));

describe('API /api/v1/triage', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 404 when triage disabled', async () => {
    vi.stubEnv('AI_TRIAGE_ENABLED', '0');
    const req = new Request('http://localhost/api/v1/triage?sessionId=s1', { method: 'POST' });
    const res = await triagePOST(req);
    expect(res.status).toBe(404);
  });

  it('invokes provider action when enabled', async () => {
    vi.stubEnv('AI_TRIAGE_ENABLED', '1');
    const req = new Request('http://localhost/api/v1/triage?sessionId=s1&limit=5', { method: 'POST' });
    const res = await triagePOST(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ updated: 2, provider: 'mock' });
  });
});
