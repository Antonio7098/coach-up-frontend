import { mutation, query } from "../_generated/server";
import { v } from "convex/values";

export const getLatest = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("session_summaries")
      .withIndex("by_session_createdAt", q => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(1);
    const row = rows[0];
    if (!row) return null;
    return {
      sessionId: row.sessionId,
      version: row.version,
      text: row.text,
      cutoffIndex: row.cutoffIndex,
      inProgress: row.inProgress,
      thresholdTurns: row.thresholdTurns,
      thresholdSeconds: row.thresholdSeconds,
      lastJobAt: row.lastJobAt,
      lastMessageTs: row.lastMessageTs,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      meta: row.meta,
    };
  },
});

export const getStatus = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const sid = args.sessionId;
    const nowMs = Date.now();
    const thresholdTurns = Number(process.env.SUMMARY_GENERATE_ASSISTANT_EVERY_N || 4);
    const thresholdSeconds = Number(process.env.SUMMARY_GENERATE_SECONDS || 120);

    const rows = await ctx.db
      .query("session_summaries")
      .withIndex("by_session_createdAt", q => q.eq("sessionId", sid))
      .order("desc")
      .take(3);

    const latest = rows[0] ?? null;
    const lastCompleted = rows.find((r) => !r.inProgress) ?? null;

    const lastUpdatedAt = Number(lastCompleted?.updatedAt || 0);
    const docs = await ctx.db
      .query("interactions")
      .withIndex("by_session_ts", (q: any) => q.eq("sessionId", sid))
      .collect();

    let assistantSince = 0;
    let transcriptCount = 0;
    for (const d of docs) {
      transcriptCount++;
      const ts = Number(d?.ts || 0);
      if (ts > lastUpdatedAt && String(d?.role) === 'assistant') assistantSince++;
    }

    const ageSec = lastUpdatedAt > 0 ? Math.floor((nowMs - lastUpdatedAt) / 1000) : Number.MAX_SAFE_INTEGER;
    const dueNow = assistantSince >= thresholdTurns || ageSec >= thresholdSeconds;
    const dueReason = assistantSince >= thresholdTurns ? 'turns' : (ageSec >= thresholdSeconds ? 'time' : null);

    return {
      sessionId: sid,
      lastSummary: lastCompleted ? {
        version: lastCompleted.version,
        updatedAt: lastCompleted.updatedAt,
        cutoffIndex: lastCompleted.cutoffIndex,
        text: lastCompleted.text,
      } : null,
      latest: latest ? { version: latest.version, inProgress: !!latest.inProgress } : null,
      assistantSince,
      transcriptCount,
      ageSec,
      thresholdTurns,
      thresholdSeconds,
      dueNow,
      dueReason,
    } as const;
  }
});

