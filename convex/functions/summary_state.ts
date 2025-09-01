// @ts-nocheck
// Convex Functions — Summary cadence state (SPR-008 v2)

import { v } from "convex/values";
import { mutation, query } from "../_generated/server";

function now() { return Date.now(); }

export const onAssistantMessage = mutation({
  args: {
    sessionId: v.string(),
    lastKnownVersion: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const sid = args.sessionId;
    const nowMs = now();
    const everyN = Number(process.env.SUMMARY_GENERATE_ASSISTANT_EVERY_N || 4);
    const maxAgeSec = Number(process.env.SUMMARY_GENERATE_SECONDS || 120);
    const lockMs = Number(process.env.SUMMARY_LOCK_MS || 15000);

    const [existing] = await ctx.db
      .query("summary_state")
      .withIndex("by_session", (q: any) => q.eq("sessionId", sid))
      .collect();

    let doc = existing;
    if (!doc) {
      const id = await ctx.db.insert("summary_state", {
        sessionId: sid,
        turnsSince: 1,
        assistantMsgSince: 1,
        lastGeneratedAt: 0,
        lastVersion: args.lastKnownVersion ?? 0,
        lockUntil: 0,
        createdAt: nowMs,
        updatedAt: nowMs,
      });
      doc = await ctx.db.get(id);
    } else {
      // Increment counters; treat assistant message as completing a turn
      const turnsSince = (doc.turnsSince ?? 0) + 1;
      const assistantMsgSince = (doc.assistantMsgSince ?? 0) + 1;
      await ctx.db.patch(doc._id, { turnsSince, assistantMsgSince, updatedAt: nowMs });
      doc = { ...doc, turnsSince, assistantMsgSince, updatedAt: nowMs };
    }

    const ageSec = doc.lastGeneratedAt > 0 ? Math.floor((nowMs - doc.lastGeneratedAt) / 1000) : Number.MAX_SAFE_INTEGER;
    const moduloDue = doc.assistantMsgSince > 0 && everyN > 0 && (doc.assistantMsgSince % everyN === 0);
    const timeDue = ageSec >= maxAgeSec;
    const dueNow = !!(moduloDue || timeDue);

    let locked = false;
    if (dueNow) {
      const lockUntil = typeof doc.lockUntil === "number" ? doc.lockUntil : 0;
      if (nowMs >= lockUntil) {
        await ctx.db.patch(doc._id, { lockUntil: nowMs + lockMs, updatedAt: nowMs });
        locked = true;
      }
    }

    return { dueNow, locked, reason: moduloDue ? "assistant_modulo" : (timeDue ? "time" : null), turnsSince: doc.turnsSince, assistantMsgSince: doc.assistantMsgSince, ageSec } as const;
  },
});

export const onGenerated = mutation({
  args: {
    sessionId: v.string(),
    newVersion: v.number(),
    generatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const [doc] = await ctx.db
      .query("summary_state")
      .withIndex("by_session", (q: any) => q.eq("sessionId", args.sessionId))
      .collect();
    if (!doc) return { ok: false } as const;
    await ctx.db.patch(doc._id, {
      lastGeneratedAt: args.generatedAt,
      lastVersion: args.newVersion,
      turnsSince: 0,
      assistantMsgSince: 0,
      lockUntil: 0,
      updatedAt: now(),
    });
    return { ok: true } as const;
  },
});

export const releaseLock = mutation({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const [doc] = await ctx.db
      .query("summary_state")
      .withIndex("by_session", (q: any) => q.eq("sessionId", args.sessionId))
      .collect();
    if (!doc) return { ok: false } as const;
    await ctx.db.patch(doc._id, { lockUntil: 0, updatedAt: now() });
    return { ok: true } as const;
  },
});

export const getState = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const sid = args.sessionId;
    const everyN = Number(process.env.SUMMARY_GENERATE_ASSISTANT_EVERY_N || 4);
    const [doc] = await ctx.db
      .query("summary_state")
      .withIndex("by_session", (q: any) => q.eq("sessionId", sid))
      .collect();
    const turnsSince = Number(doc?.turnsSince ?? 0);
    const assistantMsgSince = Number(doc?.assistantMsgSince ?? 0);
    const lastGeneratedAt = Number(doc?.lastGeneratedAt ?? 0);
    const lastVersion = Number(doc?.lastVersion ?? 0);
    return {
      sessionId: sid,
      turnsSince,
      assistantMsgSince,
      lastGeneratedAt,
      lastVersion,
      thresholdTurns: everyN,
    } as const;
  },
});



