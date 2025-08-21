import { describe, it, expect, beforeEach } from 'vitest';
import { POST as finalizePOST } from '../../src/app/api/assessments/convex/finalize/route';
import { getLatestConvexClientMock, setConvexMockBehavior } from '../setup.vitest';

describe('API: POST /api/assessments/convex/finalize', () => {
  beforeEach(() => {
    setConvexMockBehavior({ queryReturn: undefined, queryThrow: null, mutationReturn: { ok: true }, mutationThrow: null });
    delete (process.env as any).CONVEX_URL;
    delete (process.env as any).NEXT_PUBLIC_CONVEX_URL;
  });

  it('returns 400 on invalid JSON', async () => {
    const req = new Request('http://localhost:3000/api/assessments/convex/finalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"bad":',
    });
    const res = await finalizePOST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON' });
  });

  it('returns 400 on missing required fields', async () => {
    const req = new Request('http://localhost:3000/api/assessments/convex/finalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 's', summary: {} }),
    });
    const res = await finalizePOST(req);
    expect(res.status).toBe(400);
  });

  it('calls Convex mutation and returns 200', async () => {
    const payload = {
      sessionId: 's_fin_ok',
      groupId: 'g_fin_ok',
      rubricVersion: 'v1',
      summary: { highlights: ['h'], recommendations: ['r'], rubricKeyPoints: ['k'] },
    };
    const req = new Request('http://localhost:3000/api/assessments/convex/finalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const res = await finalizePOST(req);
    expect(res.status).toBe(200);
    const client = getLatestConvexClientMock();
    expect(client).toBeTruthy();
    expect(client.url).toBe('http://127.0.0.1:3210');
    expect(client.mutation).toHaveBeenCalledWith(
      'assessments:finalizeAssessmentSummary',
      payload,
    );
  });

  it('returns 502 when Convex mutation throws', async () => {
    setConvexMockBehavior({ mutationThrow: new Error('down') });
    const payload = {
      sessionId: 's_fin_err',
      groupId: 'g_fin_err',
      summary: { highlights: [], recommendations: [], rubricKeyPoints: [] },
    } as any;
    const req = new Request('http://localhost:3000/api/assessments/convex/finalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const res = await finalizePOST(req);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'Convex mutation failed' });
  });
});
