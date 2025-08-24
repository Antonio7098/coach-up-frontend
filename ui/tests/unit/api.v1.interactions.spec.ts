import { describe, it, expect, beforeEach } from 'vitest';
import { POST as interactionsPOST } from '../../src/app/api/v1/interactions/route';
import { getLatestConvexClientMock, setConvexMockBehavior } from '../setup.vitest';
import { sha256Hex } from '../../src/app/api/lib/hash';

const jsonRequest = (url: string, body: any, headers?: Record<string, string>) =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(headers || {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('API: POST /api/v1/interactions', () => {
  beforeEach(() => {
    setConvexMockBehavior({ queryReturn: undefined, queryThrow: null, mutationReturn: { ok: true }, mutationThrow: null });
  });

  it('returns 400 on invalid JSON', async () => {
    const res = await interactionsPOST(jsonRequest('http://localhost:3000/api/v1/interactions', '{"bad":'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await interactionsPOST(jsonRequest('http://localhost:3000/api/v1/interactions', { sessionId: 's', messageId: 'm' }));
    expect(res.status).toBe(400);
  });

  it('calls Convex mutations and includes trackedSkillIdHash in events log', async () => {
    const body = {
      userId: 'u1',
      sessionId: 's1',
      groupId: 'g1',
      messageId: 'm1',
      role: 'user',
      contentHash: 'deadbeef',
      ts: Date.now(),
    };
    const trackedSkillId = 'skill-abc';
    const res = await interactionsPOST(
      jsonRequest('http://localhost:3000/api/v1/interactions', body, { 'X-Tracked-Skill-Id': trackedSkillId })
    );
    expect(res.status).toBe(200);

    const client = getLatestConvexClientMock();
    expect(client).toBeTruthy();
    // appendInteraction called
    expect(client.mutation).toHaveBeenCalledWith(
      'interactions:appendInteraction',
      expect.objectContaining({ sessionId: body.sessionId, groupId: body.groupId, messageId: body.messageId, contentHash: body.contentHash })
    );
    // events:logEvent called with hash
    const expectedHash = sha256Hex(trackedSkillId);
    expect(client.mutation).toHaveBeenCalledWith(
      'events:logEvent',
      expect.objectContaining({ sessionId: body.sessionId, groupId: body.groupId, trackedSkillIdHash: expectedHash, kind: 'interaction_appended' })
    );
  });

  it('returns 502 when Convex mutation throws', async () => {
    setConvexMockBehavior({ mutationThrow: new Error('down') });
    const body = {
      userId: 'u1',
      sessionId: 's1',
      groupId: 'g1',
      messageId: 'm1',
      role: 'user',
      contentHash: 'deadbeef',
      ts: Date.now(),
    };
    const res = await interactionsPOST(jsonRequest('http://localhost:3000/api/v1/interactions', body));
    expect(res.status).toBe(502);
  });

  it('returns 400 when role is invalid', async () => {
    const body = {
      userId: 'u1',
      sessionId: 's1',
      groupId: 'g1',
      messageId: 'm1',
      role: 'bad_role',
      contentHash: 'deadbeef',
      ts: Date.now(),
    } as any;
    const res = await interactionsPOST(jsonRequest('http://localhost:3000/api/v1/interactions', body));
    expect(res.status).toBe(400);
  });

  it('returns 400 when ts is not a positive number', async () => {
    const body = {
      userId: 'u1',
      sessionId: 's1',
      groupId: 'g1',
      messageId: 'm1',
      role: 'user',
      contentHash: 'deadbeef',
      ts: -1,
    };
    const res = await interactionsPOST(jsonRequest('http://localhost:3000/api/v1/interactions', body));
    expect(res.status).toBe(400);
  });

  it('returns 400 when audioUrl is not http(s)', async () => {
    const body = {
      userId: 'u1',
      sessionId: 's1',
      groupId: 'g1',
      messageId: 'm1',
      role: 'user',
      contentHash: 'deadbeef',
      ts: Date.now(),
      audioUrl: 'ftp://example.com/file.wav',
    };
    const res = await interactionsPOST(jsonRequest('http://localhost:3000/api/v1/interactions', body));
    expect(res.status).toBe(400);
  });

  it('returns 400 when userId is provided but empty', async () => {
    const body = {
      userId: '   ',
      sessionId: 's1',
      groupId: 'g1',
      messageId: 'm1',
      role: 'user',
      contentHash: 'deadbeef',
      ts: Date.now(),
    };
    const res = await interactionsPOST(jsonRequest('http://localhost:3000/api/v1/interactions', body));
    expect(res.status).toBe(400);
  });
});
