// @ts-nocheck
// Convex Functions — Events (SPR-003)
// Stubs to enable logging of observability events including trackedSkillIdHash.

import { v } from "convex/values";
import { mutation, query } from "../_generated/server";

export const logEvent = mutation({
  args: {
    userId: v.string(),
    sessionId: v.string(),
    groupId: v.optional(v.string()),
    requestId: v.optional(v.string()),
    trackedSkillIdHash: v.optional(v.string()),
    kind: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    // Runtime guards
    const nonEmpty = (s: unknown) => typeof s === 'string' && s.trim().length > 0;
    if (!nonEmpty(args.userId)) throw new Error('userId required');
    if (!nonEmpty(args.sessionId)) throw new Error('sessionId required');
    if (!nonEmpty(args.kind)) throw new Error('kind required');
    if (args.requestId !== undefined && args.requestId !== null && !nonEmpty(args.requestId)) {
      throw new Error('requestId must be non-empty when provided');
    }
    if (args.trackedSkillIdHash !== undefined && args.trackedSkillIdHash !== null && !nonEmpty(args.trackedSkillIdHash)) {
      throw new Error('trackedSkillIdHash must be non-empty when provided');
    }
    const now = Date.now();
    await ctx.db.insert("events", {
      userId: args.userId,
      sessionId: args.sessionId,
      groupId: args.groupId,
      requestId: args.requestId,
      trackedSkillIdHash: args.trackedSkillIdHash,
      kind: args.kind,
      payload: args.payload,
      createdAt: now,
    });
    return { ok: true } as const;
  },
});

export const listBySession = query({
  args: {
    sessionId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const lim = Math.max(1, Math.min(200, args.limit ?? 50));
    const docs = await ctx.db
      .query("events")
      .withIndex("by_session", (q: any) => q.eq("sessionId", args.sessionId))
      .collect();
    // Sort newest first and apply limit
    docs.sort((a: any, b: any) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    return docs.slice(0, lim);
  },
});
