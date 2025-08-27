import { describe, it, expect, beforeEach } from 'vitest';
import { POST as finalizePOST } from '../../src/app/api/assessments/convex/finalize/route';
import { getLatestConvexClientMock, setConvexMockBehavior } from '../setup.vitest';

/**
 * Verifies the "real path" (MOCK_CONVEX=0) finalize calls Convex mutations
 * in the expected order for a single skill assessment:
 * 1) assessments:recordSkillAssessmentV2
 * 2) skills:updateLevelFromRecentAssessments
 * 3) assessments:markFinalizeCompleted
 */
describe('API: finalize v2 (real path) — mutation order', () => {
  beforeEach(() => {
    // Ensure real path and no bearer enforcement
    (process.env as any).MOCK_CONVEX = '0';
    delete (process.env as any).PERSIST_ASSESSMENTS_SECRET;
    (process.env as any).NEXT_PUBLIC_CONVEX_URL = 'http://example-convex.test';
    // Any query will return a session-like object; idempotency check will be ignored (shape not matching)
    setConvexMockBehavior({ queryReturn: { userId: 'u_order' }, mutationReturn: { ok: true } });
  });

  it('calls mutations in order for one skill', async () => {
    const payload = {
      sessionId: 's_order',
      groupId: 'g_order',
      rubricVersion: 'v2' as const,
      summary: {
        skillAssessments: [
          { skillHash: 'sh_x', level: 4, metCriteria: [], unmetCriteria: [], feedback: [] },
        ],
      },
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

    // Extract the called mutation names in order
    const names = client.mutation.mock.calls.map((c: any[]) => c[0]);
    expect(names.length).toBeGreaterThanOrEqual(3);

    // Must contain these in this order as a subsequence
    const expected = [
      'assessments:recordSkillAssessmentV2',
      'skills:updateLevelFromRecentAssessments',
      'assessments:markFinalizeCompleted',
    ];

    // Check subsequence order
    let idx = 0;
    for (const n of names) {
      if (n === expected[idx]) idx++;
      if (idx === expected.length) break;
    }
    expect(idx).toBe(expected.length);
  });
});
