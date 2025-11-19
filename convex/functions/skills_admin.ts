// @ts-nocheck
// Convex Functions — Skills Admin Utilities
// WARNING: Admin-only utilities for bulk replacing skills. Do NOT expose in production without auth.

import { v } from "convex/values";
import { mutation, query } from "../_generated/server";

const SkillLevel = v.object({
  level: v.number(),
  criteria: v.string(),
  examples: v.optional(v.array(v.string())),
  rubricHints: v.optional(v.array(v.string())),
});

const SkillInput = v.object({
  id: v.string(),
  title: v.string(),
  description: v.string(),
  levels: v.array(SkillLevel),
  category: v.optional(v.string()),
  isActive: v.boolean(),
});

export const resetSkills = mutation({
  args: {
    skills: v.array(SkillInput),
    // Optional safety flag
    confirm: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if ((args.confirm || '').toLowerCase() !== 'yes') {
      throw new Error("resetSkills requires confirm='yes'");
    }

    // Delete all existing skills
    const all = await ctx.db.query("skills").collect();
    for (const s of all) {
      await ctx.db.delete(s._id);
    }

    // Insert new set
    const now = Date.now();
    let inserted = 0;
    for (const s of args.skills) {
      if (!s.levels || s.levels.length === 0) throw new Error(`skill ${s.id} must have at least one level`);
      if (s.levels.some(l => l.level < 1 || l.level > 10)) throw new Error(`skill ${s.id} has invalid level outside 1..10`);
      await ctx.db.insert("skills", {
        id: s.id,
        title: s.title,
        description: s.description,
        levels: s.levels,
        category: s.category,
        isActive: s.isActive,
        createdAt: now,
        updatedAt: now,
      });
      inserted++;
    }
    return { ok: true, deleted: all.length, inserted } as const;
  }
});

// Admin utility: upsert hashes for specific skills by id
export const upsertSkillHashes = mutation({
  args: {
    items: v.array(
      v.object({
        skillId: v.string(),
        title: v.optional(v.string()),
        description: v.optional(v.string()),
        category: v.optional(v.string()),
        isActive: v.optional(v.boolean()),
        skillHash: v.string(),
      })
    ),
  },
  handler: async (ctx, { items }) => {
    const now = Date.now();
    let upserts = 0;
    for (const it of items) {
      const existing = await ctx.db
        .query("skills")
        .withIndex("by_skill_id", (q) => q.eq("id", it.skillId))
        .first();
      if (existing) {
        await ctx.db.replace(existing._id, {
          ...existing,
          title: it.title ?? existing.title,
          description: it.description ?? existing.description,
          category: it.category ?? existing.category,
          isActive: it.isActive ?? (existing.isActive ?? true),
          // store hash alongside skill; not part of schema but tolerated via any
          skillHash: it.skillHash,
          updatedAt: now,
        } as any);
        upserts++;
      } else {
        await ctx.db.insert("skills", {
          id: it.skillId,
          title: it.title ?? it.skillId,
          description: it.description ?? "",
          levels: [ { level: 1, criteria: "Seeded", examples: [], rubricHints: [] } ],
          category: it.category,
          isActive: it.isActive ?? true,
          createdAt: now,
          updatedAt: now,
          skillHash: it.skillHash,
        } as any);
        upserts++;
      }
    }
    return { ok: true, upserts } as const;
  },
});

// Admin utility: list skills by ids (verify stored hash and fields)
export const listSkillsByIds = query({
  args: { ids: v.array(v.string()) },
  handler: async (ctx, { ids }) => {
    const out = [] as any[];
    for (const id of ids) {
      const doc = await ctx.db
        .query("skills")
        .withIndex("by_skill_id", (q) => q.eq("id", id))
        .first();
      if (doc) out.push(doc);
    }
    return out;
  },
});
