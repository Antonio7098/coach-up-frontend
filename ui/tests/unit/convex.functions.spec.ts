import { describe, it, expect, vi } from 'vitest';

// Mock Convex server wrappers and values (virtual modules)
(vi as any).mock('../../../convex/_generated/server', () => ({
  mutation: (def: any) => def,
  query: (def: any) => def,
}), { virtual: true });

(vi as any).mock('convex/values', () => ({
  v: {
    string: () => ({}),
    number: () => ({}),
    any: () => ({}),
    array: (_inner?: any) => ({}),
    object: (_shape: any) => ({}),
    optional: (_inner: any) => ({}),
    union: (..._inners: any[]) => ({}),
    literal: (_v: any) => ({}),
  },
}), { virtual: true });

// Import Convex functions under test
import { updateSessionState } from '../../../convex/functions/sessions';
import { appendInteraction } from '../../../convex/functions/interactions';
import { logEvent, listBySession } from '../../../convex/functions/events';
import { recordSkillAssessmentV2, getLatestAssessmentSummary, checkFinalizeIdempotency, markFinalizeCompleted } from '../../../convex/functions/assessments';

describe('Convex functions: write paths and index usage', () => {
  it('sessions.updateSessionState uses by_sessionId unique and inserts when missing', async () => {
    const inserts: any[] = [];
    const patches: any[] = [];
    const usedIndex: string[] = [];

    const ctx = {
      db: {
        insert: vi.fn(async (table: string, doc: any) => { inserts.push({ table, doc }); return 'new_id'; }),
        patch: vi.fn(async (id: string, patch: any) => { patches.push({ id, patch }); }),
        query: vi.fn(() => ({
          withIndex: (name: string, _cb: any) => {
            usedIndex.push(name);
            return { unique: async () => null };
          },
        })),
      },
    } as any;

    const args = { userId: 'u1', sessionId: 'sX', state: { step: 'a' }, latestGroupId: 'g1' };
    const res = await (updateSessionState as any).handler(ctx, args);
    expect(res).toEqual({ created: true, id: 'new_id' });

    expect(usedIndex).toContain('by_sessionId');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe('sessions');
    expect(inserts[0].doc).toMatchObject({ userId: 'u1', sessionId: 'sX', latestGroupId: 'g1' });
    expect(typeof inserts[0].doc.createdAt).toBe('number');
    expect(typeof inserts[0].doc.lastActivityAt).toBe('number');
    expect(patches).toHaveLength(0);
  });

  it('sessions.updateSessionState validates non-empty ids and state object', async () => {
    const ctx = {
      db: {
        query: vi.fn(() => ({ withIndex: (_n: string, _cb: any) => ({ unique: async () => null }) })),
        insert: vi.fn(async () => 'sid1'),
        patch: vi.fn(async () => undefined),
      },
    } as any;
    await expect((updateSessionState as any).handler(ctx, { userId: ' ', sessionId: 's1' })).rejects.toThrow('userId required');
    await expect((updateSessionState as any).handler(ctx, { userId: 'u1', sessionId: ' ' })).rejects.toThrow('sessionId required');
    await expect((updateSessionState as any).handler(ctx, { userId: 'u1', sessionId: 's1', state: [] })).rejects.toThrow('state must be an object when provided');
  });

  it('interactions.appendInteraction validates ts and audioUrl and non-empty ids', async () => {
    const ctx = { db: { insert: vi.fn(async () => 'ix1') } } as any;
    // ts <= 0
    await expect((appendInteraction as any).handler(ctx, { sessionId: 's1', groupId: 'g1', messageId: 'm1', role: 'user', contentHash: 'beef', ts: 0 })).rejects.toThrow('ts must be > 0');
    // empty messageId
    await expect((appendInteraction as any).handler(ctx, { sessionId: 's1', groupId: 'g1', messageId: ' ', role: 'user', contentHash: 'beef', ts: 1 })).rejects.toThrow('messageId required');
    // invalid audioUrl
    await expect((appendInteraction as any).handler(ctx, { sessionId: 's1', groupId: 'g1', messageId: 'm1', role: 'user', contentHash: 'beef', ts: 1, audioUrl: 'ftp://x' })).rejects.toThrow('audioUrl must start with http or https');
  });

  it('events.listBySession uses by_session index, sorts desc, and respects limit', async () => {
    const usedIndex: string[] = [];
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: (name: string, _cb: any) => {
            usedIndex.push(name);
            return {
              collect: async () => ([
                { sessionId: 's1', kind: 'k', createdAt: 10, id: 'a' },
                { sessionId: 's1', kind: 'k', createdAt: 30, id: 'c' },
                { sessionId: 's1', kind: 'k', createdAt: 20, id: 'b' },
              ]),
            };
          },
        })),
      },
    } as any;

    const res = await (listBySession as any).handler(ctx, { sessionId: 's1', limit: 2 });
    expect(usedIndex).toContain('by_session');
    expect(Array.isArray(res)).toBe(true);
    expect(res.map((r: any) => r.id)).toEqual(['c', 'b']); // sorted desc by createdAt, limited to 2
  });

  it('sessions.updateSessionState patches when existing session found', async () => {
    const patches: any[] = [];
    const ctx = {
      db: {
        patch: vi.fn(async (id: string, patch: any) => { patches.push({ id, patch }); }),
        query: vi.fn(() => ({
          withIndex: (_name: string, _cb: any) => ({ unique: async () => ({ _id: 'sess1', state: { old: true }, latestGroupId: 'g0' }) }),
        })),
      },
    } as any;

    const args = { userId: 'u1', sessionId: 'sX', state: { step: 'b' } };
    const res = await (updateSessionState as any).handler(ctx, args);
    expect(res).toEqual({ created: false, id: 'sess1' });
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ id: 'sess1' });
    expect(patches[0].patch).toMatchObject({ state: { step: 'b' } });
    expect(typeof patches[0].patch.lastActivityAt).toBe('number');
  });

  it('interactions.appendInteraction inserts row with expected fields', async () => {
    const inserts: any[] = [];
    const ctx = {
      db: {
        insert: vi.fn(async (table: string, doc: any) => { inserts.push({ table, doc }); return 'ix1'; }),
      },
    } as any;

    const args = { sessionId: 's1', groupId: 'g1', messageId: 'm1', role: 'user', contentHash: 'beef', ts: 1 } as any;
    const res = await (appendInteraction as any).handler(ctx, args);
    expect(res).toEqual({ id: 'ix1' });
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe('interactions');
    expect(inserts[0].doc).toMatchObject({ sessionId: 's1', groupId: 'g1', messageId: 'm1', role: 'user', contentHash: 'beef', ts: 1 });
    expect(typeof inserts[0].doc.createdAt).toBe('number');
  });

  it('events.logEvent inserts observability event', async () => {
    const inserts: any[] = [];
    const ctx = {
      db: {
        insert: vi.fn(async (table: string, doc: any) => { inserts.push({ table, doc }); }),
      },
    } as any;

    const args = { userId: 'u1', sessionId: 's1', groupId: 'g1', kind: 'k', payload: { a: 1 } } as any;
    const res = await (logEvent as any).handler(ctx, args);
    expect(res).toEqual({ ok: true });
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe('events');
    expect(inserts[0].doc).toMatchObject({ userId: 'u1', sessionId: 's1', groupId: 'g1', kind: 'k', payload: { a: 1 } });
    expect(typeof inserts[0].doc.createdAt).toBe('number');
  });

  it('events.logEvent validates required fields', async () => {
    const ctx = { db: { insert: vi.fn(async () => undefined) } } as any;
    await expect((logEvent as any).handler(ctx, { userId: 'u1', sessionId: 's1', kind: '  ', payload: {} })).rejects.toThrow('kind required');
    await expect((logEvent as any).handler(ctx, { userId: 'u1', sessionId: 's1', kind: 'k', trackedSkillIdHash: ' ', payload: {} })).rejects.toThrow('trackedSkillIdHash must be non-empty when provided');
  });

  it('assessments.getLatestAssessmentSummary returns latest summary with latestGroupId', async () => {
    const ctx = {
      db: {
        query: vi.fn((table: string) => ({
          withIndex: (name: string, cb: any) => {
            if (table === 'assessments' && name === 'by_session') {
              // Simulate .filter().order('desc').first() chain
              const q = { eq: (_f: any, _v: any) => true, field: (_s: string) => 'kind' } as any
              cb(q)
              return {
                filter: (_fcb: any) => ({ order: (_dir: 'desc' | 'asc') => ({ first: async () => ({
                  sessionId: 's1', groupId: 'g2', kind: 'summary', summary: { a: 1 }, rubricVersion: 'v2', createdAt: 20, updatedAt: 21,
                }) }) }),
              }
            }
            if (table === 'sessions' && name === 'by_sessionId') {
              const q = { eq: (_f: any, _v: any) => true } as any
              cb(q)
              return { first: async () => ({ latestGroupId: 'g3' }) }
            }
            return { first: async () => null }
          },
        })),
      },
    } as any

    const res = await (getLatestAssessmentSummary as any).handler(ctx, { sessionId: 's1' })
    expect(res).toMatchObject({ sessionId: 's1', latestGroupId: 'g3', rubricVersion: 'v2', createdAt: 20, updatedAt: 21 })
    expect(res.summary).toEqual({ a: 1 })
  })

  it('assessments.recordSkillAssessmentV2 validates level bounds and inserts document', async () => {
    const inserts: any[] = []
    const ctx = { db: { insert: vi.fn(async (_t: string, doc: any) => { inserts.push(doc); return 'assessV2'; }) } } as any
    // invalid level
    await expect((recordSkillAssessmentV2 as any).handler(ctx, { userId: 'u1', sessionId: 's1', groupId: 'g1', skillHash: 'h', level: 11, rubricVersion: 'v2', feedback: [], metCriteria: [], unmetCriteria: [] })).rejects.toThrow('level must be 0-10')
    // valid path
    const res = await (recordSkillAssessmentV2 as any).handler(ctx, { userId: 'u1', sessionId: 's1', groupId: 'g1', skillHash: 'h', level: 5, rubricVersion: 'v2', feedback: ['f'], metCriteria: ['a'], unmetCriteria: ['b'], trackedSkillIdHash: 'th' })
    expect(res).toEqual({ ok: true, id: 'assessV2' })
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({ userId: 'u1', sessionId: 's1', groupId: 'g1', skillHash: 'h', level: 5, kind: 'skill_assessment', rubricVersion: 'v2' })
  })

  it('assessments.idempotency guards are respected', async () => {
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: (_name: string, _cb: any) => ({ first: async () => ({ sessionId: 's1', groupId: 'g1', expiresAt: Date.now() + 1000 }) }),
        })),
        insert: vi.fn(async (_t: string, _doc: any) => undefined),
      },
    } as any
    const existing = await (checkFinalizeIdempotency as any).handler(ctx, { sessionId: 's1', groupId: 'g1' })
    expect(existing).not.toBeNull()
    const res = await (markFinalizeCompleted as any).handler(ctx, { sessionId: 's1', groupId: 'g1' })
    expect(res).toEqual({ ok: true })
  })
});
