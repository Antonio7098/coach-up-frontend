import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST as interactionsPOST } from '../../src/app/api/v1/interactions/route';
import { POST as sessionsStatePOST } from '../../src/app/api/v1/sessions/state/route';
import { GET as eventsGET } from '../../src/app/api/v1/events/route';
import { sha256Hex } from '../../src/app/api/lib/hash';
import { __resetAllForTests } from '../../src/app/api/lib/mockConvex';

function withQuery(url: string, params: Record<string, string | number | undefined>) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) u.searchParams.set(k, String(v));
  }
  return u.toString();
}

describe('Integration (MOCK_CONVEX): interactions + sessions/state + events', () => {
  const base = 'http://localhost:3000';
  const trackedSkillId = 'skill-123';
  const headers = {
    'content-type': 'application/json',
    'X-Tracked-Skill-Id': trackedSkillId,
  } as Record<string, string>;

  beforeEach(() => {
    __resetAllForTests();
    process.env.MOCK_CONVEX = '1';
    delete (process.env as any).CONVEX_URL;
    delete (process.env as any).NEXT_PUBLIC_CONVEX_URL;
  });

  afterEach(() => {
    __resetAllForTests();
  });

  it('persists interaction and session state, then retrieves events with hashed trackedSkillId', async () => {
    // 1) Append interaction
    const interactionBody = {
      sessionId: 's1',
      groupId: 'g1',
      messageId: 'm1',
      role: 'user' as const,
      contentHash: 'hash-abc',
      ts: Date.now(),
      userId: 'u1',
    };
    const res1 = await interactionsPOST(new Request(`${base}/api/v1/interactions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(interactionBody),
    }));
    expect(res1.status).toBe(200);
    const json1 = await res1.json();
    expect(json1).toMatchObject({ ok: true });

    // 2) Update session state
    const res2 = await sessionsStatePOST(new Request(`${base}/api/v1/sessions/state`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        userId: 'u1',
        sessionId: 's1',
        latestGroupId: 'g1',
        state: { step: 1 },
      }),
    }));
    expect(res2.status).toBe(200);

    // 3) Fetch events
    const url = withQuery(`${base}/api/v1/events`, { sessionId: 's1', limit: 10 });
    const res3 = await eventsGET(new Request(url, { headers }));
    expect(res3.status).toBe(200);
    const json3 = await res3.json();

    expect(json3.sessionId).toBe('s1');
    expect(json3.trackedSkillIdHash).toBe(sha256Hex(trackedSkillId));
    expect(Array.isArray(json3.events)).toBe(true);
    expect(json3.events.length).toBeGreaterThanOrEqual(2);

    const kinds = new Set<string>(json3.events.map((e: any) => e?.kind));
    expect(kinds.has('interaction_appended')).toBe(true);
    expect(kinds.has('session_state_updated')).toBe(true);
  });
});
