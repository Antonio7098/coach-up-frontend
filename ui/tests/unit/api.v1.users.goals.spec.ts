import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET as goalsGET, POST as goalsPOST, PATCH as goalsPATCH, DELETE as goalsDELETE } from '../../src/app/api/v1/users/goals/route';
import { setConvexMockBehavior } from '../setup.vitest';
import * as mockConvex from '../../src/app/api/lib/mockConvex';

const withQuery = (url: string, params: Record<string, string | number | undefined>) => {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) u.searchParams.set(k, String(v));
  }
  return u.toString();
};

describe('API: /api/v1/users/goals', () => {
  beforeEach(async () => {
    setConvexMockBehavior({ queryReturn: undefined, queryThrow: null, mutationReturn: undefined, mutationThrow: null });
    delete (process.env as any).CONVEX_URL;
    delete (process.env as any).NEXT_PUBLIC_CONVEX_URL;
    delete (process.env as any).MOCK_CONVEX;
    await mockConvex.__resetAllForTests();
  });
  afterEach(async () => {
    await mockConvex.__resetAllForTests();
  });

  it('GET returns 400 without userId', async () => {
    const res = await goalsGET(new Request('http://localhost:3000/api/v1/users/goals'));
    expect(res.status).toBe(400);
  });

  it('MOCK: full CRUD flow', async () => {
    (process.env as any).MOCK_CONVEX = '1';
    const userId = 'u1';

    // Create
    let res = await goalsPOST(new Request('http://localhost:3000/api/v1/users/goals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId, goalId: 'g1', title: 'Goal 1', status: 'active', tags: ['a'] }),
    }));
    expect(res.status).toBe(200);
    let json = await res.json();
    expect(json).toEqual({ ok: true, created: true });

    // List
    res = await goalsGET(new Request(withQuery('http://localhost:3000/api/v1/users/goals', { userId })));
    expect(res.status).toBe(200);
    json = await res.json();
    expect(Array.isArray(json.goals)).toBe(true);
    expect(json.goals.length).toBe(1);
    expect(json.goals[0].goalId).toBe('g1');

    // Update
    res = await goalsPATCH(new Request('http://localhost:3000/api/v1/users/goals', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId, goalId: 'g1', title: 'Goal 1b', status: 'paused' }),
    }));
    expect(res.status).toBe(200);

    // Delete
    res = await goalsDELETE(new Request(withQuery('http://localhost:3000/api/v1/users/goals', { userId, goalId: 'g1' }), { method: 'DELETE' }));
    expect(res.status).toBe(200);
    json = await res.json();
    expect(json.deleted).toBe(true);
  });

  it('REAL: GET lists goals from Convex client', async () => {
    const userId = 'u2';
    const goals = [{ userId, goalId: 'g2', title: 'Read', status: 'active', tags: [], createdAt: 1, updatedAt: 1 }];
    setConvexMockBehavior({ queryReturn: goals });
    const res = await goalsGET(new Request(withQuery('http://localhost:3000/api/v1/users/goals', { userId })));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.goals.length).toBe(1);
    expect(json.goals[0].goalId).toBe('g2');
  });

  it('REAL: POST and PATCH proxy to Convex client mutations', async () => {
    setConvexMockBehavior({ mutationReturn: { created: true } });
    const userId = 'u3';

    let res = await goalsPOST(new Request('http://localhost:3000/api/v1/users/goals', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId, goalId: 'g3', title: 'Lift', status: 'active' }),
    }));
    expect(res.status).toBe(200);
    let json = await res.json();
    expect(json).toEqual({ ok: true, created: true });

    setConvexMockBehavior({ mutationReturn: { ok: true } });
    res = await goalsPATCH(new Request('http://localhost:3000/api/v1/users/goals', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId, goalId: 'g3', status: 'completed' }),
    }));
    expect(res.status).toBe(200);
  });

  it('REAL: DELETE proxies to Convex client mutation', async () => {
    setConvexMockBehavior({ mutationReturn: { ok: true, deleted: true } });
    const res = await goalsDELETE(new Request(withQuery('http://localhost:3000/api/v1/users/goals', { userId: 'u4', goalId: 'g4' }), { method: 'DELETE' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deleted).toBe(true);
  });
});
