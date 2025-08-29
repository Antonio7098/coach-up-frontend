// @ts-nocheck
// Convex Functions — Users: Profile & Goals (SPR-008 scope)

import { v } from "convex/values";
import { mutation, query } from "../_generated/server";

// -------------- Profile --------------
export const getProfile = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const doc = await ctx.db
      .query("users_profile")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    return doc ?? null;
  },
});

export const upsertProfile = mutation({
  args: {
    userId: v.string(),
    displayName: v.optional(v.string()),
    email: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    bio: v.optional(v.string()),
  },
  handler: async (ctx, { userId, ...updates }) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("users_profile")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!existing) {
      const id = await ctx.db.insert("users_profile", {
        userId,
        ...updates,
        createdAt: now,
        updatedAt: now,
      });
      return { created: true, id } as const;
    }
    const doc = { ...existing, ...updates, updatedAt: now };
    await ctx.db.replace(existing._id, doc);
    return { created: false, id: existing._id } as const;
  },
});

// -------------- Goals --------------
export const listGoals = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db
      .query("users_goals")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    // Sort by updatedAt desc then createdAt desc
    rows.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || (b.createdAt ?? 0) - (a.createdAt ?? 0));
    return rows;
  },
});

export const addGoal = mutation({
  args: {
    userId: v.string(),
    goalId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("paused"), v.literal("completed")),
    targetDateMs: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { userId, goalId, title, description, status, targetDateMs, tags }) => {
    const now = Date.now();
    // Upsert by (userId, goalId)
    const existing = await ctx.db
      .query("users_goals")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const match = existing.find((g) => g.goalId === goalId);
    if (!match) {
      const id = await ctx.db.insert("users_goals", {
        userId,
        goalId,
        title,
        description,
        status,
        targetDateMs,
        tags: Array.isArray(tags) ? tags : [],
        createdAt: now,
        updatedAt: now,
      });
      return { created: true, id } as const;
    }
    const doc = {
      ...match,
      title,
      description,
      status,
      targetDateMs,
      tags: Array.isArray(tags) ? tags : match.tags ?? [],
      updatedAt: now,
    };
    await ctx.db.replace(match._id, doc);
    return { created: false, id: match._id } as const;
  },
});

export const updateGoal = mutation({
  args: {
    userId: v.string(),
    goalId: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("paused"), v.literal("completed"))),
    targetDateMs: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { userId, goalId, ...updates }) => {
    const existing = await ctx.db
      .query("users_goals")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const match = existing.find((g) => g.goalId === goalId);
    if (!match) throw new Error("goal not found");
    const now = Date.now();
    const doc = { ...match, ...updates, updatedAt: now };
    await ctx.db.replace(match._id, doc);
    return { ok: true } as const;
  },
});

export const deleteGoal = mutation({
  args: { userId: v.string(), goalId: v.string() },
  handler: async (ctx, { userId, goalId }) => {
    const existing = await ctx.db
      .query("users_goals")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const match = existing.find((g) => g.goalId === goalId);
    if (!match) return { ok: true, deleted: false } as const;
    await ctx.db.delete(match._id);
    return { ok: true, deleted: true } as const;
  },
});
