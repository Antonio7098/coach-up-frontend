// @ts-nocheck
// Convex Functions — Skills (SPR-003)
// Functions for managing predefined skill pathways and their progression criteria

import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { ALL_PREDEFINED_SKILLS } from "../seed_skills";

export const getAllActiveSkills = query({
  handler: async (ctx) => {
    return await ctx.db
      .query("skills")
      .withIndex("by_isActive", (q) => q.eq("isActive", true))
      .collect();
  },
});

// -------------------- Tracked Skills (per-user) --------------------

export const getTrackedSkillsForUser = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const tracked = await ctx.db
      .query("tracked_skills")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    // Hydrate skill docs for convenience
    const out = [] as Array<any>;
    for (const t of tracked) {
      const skill = await ctx.db
        .query("skills")
        .withIndex("by_skill_id", (q) => q.eq("id", t.skillId))
        .first();
      out.push({
        userId: t.userId,
        skillId: t.skillId,
        currentLevel: t.currentLevel,
        order: t.order,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        skill: skill ?? null,
      });
    }
    // Ensure deterministic order
    out.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return out;
  },
});

export const trackSkill = mutation({
  args: {
    userId: v.string(),
    skillId: v.string(),
    order: v.optional(v.number()),
  },
  handler: async (ctx, { userId, skillId, order }) => {
    // Ensure skill exists & active
    const skill = await ctx.db
      .query("skills")
      .withIndex("by_skill_id", (q) => q.eq("id", skillId))
      .first();
    if (!skill) throw new Error("skill not found");
    if (skill.isActive !== true) throw new Error("skill not active");

    // Count existing tracked
    const existingForUser = await ctx.db
      .query("tracked_skills")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    if (existingForUser.length >= 2 && !existingForUser.find((t) => t.skillId === skillId)) {
      throw new Error("maximum of 2 tracked skills per user");
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("tracked_skills")
      .withIndex("by_user_skill", (q) => q.eq("userId", userId).eq("skillId", skillId))
      .first();
    const ord = Number.isFinite(Number(order))
      ? Math.max(1, Math.min(2, Number(order)))
      : Math.min(2, existingForUser.length + 1);

    if (!existing) {
      const id = await ctx.db.insert("tracked_skills", {
        userId,
        skillId,
        currentLevel: 0,
        order: ord,
        createdAt: now,
        updatedAt: now,
      });
      return { created: true, id } as const;
    }

    const doc = { ...existing, order: ord, updatedAt: now };
    await ctx.db.replace(existing._id, doc);
    return { created: false, id: existing._id } as const;
  },
});

export const untrackSkill = mutation({
  args: { userId: v.string(), skillId: v.string() },
  handler: async (ctx, { userId, skillId }) => {
    const existing = await ctx.db
      .query("tracked_skills")
      .withIndex("by_user_skill", (q) => q.eq("userId", userId).eq("skillId", skillId))
      .first();
    if (!existing) return { ok: true, removed: false } as const;
    await ctx.db.delete(existing._id);
    return { ok: true, removed: true } as const;
  },
});

export const setSkillLevel = mutation({
  args: { userId: v.string(), skillId: v.string(), currentLevel: v.number() },
  handler: async (ctx, { userId, skillId, currentLevel }) => {
    if (currentLevel < 0 || currentLevel > 10) throw new Error("currentLevel must be between 0 and 10");

    const existing = await ctx.db
      .query("tracked_skills")
      .withIndex("by_user_skill", (q) => q.eq("userId", userId).eq("skillId", skillId))
      .first();
    if (!existing) throw new Error("skill not tracked");

    const now = Date.now();
    const doc = { ...existing, currentLevel, updatedAt: now };
    await ctx.db.replace(existing._id, doc);
    return { ok: true } as const;
  },
});

export const getSkillById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const skills = await ctx.db
      .query("skills")
      .withIndex("by_skill_id", (q) => q.eq("id", id))
      .collect();
    return skills[0] ?? null;
  },
});

export const getSkillsByCategory = query({
  args: { category: v.string() },
  handler: async (ctx, { category }) => {
    return await ctx.db
      .query("skills")
      .withIndex("by_category", (q) => q.eq("category", category))
      .collect();
  },
});

