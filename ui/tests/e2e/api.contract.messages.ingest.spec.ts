import { test, expect } from '@playwright/test';

// Skip with SKIP_AI_CONTRACTS=1 to avoid starting the AI API server
test.skip(!!process.env.SKIP_AI_CONTRACTS, 'AI contract tests are skipped when SKIP_AI_CONTRACTS=1');

test('contract: POST /api/messages/ingest start/end enqueues and produces summary', async ({ request, baseURL }) => {
  expect(baseURL).toBeTruthy();

  const project = (test.info().project.name || 'proj').replace(/[^a-z0-9:_-]/gi, '_');
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const sessionId = `e2e-ingest:${project}:${uniq}`;

  // Start: user message likely classified as start (low/med conf -> decision 'start')
  let res = await request.post(`/api/messages/ingest`, {
    data: {
      sessionId,
      messageId: `m1-${uniq}`,
      role: 'user',
      content: 'Can you plan my next two weeks?'
    },
  });
  expect(res.status(), 'start should return 200').toBe(200);
  const j1 = await res.json();
  expect(j1).toHaveProperty('state', 'active');
  expect(j1).toHaveProperty('enqueued', false);
  expect(typeof j1.groupId).toBe('string');
  const groupId: string = j1.groupId;

  // End: assistant closing cue should enqueue assessment
  res = await request.post(`/api/messages/ingest`, {
    data: {
      sessionId,
      messageId: `m2-${uniq}`,
      role: 'assistant',
      content: 'Here is your plan. Good luck!'
    },
  });
  expect(res.status(), 'end should return 200').toBe(200);
  const j2 = await res.json();
  expect(j2).toMatchObject({ state: 'idle', enqueued: true });
  expect(j2.groupId).toBe(groupId);

  // Poll AI API directly for summary
  const aiBase = process.env.AI_API_BASE_URL || 'http://127.0.0.1:8001';
  const deadline = Date.now() + 12000;
  let payload: any = {};
  while (Date.now() < deadline) {
    const r = await request.get(`${aiBase}/assessments/${encodeURIComponent(sessionId)}`);
    expect(r.status(), 'AI API GET should be 200').toBe(200);
    payload = await r.json();
    if (payload?.latestGroupId === groupId && payload?.summary?.scores) break;
    await new Promise((res) => setTimeout(res, 100));
  }

  expect(payload.sessionId).toBe(sessionId);
  expect(payload.latestGroupId).toBe(groupId);
  expect(typeof payload.summary).toBe('object');
  expect(typeof payload.summary.scores).toBe('object');
});
