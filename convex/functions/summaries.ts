import { mutation, query } from "../_generated/server";
import { v } from "convex/values";

export const getLatest = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("session_summaries")
      .withIndex("by_session_createdAt", q => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(1);
    const row = rows[0];
    if (!row) return null;
    return {
      sessionId: row.sessionId,
      version: row.version,
      text: row.text,
      lastMessageTs: row.lastMessageTs,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      meta: row.meta,
    };
  },
});

export const insert = mutation({
  args: {
    sessionId: v.string(),
    text: v.string(),
    lastMessageTs: v.optional(v.number()),
    meta: v.optional(v.object({
      provider: v.optional(v.string()),
      modelId: v.optional(v.string()),
      tokenBudget: v.optional(v.number()),
    })),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const latest = await ctx.db
      .query("session_summaries")
      .withIndex("by_session_createdAt", q => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(1);
    const nextVersion = latest[0] ? latest[0].version + 1 : 1;
    const id = await ctx.db.insert("session_summaries", {
      sessionId: args.sessionId,
      version: nextVersion,
      text: args.text,
      lastMessageTs: args.lastMessageTs,
      meta: args.meta,
      createdAt: now,
      updatedAt: now,
    });
    return { id, version: nextVersion, updatedAt: now };
  },
});


