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
        // Cost tracking fields - initialize to 0
        totalCostCents: 0,
        sttCostCents: 0,
        llmCostCents: 0,
        ttsCostCents: 0,
        // Session metrics - initialize appropriately
        interactionCount: 0,
        durationMs: 0,
        startTime: now,
        // endTime is optional and not set for active sessions
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

export const listRecentSessions = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;
    const sessions = await ctx.db
      .query("sessions")
      .order("desc")
      .take(limit);
    return sessions;
  },
});

export const ensureActiveSession = mutation({
  args: {
    userId: v.string(),
    sessionIdHint: v.optional(v.string()),
    nowMs: v.number(),
    idleThresholdMs: v.number(),
  },
  handler: async (ctx, args) => {
    // Runtime guards
    const nonEmpty = (s: unknown) => typeof s === 'string' && s.trim().length > 0;
    if (!nonEmpty(args.userId)) throw new Error('userId required');
    if (typeof args.nowMs !== 'number' || args.nowMs <= 0) {
      throw new Error('nowMs must be a positive number (ms since epoch)');
    }
    if (typeof args.idleThresholdMs !== 'number' || args.idleThresholdMs <= 0) {
      throw new Error('idleThresholdMs must be a positive number');
    }

    // If sessionIdHint provided, check if it's still active
    if (args.sessionIdHint && nonEmpty(args.sessionIdHint)) {
      const existing = await ctx.db
        .query("sessions")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionIdHint))
        .unique();

      if (existing && existing.userId === args.userId) {
        // Check if session is still active (not idle beyond threshold)
        const timeSinceLastActivity = args.nowMs - (existing.lastActivityAt || 0);
        if (timeSinceLastActivity <= args.idleThresholdMs) {
          // Session is still active, update lastActivityAt
          await ctx.db.patch(existing._id, {
            lastActivityAt: args.nowMs,
          });
          return { sessionId: args.sessionIdHint, isNew: false };
        }
      }
    }

    // Need to create a new session
    const newSessionId = `sess_${args.nowMs}_${Math.random().toString(36).slice(2)}`;
    
    const id = await ctx.db.insert("sessions", {
      userId: args.userId,
      sessionId: newSessionId,
      state: {},
      // Cost tracking fields - initialize to 0
      totalCostCents: 0,
      sttCostCents: 0,
      llmCostCents: 0,
      ttsCostCents: 0,
      // Session metrics - initialize appropriately
      interactionCount: 0,
      durationMs: 0,
      startTime: args.nowMs,
      // endTime is optional and not set for active sessions
      createdAt: args.nowMs,
      lastActivityAt: args.nowMs,
    });

    return { sessionId: newSessionId, isNew: true };
  },
});

export const updateActivity = mutation({
  args: {
    sessionId: v.string(),
    lastActivityAt: v.number(),
    incInteractionCount: v.optional(v.number()),
    llmCostCentsDelta: v.optional(v.number()),
    sttCostCentsDelta: v.optional(v.number()),
    ttsCostCentsDelta: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Runtime guards
    const nonEmpty = (s: unknown) => typeof s === 'string' && s.trim().length > 0;
    if (!nonEmpty(args.sessionId)) throw new Error('sessionId required');
    if (typeof args.lastActivityAt !== 'number' || args.lastActivityAt <= 0) {
      throw new Error('lastActivityAt must be a positive number (ms since epoch)');
    }

    // Lookup session by sessionId
    const existing = await ctx.db
      .query("sessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .unique();

    if (!existing) {
      throw new Error(`Session not found: ${args.sessionId}`);
    }

    // Prepare update object
    const updates: any = {};

    // Update lastActivityAt only if provided value is newer
    if (args.lastActivityAt > (existing.lastActivityAt || 0)) {
      updates.lastActivityAt = args.lastActivityAt;
    }

    // Increment interactionCount if provided
    if (args.incInteractionCount !== undefined && args.incInteractionCount > 0) {
      updates.interactionCount = (existing.interactionCount || 0) + args.incInteractionCount;
    }

    // Add cost deltas to their aggregates (allow negative for refunds/corrections)
    if (args.llmCostCentsDelta !== undefined && args.llmCostCentsDelta !== 0) {
      updates.llmCostCents = (existing.llmCostCents || 0) + args.llmCostCentsDelta;
    }

    if (args.sttCostCentsDelta !== undefined && args.sttCostCentsDelta !== 0) {
      updates.sttCostCents = (existing.sttCostCents || 0) + args.sttCostCentsDelta;
    }

    if (args.ttsCostCentsDelta !== undefined && args.ttsCostCentsDelta !== 0) {
      updates.ttsCostCents = (existing.ttsCostCents || 0) + args.ttsCostCentsDelta;
    }

    // Update totalCostCents if any cost deltas were applied
    const totalCostDelta = (args.llmCostCentsDelta || 0) + (args.sttCostCentsDelta || 0) + (args.ttsCostCentsDelta || 0);
    if (totalCostDelta !== 0) {
      updates.totalCostCents = (existing.totalCostCents || 0) + totalCostDelta;
    }

    // Apply updates if any
    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(existing._id, updates);
    }

    return { 
      sessionId: args.sessionId,
      updated: Object.keys(updates).length > 0,
      updates 
    };
  },
});
