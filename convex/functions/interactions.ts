// @ts-nocheck
// Convex Functions — Interactions (SPR-003)
// Append per-message interaction rows for transcripts and audio pointers.

import { v } from "convex/values";
import { mutation, query } from "../_generated/server";

export const appendInteraction = mutation({
  args: {
    sessionId: v.string(),
    groupId: v.string(),
    messageId: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant")),
    contentHash: v.string(),
    text: v.optional(v.string()),
    audioUrl: v.optional(v.string()),
    ts: v.number(), // original event timestamp (ms since epoch)
  },
  handler: async (ctx, args) => {
    // Runtime guards to complement v validators
    const nonEmpty = (s: unknown) => typeof s === 'string' && s.trim().length > 0;
    if (!nonEmpty(args.sessionId)) throw new Error('sessionId required');
    if (!nonEmpty(args.groupId)) throw new Error('groupId required');
    if (!nonEmpty(args.messageId)) throw new Error('messageId required');
    if (!nonEmpty(args.contentHash)) throw new Error('contentHash required');
    if (!Number.isFinite(args.ts) || args.ts <= 0) throw new Error('ts must be > 0');
    if (args.audioUrl !== undefined && args.audioUrl !== null) {
      if (!nonEmpty(args.audioUrl)) throw new Error('audioUrl must be non-empty when provided');
      const ok = /^https?:\/\//.test(args.audioUrl);
      if (!ok) throw new Error('audioUrl must start with http or https');
    }
    if (args.text !== undefined && args.text !== null) {
      if (typeof args.text !== 'string') throw new Error('text must be a string when provided');
      // Allow empty string but trim to store consistent formatting
    }
    const now = Date.now();
    const id = await ctx.db.insert("interactions", {
      sessionId: args.sessionId,
      groupId: args.groupId,
      messageId: args.messageId,
      role: args.role,
      contentHash: args.contentHash,
      text: args.text,
      audioUrl: args.audioUrl,
      ts: args.ts,
      createdAt: now,
    });
    return { id } as const;
  },
});

export const listBySession = query({
  args: {
    sessionId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const nonEmpty = (s: unknown) => typeof s === 'string' && s.trim().length > 0;
    if (!nonEmpty(args.sessionId)) throw new Error('sessionId required');
    const lim = Math.max(1, Math.min(500, args.limit ?? 200));
    const docs = await ctx.db
      .query("interactions")
      .withIndex("by_session", (q: any) => q.eq("sessionId", args.sessionId))
      .collect();
    // Order by event timestamp ascending (chronological transcript)
    docs.sort((a: any, b: any) => (a.ts ?? 0) - (b.ts ?? 0));
    if (docs.length > lim) return docs.slice(docs.length - lim);
    return docs;
  },
});

export const listByGroup = query({
  args: {
    groupId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const nonEmpty = (s: unknown) => typeof s === 'string' && s.trim().length > 0;
    if (!nonEmpty(args.groupId)) throw new Error('groupId required');
    const lim = Math.max(1, Math.min(500, args.limit ?? 200));
    const docs = await ctx.db
      .query("interactions")
      .withIndex("by_group", (q: any) => q.eq("groupId", args.groupId))
      .collect();
    docs.sort((a: any, b: any) => (a.ts ?? 0) - (b.ts ?? 0));
    if (docs.length > lim) return docs.slice(docs.length - lim);
    return docs;
  },
});
