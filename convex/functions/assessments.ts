// Convex Functions — Assessments v2 (SPR-007)
// V2-only with per-skill persistence and level progression

import { v } from "convex/values";
import { mutation, query } from "../_generated/server";

// ARCHIVED V1 FUNCTIONS (below) - kept for reference but not used
// These have been replaced by v2-only implementations

/*
export const writeAssessment = mutation({...});
export const getLatestSummaryBySession = query({...});
export const persistAssessmentSummary = mutation({...});
*/

// ACTIVE V2 FUNCTIONS (below)

export const recordSkillAssessmentV2 = mutation({
  args: {
    userId: v.string(),
    sessionId: v.string(),
    groupId: v.string(),
    skillHash: v.string(),
    level: v.number(), // 0..10
    rubricVersion: v.literal("v2"),
    feedback: v.array(v.string()),
    metCriteria: v.array(v.string()),
    unmetCriteria: v.array(v.string()),
    trackedSkillIdHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.level < 0 || args.level > 10) throw new Error("level must be 0-10");
    const now = Date.now();
    const doc = {
      userId: args.userId,
      sessionId: args.sessionId,
      groupId: args.groupId,
      skillHash: args.skillHash,
      kind: "skill_assessment",
      level: args.level,
      rubricVersion: "v2",
      feedback: args.feedback,
      metCriteria: args.metCriteria,
      unmetCriteria: args.unmetCriteria,
      trackedSkillIdHash: args.trackedSkillIdHash,
      createdAt: now,
      updatedAt: now,
    } as any;
    const id = await ctx.db.insert("assessments", doc);
    return { ok: true, id } as const;
  },
});

// Check idempotency for finalize (sessionId, groupId)
export const checkFinalizeIdempotency = query({
  args: {
    sessionId: v.string(),
    groupId: v.string(),
  },
  handler: async (ctx, { sessionId, groupId }) => {
    const existing = await ctx.db
      .query("finalize_idempotency")
      .withIndex("by_session_group", (q) => q.eq("sessionId", sessionId).eq("groupId", groupId))
      .first();
    if (!existing) return null;
    if (Date.now() > existing.expiresAt) return null; // expired
    return existing;
  },
});

// Mark finalize as completed (idempotency guard)
export const markFinalizeCompleted = mutation({
  args: {
    sessionId: v.string(),
    groupId: v.string(),
  },
  handler: async (ctx, { sessionId, groupId }) => {
    const now = Date.now();
    const expiresAt = now + 24 * 60 * 60 * 1000; // 24h TTL
    await ctx.db.insert("finalize_idempotency", {
      sessionId,
      groupId,
      completedAt: now,
      expiresAt,
    });
    return { ok: true } as const;
  },
});
