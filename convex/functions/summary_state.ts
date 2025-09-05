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

    // Retry logic for concurrent modification errors
    const maxRetries = 3;
    let lastError: any;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
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
            version: 1, // Add version field for optimistic locking
          });
          doc = await ctx.db.get(id);
        } else {
          // Optimistic locking: use version field to prevent concurrent modifications
          const currentVersion = doc.version ?? 0;
          const newVersion = currentVersion + 1;

          // Increment counters; treat assistant message as completing a turn
          const turnsSince = (doc.turnsSince ?? 0) + 1;
          const assistantMsgSince = (doc.assistantMsgSince ?? 0) + 1;

          // Use replace instead of patch for atomic update with version check
          const updateResult = await ctx.db.replace(doc._id, {
            ...doc,
            turnsSince,
            assistantMsgSince,
            updatedAt: nowMs,
            version: newVersion,
          });

          if (!updateResult) {
            // Replace failed (likely due to concurrent modification)
            throw new Error("Concurrent modification detected");
          }

          doc = { ...doc, turnsSince, assistantMsgSince, updatedAt: nowMs, version: newVersion };
        }

        const ageSec = doc.lastGeneratedAt > 0 ? Math.floor((nowMs - doc.lastGeneratedAt) / 1000) : Number.MAX_SAFE_INTEGER;
        const moduloDue = doc.assistantMsgSince > 0 && everyN > 0 && (doc.assistantMsgSince % everyN === 0);
        const timeDue = ageSec >= maxAgeSec;
        const dueNow = !!(moduloDue || timeDue);

        let locked = false;
        if (dueNow) {
          const lockUntil = typeof doc.lockUntil === "number" ? doc.lockUntil : 0;
          if (nowMs >= lockUntil) {
            // Update lock with optimistic locking
            const currentVersion = doc.version ?? 0;
            const newVersion = currentVersion + 1;
            const updateResult = await ctx.db.replace(doc._id, {
              ...doc,
              lockUntil: nowMs + lockMs,
              updatedAt: nowMs,
              version: newVersion,
            });

            if (updateResult) {
              locked = true;
              doc = { ...doc, lockUntil: nowMs + lockMs, updatedAt: nowMs, version: newVersion };
            }
          }
        }

        return { dueNow, locked, reason: moduloDue ? "assistant_modulo" : (timeDue ? "time" : null), turnsSince: doc.turnsSince, assistantMsgSince: doc.assistantMsgSince, ageSec } as const;

      } catch (error) {
        lastError = error;

        // Check if this is a concurrent modification error
        const isConcurrentError = error?.message?.includes("changed while") ||
                                 error?.message?.includes("Concurrent modification") ||
                                 error?.message?.includes("replace");

        if (isConcurrentError && attempt < maxRetries - 1) {
          // Retry immediately without delay (setTimeout not allowed in mutations)
          continue;
        }

        // If we've exhausted retries or it's not a concurrent error, rethrow
        throw error;
      }
    }

    // This should not be reached, but just in case
    throw lastError || new Error("Failed to update summary state after retries");
  },
});

export const onGenerated = mutation({
  args: {
    sessionId: v.string(),
    newVersion: v.number(),
    generatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    // Retry logic for concurrent modification errors
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const [doc] = await ctx.db
          .query("summary_state")
          .withIndex("by_session", (q: any) => q.eq("sessionId", args.sessionId))
          .collect();
        if (!doc) return { ok: false } as const;

        // Use optimistic locking
        const currentVersion = doc.version ?? 0;
        const newVersion = currentVersion + 1;

        const updateResult = await ctx.db.replace(doc._id, {
          ...doc,
          lastGeneratedAt: args.generatedAt,
          lastVersion: args.newVersion,
          turnsSince: 0,
          assistantMsgSince: 0,
          lockUntil: 0,
          updatedAt: now(),
          version: newVersion,
        });

        if (!updateResult) {
          if (attempt < maxRetries - 1) {
            // Retry immediately without delay (setTimeout not allowed in mutations)
            continue;
          }
          return { ok: false } as const;
        }

        return { ok: true } as const;

      } catch (error) {
        const isConcurrentError = error?.message?.includes("changed while") ||
                                 error?.message?.includes("Concurrent modification") ||
                                 error?.message?.includes("replace");

        if (isConcurrentError && attempt < maxRetries - 1) {
          const delay = Math.min(100 * Math.pow(2, attempt), 1000);
          // Retry immediately without delay (setTimeout not allowed in mutations)
          continue;
        }

        throw error;
      }
    }

    return { ok: false } as const;
  },
});

export const releaseLock = mutation({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    // Retry logic for concurrent modification errors
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const [doc] = await ctx.db
          .query("summary_state")
          .withIndex("by_session", (q: any) => q.eq("sessionId", args.sessionId))
          .collect();
        if (!doc) return { ok: false } as const;

        // Use optimistic locking
        const currentVersion = doc.version ?? 0;
        const newVersion = currentVersion + 1;

        const updateResult = await ctx.db.replace(doc._id, {
          ...doc,
          lockUntil: 0,
          updatedAt: now(),
          version: newVersion,
        });

        if (!updateResult) {
          if (attempt < maxRetries - 1) {
            // Retry immediately without delay (setTimeout not allowed in mutations)
            continue;
          }
          return { ok: false } as const;
        }

        return { ok: true } as const;

      } catch (error) {
        const isConcurrentError = error?.message?.includes("changed while") ||
                                 error?.message?.includes("Concurrent modification") ||
                                 error?.message?.includes("replace");

        if (isConcurrentError && attempt < maxRetries - 1) {
          const delay = Math.min(100 * Math.pow(2, attempt), 1000);
          // Retry immediately without delay (setTimeout not allowed in mutations)
          continue;
        }

        throw error;
      }
    }

    return { ok: false } as const;
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



