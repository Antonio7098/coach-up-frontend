// @ts-nocheck
// Convex Schema — Assessments v1 (SPR-002)
// NOTE: This file is a planning/implementation artifact and is not imported by the app build yet.
// It can be activated later by installing Convex and running the dev server.

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Assessments — includes optional trackedSkillIdHash for privacy-preserving correlations
  assessments: defineTable({
    userId: v.string(),
    sessionId: v.string(),
    trackedSkillIdHash: v.optional(v.string()),
    interactionId: v.optional(v.string()),
    groupId: v.optional(v.string()),
    kind: v.union(
      v.literal("per_interaction"),
      v.literal("multi_turn"),
      v.literal("summary"),
    ),
    category: v.string(),
    score: v.number(), // 0..1
    errors: v.array(v.string()),
    tags: v.array(v.string()),
    rubricVersion: v.string(),
    summary: v.optional(
      v.object({
        highlights: v.array(v.string()),
        recommendations: v.array(v.string()),
        rubricKeyPoints: v.array(v.string()),
        categories: v.optional(v.array(v.string())),
        // Using any for scores to allow dynamic keys per rubric category
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
    createdAt: v.number(), // ms since epoch
    updatedAt: v.number(), // ms since epoch
  })
    .index("by_user", ["userId"]) 
    .index("by_session", ["sessionId"]) 
    .index("by_group", ["groupId"]) 
    .index("by_kind_category", ["kind", "category"]) 
    .index("by_createdAt", ["createdAt"]) 
    .index("by_tracked_hash", ["trackedSkillIdHash"]),

  // Sessions — minimal state tracking
  sessions: defineTable({
    userId: v.string(),
    sessionId: v.string(),
    state: v.optional(v.any()),
    latestGroupId: v.optional(v.string()),
    createdAt: v.number(),
    lastActivityAt: v.number(),
  })
    .index("by_user", ["userId"]) 
    .index("by_sessionId", ["sessionId"]) 
    .index("by_lastActivityAt", ["lastActivityAt"]),

  // Interactions — per message storage and pointers to blobs
  interactions: defineTable({
    sessionId: v.string(),
    groupId: v.string(),
    messageId: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant")),
    contentHash: v.string(),
    audioUrl: v.optional(v.string()),
    ts: v.number(), // event timestamp (ms since epoch)
    createdAt: v.number(),
  })
    .index("by_session", ["sessionId"]) 
    .index("by_group", ["groupId"]) 
    .index("by_session_ts", ["sessionId", "ts"]),

  // Events — observability and state transitions
  events: defineTable({
    userId: v.string(),
    sessionId: v.string(),
    groupId: v.optional(v.string()),
    requestId: v.optional(v.string()),
    trackedSkillIdHash: v.optional(v.string()),
    kind: v.string(),
    payload: v.any(),
    createdAt: v.number(),
  })
    .index("by_session", ["sessionId"]) 
    .index("by_group", ["groupId"]) 
    .index("by_requestId", ["requestId"]) 
    .index("by_createdAt", ["createdAt"]) 
    .index("by_tracked_hash", ["trackedSkillIdHash"]),
});
