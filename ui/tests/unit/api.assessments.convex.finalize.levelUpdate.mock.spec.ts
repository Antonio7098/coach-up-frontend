import { describe, it, expect, beforeEach } from 'vitest';
import { POST as finalizePOST } from '../../src/app/api/assessments/convex/finalize/route';
import { sha256Hex } from '../../src/app/api/lib/hash';
import {
  __resetAllForTests,
  __seedSkillsForTests,
  listTrackedSkillsForUser,
} from '../../src/app/api/lib/mockConvex';

/**
 * Verify: creating v2 per-skill assessments via finalize (MOCK_CONVEX=1)
 * triggers skill level calculation and increments tracked level when avg >= threshold.
 */
describe('API: finalize v2 (mock) — assessment creation triggers level calc', () => {
  beforeEach(async () => {
    // Ensure we exercise the mock path and no bearer enforcement
    (process.env as any).MOCK_CONVEX = '1';
    delete (process.env as any).PERSIST_ASSESSMENTS_SECRET;
    // Threshold and window for deterministic behavior
    (process.env as any).SKILL_LEVEL_AVERAGE_COUNT = '5';
    (process.env as any).SKILL_LEVEL_INCREMENT_THRESHOLD = '1.0';
    (process.env as any).SKILL_HASH_SALT = 'test_salt';

    await __resetAllForTests();
    // Seed a single skill we will reference
    __seedSkillsForTests([
      {
        id: 'clarity_eloquence',
        title: 'Clarity & Eloquence',
        description: 'desc',
        levels: [
          { level: 0, criteria: 'c0' },
          { level: 5, criteria: 'c5' },
          { level: 10, criteria: 'c10' },
        ],
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);
  });

  it('increments tracked skill level when avg over last N reaches threshold', async () => {
    const salt = (process.env.SKILL_HASH_SALT || 'test_salt').trim();
    const skillId = 'clarity_eloquence';
    const skillHash = sha256Hex(`${salt}:${skillId}`);

    const payload = {
      sessionId: 'sess_lvl',
      groupId: 'grp_lvl',
      rubricVersion: 'v2' as const,
      summary: {
        skillAssessments: [
          { skillHash, level: 3, metCriteria: [], unmetCriteria: [], feedback: [] },
          { skillHash, level: 3, metCriteria: [], unmetCriteria: [], feedback: [] },
          { skillHash, level: 3, metCriteria: [], unmetCriteria: [], feedback: [] },
          { skillHash, level: 3, metCriteria: [], unmetCriteria: [], feedback: [] },
          { skillHash, level: 3, metCriteria: [], unmetCriteria: [], feedback: [] },
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
    const body = await res.json();
    expect(body).toEqual({ ok: true, mock: true });

    // After finalize, an update was triggered; tracked level should be 1 for user 'unknown'
    const tracked = await listTrackedSkillsForUser({ userId: 'unknown' });
    const row = tracked.find(t => t.skillId === skillId);
    expect(row).toBeTruthy();
    expect(row?.currentLevel).toBe(1);
  });
});
