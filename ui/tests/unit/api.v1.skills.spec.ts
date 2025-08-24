import { describe, it, expect, beforeEach } from 'vitest';
import { GET as skillsGET } from '../../src/app/api/v1/skills/route';
import { getLatestConvexClientMock, setConvexMockBehavior } from '../setup.vitest';

const withQuery = (url: string, params: Record<string, string | number | undefined>) => {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) u.searchParams.set(k, String(v));
  }
  return u.toString();
};

describe('API: GET /api/v1/skills', () => {
  beforeEach(() => {
    setConvexMockBehavior({ queryReturn: undefined, queryThrow: null, mutationReturn: undefined, mutationThrow: null });
    delete (process.env as any).CONVEX_URL;
    delete (process.env as any).NEXT_PUBLIC_CONVEX_URL;
  });

  it('returns active skills when no filters are provided', async () => {
    const skills = [
      { id: 's1', title: 'Clarity', description: 'desc', levels: [], isActive: true, createdAt: 1, updatedAt: 1 },
      { id: 's2', title: 'Pacing', description: 'desc', levels: [], isActive: true, createdAt: 2, updatedAt: 2 },
    ];
    setConvexMockBehavior({ queryReturn: skills });
    const url = 'http://localhost:3000/api/v1/skills';
    const res = await skillsGET(new Request(url));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.skills)).toBe(true);
    expect(json.skills.length).toBe(2);

    const client = getLatestConvexClientMock();
    expect(client).toBeTruthy();
    expect(client.url).toBe('http://127.0.0.1:3210');
  });

  it('returns a single skill when id is provided', async () => {
    const skill = { id: 's1', title: 'Clarity', description: 'desc', levels: [], isActive: true, createdAt: 1, updatedAt: 1 };
    setConvexMockBehavior({ queryReturn: skill });
    const url = withQuery('http://localhost:3000/api/v1/skills', { id: 's1' });
    const res = await skillsGET(new Request(url));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skill).toBeTruthy();
    expect(json.skill.id).toBe('s1');
  });

  it('returns skills by category when category is provided', async () => {
    const skills = [
      { id: 's3', title: 'Empathy', description: 'desc', levels: [], category: 'soft', isActive: true, createdAt: 1, updatedAt: 1 },
    ];
    setConvexMockBehavior({ queryReturn: skills });
    const url = withQuery('http://localhost:3000/api/v1/skills', { category: 'soft' });
    const res = await skillsGET(new Request(url));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.skills)).toBe(true);
    expect(json.skills.length).toBe(1);
    expect(json.skills[0].category).toBe('soft');
  });

  it('returns 400 when id is present but empty', async () => {
    const url = withQuery('http://localhost:3000/api/v1/skills', { id: '' });
    const res = await skillsGET(new Request(url));
    expect(res.status).toBe(400);
  });

  it('handles Convex errors with 502', async () => {
    setConvexMockBehavior({ queryThrow: new Error('down') });
    const res = await skillsGET(new Request('http://localhost:3000/api/v1/skills'));
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json).toEqual({ error: 'Convex query failed' });
  });
});
