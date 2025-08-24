import { describe, it, expect, vi } from 'vitest';

// Mock Convex server wrappers and values (virtual modules)
vi.mock('../../../convex/_generated/server', () => ({
  mutation: (def: any) => def,
  query: (def: any) => def,
}), { virtual: true });

vi.mock('convex/values', () => ({
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

import { getAllActiveSkills, getSkillById, getSkillsByCategory, createSkill, updateSkill } from '../../../convex/functions/skills';

describe('Convex functions: skills', () => {
  it('getAllActiveSkills uses by_isActive index and collects', async () => {
    const usedIndex: string[] = [];
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: (name: string, _cb: any) => {
            usedIndex.push(name);
            return { collect: async () => ([{ id: 'clarity' }]) };
          },
        })),
      },
    } as any;

    const res = await (getAllActiveSkills as any).handler(ctx);
    expect(usedIndex).toContain('by_isActive');
    expect(Array.isArray(res)).toBe(true);
    expect(res[0]).toMatchObject({ id: 'clarity' });
  });

  it('getSkillById uses by_id index and returns first or null', async () => {
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: (_name: string, _cb: any) => ({ collect: async () => ([{ id: 'clarity' }, { id: 'other' }]) }),
        })),
      },
    } as any;

    const found = await (getSkillById as any).handler(ctx, { id: 'clarity' });
    expect(found).toMatchObject({ id: 'clarity' });

    const ctxNone = {
      db: { query: vi.fn(() => ({ withIndex: (_n: string, _cb: any) => ({ collect: async () => ([] as any[]) }) })) },
    } as any;
    const none = await (getSkillById as any).handler(ctxNone, { id: 'missing' });
    expect(none).toBeNull();
  });

  it('getSkillsByCategory uses by_category index and collects', async () => {
    const usedIndex: string[] = [];
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: (name: string, _cb: any) => {
            usedIndex.push(name);
            return { collect: async () => ([{ id: 'clarity', category: 'communication' }]) };
          },
        })),
      },
    } as any;

    const res = await (getSkillsByCategory as any).handler(ctx, { category: 'communication' });
    expect(usedIndex).toContain('by_category');
    expect(Array.isArray(res)).toBe(true);
    expect(res[0]).toMatchObject({ id: 'clarity', category: 'communication' });
  });

  it('createSkill validates levels and inserts with timestamps', async () => {
    const inserts: any[] = [];
    const ctx = { db: { insert: vi.fn(async (_t: string, doc: any) => { inserts.push(doc); return 'skill_doc_id'; }) } } as any;

    const args = {
      id: 'clarity_eloquence',
      title: 'Clarity/Eloquence',
      description: 'Improve clarity and eloquence',
      levels: [
        { level: 1, criteria: 'basic criteria' },
        { level: 2, criteria: 'intermediate criteria' },
      ],
      category: 'communication',
      isActive: true,
    } as any;

    const res = await (createSkill as any).handler(ctx, args);
    expect(res).toBe('skill_doc_id');
    expect(inserts).toHaveLength(1);
    expect(typeof inserts[0].createdAt).toBe('number');
    expect(typeof inserts[0].updatedAt).toBe('number');
  });

  it('createSkill throws on empty levels and invalid level bounds', async () => {
    const ctx = { db: { insert: vi.fn(async () => 'x') } } as any;

    await expect((createSkill as any).handler(ctx, {
      id: 'id', title: 't', description: 'd', levels: [], isActive: true,
    })).rejects.toThrow('at least one level required');

    await expect((createSkill as any).handler(ctx, {
      id: 'id', title: 't', description: 'd', levels: [{ level: 0, criteria: 'x' }], isActive: true,
    })).rejects.toThrow('levels must be between 1 and 10');

    await expect((createSkill as any).handler(ctx, {
      id: 'id', title: 't', description: 'd', levels: [{ level: 11, criteria: 'x' }], isActive: true,
    })).rejects.toThrow('levels must be between 1 and 10');
  });

  it('updateSkill throws when skill not found', async () => {
    const ctx = {
      db: {
        query: vi.fn(() => ({ withIndex: (_n: string, _cb: any) => ({ first: async () => null }) })),
      },
    } as any;

    await expect((updateSkill as any).handler(ctx, { id: 'missing', title: 'x' })).rejects.toThrow('skill not found');
  });

  it('updateSkill validates levels when provided', async () => {
    const ctx = {
      db: {
        query: vi.fn(() => ({ withIndex: (_n: string, _cb: any) => ({ first: async () => ({ _id: 'doc1', id: 'clarity' }) }) })),
        replace: vi.fn(async () => 'ok'),
      },
    } as any;

    await expect((updateSkill as any).handler(ctx, { id: 'clarity', levels: [] })).rejects.toThrow('at least one level required');
    await expect((updateSkill as any).handler(ctx, { id: 'clarity', levels: [{ level: 0, criteria: 'x' }] as any })).rejects.toThrow('levels must be between 1 and 10');
    await expect((updateSkill as any).handler(ctx, { id: 'clarity', levels: [{ level: 11, criteria: 'x' }] as any })).rejects.toThrow('levels must be between 1 and 10');
  });

  it('updateSkill replaces existing with updated fields and timestamp', async () => {
    const replaced: any[] = [];
    const ctx = {
      db: {
        query: vi.fn(() => ({ withIndex: (_n: string, _cb: any) => ({ first: async () => ({ _id: 'doc1', id: 'clarity', title: 'Old', updatedAt: 1 }) }) })),
        replace: vi.fn(async (id: string, doc: any) => { replaced.push({ id, doc }); return 'ok'; }),
      },
    } as any;

    const res = await (updateSkill as any).handler(ctx, { id: 'clarity', title: 'New Title', isActive: false });
    expect(res).toBe('ok');
    expect(replaced).toHaveLength(1);
    expect(replaced[0].id).toBe('doc1');
    expect(replaced[0].doc).toMatchObject({ id: 'clarity', title: 'New Title', isActive: false });
    expect(typeof replaced[0].doc.updatedAt).toBe('number');
    expect(replaced[0].doc.updatedAt).toBeGreaterThan(1);
  });
});
