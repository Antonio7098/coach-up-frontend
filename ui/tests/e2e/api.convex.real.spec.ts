import { test, expect } from '@playwright/test';

// Real Convex E2E using Next.js API routes (no mocks)
// Requires: MOCK_CONVEX=0 and CONVEX_URL set to a running Convex deployment
// Run via: SKIP_AI_CONTRACTS=1 CONVEX_URL=... MOCK_CONVEX=0 npm run test:e2e:real-convex

test.describe('real-convex e2e', () => {
  test.skip(process.env.MOCK_CONVEX !== '0', 'Set MOCK_CONVEX=0 to run real Convex E2E');

  test('sessions + interactions + events happy path', async ({ request }) => {
    const sessionId = `sess-${Date.now()}`;
    const groupId = `g-${Math.random().toString(36).slice(2)}`;

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-request-id': `pw-e2e-${Date.now()}`,
      'x-tracked-skill-id': 'e2e-skill',
    };

    // 1) Update session state
    const resState = await request.post('/api/v1/sessions/state', {
      headers,
      data: {
        userId: 'u-e2e',
        sessionId,
        state: { step: 'init' },
        latestGroupId: groupId,
      },
    });
    expect(resState.status(), await resState.text()).toBe(200);

    // 2) Append an interaction
    const resInter = await request.post('/api/v1/interactions', {
      headers,
      data: {
        sessionId,
        groupId,
        messageId: 'm1',
        role: 'user',
        contentHash: 'hash-1',
        ts: Date.now(),
        userId: 'u-e2e',
      },
    });
    expect(resInter.status(), await resInter.text()).toBe(200);

    // 3) Fetch events
    const resEvents = await request.get(`/api/v1/events?sessionId=${encodeURIComponent(sessionId)}&limit=10`, { headers });
    expect(resEvents.status(), await resEvents.text()).toBe(200);

    const json = await resEvents.json();
    expect(json).toHaveProperty('sessionId', sessionId);
    expect(Array.isArray(json.events)).toBe(true);
    const kinds = (json.events as Array<{ kind?: string }>).map(e => e.kind);
    expect(kinds).toContain('session_state_updated');
    expect(kinds).toContain('interaction_appended');
  });
});