export const insert = mutation({
  args: {
    sessionId: v.string(),
    text: v.string(),
    lastMessageTs: v.optional(v.number()),
    meta: v.optional(v.object({
      provider: v.optional(v.string()),
      modelId: v.optional(v.string()),
      tokenBudget: v.optional(v.number()),
    })),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const latest = await ctx.db
      .query("session_summaries")
      .withIndex("by_session_createdAt", q => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(1);
    const nextVersion = latest[0] ? latest[0].version + 1 : 1;
    const id = await ctx.db.insert("session_summaries", {
      sessionId: args.sessionId,
      version: nextVersion,
      text: args.text,
      lastMessageTs: args.lastMessageTs,
      meta: args.meta,
      createdAt: now,
      updatedAt: now,
    });
    return { id, version: nextVersion, updatedAt: now };
  },
});

export const ensureJob = mutation({
  args: {
    sessionId: v.string(),
    nowMs: v.number(),
    thresholdTurns: v.optional(v.number()),
    thresholdSeconds: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    console.log(JSON.stringify({ level: 'info', where: 'summaries.ensureJob.start', sessionId: args.sessionId, nowMs: args.nowMs, thresholdTurns: args.thresholdTurns ?? null, thresholdSeconds: args.thresholdSeconds ?? null }));
    const sid = args.sessionId;
    const nowMs = args.nowMs;
    const thresholdTurns = args.thresholdTurns ?? Number(process.env.SUMMARY_GENERATE_ASSISTANT_EVERY_N || 4);
    const thresholdSeconds = args.thresholdSeconds ?? Number(process.env.SUMMARY_GENERATE_SECONDS || 120);

    // Get latest summary (any row)
    const latestRows = await ctx.db
      .query("session_summaries")
      .withIndex("by_session_createdAt", q => q.eq("sessionId", sid))
      .order("desc")
      .take(3);

    // Find last completed summary (not inProgress)
    const lastCompleted = latestRows.find((r) => !r.inProgress) ?? null;
    const latestSummary = latestRows[0] ?? null;

    const currentVersion = latestSummary?.version ?? 0;
    const nextVersion = currentVersion + 1;

    console.log(JSON.stringify({ level: 'debug', where: 'summaries.ensureJob.latest', hasLatest: !!latestSummary, latestVersion: latestSummary?.version ?? 0, inProgress: !!latestSummary?.inProgress, lastCompletedVersion: lastCompleted?.version ?? 0, lastCompletedUpdatedAt: lastCompleted?.updatedAt ?? 0 }));

    // Handle in-progress reservation state (stale lock clearing)
    if (latestSummary?.inProgress) {
      const staleMs = Number(process.env.SUMMARY_STALE_JOB_MS || 60000);
      const lastJobAt = Number(latestSummary.lastJobAt || 0);
      if (!Number.isFinite(lastJobAt) || lastJobAt <= 0 || (nowMs - lastJobAt) < staleMs) {
        return { accepted: false, reason: "in_progress" } as const;
      }
      await ctx.db.patch(latestSummary._id, { inProgress: false });
    }

    // Compute assistant-only turns since last completed summary (or from session start if none)
    const lastUpdatedAt = Number(lastCompleted?.updatedAt || 0);
    const interactions = await ctx.db
      .query("interactions")
      .withIndex("by_session_ts", (q: any) => q.eq("sessionId", sid))
      .collect();

    let assistantSince = 0;
    let transcriptCount = 0;
    for (const d of interactions) {
      transcriptCount++;
      const ts = Number(d?.ts || 0);
      if (ts > lastUpdatedAt && String(d?.role) === 'assistant') assistantSince++;
    }

    const ageSec = lastUpdatedAt > 0 ? Math.floor((nowMs - lastUpdatedAt) / 1000) : Number.MAX_SAFE_INTEGER;
    const turnsDue = assistantSince >= thresholdTurns;
    const timeDue = ageSec >= thresholdSeconds;
    if (!turnsDue && !timeDue) {
      console.log(JSON.stringify({ level: 'info', where: 'summaries.ensureJob.notDue', sessionId: sid, assistantSince, ageSec, thresholdTurns, thresholdSeconds }));
      return { accepted: false, reason: "not_due" } as const;
    }

    const cutoffIndex = transcriptCount;
    console.log(JSON.stringify({ level: 'debug', where: 'summaries.ensureJob.cutoff', sessionId: sid, cutoffIndex, transcriptCount }));

    // Reserve job
    await ctx.db.insert("session_summaries", {
      sessionId: sid,
      version: nextVersion,
      text: "",
      cutoffIndex,
      inProgress: true,
      thresholdTurns,
      thresholdSeconds,
      lastJobAt: nowMs,
      createdAt: nowMs,
      updatedAt: nowMs,
    });

    console.log(JSON.stringify({ level: 'info', where: 'summaries.ensureJob.accepted', sessionId: sid, version: nextVersion, cutoffIndex, reason: turnsDue ? 'turns' : 'time' }));
    return { accepted: true, version: nextVersion, cutoffIndex, thresholdTurns, thresholdSeconds, reason: turnsDue ? 'turns' : 'time' } as const;
  },
});

export const complete = mutation({
  args: {
    sessionId: v.string(),
    version: v.number(),
    text: v.string(),
    cutoffIndex: v.optional(v.number()),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    console.log(JSON.stringify({ level: 'info', where: 'summaries.complete.start', ...args }));
    const sid = args.sessionId;

    // Find the in-progress summary
    const inProgress = await ctx.db
      .query("session_summaries")
      .withIndex("by_session_version", q => q.eq("sessionId", sid).eq("version", args.version))
      .unique();

    if (!inProgress) {
      console.log(JSON.stringify({ level: 'warn', where: 'summaries.complete.missing', sessionId: sid, version: args.version }));
      return { completed: false, reason: "not_found_or_not_in_progress" } as const;
    }

    // Complete atomically
    await ctx.db.patch(inProgress._id, {
      text: args.text,
      cutoffIndex: args.cutoffIndex ?? inProgress.cutoffIndex,
      inProgress: false,
      updatedAt: args.updatedAt,
    });

    const out = { completed: true, version: args.version, cutoffIndex: args.cutoffIndex ?? inProgress.cutoffIndex } as const;
    console.log(JSON.stringify({ level: 'info', where: 'summaries.complete.done', ...out }));
    return out;
  },
});


