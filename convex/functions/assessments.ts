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

export const persistAssessmentSummaryV2 = mutation({
  args: {
    sessionId: v.string(),
    groupId: v.string(),
    summary: v.any(),
    rubricVersion: v.literal("v2"),
  },
  handler: async (ctx, { sessionId, groupId, summary }) => {
    const now = Date.now();
    const doc = {
      sessionId,
      groupId,
      kind: "summary",
      rubricVersion: "v2",
      summary,
      createdAt: now,
      updatedAt: now,
    } as any;
    const id = await (ctx.db as any).insert("assessments", doc);
    return { ok: true, id } as const;
  },
});

export const recordSkillAssessmentV2 = mutation({
  args: {
    userId: v.string(),
    sessionId: v.string(),
    groupId: v.string(),
    skillId: v.string(),
    skillHash: v.optional(v.string()),
    level: v.number(), // 0..10
    confidence: v.optional(v.number()), // 0..1
    levelFeedback: v.object({
      currentLevel: v.number(),
      nextLevelCriteria: v.array(v.string()),
      strengths: v.array(v.string()),
      improvements: v.array(v.string()),
      focus: v.array(v.string()),
      examples: v.optional(v.array(v.string())),
    }),
    assessmentMetadata: v.object({
      provider: v.optional(v.string()),
      modelId: v.optional(v.string()),
      promptVersion: v.optional(v.string()),
      processingTimeMs: v.optional(v.number()),
      tokenCount: v.optional(v.number()),
      costCents: v.optional(v.number()),
    }),
    sourceContext: v.object({
      interactionCount: v.optional(v.number()),
      transcriptLength: v.optional(v.number()),
      assessmentType: v.optional(v.string()),
      sessionDuration: v.optional(v.number()),
    }),
    rubricVersion: v.literal("v2"),
    // Legacy fields for backward compatibility
    feedback: v.optional(v.array(v.string())),
    metCriteria: v.optional(v.array(v.string())),
    unmetCriteria: v.optional(v.array(v.string())),
    trackedSkillIdHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.level < 0 || args.level > 10) throw new Error("level must be 0-10");
    if (args.confidence && (args.confidence < 0 || args.confidence > 1)) {
      throw new Error("confidence must be 0-1");
    }
    const now = Date.now();
    const doc = {
      userId: args.userId,
      sessionId: args.sessionId,
      groupId: args.groupId,
      skillId: args.skillId,
      skillHash: args.skillHash,
      kind: "skill_assessment",
      level: args.level,
      confidence: args.confidence,
      levelFeedback: args.levelFeedback,
      assessmentMetadata: args.assessmentMetadata,
      sourceContext: args.sourceContext,
      rubricVersion: "v2",
      // Legacy fields
      feedback: args.feedback,
      metCriteria: args.metCriteria,
      unmetCriteria: args.unmetCriteria,
      trackedSkillIdHash: args.trackedSkillIdHash,
      createdAt: now,
      updatedAt: now,
    } as any;
    const id = await (ctx.db as any).insert("assessments", doc);
    return { ok: true, id } as const;
  },
});

// Fetch latest session summary for a given sessionId
export const getLatestAssessmentSummary = query({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, { sessionId }) => {
    // Find the latest summary entry in assessments for this session
    const latest = await ctx.db
      .query("assessments")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .filter((q) => q.eq(q.field("kind"), "summary"))
      .order("desc")
      .first();

    if (!latest) return null as any;

    // Look up session record to provide latestGroupId (optional)
    const sess = await ctx.db
      .query("sessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .first();

    return {
      sessionId,
      latestGroupId: sess?.latestGroupId ?? latest.groupId ?? null,
      summary: latest.summary ?? null,
      rubricVersion: latest.rubricVersion ?? "v2",
      createdAt: latest.createdAt,
      updatedAt: latest.updatedAt,
    } as any;
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

// Record skill level change in history
export const recordSkillLevelChange = mutation({
  args: {
    userId: v.string(),
    skillId: v.string(),
    fromLevel: v.number(), // 0..10
    toLevel: v.number(), // 0..10
    reason: v.string(),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.fromLevel < 0 || args.fromLevel > 10) throw new Error("fromLevel must be 0-10");
    if (args.toLevel < 0 || args.toLevel > 10) throw new Error("toLevel must be 0-10");
    const now = Date.now();
    const doc = {
      userId: args.userId,
      skillId: args.skillId,
      fromLevel: args.fromLevel,
      toLevel: args.toLevel,
      reason: args.reason,
      source: args.source,
      createdAt: now,
    } as any;
    const id = await (ctx.db as any).insert("skill_level_history", doc);
    return { ok: true, id } as const;
  },
});