export const createSkill = mutation({
  args: {
    id: v.string(),
    title: v.string(),
    description: v.string(),
    levels: v.array(
      v.object({
        level: v.number(),
        criteria: v.string(),
        examples: v.optional(v.array(v.string())),
        rubricHints: v.optional(v.array(v.string())),
      })
    ),
    category: v.optional(v.string()),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    // Basic validation
    if (args.levels.length === 0) throw new Error("at least one level required");
    if (args.levels.some((level) => level.level < 1 || level.level > 10)) {
      throw new Error("levels must be between 1 and 10");
    }

    const now = Date.now();
    const doc = {
      ...args,
      createdAt: now,
      updatedAt: now,
    };

    return await ctx.db.insert("skills", doc);
  },
});

export const updateSkill = mutation({
  args: {
    id: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    levels: v.optional(
      v.array(
        v.object({
          level: v.number(),
          criteria: v.string(),
          examples: v.optional(v.array(v.string())),
          rubricHints: v.optional(v.array(v.string())),
        })
      )
    ),
    category: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;

    // Get existing skill
    const existing = await ctx.db
      .query("skills")
      .withIndex("by_skill_id", (q) => q.eq("id", id))
      .first();

    if (!existing) {
      throw new Error("skill not found");
    }

    // Validate levels if being updated
    if (updates.levels) {
      if (updates.levels.length === 0) throw new Error("at least one level required");
      if (updates.levels.some((level) => level.level < 1 || level.level > 10)) {
        throw new Error("levels must be between 1 and 10");
      }
    }

    const now = Date.now();
    const doc = {
      ...existing,
      ...updates,
      updatedAt: now,
    };

    return await ctx.db.replace(existing._id, doc);
  },
});

// V2 Functions for Assessments Migration
export const resolveSkillIdFromHash = query({
  args: {
    skillHash: v.string(),
  },
  handler: async (ctx, { skillHash }) => {
    const salt = process.env.SKILL_HASH_SALT;
    if (!salt) throw new Error("SKILL_HASH_SALT not configured");

    // Get all active skills and find matching hash
    const skills = await ctx.db
      .query("skills")
      .withIndex("by_isActive", (q) => q.eq("isActive", true))
      .collect();

    for (const skill of skills) {
      const expectedHash = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(skill.id + salt)
      ).then(hash => Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0'))
        .join(''));

      if (expectedHash === skillHash) {
        return skill.id;
      }
    }
    return null;
  },
});

export const updateLevelFromRecentAssessments = mutation({
  args: {
    userId: v.string(),
    sessionId: v.string(),
    groupId: v.string(),
    skillHash: v.string(),
  },
  handler: async (ctx, { userId, sessionId, groupId, skillHash }) => {
    const N = Number(process.env.SKILL_LEVEL_AVERAGE_COUNT) || 5;
    const THRESH = Number(process.env.SKILL_LEVEL_INCREMENT_THRESHOLD) || 1.0;

    // Resolve skillId from hash
    const skillId = await ctx.runQuery("skills:resolveSkillIdFromHash", { skillHash });
    if (!skillId) throw new Error("skillHash not found");

    // Get current level
    const tracked = await ctx.db
      .query("tracked_skills")
      .withIndex("by_user_skill", (q) => q.eq("userId", userId).eq("skillId", skillId))
      .first();
    if (!tracked) throw new Error("skill not tracked by user");
    const currentLevel = tracked.currentLevel;

    // Query last N assessments for this (userId, skillHash)
    const assessments = await ctx.db
      .query("assessments")
      .withIndex("by_user_skillHash", (q) => q.eq("userId", userId).eq("skillHash", skillHash))
      .take(N);

    if (assessments.length === 0) return { ok: true, levelChanged: false };

    // Calculate average level
    const avg = assessments.reduce((sum, a) => sum + (a.level ?? 0), 0) / assessments.length;

    if (avg < currentLevel + THRESH) {
      return { ok: true, levelChanged: false };
    }

    // Increment level (max 10)
    const newLevel = Math.min(10, currentLevel + 1);

    // Update tracked_skills
    const now = Date.now();
    await ctx.db.replace(tracked._id, {
      ...tracked,
      currentLevel: newLevel,
      updatedAt: now,
    });

    // Write skill_level_history
    await ctx.db.insert("skill_level_history", {
      userId,
      skillId,
      fromLevel: currentLevel,
      toLevel: newLevel,
      reason: "assessment_average",
      avgSource: avg,
      sessionId,
      groupId,
      createdAt: now,
    });

    // Emit analytics event
    await ctx.db.insert("events", {
      userId,
      sessionId,
      groupId,
      kind: "skill_level_up",
      payload: {
        skillId,
        fromLevel: currentLevel,
        toLevel: newLevel,
        avgSource: avg,
        assessmentCount: assessments.length,
      },
      createdAt: now,
    });

    return { ok: true, levelChanged: true, newLevel };
  },
});

