// @ts-nocheck
// Convex Functions — Triage (Stage 1: mock/manual)

import { v } from "convex/values";
import { action, mutation, query } from "../_generated/server";

const AssessmentEnum = v.union(
  v.literal("single_qa_pair"),
  v.literal("roleplay_scenario"),
  v.literal("general_chatter"),
  v.literal("unknown"),
  // Extended provider labels
  v.literal("multi_step_exercise"),
  v.literal("progressive_skill_building"),
  v.literal("skill_practice"),
  v.literal("practice"),
);

export const setResults = mutation({
  args: {
    updates: v.array(v.object({
      sessionId: v.string(),
      messageId: v.string(),
      assessmentType: AssessmentEnum,
      groupId: v.optional(v.string()),
    }))
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let updated = 0;

    for (const u of args.updates) {
      // Find target interaction by (sessionId, messageId)
      const docs = await ctx.db
        .query("interactions")
        .withIndex("by_session", (q: any) => q.eq("sessionId", u.sessionId))
        .collect();
      const target = docs.find((d: any) => String(d?.messageId || "") === u.messageId);
      if (!target) continue;

      const patch: any = {
        assessmentType: u.assessmentType,
        triageProcessedAt: now,
      };
      // Only set groupId if provided (do not overwrite existing otherwise)
      if (typeof u.groupId === 'string' && u.groupId.trim().length > 0) {
        patch.groupId = u.groupId;
      }
      await ctx.db.patch(target._id, patch);
      updated++;
    }

    return { ok: true, updated } as const;
  }
});

export const runForSession = action({
  args: {
    sessionId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const sid = args.sessionId;
    const lim = Math.max(1, Math.min(200, args.limit ?? 20));
    const provider = String(process.env.TRIAGE_PROVIDER || 'mock').toLowerCase();

    // Determine cutoffIndex from latest summary so triage matches the summary batch
    const latest: any = await ctx.runQuery("functions/summaries:getLatest", { sessionId: sid }).catch(() => null);
    const cut = Number(latest?.cutoffIndex);
    const hasCut = Number.isFinite(cut);

    try { console.log(JSON.stringify({ where: 'triage.runForSession.start', sessionId: sid, provider, lim, hasCut, cut })); } catch {}

    if (provider === 'mock') {
      const r = await ctx.runAction("functions/triage:runMockForSession", { sessionId: sid, limit: lim });
      try { console.log(JSON.stringify({ where: 'triage.runForSession.mock', sessionId: sid, updated: (r as any)?.updated, inferred: (r as any)?.inferred })); } catch {}
      return { ok: true, updated: (r as any)?.updated ?? 0, provider: 'mock', inferred: (r as any)?.inferred ?? 'general_chatter' } as const;
    }

    // External provider: call AI API /triage/batch
    const base = String(process.env.AI_API_BASE_URL || process.env.NEXT_PUBLIC_AI_API_BASE_URL || 'http://127.0.0.1:8000');
    const url = base.replace(/\/$/, '') + '/triage/batch';

    // Compute the exact messageIds since cutoff (bounded by limit) so provider can align with summary slice
    const docs = await ctx.runQuery("functions/triage:listBySession", { sessionId: sid }) as any[];
    const withIndex = docs.map((d, i) => ({ i, d }));
    let sinceCut = hasCut ? withIndex.filter(({ i }) => i > (cut as number)).map(({ d }) => d) : docs;
    if (sinceCut.length > lim) sinceCut = sinceCut.slice(-lim);
    const messageIds = sinceCut.map((d: any) => String(d?.messageId || ''));

    try { console.log(JSON.stringify({ where: 'triage.runForSession.callExternal', url, count: messageIds.length, messageIds })); } catch {}

    const controller = new AbortController();
    const timeoutMs = Math.max(500, Math.min(5000, Number(process.env.TRIAGE_TIMEOUT_MS || 4000)));
    const to = setTimeout(() => controller.abort(), timeoutMs);

    let json: any = null;
    let tookMs = 0;
    try {
      const t0 = Date.now();
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: sid, batchSize: lim, cutoffIndex: hasCut ? cut : undefined, messageIds }),
        signal: controller.signal,
      } as any);
      tookMs = Date.now() - t0;
      const text = await res.text();
      try { json = JSON.parse(text); } catch { json = {}; }
      try { console.log(JSON.stringify({ where: 'triage.runForSession.externalResponse', status: res.status, tookMs, textPreview: String(text).slice(0, 400) })); } catch {}
      if (!res.ok) {
        // Fallback to mock if external fails
        const r = await ctx.runAction("functions/triage:runMockForSession", { sessionId: sid, limit: lim });
        try { console.log(JSON.stringify({ where: 'triage.runForSession.fallback.mock', reason: 'non_200', status: res.status, updated: (r as any)?.updated })); } catch {}
        return { ok: true, updated: (r as any)?.updated ?? 0, provider: 'mock_fallback', inferred: (r as any)?.inferred ?? 'general_chatter' } as const;
      }
    } catch (e) {
      try { clearTimeout(to); } catch {}
      try { console.log(JSON.stringify({ where: 'triage.runForSession.externalError', error: String(e) })); } catch {}
      // Timeout or network error — fallback to mock
      const r = await ctx.runAction("functions/triage:runMockForSession", { sessionId: sid, limit: lim });
      try { console.log(JSON.stringify({ where: 'triage.runForSession.fallback.mock', reason: 'exception', updated: (r as any)?.updated })); } catch {}
      return { ok: true, updated: (r as any)?.updated ?? 0, provider: 'mock_fallback', inferred: (r as any)?.inferred ?? 'general_chatter' } as const;
    } finally {
      try { clearTimeout(to); } catch {}
    }

    // Expect AI API to return { updates: [{ messageId, assessmentType, groupId? }], provider?, modelId? }
    const updatesArr: any[] = Array.isArray(json?.updates) ? json.updates : [];
    const providerName = String(json?.provider || provider || 'external');
    const modelId = typeof json?.modelId === 'string' ? json.modelId : undefined;

    try { console.log(JSON.stringify({ where: 'triage.runForSession.parsed', providerName, modelId, updatesLen: updatesArr.length })); } catch {}

    if (updatesArr.length > 0) {
      const updates = updatesArr.map((u) => ({
        sessionId: sid,
        messageId: String(u?.messageId || ''),
        assessmentType: String(u?.assessmentType || 'unknown') as any,
        ...(u?.groupId ? { groupId: String(u.groupId) } : {}),
      }));
      const r = await ctx.runMutation("functions/triage:setResults", { updates });
      try { console.log(JSON.stringify({ where: 'triage.runForSession.persisted', updated: (r as any)?.updated })); } catch {}
      return { ok: true, updated: (r as any)?.updated ?? updates.length, provider: providerName, modelId, tookMs } as const;
    }

    try { console.log(JSON.stringify({ where: 'triage.runForSession.noUpdates', providerName, modelId })); } catch {}
    return { ok: true, updated: 0, provider: providerName, modelId, tookMs } as const;
  }
});

