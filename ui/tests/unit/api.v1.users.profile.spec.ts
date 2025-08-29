import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET as profileGET, PUT as profilePUT } from '../../src/app/api/v1/users/profile/route';
import { setConvexMockBehavior } from '../setup.vitest';
import * as mockConvex from '../../src/app/api/lib/mockConvex';

const withQuery = (url: string, params: Record<string, string | number | undefined>) => {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) u.searchParams.set(k, String(v));
  }
  return u.toString();
};

describe('API: /api/v1/users/profile', () => {
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
    const res = await profileGET(new Request('http://localhost:3000/api/v1/users/profile'));
    expect(res.status).toBe(400);
  });

  it('MOCK: GET returns existing profile', async () => {
    (process.env as any).MOCK_CONVEX = '1';
    await mockConvex.upsertUserProfile({ userId: 'u1', displayName: 'Alice' });
    const url = withQuery('http://localhost:3000/api/v1/users/profile', { userId: 'u1' });
    const res = await profileGET(new Request(url));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.profile).toBeTruthy();
    expect(json.profile.displayName).toBe('Alice');
  });

  it('MOCK: PUT upserts profile', async () => {
    (process.env as any).MOCK_CONVEX = '1';
    const body = { userId: 'u2', displayName: 'Bob', email: 'b@example.com' };
    const res = await profilePUT(new Request('http://localhost:3000/api/v1/users/profile', { method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, created: true });
    const got = await mockConvex.getUserProfile({ userId: 'u2' });
    expect(got?.email).toBe('b@example.com');
  });

  it('REAL: GET pulls from Convex client', async () => {
    const profile = { userId: 'u3', displayName: 'Carol', createdAt: Date.now(), updatedAt: Date.now() };
    setConvexMockBehavior({ queryReturn: profile });
    const url = withQuery('http://localhost:3000/api/v1/users/profile', { userId: 'u3' });
    const res = await profileGET(new Request(url));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.profile.userId).toBe('u3');
  });

  it('REAL: PUT proxies to Convex mutation', async () => {
    setConvexMockBehavior({ mutationReturn: { created: true } });
    const body = { userId: 'u4', displayName: 'Dan' };
    const res = await profilePUT(new Request('http://localhost:3000/api/v1/users/profile', { method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, created: true });
  });
});
