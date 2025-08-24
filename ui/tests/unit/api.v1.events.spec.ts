import { describe, it, expect, beforeEach } from 'vitest';
import { GET as eventsGET } from '../../src/app/api/v1/events/route';
import { getLatestConvexClientMock, setConvexMockBehavior } from '../setup.vitest';
import { sha256Hex } from '../../src/app/api/lib/hash';

const withQuery = (url: string, params: Record<string, string | number | undefined>) => {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) u.searchParams.set(k, String(v));
  }
  return u.toString();
};

describe('API: GET /api/v1/events', () => {
  beforeEach(() => {
    setConvexMockBehavior({ queryReturn: undefined, queryThrow: null, mutationReturn: undefined, mutationThrow: null });
    delete (process.env as any).CONVEX_URL;
    delete (process.env as any).NEXT_PUBLIC_CONVEX_URL;
  });

  it('returns 400 when sessionId missing or empty', async () => {
    const res = await eventsGET(new Request('http://localhost:3000/api/v1/events'));
    expect(res.status).toBe(400);
  });

  it('returns events and includes trackedSkillIdHash', async () => {
    const events = [
      { sessionId: 's1', kind: 'k1', createdAt: 1 },
      { sessionId: 's1', kind: 'k2', createdAt: 2 },
    ];
    setConvexMockBehavior({ queryReturn: events });
    const trackedSkillId = 'skill-abc';
    const url = withQuery('http://localhost:3000/api/v1/events', { sessionId: 's1', limit: 10 });
    const res = await eventsGET(new Request(url, { headers: { 'X-Tracked-Skill-Id': trackedSkillId } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ sessionId: 's1' });
    expect(Array.isArray(json.events)).toBe(true);
    expect(json.events.length).toBe(2);
    const expectedHash = sha256Hex(trackedSkillId);
    expect(json.trackedSkillIdHash).toBe(expectedHash);

    const client = getLatestConvexClientMock();
    expect(client).toBeTruthy();
    expect(client.url).toBe('http://127.0.0.1:3210');
  });

  it('handles Convex errors with 502', async () => {
    setConvexMockBehavior({ queryThrow: new Error('down') });
    const url = withQuery('http://localhost:3000/api/v1/events', { sessionId: 's1' });
    const res = await eventsGET(new Request(url));
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json).toEqual({ error: 'Convex query failed' });
  });
});
