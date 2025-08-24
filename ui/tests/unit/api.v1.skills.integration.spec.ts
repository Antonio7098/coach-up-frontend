import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET as skillsGET } from '../../src/app/api/v1/skills/route';
import { __resetAllForTests, __seedSkillsForTests, type SkillDoc } from '../../src/app/api/lib/mockConvex';

function withQuery(url: string, params: Record<string, string | number | undefined>) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) u.searchParams.set(k, String(v));
  }
  return u.toString();
}

describe('Integration (MOCK_CONVEX): Skills API', () => {
  const base = 'http://localhost:3000';
  const now = Date.now();

  beforeEach(() => {
    __resetAllForTests();
    process.env.MOCK_CONVEX = '1';
    delete (process.env as any).CONVEX_URL;
    delete (process.env as any).NEXT_PUBLIC_CONVEX_URL;

    const skills: SkillDoc[] = [
      {
        id: 'clarity_eloquence',
        title: 'Clarity/Eloquence',
        description: 'Express ideas clearly',
        category: 'communication',
        isActive: true,
        levels: [{ level: 1, criteria: 'Confusing' }, { level: 7, criteria: 'Clear' }],
        createdAt: now - 1000,
        updatedAt: now - 1000,
      },
      {
        id: 'stutter_reduction',
        title: 'Stutter Reduction',
        description: 'Improve fluency',
        category: 'fluency',
        isActive: false,
        levels: [{ level: 1, criteria: 'Frequent stutters' }, { level: 10, criteria: 'Smooth' }],
        createdAt: now - 500,
        updatedAt: now - 500,
      },
      {
        id: 'sales_persuasiveness',
        title: 'Sales Persuasiveness',
        description: 'Influence effectively',
        category: 'communication',
        isActive: true,
        levels: [{ level: 1, criteria: 'Weak pitch' }, { level: 10, criteria: 'Compelling' }],
        createdAt: now,
        updatedAt: now,
      },
    ];
    __seedSkillsForTests(skills);
  });

  afterEach(() => {
    __resetAllForTests();
  });

  it('lists only active skills when no filters are provided', async () => {
    const res = await skillsGET(new Request(`${base}/api/v1/skills`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.skills)).toBe(true);
    // stutter_reduction is inactive, should be filtered out
    const ids = new Set<string>(json.skills.map((s: any) => s.id));
    expect(ids.has('clarity_eloquence')).toBe(true);
    expect(ids.has('sales_persuasiveness')).toBe(true);
    expect(ids.has('stutter_reduction')).toBe(false);
  });

  it('fetches a single skill by id', async () => {
    const res = await skillsGET(new Request(withQuery(`${base}/api/v1/skills`, { id: 'clarity_eloquence' })));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skill?.id).toBe('clarity_eloquence');
  });

  it('lists skills by category (communication)', async () => {
    const res = await skillsGET(new Request(withQuery(`${base}/api/v1/skills`, { category: 'communication' })));
    expect(res.status).toBe(200);
    const json = await res.json();
    const ids = new Set<string>(json.skills.map((s: any) => s.id));
    expect(ids.has('clarity_eloquence')).toBe(true);
    expect(ids.has('sales_persuasiveness')).toBe(true);
    // Does not include fluency category
    expect(ids.has('stutter_reduction')).toBe(false);
  });
});
