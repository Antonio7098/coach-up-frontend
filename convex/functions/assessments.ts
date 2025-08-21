// @ts-nocheck
// Convex Functions — Assessments v1 (SPR-002)
// These are stubs to define the shape of reads/writes; activate once Convex is integrated.

import { v } from "convex/values";
import { mutation, query } from "../_generated/server";

// Validation helpers
const KINDS = ["per_interaction", "multi_turn", "summary"] as const;
const RUBRIC_V1_CATEGORIES = ["correctness", "clarity", "conciseness", "fluency"] as const;

export const writeAssessment = mutation({
  args: {
    userId: v.string(),
    sessionId: v.string(),
    trackedSkillIdHash: v.optional(v.string()),
    interactionId: v.optional(v.string()),
    groupId: v.optional(v.string()),
    kind: v.string(),
    category: v.string(),
    score: v.number(),
    errors: v.array(v.string()),
    tags: v.array(v.string()),
    rubricVersion: v.string(),
    summary: v.optional(
      v.object({
        highlights: v.array(v.string()),
        recommendations: v.array(v.string()),
        rubricKeyPoints: v.array(v.string()),
        categories: v.optional(v.array(v.string())),
        scores: v.optional(v.any()),
        meta: v.optional(
          v.object({
            messageCount: v.optional(v.number()),
            durationMs: v.optional(v.number()),
            slice: v.optional(
              v.object({
                startIndex: v.number(),
                endIndex: v.number(),
              })
            ),
          })
        ),
        rubricVersion: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    // Basic guards (MVP)
    if (!KINDS.includes(args.kind as any)) throw new Error("invalid kind");
    if (args.score < 0 || args.score > 1) throw new Error("invalid score");
    if (args.kind === "per_interaction" && !args.interactionId) throw new Error("interactionId required");
    if ((args.kind === "multi_turn" || args.kind === "summary") && !args.groupId) throw new Error("groupId required");
    if (args.kind !== "summary" && !(RUBRIC_V1_CATEGORIES as readonly string[]).includes(args.category)) {
      throw new Error("invalid category");
    }

    const now = Date.now();
    const doc = {
      ...args,
      createdAt: now,
      updatedAt: now,
    } as any;
    return await ctx.db.insert("assessments", doc);
  },
});

export const getLatestSummaryBySession = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const summaries = await ctx.db
      .query("assessments")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    // Filter client-side for stub; in production add a compound index if needed
    const onlySummaries = summaries.filter((d: any) => d.kind === "summary");
    onlySummaries.sort((a: any, b: any) => b.createdAt - a.createdAt);
    return onlySummaries[0] ?? null;
  },
});

export const persistAssessmentSummary = mutation({
  args: {
    userId: v.string(),
    sessionId: v.string(),
    groupId: v.string(),
    rubricVersion: v.string(),
    trackedSkillIdHash: v.optional(v.string()),
    summary: v.object({
      highlights: v.array(v.string()),
      recommendations: v.array(v.string()),
      rubricKeyPoints: v.array(v.string()),
      categories: v.optional(v.array(v.string())),
      scores: v.optional(v.any()),
      meta: v.optional(
        v.object({
          messageCount: v.optional(v.number()),
          durationMs: v.optional(v.number()),
          slice: v.optional(
            v.object({
              startIndex: v.number(),
              endIndex: v.number(),
            })
          ),
        })
      ),
      rubricVersion: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("assessments", {
      userId: args.userId,
      sessionId: args.sessionId,
      trackedSkillIdHash: args.trackedSkillIdHash,
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
    return { ok: true, id } as const;
  },
});
