import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST as runPOST } from '../../src/app/api/assessments/run/route';
import { getLatestConvexClientMock, setConvexMockBehavior } from '../setup.vitest';

const mkRequest = (body: any, qs = '') =>
  new Request('http://localhost:3000/api/assessments/run' + qs, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('API: POST /api/assessments/run', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setConvexMockBehavior({ queryReturn: undefined, queryThrow: null, mutationReturn: undefined, mutationThrow: null });
  });

  it('proxies to AI API and persists group/session in Convex on success', async () => {
    const SESSION_ID = 's_unit_1';
    const GROUP_ID = 'g_unit_1';

    // Mock upstream AI API
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ groupId: GROUP_ID, status: 'accepted' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    ) as any;

    const res = await runPOST(mkRequest({ sessionId: SESSION_ID }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ groupId: GROUP_ID, status: 'accepted' });

    const client = getLatestConvexClientMock();
    expect(client).toBeTruthy();
    expect(client.mutation).toHaveBeenCalledWith(
      'assessments:createAssessmentGroup',
      { sessionId: SESSION_ID, groupId: GROUP_ID, rubricVersion: 'v1' }
    );
  });

  it('returns 502 when upstream is unavailable', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('boom'); }) as any;
    const res = await runPOST(mkRequest({ sessionId: 's_unit_2' }));
    expect(res.status).toBe(502);
  });
});
