import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Convex server wrappers and values
(vi as any).mock('../convex/_generated/server', () => ({
  mutation: (def: any) => def,
  query: (def: any) => def,
}), { virtual: true });

(vi as any).mock('convex/values', () => ({
  v: {
    string: () => ({}),
    number: () => ({}),
    optional: (_inner: any) => ({}),
  },
}), { virtual: true });

// Import Convex functions under test
import { onAssistantMessage, onGenerated, releaseLock, getState } from '../convex/functions/summary_state';

describe('Convex functions: summary_state cadence logic', () => {
  let mockCtx: any;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z')); // Fixed time for tests

    mockCtx = {
      db: {
        query: vi.fn(() => ({
          withIndex: (_name: string, _cb: any) => ({
            collect: vi.fn().mockResolvedValue([]),
          }),
        })),
        insert: vi.fn().mockResolvedValue('new_id'),
        patch: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue(null),
      },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('onAssistantMessage', () => {
    it('creates new summary_state when none exists', async () => {
      mockCtx.db.query.mockReturnValue({
        withIndex: (_name: string, _cb: any) => ({
          collect: vi.fn().mockResolvedValue([]),
        }),
      });

      const result = await (onAssistantMessage as any)(mockCtx, {
        sessionId: 'sess-1',
        lastKnownVersion: 0,
      });

      expect(result).toEqual({
        dueNow: false,
        locked: false,
        reason: null,
        turnsSince: 1,
        assistantMsgSince: 1,
        ageSec: Number.MAX_SAFE_INTEGER,
      });

      expect(mockCtx.db.insert).toHaveBeenCalledWith('summary_state', {
        sessionId: 'sess-1',
        turnsSince: 1,
        assistantMsgSince: 1,
        lastGeneratedAt: 0,
        lastVersion: 0,
        lockUntil: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    it('updates existing summary_state counters', async () => {
      const existingDoc = {
        _id: 'existing_id',
        sessionId: 'sess-1',
        turnsSince: 2,
        assistantMsgSince: 3,
        lastGeneratedAt: Date.now() - 100000, // 100 seconds ago
        lastVersion: 1,
        lockUntil: 0,
      };

      mockCtx.db.query.mockReturnValue({
        withIndex: (_name: string, _cb: any) => ({
          collect: vi.fn().mockResolvedValue([existingDoc]),
        }),
      });
      mockCtx.db.get.mockResolvedValue(existingDoc);

      const result = await (onAssistantMessage as any)(mockCtx, {
        sessionId: 'sess-1',
        lastKnownVersion: 1,
      });

      expect(result).toEqual({
        dueNow: false,
        locked: false,
        reason: null,
        turnsSince: 3,
        assistantMsgSince: 4,
        ageSec: 100,
      });

      expect(mockCtx.db.patch).toHaveBeenCalledWith('existing_id', {
        turnsSince: 3,
        assistantMsgSince: 4,
        updatedAt: Date.now(),
      });
    });

    it('triggers due when assistant message count reaches threshold', async () => {
      // Set environment variable for test
      process.env.SUMMARY_GENERATE_ASSISTANT_EVERY_N = '3';

      const existingDoc = {
        _id: 'existing_id',
        sessionId: 'sess-1',
        turnsSince: 2,
        assistantMsgSince: 2, // Will become 3 after increment
        lastGeneratedAt: Date.now(),
        lastVersion: 1,
        lockUntil: 0,
      };

      mockCtx.db.query.mockReturnValue({
        withIndex: (_name: string, _cb: any) => ({
          collect: vi.fn().mockResolvedValue([existingDoc]),
        }),
      });
      mockCtx.db.get.mockResolvedValue(existingDoc);

      const result = await (onAssistantMessage as any)(mockCtx, {
        sessionId: 'sess-1',
        lastKnownVersion: 1,
      });

      expect(result.dueNow).toBe(true);
      expect(result.reason).toBe('assistant_modulo');
      expect(result.assistantMsgSince).toBe(3);
    });

    it('triggers due when time threshold exceeded', async () => {
      // Set environment variable for test
      process.env.SUMMARY_GENERATE_SECONDS = '60';

      const existingDoc = {
        _id: 'existing_id',
        sessionId: 'sess-1',
        turnsSince: 1,
        assistantMsgSince: 1,
        lastGeneratedAt: Date.now() - 70000, // 70 seconds ago (> 60 threshold)
        lastVersion: 1,
        lockUntil: 0,
      };

      mockCtx.db.query.mockReturnValue({
        withIndex: (_name: string, _cb: any) => ({
          collect: vi.fn().mockResolvedValue([existingDoc]),
        }),
      });
      mockCtx.db.get.mockResolvedValue(existingDoc);

      const result = await (onAssistantMessage as any)(mockCtx, {
        sessionId: 'sess-1',
        lastKnownVersion: 1,
      });

      expect(result.dueNow).toBe(true);
      expect(result.reason).toBe('time');
      expect(result.ageSec).toBe(70);
    });

    it('acquires lock when due and no existing lock', async () => {
      process.env.SUMMARY_GENERATE_SECONDS = '60';
      process.env.SUMMARY_LOCK_MS = '15000';

      const existingDoc = {
        _id: 'existing_id',
        sessionId: 'sess-1',
        turnsSince: 1,
        assistantMsgSince: 1,
        lastGeneratedAt: Date.now() - 70000,
        lastVersion: 1,
        lockUntil: 0,
      };

      mockCtx.db.query.mockReturnValue({
        withIndex: (_name: string, _cb: any) => ({
          collect: vi.fn().mockResolvedValue([existingDoc]),
        }),
      });
      mockCtx.db.get.mockResolvedValue(existingDoc);

      const result = await (onAssistantMessage as any)(mockCtx, {
        sessionId: 'sess-1',
        lastKnownVersion: 1,
      });

      expect(result.locked).toBe(true);
      expect(mockCtx.db.patch).toHaveBeenCalledWith('existing_id', {
        lockUntil: Date.now() + 15000,
        updatedAt: Date.now(),
      });
    });

    it('does not acquire lock when lock already exists', async () => {
      process.env.SUMMARY_GENERATE_SECONDS = '60';

      const existingDoc = {
        _id: 'existing_id',
        sessionId: 'sess-1',
        turnsSince: 1,
        assistantMsgSince: 1,
        lastGeneratedAt: Date.now() - 70000,
        lastVersion: 1,
        lockUntil: Date.now() + 10000, // Future lock
      };

      mockCtx.db.query.mockReturnValue({
        withIndex: (_name: string, _cb: any) => ({
          collect: vi.fn().mockResolvedValue([existingDoc]),
        }),
      });
      mockCtx.db.get.mockResolvedValue(existingDoc);

      const result = await (onAssistantMessage as any)(mockCtx, {
        sessionId: 'sess-1',
        lastKnownVersion: 1,
      });

      expect(result.locked).toBe(false);
      expect(result.dueNow).toBe(true);
    });
  });

  describe('onGenerated', () => {
    it('resets counters and clears lock when summary generated', async () => {
      const existingDoc = {
        _id: 'existing_id',
        sessionId: 'sess-1',
        turnsSince: 5,
        assistantMsgSince: 3,
        lastGeneratedAt: Date.now() - 100000,
        lastVersion: 1,
        lockUntil: Date.now() + 5000,
      };

      mockCtx.db.query.mockReturnValue({
        withIndex: (_name: string, _cb: any) => ({
          collect: vi.fn().mockResolvedValue([existingDoc]),
        }),
      });

      const result = await (onGenerated as any)(mockCtx, {
        sessionId: 'sess-1',
        newVersion: 2,
        generatedAt: Date.now(),
      });

      expect(result).toEqual({ ok: true });
      expect(mockCtx.db.patch).toHaveBeenCalledWith('existing_id', {
        lastGeneratedAt: Date.now(),
        lastVersion: 2,
        turnsSince: 0,
        assistantMsgSince: 0,
        lockUntil: 0,
        updatedAt: Date.now(),
      });
    });

    it('returns false when no existing summary_state found', async () => {
      mockCtx.db.query.mockReturnValue({
        withIndex: (_name: string, _cb: any) => ({
          collect: vi.fn().mockResolvedValue([]),
        }),
      });

      const result = await (onGenerated as any)(mockCtx, {
        sessionId: 'sess-1',
        newVersion: 2,
        generatedAt: Date.now(),
      });

      expect(result).toEqual({ ok: false });
    });
  });

  describe('releaseLock', () => {
    it('clears lock on existing summary_state', async () => {
      const existingDoc = {
        _id: 'existing_id',
        sessionId: 'sess-1',
        lockUntil: Date.now() + 10000,
      };

      mockCtx.db.query.mockReturnValue({
        withIndex: (_name: string, _cb: any) => ({
          collect: vi.fn().mockResolvedValue([existingDoc]),
        }),
      });

      const result = await (releaseLock as any)(mockCtx, {
        sessionId: 'sess-1',
      });

      expect(result).toEqual({ ok: true });
      expect(mockCtx.db.patch).toHaveBeenCalledWith('existing_id', {
        lockUntil: 0,
        updatedAt: Date.now(),
      });
    });

    it('returns false when no existing summary_state found', async () => {
      mockCtx.db.query.mockReturnValue({
        withIndex: (_name: string, _cb: any) => ({
          collect: vi.fn().mockResolvedValue([]),
        }),
      });

      const result = await (releaseLock as any)(mockCtx, {
        sessionId: 'sess-1',
      });

      expect(result).toEqual({ ok: false });
    });
  });

  describe('getState', () => {
    it('returns current summary_state with threshold info', async () => {
      process.env.SUMMARY_GENERATE_ASSISTANT_EVERY_N = '4';

      const existingDoc = {
        turnsSince: 2,
        assistantMsgSince: 3,
        lastGeneratedAt: Date.now() - 60000,
        lastVersion: 1,
      };

      mockCtx.db.query.mockReturnValue({
        withIndex: (_name: string, _cb: any) => ({
          collect: vi.fn().mockResolvedValue([existingDoc]),
        }),
      });

      const result = await (getState as any)(mockCtx, {
        sessionId: 'sess-1',
      });

      expect(result).toEqual({
        sessionId: 'sess-1',
        turnsSince: 2,
        assistantMsgSince: 3,
        lastGeneratedAt: Date.now() - 60000,
        lastVersion: 1,
        thresholdTurns: 4,
      });
    });

    it('returns default values when no summary_state exists', async () => {
      mockCtx.db.query.mockReturnValue({
        withIndex: (_name: string, _cb: any) => ({
          collect: vi.fn().mockResolvedValue([]),
        }),
      });

      const result = await (getState as any)(mockCtx, {
        sessionId: 'sess-1',
      });

      expect(result).toEqual({
        sessionId: 'sess-1',
        turnsSince: 0,
        assistantMsgSince: 0,
        lastGeneratedAt: 0,
        lastVersion: 0,
        thresholdTurns: 4, // default value
      });
    });
  });
});
