// @ts-nocheck
// Convex Functions — Interactions (SPR-003)
// Append per-message interaction rows for transcripts and audio pointers.

import { v } from "convex/values";
import { mutation } from "../_generated/server";

export const appendInteraction = mutation({
  args: {
    sessionId: v.string(),
    groupId: v.string(),
    messageId: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant")),
    contentHash: v.string(),
    audioUrl: v.optional(v.string()),
    ts: v.number(), // original event timestamp (ms since epoch)
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("interactions", {
      sessionId: args.sessionId,
      groupId: args.groupId,
      messageId: args.messageId,
      role: args.role,
      contentHash: args.contentHash,
      audioUrl: args.audioUrl,
      ts: args.ts,
      createdAt: now,
    });
    return { id } as const;
  },
});
