// @ts-nocheck
// Convex Functions — Events (SPR-003)
// Stubs to enable logging of observability events including trackedSkillIdHash.

import { v } from "convex/values";
import { mutation } from "../_generated/server";

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
