import { describe, it, expect, vi, beforeEach } from 'vitest';

// Local mock for Convex server wrappers used by convex/functions/* in this spec
(vi as any).mock('../../../convex/_generated/server', () => ({
  mutation: (def: any) => def,
  query: (def: any) => def,
  action: (def: any) => def,
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

import { setResults, runMockForSession, runForSession } from '../../../convex/functions/triage';

describe('Convex triage functions', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('setResults patches matching interactions and sets triageProcessedAt', async () => {
    const patches: any[] = [];
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: (_name: string, _cb: any) => ({ collect: async () => ([{ _id: 'ix1', sessionId: 's1', messageId: 'm1' }]) }),
        })),
        patch: vi.fn(async (id: string, patch: any) => { patches.push({ id, patch }); }),
      },
    } as any;

    const updates = [{ sessionId: 's1', messageId: 'm1', assessmentType: 'single_qa_pair' }];
    const res = await (setResults as any).handler(ctx, { updates });
    expect(res).toEqual({ ok: true, updated: 1 });
    expect(patches).toHaveLength(1);
    expect(patches[0].id).toBe('ix1');
    expect(patches[0].patch).toMatchObject({ assessmentType: 'single_qa_pair' });
    expect(typeof patches[0].patch.triageProcessedAt).toBe('number');
  });

  it('runMockForSession infers assessmentType and calls setResults', async () => {
    const recent = [
      { messageId: 'm1', role: 'user', ts: 1 },
      { messageId: 'm2', role: 'assistant', ts: 2 },
    ];
    const ctx = {
      runQuery: vi.fn(async (name: string, args: any) => {
        if (name === "functions/summaries:getLatest") {
          return { cutoffIndex: 0 };
        }
        if (name === "functions/triage:listBySession") {
          return recent;
        }
        return [];
      }),
      runMutation: vi.fn(async (_name: string, _args: any) => ({ updated: recent.length })),
    } as any;

    const res = await (runMockForSession as any).handler(ctx, { sessionId: 's1', limit: 20 });
    expect(res).toMatchObject({ ok: true });
    expect(typeof (res as any).updated).toBe('number');
    expect(['single_qa_pair', 'roleplay_scenario', 'general_chatter']).toContain((res as any).inferred);
    expect(ctx.runMutation).toHaveBeenCalledWith('functions/triage:setResults', expect.any(Object));
  });

  it('runForSession uses provider=mock by default and delegates to runMockForSession', async () => {
    vi.stubEnv('TRIAGE_PROVIDER', 'mock');
    const ctx = {
      runQuery: vi.fn(async () => ({ cutoffIndex: 0 })),
      runAction: vi.fn(async (_name: string, _args: any) => ({ updated: 5, inferred: 'general_chatter' })),
    } as any;
    const out = await (runForSession as any).handler(ctx, { sessionId: 's1', limit: 10 });
    expect(out).toEqual({ ok: true, updated: 5, provider: 'mock', inferred: 'general_chatter' });
  });

  it('runForSession falls back to mock when external provider errors', async () => {
    vi.stubEnv('TRIAGE_PROVIDER', 'google');
    vi.stubEnv('AI_API_BASE_URL', 'http://127.0.0.1:8000');
    const fetchSpy = vi.spyOn(global as any, 'fetch').mockRejectedValueOnce(new Error('network'));
    const ctx = {
      runQuery: vi.fn(async (name: string, args: any) => {
        if (name === "functions/summaries:getLatest") {
          return { cutoffIndex: 0 };
        }
        if (name === "functions/triage:listBySession") {
          return []; // Return empty array instead of undefined
        }
        return [];
      }),
      runAction: vi.fn(async (_name: string, _args: any) => ({ updated: 3, inferred: 'roleplay_scenario' })),
      runMutation: vi.fn(async () => ({ updated: 0 })),
    } as any;
    const out = await (runForSession as any).handler(ctx, { sessionId: 's1', limit: 10 });
    expect(out).toMatchObject({ ok: true, provider: 'mock_fallback', updated: 3 });
    fetchSpy.mockRestore();
  });
});
