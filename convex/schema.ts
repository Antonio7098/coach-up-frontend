// Convex Schema — Assessments v2 (SPR-007)
// Supports v2-only finalize with per-skill persistence and level progression

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Assessments — v2-only with per-skill rows and skillHash
  assessments: defineTable({
    userId: v.string(),
    sessionId: v.string(),
    groupId: v.optional(v.string()),
    // Optional to support legacy v1 rows that didn't include a skill hash
    skillHash: v.optional(v.string()), // required for kind="skill_assessment" in v2
    // Widen kind to accept legacy records
    kind: v.union(
      v.literal("skill_assessment"),
      v.literal("summary"),
      v.literal("multi_turn")
    ),
    level: v.optional(v.number()), // 0..10 for per-skill rows
    // Accept both v1 and v2 legacy rows
    rubricVersion: v.union(v.literal("v1"), v.literal("v2")),
    summary: v.optional(
      v.object({
        highlights: v.array(v.string()),
        recommendations: v.array(v.string()),
        rubricKeyPoints: v.array(v.string()),
        meta: v.optional(
          v.object({
            provider: v.optional(v.string()),
            modelId: v.optional(v.string()),
            skillsCount: v.optional(v.number()),
          })
        ),
      })
    ),
    // These are optional in legacy rows
    feedback: v.optional(v.array(v.string())),
    metCriteria: v.optional(v.array(v.string())),
    unmetCriteria: v.optional(v.array(v.string())),
    trackedSkillIdHash: v.optional(v.string()),
    createdAt: v.number(), // ms since epoch
    updatedAt: v.number(), // ms since epoch
  })
    .index("by_user_skillHash", ["userId", "skillHash", "createdAt"])
    .index("by_session", ["sessionId"])
    .index("by_group", ["groupId"])
    .index("by_kind", ["kind"])
    .index("by_createdAt", ["createdAt"]),

  // Finalize idempotency — prevent duplicate writes by (sessionId, groupId)
  finalize_idempotency: defineTable({
    sessionId: v.string(),
    groupId: v.string(),
    completedAt: v.number(), // ms since epoch
    expiresAt: v.number(), // ms since epoch (24h TTL)
  })
    .index("by_session_group", ["sessionId", "groupId"])
    .index("by_expiresAt", ["expiresAt"]),

  // Skill level history — track level changes from v2 assessments
  skill_level_history: defineTable({
    userId: v.string(),
    skillId: v.string(),
    fromLevel: v.number(), // 0..10
    toLevel: v.number(), // 0..10
    reason: v.string(), // e.g., "assessment_average"
    avgSource: v.number(), // average level used
    sessionId: v.string(),
    groupId: v.string(),
    createdAt: v.number(), // ms since epoch
  })
    .index("by_user", ["userId"])
    .index("by_skillId", ["skillId"])
    .index("by_createdAt", ["createdAt"])
    .index("by_session", ["sessionId"]),

  // Sessions — minimal state tracking with cost aggregation
  sessions: defineTable({
    userId: v.string(),
    sessionId: v.string(),
    state: v.optional(v.any()),
    latestGroupId: v.optional(v.string()),
    // Cost tracking fields (in cents)
    totalCostCents: v.optional(v.number()),
    sttCostCents: v.optional(v.number()),
    llmCostCents: v.optional(v.number()),
    ttsCostCents: v.optional(v.number()),
    // Session metrics
    interactionCount: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
    createdAt: v.number(),
    lastActivityAt: v.number(),
  })
    .index("by_user", ["userId"]) 
    .index("by_sessionId", ["sessionId"]) 
    .index("by_lastActivityAt", ["lastActivityAt"]),

  // Interactions — per message storage and pointers to blobs with cost tracking
  interactions: defineTable({
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
    .index("by_user", ["userId"]) 
    .index("by_group", ["groupId"]) 
    .index("by_requestId", ["requestId"]) 
    .index("by_createdAt", ["createdAt"]) 
    .index("by_tracked_hash", ["trackedSkillIdHash"]),

  // Skills — predefined pathways for learning with ranked levels and progression criteria
  skills: defineTable({
    id: v.string(), // unique skill identifier (e.g., "clarity_eloquence", "stutter_reduction")
    title: v.string(), // display name (e.g., "Clarity/Eloquence")
    description: v.string(), // brief description of what the skill teaches
    levels: v.array(
      v.object({
        level: v.number(), // 1-10 scale
        criteria: v.string(), // requirements for achieving this level
        examples: v.optional(v.array(v.string())), // example utterances/behaviors
        rubricHints: v.optional(v.array(v.string())), // hints for assessment
      })
    ),
    category: v.optional(v.string()), // e.g., "communication", "fluency", "style"
    isActive: v.boolean(), // whether this skill is available for selection
    createdAt: v.number(), // ms since epoch
    updatedAt: v.number(), // ms since epoch
  })
    .index("by_skill_id", ["id"])
    .index("by_category", ["category"])
    .index("by_isActive", ["isActive"])
    .index("by_createdAt", ["createdAt"]),

  // Per-user tracked skills — at most 2 per user, ordered, with current level (0-10)
  tracked_skills: defineTable({
    userId: v.string(),
    skillId: v.string(),
    currentLevel: v.number(), // 0..10
    order: v.number(), // 1..2
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"]) 
    .index("by_user_skill", ["userId", "skillId"]) 
    .index("by_user_order", ["userId", "order"]),

  // Users — profile info
  users: defineTable({
    tokenIdentifier: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    pictureUrl: v.optional(v.string()),
  })
  .index('by_tokenIdentifier', ['tokenIdentifier']),

  users_profile: defineTable({
    userId: v.string(),
    displayName: v.optional(v.string()),
    email: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    bio: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
  .index('by_user', ['userId']),

  users_goals: defineTable({
    userId: v.string(),
    goalId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    status: v.union(
      v.literal('active'),
      v.literal('paused'),
      v.literal('completed')
    ),
    targetDateMs: v.optional(v.number()),
    tags: v.array(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
  .index('by_user', ['userId'])
  .index('by_user_goal', ['userId', 'goalId']),

  // Session summaries — decoupled from assessments
  session_summaries: defineTable({
    sessionId: v.string(),
    version: v.number(),
    text: v.string(),
    lastMessageTs: v.optional(v.number()),
    meta: v.optional(v.object({
      provider: v.optional(v.string()),
      modelId: v.optional(v.string()),
      tokenBudget: v.optional(v.number()),
    })),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
  .index('by_session_createdAt', ['sessionId', 'createdAt'])
  .index('by_createdAt', ['createdAt']),

  // Summary cadence state — ingest-driven triggers and locks (SPR-008 v2)
  summary_state: defineTable({
    sessionId: v.string(),
    turnsSince: v.number(), // assistant-completed turns since last summary
    assistantMsgSince: v.number(), // assistant messages since last summary
    lastGeneratedAt: v.number(), // ms since epoch
    lastVersion: v.number(),
    lockUntil: v.optional(v.number()), // ms since epoch
    createdAt: v.number(),
    updatedAt: v.number(),
  })
  .index('by_session', ['sessionId'])
  .index('by_updatedAt', ['updatedAt']),
});
