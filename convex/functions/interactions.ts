// @ts-nocheck
// Convex Functions — Interactions (SPR-003)
// Append per-message interaction rows for transcripts and audio pointers.

import { v } from "convex/values";
import { mutation, query } from "../_generated/server";

export const appendInteraction = mutation({
  args: {
    sessionId: v.string(),
    groupId: v.optional(v.string()),
    messageId: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant")),
    contentHash: v.string(),
    text: v.optional(v.string()),
    audioUrl: v.optional(v.string()),
    // Cost tracking fields (in cents)
    sttCostCents: v.optional(v.number()),
    llmCostCents: v.optional(v.number()),
    ttsCostCents: v.optional(v.number()),
    totalCostCents: v.optional(v.number()),
    // Usage tracking fields
    sttDurationMs: v.optional(v.number()),
    llmTokensIn: v.optional(v.number()),
    llmTokensOut: v.optional(v.number()),
    ttsCharacters: v.optional(v.number()),
    ts: v.number(), // original event timestamp (ms since epoch)
  },
  handler: async (ctx, args) => {
    // Runtime guards to complement v validators
    const nonEmpty = (s: unknown) => typeof s === 'string' && s.trim().length > 0;
    if (!nonEmpty(args.sessionId)) throw new Error('sessionId required');
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
      // Cost tracking fields
      sttCostCents: args.sttCostCents,
      llmCostCents: args.llmCostCents,
      ttsCostCents: args.ttsCostCents,
      totalCostCents: args.totalCostCents,
      // Usage tracking fields
      sttDurationMs: args.sttDurationMs,
      llmTokensIn: args.llmTokensIn,
      llmTokensOut: args.llmTokensOut,
      ttsCharacters: args.ttsCharacters,
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

export const updateSessionCosts = mutation({
  args: {
    sessionId: v.string(),
    sttCostCents: v.optional(v.number()),
    llmCostCents: v.optional(v.number()),
    ttsCostCents: v.optional(v.number()),
    totalCostCents: v.optional(v.number()),
    interactionCount: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const nonEmpty = (s: unknown) => typeof s === 'string' && s.trim().length > 0;
    if (!nonEmpty(args.sessionId)) throw new Error('sessionId required');
    
    // Find existing session
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_sessionId", (q: any) => q.eq("sessionId", args.sessionId))
      .first();
    
    if (!session) {
      throw new Error('Session not found');
    }
    
    // Update session with cost aggregation
    const now = Date.now();
    await ctx.db.patch(session._id, {
      // Cost tracking fields
      sttCostCents: args.sttCostCents ?? session.sttCostCents,
      llmCostCents: args.llmCostCents ?? session.llmCostCents,
      ttsCostCents: args.ttsCostCents ?? session.ttsCostCents,
      totalCostCents: args.totalCostCents ?? session.totalCostCents,
      // Session metrics
      interactionCount: args.interactionCount ?? session.interactionCount,
      durationMs: args.durationMs ?? session.durationMs,
      startTime: args.startTime ?? session.startTime,
      endTime: args.endTime ?? session.endTime,
      lastActivityAt: now,
    });
    
    return { id: session._id } as const;
  },
});

export const getSessionCosts = query({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const nonEmpty = (s: unknown) => typeof s === 'string' && s.trim().length > 0;
    if (!nonEmpty(args.sessionId)) throw new Error('sessionId required');
    
    // Get session data
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_sessionId", (q: any) => q.eq("sessionId", args.sessionId))
      .first();
    
    if (!session) {
      return null;
    }
    
    // Get all interactions for this session with cost data
    const interactions = await ctx.db
      .query("interactions")
      .withIndex("by_session", (q: any) => q.eq("sessionId", args.sessionId))
      .collect();
    
    // Calculate aggregated costs from interactions
    let totalSttCost = 0;
    let totalLlmCost = 0;
    let totalTtsCost = 0;
    let totalCost = 0;
    let interactionCount = 0;
    
    interactions.forEach((interaction: any) => {
      if (interaction.sttCostCents) totalSttCost += interaction.sttCostCents;
      if (interaction.llmCostCents) totalLlmCost += interaction.llmCostCents;
      if (interaction.ttsCostCents) totalTtsCost += interaction.ttsCostCents;
      if (interaction.totalCostCents) totalCost += interaction.totalCostCents;
      interactionCount++;
    });
    
    // Calculate session duration
    const now = Date.now();
    const startTime = session.startTime || session.createdAt;
    const endTime = session.endTime || now;
    const durationMs = endTime - startTime;
    
    return {
      session: {
        sessionId: session.sessionId,
        userId: session.userId,
        startTime: session.startTime || session.createdAt,
        endTime: session.endTime || now,
        durationMs,
        lastActivityAt: session.lastActivityAt,
      },
      costs: {
        sttCostCents: totalSttCost,
        llmCostCents: totalLlmCost,
        ttsCostCents: totalTtsCost,
        totalCostCents: totalCost,
      },
      metrics: {
        interactionCount,
        durationMs,
      },
      interactions: interactions.map((interaction: any) => ({
        id: interaction._id,
        role: interaction.role,
        text: interaction.text,
        ts: interaction.ts,
        createdAt: interaction.createdAt,
        costs: {
          sttCostCents: interaction.sttCostCents || 0,
          llmCostCents: interaction.llmCostCents || 0,
          ttsCostCents: interaction.ttsCostCents || 0,
          totalCostCents: interaction.totalCostCents || 0,
        },
        usage: {
          sttDurationMs: interaction.sttDurationMs,
          llmTokensIn: interaction.llmTokensIn,
          llmTokensOut: interaction.llmTokensOut,
          ttsCharacters: interaction.ttsCharacters,
        },
      })),
    };
  },
});