export const listBySession = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("interactions")
      .withIndex("by_session_ts", (q: any) => q.eq("sessionId", args.sessionId))
      .collect();
    docs.sort((a: any, b: any) => (a.ts ?? 0) - (b.ts ?? 0));
    return docs;
  }
});

export const runMockForSession = action({
  args: {
    sessionId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const sid = args.sessionId;
    const lim = Math.max(1, Math.min(200, args.limit ?? 20));

    // Fetch interactions and align with latest summary cutoff so triage matches the summary batch
    const latest: any = await ctx.runQuery("functions/summaries:getLatest", { sessionId: sid }).catch(() => null);
    const cut = Number(latest?.cutoffIndex);
    const hasCut = Number.isFinite(cut);
    const docs = await ctx.runQuery("functions/triage:listBySession", { sessionId: sid }) as any[];
    const withIndex = docs.map((d, i) => ({ i, d }));
    let recent = hasCut ? withIndex.filter(({ i }) => i > (cut as number)).map(({ d }) => d) : docs;
    if (recent.length > lim) recent = recent.slice(-lim);

    // Simple deterministic heuristic:
    // - If sequence contains at least one adjacent user→assistant pair and total turns <= 2: single_qa_pair
    // - If there are 3+ alternating roles: roleplay_scenario
    // - Else: general_chatter
    let alternatingPairs = 0;
    let uaPairs = 0;
    for (let i = 1; i < recent.length; i++) {
      const prev = String(recent[i-1]?.role || "");
      const cur = String(recent[i]?.role || "");
      if (prev !== cur) alternatingPairs++;
      if (prev === 'user' && cur === 'assistant') uaPairs++;
    }
    let inferred: 'single_qa_pair' | 'roleplay_scenario' | 'general_chatter' = 'general_chatter';
    const turns = recent.length;
    if (uaPairs >= 1 && turns <= 2) inferred = 'single_qa_pair';
    else if (alternatingPairs >= 3) inferred = 'roleplay_scenario';

    const updates = recent.map((r: any) => ({
      sessionId: sid,
      messageId: String(r.messageId || ""),
      assessmentType: inferred,
      // Do not set/override groupId here (Stage 1 keeps grouping unchanged)
    }));

    const res = await ctx.runMutation("functions/triage:setResults", { updates });
    return { ok: true, updated: res.updated, inferred } as const;
  }
});
