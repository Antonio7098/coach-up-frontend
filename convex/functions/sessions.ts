// @ts-nocheck
// Convex Functions — Sessions (SPR-003)
// Update minimal session state and last activity timestamp.

import { v } from "convex/values";
import { mutation, query } from "../_generated/server";

export const updateSessionState = mutation({
  args: {
    userId: v.string(),
    sessionId: v.string(),
    state: v.optional(v.any()),
    latestGroupId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Runtime guards
    const nonEmpty = (s: unknown) => typeof s === 'string' && s.trim().length > 0;
    if (!nonEmpty(args.userId)) throw new Error('userId required');
    if (!nonEmpty(args.sessionId)) throw new Error('sessionId required');
    if (args.latestGroupId !== undefined && args.latestGroupId !== null && !nonEmpty(args.latestGroupId)) {
      throw new Error('latestGroupId must be non-empty when provided');
    }
    if (args.state !== undefined && args.state !== null) {
      if (typeof args.state !== 'object' || Array.isArray(args.state)) {
        throw new Error('state must be an object when provided');
      }
    }
    const now = Date.now();
    // Lookup by sessionId
    const existing = await ctx.db
      .query("sessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .unique();

    if (!existing) {
      const id = await ctx.db.insert("sessions", {
        userId: args.userId,
        sessionId: args.sessionId,
        state: args.state ?? {},
        latestGroupId: args.latestGroupId,
        createdAt: now,
        lastActivityAt: now,
      });
      return { created: true, id } as const;
    }

    await ctx.db.patch(existing._id, {
      state: args.state ?? existing.state ?? {},
      latestGroupId: args.latestGroupId ?? existing.latestGroupId,
      lastActivityAt: now,
    });
    return { created: false, id: existing._id } as const;
  },
});

export const getBySessionId = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const existing = await ctx.db
      .query("sessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .unique();
    return existing ?? null;
  },
});
