// @ts-nocheck
// Convex Functions — Sessions (SPR-003)
// Update minimal session state and last activity timestamp.

import { v } from "convex/values";
import { mutation } from "../_generated/server";

export const updateSessionState = mutation({
  args: {
    userId: v.string(),
    sessionId: v.string(),
    state: v.optional(v.any()),
    latestGroupId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
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
