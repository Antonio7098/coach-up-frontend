import { describe, it, expect, beforeEach } from 'vitest';
import { POST as statePOST } from '../../src/app/api/v1/sessions/state/route';
import { getLatestConvexClientMock, setConvexMockBehavior } from '../setup.vitest';
import { sha256Hex } from '../../src/app/api/lib/hash';

const jsonRequest = (url: string, body: any, headers?: Record<string, string>) =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(headers || {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('API: POST /api/v1/sessions/state', () => {
  beforeEach(() => {
    setConvexMockBehavior({ queryReturn: undefined, queryThrow: null, mutationReturn: { ok: true }, mutationThrow: null });
  });

  it('returns 400 on invalid JSON', async () => {
    const res = await statePOST(jsonRequest('http://localhost:3000/api/v1/sessions/state', '{"bad":'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when userId or sessionId missing', async () => {
    const res = await statePOST(jsonRequest('http://localhost:3000/api/v1/sessions/state', { userId: 'u' }));
    expect(res.status).toBe(400);
  });

  it('calls updateSessionState and logs event with trackedSkillIdHash', async () => {
    const body = { userId: 'u1', sessionId: 's1', state: { step: 'intro' }, latestGroupId: 'g1' };
    const trackedSkillId = 'skill-xyz';
    const res = await statePOST(
      jsonRequest('http://localhost:3000/api/v1/sessions/state', body, { 'X-Tracked-Skill-Id': trackedSkillId })
    );
    expect(res.status).toBe(200);

    const client = getLatestConvexClientMock();
    expect(client).toBeTruthy();

    expect(client.mutation).toHaveBeenCalledWith(
      'functions/sessions:updateSessionState',
      expect.objectContaining({ userId: body.userId, sessionId: body.sessionId, latestGroupId: body.latestGroupId })
    );

    const expectedHash = sha256Hex(trackedSkillId);
    expect(client.mutation).toHaveBeenCalledWith(
      'events:logEvent',
      expect.objectContaining({ sessionId: body.sessionId, groupId: body.latestGroupId, trackedSkillIdHash: expectedHash, kind: 'session_state_updated' })
    );
  });

  it('returns 502 when Convex mutation throws', async () => {
    setConvexMockBehavior({ mutationThrow: new Error('down') });
    const body = { userId: 'u1', sessionId: 's1' };
    const res = await statePOST(jsonRequest('http://localhost:3000/api/v1/sessions/state', body));
    expect(res.status).toBe(502);
  });

  it('returns 400 when userId is empty', async () => {
    const res = await statePOST(jsonRequest('http://localhost:3000/api/v1/sessions/state', { userId: '   ', sessionId: 's1' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when sessionId is empty', async () => {
    const res = await statePOST(jsonRequest('http://localhost:3000/api/v1/sessions/state', { userId: 'u1', sessionId: '   ' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when latestGroupId is provided but empty', async () => {
    const res = await statePOST(jsonRequest('http://localhost:3000/api/v1/sessions/state', { userId: 'u1', sessionId: 's1', latestGroupId: '   ' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when state is not an object', async () => {
    const res = await statePOST(jsonRequest('http://localhost:3000/api/v1/sessions/state', { userId: 'u1', sessionId: 's1', state: 123 }));
    expect(res.status).toBe(400);
  });
});
