// @ts-nocheck
// Convex Schema — Assessments v1 (SPR-002)
// NOTE: This file is a planning/implementation artifact and is not imported by the app build yet.
// It can be activated later by installing Convex and running the dev server.

import { defineSchema, defineTable, v } from "convex/schema";

export default defineSchema({
  assessments: defineTable({
    userId: v.string(),
    sessionId: v.string(),
    focusId: v.optional(v.string()),
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
      })
    ),
    createdAt: v.number(), // ms since epoch
    updatedAt: v.number(), // ms since epoch
  })
    .index("by_user", ["userId"]) 
    .index("by_session", ["sessionId"]) 
    .index("by_group", ["groupId"]) 
    .index("by_kind_category", ["kind", "category"]) 
    .index("by_createdAt", ["createdAt"]),
});
