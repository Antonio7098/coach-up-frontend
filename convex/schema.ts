// Convex Schema — Assessments v3 (SPR-014)
// Supports v3-only finalize with per-skill persistence, structured feedback, and level progression

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Finalize idempotency — prevent duplicate writes by (sessionId, groupId)
  finalize_idempotency: defineTable({
    sessionId: v.string(),
    groupId: v.string(),
    completedAt: v.number(), // ms since epoch
    expiresAt: v.number(), // ms since epoch (24h TTL)
  })
    .index("by_session_group", ["sessionId", "groupId"])
    .index("by_expiresAt", ["expiresAt"]),

  // Minimal skill level history - just level progression
  skill_level_history: defineTable({
    userId: v.string(),
    skillId: v.string(),
    fromLevel: v.number(), // 0-10 scale
    toLevel: v.number(), // 0-10 scale
    reason: v.string(), // "assessment_average", "manual_adjustment", "admin_override"
    source: v.string(), // "assessment", "admin", "user", "system"
    
    createdAt: v.number(),
  })
  .index("by_user", ["userId"])
  .index("by_skillId", ["skillId"])
  .index("by_user_skill", ["userId", "skillId"])
  .index("by_createdAt", ["createdAt"]),

  // Sessions — minimal state tracking with cost aggregation
  sessions: defineTable({
    userId: v.string(),
    sessionId: v.string(),
    state: v.optional(v.any()),
    latestGroupId: v.optional(v.string()),
    latestAssessmentId: v.optional(v.string()),
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
    // Triage metadata (optional; populated by triage pipeline)
    assessmentType: v.optional(
      v.union(
        v.literal("single_qa_pair"),
        v.literal("roleplay_scenario"),
        v.literal("general_chatter"),
        v.literal("unknown"),
        v.literal("multi_step_exercise"),
        v.literal("progressive_skill_building"),
        v.literal("skill_practice"),
        v.literal("practice"),
      )
    ),
    triageStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("running"),
        v.literal("processed"),
        v.literal("skipped"),
        v.literal("error"),
      )
    ),
    triageDecision: v.optional(
      v.union(
        v.literal("assess"),
        v.literal("not_assess"),
      )
    ),
    triageGroupId: v.optional(v.string()),
    triageJobId: v.optional(v.string()),
    triageError: v.optional(v.string()),
    triageProcessedAt: v.optional(v.number()), // ms since epoch
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
    .index("by_session_ts", ["sessionId", "ts"]) 
    // Index to efficiently query assessable interactions by session/type/time
    .index("by_session_assess_type_ts", ["sessionId", "assessmentType", "ts"]),

  // Triage jobs — orchestrator entries for reliability/coalescing
  triage_jobs: defineTable({
    sessionId: v.string(),
    jobId: v.string(),
    status: v.union(
      v.literal('queued'),
      v.literal('running'),
      v.literal('persisted'),
      v.literal('skipped'),
      v.literal('failed'),
    ),
    reason: v.optional(v.string()), // user_ingest | summary_preflight | manual
    messageIds: v.optional(v.array(v.string())),
    attempts: v.optional(v.number()),
    nextAttemptAt: v.optional(v.number()),
    updatedCount: v.optional(v.number()),
    decisions: v.optional(v.object({ assess: v.number(), not_assess: v.number() })),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_session_createdAt', ['sessionId', 'createdAt'])
    .index('by_jobId', ['jobId'])
    .index('by_status', ['status'])
,

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
        level: v.number(), // 0-10 scale (0 = not started, 1-10 = skill levels)
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

  // Session summaries — decoupled from assessments with concurrency control
  session_summaries: defineTable({
    sessionId: v.string(),
    version: v.number(),
    text: v.string(),
    cutoffIndex: v.optional(v.number()), // transcript index where this summary ends
    inProgress: v.optional(v.boolean()), // single-flight lock
    thresholdTurns: v.optional(v.number()), // turns threshold for next summary
    thresholdSeconds: v.optional(v.number()), // time threshold for next summary
    lastJobAt: v.optional(v.number()), // when ensureJob was last called
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
  .index('by_session_version', ['sessionId', 'version'])
  .index('by_createdAt', ['createdAt']),

  // Group-level Assessments (v2)
  assessments_v2: defineTable({
    userId: v.string(),
    sessionId: v.string(),
    groupId: v.string(),
    results: v.object({
      highlights: v.array(v.string()),
      recommendations: v.array(v.string()),
      rubricKeyPoints: v.array(v.string()),
      meta: v.optional(v.object({
        skillsCount: v.optional(v.number()),
        provider: v.optional(v.string()),
        modelId: v.optional(v.string()),
      })),
    }),
    kpis: v.optional(v.object({
      totalScore: v.optional(v.number()),
      averageLevel: v.optional(v.number()),
      confidence: v.optional(v.number()),
    })),
    assessmentMetadata: v.optional(v.object({
      provider: v.optional(v.string()),
      modelId: v.optional(v.string()),
      promptVersion: v.optional(v.string()),
      tokenCount: v.optional(v.number()),
      costCents: v.optional(v.number()),
      processingTimeMs: v.optional(v.number()),
    })),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
  .index('by_session_createdAt', ['sessionId','createdAt'])
  .index('by_group', ['groupId'])
  ,

  // Per-skill assessment results (v2)
  skill_assessment: defineTable({
    assessmentId: v.id('assessments_v2'),
    userId: v.string(),
    sessionId: v.string(),
    groupId: v.string(),
    skillId: v.string(),
    skillHash: v.string(),
    results: v.object({
      level: v.number(),
      levelFeedback: v.object({
        currentLevel: v.number(),
        strengths: v.array(v.string()),
        improvements: v.array(v.string()),
        focus: v.array(v.string()),
        nextLevelCriteria: v.array(v.string()),
        examples: v.optional(v.array(v.string())),
      }),
      confidence: v.optional(v.number()), 
    }),
    assessmentMetadata: v.optional(v.object({
      provider: v.optional(v.string()),
      modelId: v.optional(v.string()),
      promptVersion: v.optional(v.string()),
      tokenCount: v.optional(v.number()),
      costCents: v.optional(v.number()),
      processingTimeMs: v.optional(v.number()),
    })),
    sourceContext: v.optional(v.object({
      assessmentType: v.optional(v.string()),
      interactionCount: v.optional(v.number()),
      transcriptLength: v.optional(v.number()),
      sessionDuration: v.optional(v.number()),
    })),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
  .index('by_assessment', ['assessmentId'])
  .index('by_session', ['sessionId'])
  ,

  // Summary cadence state — ingest-driven triggers and locks (SPR-008 v2)
  summary_state: defineTable({
    sessionId: v.string(),
    turnsSince: v.number(), // assistant-completed turns since last summary
    assistantMsgSince: v.number(), // assistant messages since last summary
    lastGeneratedAt: v.number(), // ms since epoch
    lastVersion: v.number(),
    cutoffIndex: v.optional(v.number()), // transcript index of last summarized message
    lockUntil: v.optional(v.number()), // ms since epoch
    createdAt: v.number(),
    updatedAt: v.number(),
    version: v.optional(v.number()), // optimistic locking version
  })
  .index('by_session', ['sessionId'])
  .index('by_updatedAt', ['updatedAt']),

  // Group-level Assessments (v3) — deterministic summary from per-skill results
  assessments_v3: defineTable({
    userId: v.string(),
    sessionId: v.string(),
    groupId: v.string(),
    results: v.object({
      highlights: v.array(v.string()),
      recommendations: v.array(v.string()),
      rubricKeyPoints: v.array(v.string()),
      meta: v.optional(v.object({
        skillsCount: v.optional(v.number()),
        provider: v.optional(v.string()),
        modelId: v.optional(v.string()),
      })),
    }),
    kpis: v.optional(v.object({
      averageLevel: v.optional(v.number()),
      totalScore: v.optional(v.number()),
    })),
    assessmentMetadata: v.optional(v.object({
      provider: v.optional(v.string()),
      modelId: v.optional(v.string()),
      promptVersion: v.optional(v.string()),
      tokenCount: v.optional(v.number()),
      costCents: v.optional(v.number()),
      processingTimeMs: v.optional(v.number()),
    })),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
  .index('by_session_createdAt', ['sessionId','createdAt'])
  .index('by_group', ['groupId']),

  // Per-skill assessment results (v3) — structured feedback with annotated examples
  skill_assessment_v3: defineTable({
    assessmentId: v.id('assessments_v3'),
    userId: v.string(),
    sessionId: v.string(),
    groupId: v.string(),
    skillId: v.string(),
    skillHash: v.string(),
    level: v.number(), // 0..10 scale
    confidence: v.optional(v.number()), // 0..1 confidence
    structuredFeedback: v.object({
      primaryTakeaway: v.string(),
      primaryFocus: v.object({
        description: v.string(),
        nextLevelCriteria: v.string(),
        exampleToPractice: v.optional(v.string()),
      }),
      annotatedExamples: v.array(v.object({
        userQuote: v.string(),
        annotation: v.string(),
        classification: v.union(v.literal('strength'), v.literal('improvement_opportunity')),
        relevantLevel: v.number(), // 0..10
      })),
    }),
    quantitativeMetrics: v.optional(v.object({
      averageTUnitLength: v.optional(v.number()),
      subordinationIndex: v.optional(v.number()),
      yngveScore: v.optional(v.number()),
      nominalizationCount: v.optional(v.number()),
      conjunctionVariety: v.optional(v.array(v.string())),
    })),
    assessmentMetadata: v.optional(v.object({
      provider: v.optional(v.string()),
      modelId: v.optional(v.string()),
      promptVersion: v.optional(v.string()),
      tokenCount: v.optional(v.number()),
      costCents: v.optional(v.number()),
      processingTimeMs: v.optional(v.number()),
    })),
    sourceContext: v.optional(v.object({
      assessmentType: v.optional(v.string()),
      interactionCount: v.optional(v.number()),
      transcriptLength: v.optional(v.number()),
      sessionDuration: v.optional(v.number()),
    })),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
  .index('by_assessment', ['assessmentId'])
  .index('by_session', ['sessionId'])
  .index('by_user_skill', ['userId', 'skillId', 'createdAt'])
  .index('by_user_skillHash', ['userId', 'skillHash', 'createdAt']),
});
