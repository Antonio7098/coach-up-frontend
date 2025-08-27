import { describe, it, expect, beforeEach } from 'vitest';
import { POST as finalizePOST } from '../../src/app/api/assessments/convex/finalize/route';
import { getLatestConvexClientMock, setConvexMockBehavior } from '../setup.vitest';
import { sha256Hex } from '../../src/app/api/lib/hash';

describe('API: finalize v2 — trackedSkillIdHash + metrics smoke', () => {
  beforeEach(() => {
    setConvexMockBehavior({ queryReturn: undefined, queryThrow: null, mutationReturn: { ok: true }, mutationThrow: null });
    // Ensure bearer secret doesn't enforce auth in tests
    delete (process.env as any).PERSIST_ASSESSMENTS_SECRET;
    // Provide a Convex URL (the Convex client is mocked, URL value irrelevant)
    (process.env as any).NEXT_PUBLIC_CONVEX_URL = 'http://example-convex.test';
    (process.env as any).MOCK_CONVEX = '0';
  });

  it('forwards x-tracked-skill-id as sha256Hex to recordSkillAssessmentV2', async () => {
    setConvexMockBehavior({ queryReturn: { userId: 'u_hash' } });

    const payload = {
      sessionId: 's_hash',
      groupId: 'g_hash',
      rubricVersion: 'v2' as const,
      summary: {
        skillAssessments: [
          {
            skillHash: 'sh_1',
            level: 3,
            metCriteria: ['a'],
            unmetCriteria: ['b'],
            feedback: ['f1'],
          },
        ],
      },
    };

    const tracked = 'abc123';
    const req = new Request('http://localhost:3000/api/assessments/convex/finalize', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Tracked-Skill-Id': tracked,
      },
      body: JSON.stringify(payload),
    });

    const res = await finalizePOST(req);
    expect(res.status).toBe(200);
    const client = getLatestConvexClientMock();
    expect(client).toBeTruthy();
    const expectedHash = sha256Hex(tracked);
    expect(client.mutation).toHaveBeenCalledWith(
      'assessments:recordSkillAssessmentV2',
      expect.objectContaining({ trackedSkillIdHash: expectedHash }),
    );
  });

  it('metrics smoke: returns 400 Invalid JSON without throwing (metrics imported)', async () => {
    const req = new Request('http://localhost:3000/api/assessments/convex/finalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    const res = await finalizePOST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'Invalid JSON' });
  });
});
