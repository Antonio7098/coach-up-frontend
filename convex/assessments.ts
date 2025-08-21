// Convex functions for Assessments v1 (SPR-002)
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const createAssessmentGroup = mutation({
  args: {
    sessionId: v.string(),
    groupId: v.string(),
    rubricVersion: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("assessments", {
      userId: "unknown", // TODO: fill from auth/session when available
      sessionId: args.sessionId,
      trackedSkillIdHash: undefined,
      interactionId: undefined,
      groupId: args.groupId,
      kind: "multi_turn",
      category: "group_init",
      score: 0,
      errors: [],
      tags: ["group_init"],
      rubricVersion: args.rubricVersion,
      summary: undefined,
      createdAt: now,
      updatedAt: now,
    });
    return { ok: true } as const;
  },
});

export const recordAssessmentRun = mutation({
  args: {
    sessionId: v.string(),
    groupId: v.string(),
    kind: v.union(
      v.literal("per_interaction"),
      v.literal("multi_turn"),
      v.literal("summary"),
    ),
    category: v.string(),
    score: v.optional(v.number()),
    errors: v.optional(v.array(v.string())),
    tags: v.optional(v.array(v.string())),
    rubricVersion: v.string(),
    interactionId: v.optional(v.string()),
    trackedSkillIdHash: v.optional(v.string()),
    summary: v.optional(
      v.object({
        highlights: v.array(v.string()),
        recommendations: v.array(v.string()),
        rubricKeyPoints: v.array(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("assessments", {
      userId: "unknown",
      sessionId: args.sessionId,
      trackedSkillIdHash: args.trackedSkillIdHash,
      interactionId: args.interactionId,
      groupId: args.groupId,
      kind: args.kind,
      category: args.category,
      score: args.score ?? 0,
      errors: args.errors ?? [],
      tags: args.tags ?? [],
      rubricVersion: args.rubricVersion,
      summary: args.summary,
      createdAt: now,
      updatedAt: now,
    });
    return { ok: true } as const;
  },
});

export const getLatestAssessmentSummary = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const bySession = await ctx.db
      .query("assessments")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    const summaries = bySession.filter((d) => d.kind === "summary");
    summaries.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    const latestSummary = summaries[0] ?? null;
    if (latestSummary) {
      return {
        sessionId,
        latestGroupId: latestSummary.groupId ?? null,
        summary: latestSummary.summary ?? null,
        rubricVersion: latestSummary.rubricVersion,
      } as const;
    }
    // Fallback: return the newest assessment doc (e.g., group_init) when no summary exists yet
    bySession.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    const newest = bySession[0] ?? null;
    if (!newest) return null;
    return {
      sessionId,
      latestGroupId: newest.groupId ?? null,
      summary: null,
      rubricVersion: newest.rubricVersion,
    } as const;
  },
});

export const finalizeAssessmentSummary = mutation({
  args: {
    sessionId: v.string(),
    groupId: v.string(),
    rubricVersion: v.string(),
    summary: v.object({
      highlights: v.array(v.string()),
      recommendations: v.array(v.string()),
      rubricKeyPoints: v.array(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("assessments", {
      userId: "unknown",
      sessionId: args.sessionId,
      trackedSkillIdHash: undefined,
      interactionId: undefined,
      groupId: args.groupId,
      kind: "summary",
      category: "session_summary",
      score: 0,
      errors: [],
      tags: ["summary"],
      rubricVersion: args.rubricVersion,
      summary: args.summary,
      createdAt: now,
      updatedAt: now,
    });
    return { ok: true } as const;
  },
});
