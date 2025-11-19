 
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { requireAuth } from "../../lib/auth";
import { promMetrics } from "../../lib/metrics";
import { makeConvex } from "../../lib/convex";
import * as mockConvex from "../../lib/mockConvex";
import { getBus } from "../../lib/events";
import { getEnvString, getEnvBool } from "../../lib/env";
import { json, badRequest, unauthorized, withTimeout, serverBaseUrl } from "../../lib/http";
import { devLog } from "../../lib/observability";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Request-Id, Authorization",
  "Access-Control-Expose-Headers": "X-Request-Id",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

function safeUUID(): string {
  try {
    const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
    return g.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

function convexBaseUrl() {
  return getEnvString("CONVEX_URL") || getEnvString("NEXT_PUBLIC_CONVEX_URL") || "http://127.0.0.1:3210";
}

export async function POST(request: Request) {
  const headersIn = new Headers(request.headers);
  const requestId = headersIn.get("x-request-id") || safeUUID();
  const routePath = "/api/v1/triage";
  const method = "POST";
  const mode = getEnvString("MOCK_CONVEX") === '1' ? 'mock' : 'convex';
  const endTimer = promMetrics.requestDurationSeconds.startTimer();

  devLog("debug", "triage: POST request initiated", {
    requestId,
    mode,
    timestamp: new Date().toISOString()
  });

  // Helper to emit Convex events for live status tracking
  let sessionId = "";
  let jobId = "";
  const emitEvent = async (kind: string, payload: Record<string, unknown> = {}) => {
    if (!sessionId) return; // Skip if no sessionId yet
    // 1) best-effort: persist to Convex events table
    try {
      if (mode === 'mock') {
        await mockConvex.logEvent({ userId: "unknown", sessionId, requestId, kind, payload });
      } else {
        const client = makeConvex(convexBaseUrl());
        await client.mutation("functions/events:logEvent", { userId: "unknown", sessionId, requestId, kind, payload });
      }
    } catch (e) {
      devLog("warn", "triage: event emission error", {
        sessionId,
        kind,
        error: String(e),
        requestId
      });
    }
    // 2) live SSE bus: map to BusEvent shape
    try {
      const bus = getBus('triage', sessionId);
      // Map underscore kinds to colon kinds for BusEvent consumers
      let type = String(kind || '').replace('triage_', 'triage:');
      // Normalize common variants
      if (type === 'triage:external_response') type = 'triage:externalResponse';
      if (type === 'triage:updates_prepared') type = 'triage:updatesPrepared';
      if (type === 'triage:persist_attempt') type = 'triage:persistAttempt';
      if (type === 'triage:persist_ok') type = 'triage:persistOk';
      if (type === 'triage:persist_zero_updated') type = 'triage:persistZeroUpdated';
      if (type === 'triage:persist_error') type = 'triage:persistError';
      if (type === 'triage:done') {
        // include messageIds/decisions if present
        bus.emit('event', { type, sessionId, ...(payload || {}) });
      } else if (type === 'triage:persistOk') {
        bus.emit('event', { type, sessionId, ...(payload || {}) });
      } else if (type && type.startsWith('triage:')) {
        bus.emit('event', { type, sessionId, ...(payload || {}) });
      }
    } catch {}
  };

  const respond = (status: number, body: unknown) => {
    const labels = { route: routePath, method, status: String(status), mode } as const;
    promMetrics.requestsTotal.labels(labels.route, labels.method, labels.status, labels.mode).inc();
    if (status >= 500) {
      promMetrics.requestErrorsTotal.labels(labels.route, labels.method, labels.status, labels.mode).inc();
    }
    endTimer(labels);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  };

  // Lightweight retry helper for Convex reads (queries/actions)
  async function retryQuery<T>(fn: () => Promise<T>, label: string, attempts = 3, baseDelayMs = 200): Promise<T> {
    let lastErr: any = null;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (e: any) {
        lastErr = e;
        const cause = (e?.cause?.code || e?.cause || '').toString();
        const isTimeout = cause.includes('ETIMEDOUT') || /timeout/i.test(String(e?.message || ''));
        devLog("warn", "triage: retry query failed", {
          label,
          attempt: i + 1,
          attempts,
          cause: cause || null,
          error: String(e?.message || e),
          requestId,
          sessionId
        });
        if (i < attempts - 1 && isTimeout) {
          const delay = baseDelayMs * Math.pow(2, i);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        break;
      }
    }
    throw lastErr;
  }

  // Feature gate (lenient in dev: default to enabled if unspecified)
  const enabledStr = String(getEnvString("AI_TRIAGE_ENABLED") || getEnvString("NEXT_PUBLIC_AI_TRIAGE_ENABLED") || '1').toLowerCase();
  const triageEnabled = (enabledStr === '1' || enabledStr === 'true');
  try { console.log(JSON.stringify({ where: 'ui.api.triage.gate', enabledStr, triageEnabled })); } catch {}
  if (!triageEnabled) {
    // Soft-return: allow the rest of the code to run fallback persistence for robustness, but mark disabled mode
    // Note: we won't early-return 404 to avoid stuck PENDING in dev.
  }
  try {
    const envLog = {
      where: 'ui.api.triage.env',
      mode,
      providerUi: String(getEnvString("TRIAGE_PROVIDER") || getEnvString("NEXT_PUBLIC_TRIAGE_PROVIDER") || '').toLowerCase(),
      hasAiBase: Boolean(getEnvString("AI_API_BASE_URL") || getEnvString("NEXT_PUBLIC_AI_API_BASE_URL")),
      clerkEnabled: String(getEnvString("CLERK_ENABLED") || '').toLowerCase(),
      onUserIngest: String(getEnvString("TRIAGE_ON_USER_INGEST") || '').toLowerCase(),
      onSummary: String(getEnvString("TRIAGE_ON_SUMMARY") || '').toLowerCase(),
    };
    console.log(JSON.stringify(envLog));
  } catch {}

  // Optional auth gating via CLERK_ENABLED
  const auth = await requireAuth(request);
  try { console.log(JSON.stringify({ where: 'ui.api.triage.auth', ok: auth.ok, reason: (auth as any)?.reason || null })); } catch {}
  if (!auth.ok) {
    return respond(401, { error: "Unauthorized" });
  }

  try {
    const url = new URL(request.url);
    sessionId = url.searchParams.get("sessionId") || "";
    const limitParam = url.searchParams.get("limit");
    const cutoffParam = url.searchParams.get("cutoffIndex");
    const limit = Math.max(1, Math.min(200, Number.isFinite(Number(limitParam)) ? Number(limitParam) : 20));
    const cutoffOverride = Number.isFinite(Number(cutoffParam)) ? Number(cutoffParam) : undefined;
    if (!sessionId) return respond(400, { error: "sessionId is required" });

    // Optional body override for explicit messageIds (e.g., last 2 on user ingest)
    let overrideMessageIds: string[] = [];
    // Enqueue triage job (coalesced) before starting
    try {
      const client = makeConvex(convexBaseUrl());
      const ej: any = await client.mutation("functions/triage:enqueueJob", { sessionId, reason: 'user_ingest', messageIds: [], requestId });
      jobId = String(ej?.jobId || '');
    } catch {}

    // Emit triage start event
    await emitEvent("triage_start", { limit, cutoffIndex: cutoffOverride, jobId });
    try {
      const json = await request.json().catch(() => ({} as any));
      const arr = Array.isArray((json as any)?.messageIds) ? (json as any).messageIds : [];
      overrideMessageIds = arr.map((s: any) => String(s || '')).filter((s: string) => s.length > 0);
      try { console.log(JSON.stringify({ where: 'ui.api.triage.request', sessionId, overrideCount: overrideMessageIds.length })); } catch {}
      
      if (overrideMessageIds.length > 0) {
        await emitEvent("triage_queued", { messageIds: overrideMessageIds.length, jobId });
      }
    } catch {}

    // In mock mode, if AI_API_BASE_URL is missing or explicitly disabled, fall back to synchronous mock; otherwise use external path below
    if (mode === 'mock' && !(getEnvString("AI_API_BASE_URL") || getEnvString("NEXT_PUBLIC_AI_API_BASE_URL"))) {
      // In mock mode, persist assessmentType/triageProcessedAt on the specified messageIds (or last 2)
      try {
        const docs: any[] = await mockConvex.listTailBySession({ sessionId, limit: Math.max(2, limit) }) as any[];
        let targets: any[] = [];
        if (overrideMessageIds.length > 0) {
          const msgSet = new Set(overrideMessageIds);
          targets = (Array.isArray(docs) ? docs : []).filter(d => msgSet.has(String(d?.messageId || '')));
        } else {
          targets = (Array.isArray(docs) ? docs : []).slice(-Math.min(2, Math.max(1, limit)));
        }
        // Infer simple type
        let inferred: 'single_qa_pair' | 'roleplay_scenario' | 'general_chatter' = 'general_chatter';
        if (targets.length >= 2) {
          const a = String(targets[targets.length - 2]?.role || '');
          const b = String(targets[targets.length - 1]?.role || '');
          inferred = (a !== b && (a === 'user' || a === 'assistant') && (b === 'user' || b === 'assistant')) ? 'single_qa_pair' : 'general_chatter';
        } else if (targets.length === 1) {
          inferred = String(targets[0]?.role || '') === 'user' ? 'single_qa_pair' : 'general_chatter';
        }
        const groupId = `mock_grp_${Date.now()}`;
        const updates = targets.map(t => ({ messageId: String(t?.messageId || ''), assessmentType: inferred as any, groupId }));
        await emitEvent("triage_persist_attempt", { updatesLen: updates.length });
        const persisted = await mockConvex.setTriageResults({ sessionId, updates });
        await emitEvent("triage_persist_ok", { updated: persisted?.updated || 0, messageIds: updates.map(u => u.messageId), decisions: { assess: inferred !== 'general_chatter' ? updates.length : 0, not_assess: inferred === 'general_chatter' ? updates.length : 0 } });
        try { console.log(JSON.stringify({ where: 'ui.api.triage.mock.persisted', sessionId, count: updates.length, updated: persisted?.updated, inferred })); } catch {}
        await emitEvent("triage_done", { updated: Number(persisted?.updated || 0), provider: 'mock', messageIds: updates.map(u => u.messageId), decisions: { assess: inferred !== 'general_chatter' ? updates.length : 0, not_assess: inferred === 'general_chatter' ? updates.length : 0 } });
        return respond(200, { updated: Number(persisted?.updated || 0), inferred, provider: 'mock', mode: 'mock', messageIds: updates.map(u => u.messageId), decisions: { assess: inferred !== 'general_chatter' ? updates.length : 0, not_assess: inferred === 'general_chatter' ? updates.length : 0 } });
      } catch (e) {
        try { console.warn(JSON.stringify({ where: 'ui.api.triage.mock.error', sessionId, error: String(e) })); } catch {}
        await emitEvent("triage_persist_error", { error: String(e) });
        await emitEvent("triage_done", { updated: 0, provider: 'mock_error' });
        return respond(200, { updated: 0, inferred: 'general_chatter', provider: 'mock', mode: 'mock_error' });
      }
    }

    const client = makeConvex(convexBaseUrl());

    // Decide where to perform triage: outside Convex (here) or inside Convex action.
    const providerUi = String(getEnvString("TRIAGE_PROVIDER") || getEnvString("NEXT_PUBLIC_TRIAGE_PROVIDER") || '').toLowerCase();
    const aiBase = String(getEnvString("AI_API_BASE_URL") || getEnvString("NEXT_PUBLIC_AI_API_BASE_URL") || '');

    if (providerUi === 'external' && aiBase) {
      const since0 = Date.now();
      // 1) Gather messageIds for this session (or use override)
      let messageIds: string[] = [];
      if (overrideMessageIds.length > 0) {
        messageIds = overrideMessageIds;
        try { console.log(JSON.stringify({ where: 'ui.api.triage.external.usingOverrideIds', sessionId, count: messageIds.length })); } catch {}
        // If only a single user message is provided, include the immediately preceding assistant message to form a pair
        try {
          if (messageIds.length === 1) {
            const targetId = messageIds[0];
            if (mode === 'mock') {
              const interactions: any[] = await mockConvex.listTailBySession({ sessionId }) as any[];
              const idx = interactions.findIndex((d: any) => String(d?.messageId || '') === targetId);
              if (idx > 0) {
                const prev = interactions[idx - 1];
                if (String(prev?.role || '') === 'assistant') {
                  messageIds = [String(prev?.messageId || ''), targetId];
                }
              }
            } else {
              const interactions = await retryQuery<any[]>(() => client.query("functions/triage:listTailBySession", { sessionId }) as any, 'triage:listTailBySession');
              const idx = interactions.findIndex((d: any) => String(d?.messageId || '') === targetId);
              if (idx > 0) {
                const prev = interactions[idx - 1];
                if (String(prev?.role || '') === 'assistant') {
                  messageIds = [String(prev?.messageId || ''), targetId];
                }
              }
            }
          }
        } catch {}
      } else {
        if (mode === 'mock') {
          const interactions: any[] = await mockConvex.listTailBySession({ sessionId }) as any[];
          let recent = interactions;
          if (recent.length > limit) recent = recent.slice(-limit);
          messageIds = recent.map((d: any) => String(d?.messageId || ''));
        } else {
          const interactions = await retryQuery<any[]>(() => client.query("functions/triage:listTailBySession", { sessionId }) as any, 'triage:listTailBySession');
          // Optional: align with provided cutoffIndex (from reservation) or latest summary cutoff
          let cutoffIndex: number | undefined = cutoffOverride;
          if (cutoffIndex === undefined) {
            try {
              const latest: any = await retryQuery<any>(() => client.query("functions/summaries:getLatest", { sessionId }) as any, 'summaries:getLatest').catch(() => null);
              const cut = Number(latest?.cutoffIndex);
              if (Number.isFinite(cut)) cutoffIndex = cut as number;
            } catch {}
          }
          let recent = interactions;
          if (typeof cutoffIndex === 'number') {
            recent = interactions.map((d, i) => ({ i, d })).filter(({ i }) => i > cutoffIndex!).map(({ d }) => d);
          }
          if (recent.length > limit) recent = recent.slice(-limit);
          messageIds = recent.map((d: any) => String(d?.messageId || ''));
        }
      }

      const url = aiBase.replace(/\/$/, '') + '/triage/batch';

      // Synchronous override path: proceed to call external and persist in this request
      // (removed background fast-path to ensure immediate persistence/assessment)
      let json: any = null;
      let status = 0;
      let tookMs = 0;
      try {
        const t0 = Date.now();
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, batchSize: messageIds.length || limit, messageIds }),
        } as RequestInit);
        tookMs = Date.now() - t0;
        const text = await res.text();
        status = res.status;
        try { json = JSON.parse(text); } catch { json = {}; }
        try {
          console.log(JSON.stringify({ where: 'ui.api.triage.externalResponse', sessionId, status, tookMs, url, textPreview: String(text).slice(0, 300) }));
        } catch {}
        
        // Emit external response event
        await emitEvent("triage_external_response", { status, tookMs });
        
        if (!res.ok) throw new Error(`AI API non-200: ${res.status}`);
      } catch (e) {
        // Fallback: call Convex action (may run mock)
        const took0 = Date.now();
        const fallbackRes = await (client as any).action("functions/triage:runForSession", { sessionId, limit }) as any;
        const tookMsFb = Date.now() - took0;
        try {
          console.warn(JSON.stringify({ where: 'ui.api.triage.externalError', sessionId, error: String(e), fallbackProvider: fallbackRes?.provider, updated: fallbackRes?.updated, tookMs: tookMsFb }));
        } catch {}
        return respond(200, { updated: Number(fallbackRes?.updated || 0), inferred: fallbackRes?.inferred || null, provider: fallbackRes?.provider || 'mock_fallback', modelId: fallbackRes?.modelId || null, tookMs: tookMsFb, mode: 'fallback' });
      }

        // Mark job running
        try { if (jobId) { await client.mutation("functions/triage:updateJobStatus", { jobId, status: 'running' }); } } catch {}

        // Persist updates back to Convex (or mockConvex in mock mode)
      const updatesArr: any[] = Array.isArray(json?.updates) ? json.updates : [];
      let updates = updatesArr.map((u) => ({
        sessionId,
        messageId: String(u?.messageId || ''),
        assessmentType: String(u?.assessmentType || 'unknown') as any,
        ...(u?.groupId ? { groupId: String(u.groupId) } : {}),
      }));

      // Ensure each update has a groupId so the orchestrator can run (except general_chatter)
      try {
        const assessableUpdates = updates.filter(u => String((u as any)?.assessmentType || '') !== 'general_chatter');
        const missing = assessableUpdates.filter(u => !(u as any).groupId).length;
        if (assessableUpdates.length > 0 && missing > 0) {
          const ts = Date.now();
          const inferred = String((assessableUpdates[0] as any)?.assessmentType || 'unknown');
          const generatedGroupId = `${sessionId}:batch:${ts}:${inferred}`;
          updates = updates.map(u => {
            const assessmentType = String((u as any)?.assessmentType || '');
            // Only assign groupId to non-general_chatter messages
            if (assessmentType === 'general_chatter') {
              return u; // Keep as-is, no groupId
            }
            return (u as any).groupId ? u : { ...u, groupId: generatedGroupId };
          });
          console.log(JSON.stringify({ where: 'ui.api.triage.external.groupId.filled', sessionId, missing, generatedGroupId, skippedGeneralChatter: updates.filter(u => String((u as any)?.assessmentType || '') === 'general_chatter').length }));
        }
      } catch {}

      try {
        const preview = updates.slice(0, 3);
        console.log(JSON.stringify({ where: 'ui.api.triage.external.updatesPrepared', sessionId, updatesLen: updates.length, preview }));
      } catch {}
      
      // Emit updates prepared event
      await emitEvent("triage_updates_prepared", { updatesLen: updates.length });

      let persisted: any = { updated: 0 };
      if (updates.length > 0) {
        try {
          console.log(JSON.stringify({ where: 'ui.api.triage.external.persist.attempt', sessionId, mode, convexUrl: convexBaseUrl(), updatesLen: updates.length }));
        } catch {}
        
        // Emit persist attempt event
        await emitEvent("triage_persist_attempt", { updatesLen: updates.length });
        
        try {
          if (mode === 'mock') {
            persisted = await mockConvex.setTriageResults({ sessionId, updates });
          } else {
            persisted = await client.mutation("functions/triage:setResults", { updates });
          }
          try {
            console.log(JSON.stringify({ where: 'ui.api.triage.external.persist.ok', sessionId, updated: persisted?.updated || 0, messageIds: (persisted as any)?.messageIds, decisions: (persisted as any)?.decisions }));
          } catch {}
          
// Emit persist success event
          await emitEvent("triage_persist_ok", { updated: persisted?.updated || 0, messageIds: (persisted as any)?.messageIds || [], decisions: (persisted as any)?.decisions || null, jobId });
          try { if (jobId) { await client.mutation("functions/triage:updateJobStatus", { jobId, status: 'persisted', updatedCount: Number(persisted?.updated || 0), decisions: (persisted as any)?.decisions || undefined }); } } catch {}

          // NEW: Trigger assessments on triage persist (env-gated)
          try {
            const gate = String(getEnvString("ASSESS_ON_TRIAGE") || '1');
            const shouldRun = gate === '1' || gate.toLowerCase() === 'true';
            if (shouldRun) {
              const authz = headersIn.get('authorization') || headersIn.get('Authorization') || '';
              const groupIdsFromUpdates = (updates || [])
                .filter((u) => {
                  const assessmentType = String((u as any)?.assessmentType || '');
                  // Skip general_chatter - it should not be assessed
                  return assessmentType !== 'general_chatter';
                })
                .map((u) => String((u as any)?.groupId || ''))
                .filter((g) => g);
              const uniq = Array.from(new Set(groupIdsFromUpdates));
              if (uniq.length > 0) {
                try { console.log(JSON.stringify({ where: 'ui.api.triage.assess.autorun', sessionId, groups: uniq.length, groupIds: uniq })); } catch {}
                try {
                  const { finalizeAssessmentsForGroups } = await import('../../assessments/orchestrator');
                  await finalizeAssessmentsForGroups({
                    sessionId,
                    groupIds: uniq,
                    requestId,
                    authz,
                  logger: async (kind, payload) => { await emitEvent(kind, payload || {}); },
                });
                try { console.log(JSON.stringify({ where: 'ui.api.triage.assess.autorun.success', sessionId, groups: uniq.length })); } catch {}
              } catch (assessError) {
                try { console.error(JSON.stringify({ where: 'ui.api.triage.assess.autorun.error', sessionId, groups: uniq.length, error: (assessError as Error).message, stack: (assessError as Error).stack?.split('\n')[0] })); } catch {}
              }
              }
            }
          } catch (e) {
            try { console.warn(JSON.stringify({ where: 'ui.api.triage.assess.autorun.error', sessionId, error: String(e) })); } catch {}
          }
          
          if ((persisted?.updated || 0) === 0) {
            try { console.warn(JSON.stringify({ where: 'ui.api.triage.external.persist.zeroUpdated', sessionId, updatesLen: updates.length })); } catch {}
            await emitEvent("triage_persist_zero_updated", { updatesLen: updates.length });
          }
        } catch (e) {
          try {
            console.warn(JSON.stringify({ where: 'ui.api.triage.external.persist.error', sessionId, error: String(e) }));
          } catch {}
          
          // Emit persist error event
          await emitEvent("triage_persist_error", { error: String(e), jobId });
          try { if (jobId) { await client.mutation("functions/triage:updateJobStatus", { jobId, status: 'failed', updatedCount: 0, error: String(e) }); } } catch {}
          
          // surface a 200 with zero updated, but mark mode
          persisted = { updated: 0, error: String(e) };
        }
      } else {
        // External returned no updates — persist a default triage to unblock UI (mark as general_chatter)
        try { console.warn(JSON.stringify({ where: 'ui.api.triage.external.updatesEmpty', sessionId, action: 'default_persist' })); } catch {}
        try {
          // Determine targets: prefer provided override messageIds; otherwise, take the last 2 interactions
          let targets: { messageId: string }[] = [];
          if (overrideMessageIds.length > 0) {
            targets = overrideMessageIds.map(m => ({ messageId: m }));
          } else {
            if (mode === 'mock') {
              const docs: any[] = await mockConvex.listTailBySession({ sessionId, limit: Math.max(2, limit) }) as any[];
              const recent = (Array.isArray(docs) ? docs : []).slice(-2);
              targets = recent.map(d => ({ messageId: String(d?.messageId || '') })).filter(t => t.messageId);
            } else {
              const docs: any[] = await retryQuery<any[]>(() => client.query("functions/triage:listTailBySession", { sessionId }) as any, 'triage:listTailBySession');
              const recent = (Array.isArray(docs) ? docs : []).slice(-2);
              targets = recent.map(d => ({ messageId: String(d?.messageId || '') })).filter(t => t.messageId);
            }
          }

          // Resolve roles for targets and filter to role === 'user' to avoid marking assistant turns
          try {
            if (targets.length > 0) {
              // If explicit overrides provided, we assume they are user messages from ingest; skip extra reads.
              if (overrideMessageIds.length === 0) {
                if (mode === 'mock') {
                  const docs: any[] = await mockConvex.listTailBySession({ sessionId, limit: Math.max(10, limit) }) as any[];
                  const roleById = new Map<string, string>();
                  for (const d of (Array.isArray(docs) ? docs : [])) {
                    const mid = String(d?.messageId || '');
                    if (mid) roleById.set(mid, String(d?.role || ''));
                  }
                  targets = targets.filter(t => roleById.get(t.messageId) === 'user');
                } else {
                  const docs: any[] = await retryQuery<any[]>(() => client.query("functions/triage:listTailBySession", { sessionId }) as any, 'triage:listTailBySession');
                  const roleById = new Map<string, string>();
                  for (const d of (Array.isArray(docs) ? docs : [])) {
                    const mid = String(d?.messageId || '');
                    if (mid) roleById.set(mid, String(d?.role || ''));
                  }
                  targets = targets.filter(t => roleById.get(t.messageId) === 'user');
                }
              }
            }
          } catch {}

          // Build default updates (user-only) - general_chatter gets no groupId
          const nowTag = `${Date.now()}`;
          const defaultUpdates = targets.map(t => ({
            sessionId,
            messageId: t.messageId,
            assessmentType: 'general_chatter' as any,
            // No groupId for general_chatter - it should not be assessed
          }));

          // Persist defaults
          if (defaultUpdates.length > 0) {
            await emitEvent("triage_persist_attempt", { updatesLen: defaultUpdates.length, provider: 'default' });
            if (mode === 'mock') {
              persisted = await mockConvex.setTriageResults({ sessionId, updates: defaultUpdates });
            } else {
              persisted = await client.mutation("functions/triage:setResults", { updates: defaultUpdates });
            }
            // Include a per-event decisions count to help UI clear PENDING deterministically
            const messageIdsOut = (persisted as any)?.messageIds || defaultUpdates.map(u => u.messageId);
            const decisionsOut = (persisted as any)?.decisions || { assess: 0, not_assess: messageIdsOut.length };
            await emitEvent("triage_persist_ok", { updated: persisted?.updated || 0, provider: 'default', messageIds: messageIdsOut, decisions: decisionsOut, jobId });
            try { if (jobId) { await client.mutation("functions/triage:updateJobStatus", { jobId, status: 'persisted', updatedCount: Number(persisted?.updated || 0), decisions: decisionsOut }); } } catch {}

            // Skip assessments for default triage - general_chatter should not be assessed
            try { console.log(JSON.stringify({ where: 'ui.api.triage.assess.autorun.default.skipped', sessionId, reason: 'general_chatter_no_groupId' })); } catch {}
          } else {
            // Nothing to persist, but still mark done to unblock any spinners
            persisted = { updated: 0, provider: 'default' };
            await emitEvent("triage_persist_zero_updated", { updatesLen: 0, provider: 'default' });
          }
        } catch (e) {
          try { console.warn(JSON.stringify({ where: 'ui.api.triage.external.updatesEmpty.persistError', sessionId, error: String(e) })); } catch {}
          await emitEvent("triage_persist_error", { error: String(e), jobId });
          try { if (jobId) { await client.mutation("functions/triage:updateJobStatus", { jobId, status: 'failed', updatedCount: 0, error: String(e) }); } } catch {}
        }
      }

      try {
        console.log(JSON.stringify({ where: 'ui.api.triage.external.persisted', sessionId, limit, convexUrl: convexBaseUrl(), provider: 'external', modelId: json?.modelId || null, updatesLen: updates.length, updated: persisted?.updated || 0, tookMs, endToEndMs: Date.now() - since0 }));
      } catch {}

      // Emit triage done event
      await emitEvent("triage_done", { updated: Number(persisted?.updated || 0), provider: (persisted?.provider || 'external'), tookMs, messageIds: (persisted as any)?.messageIds || [], decisions: (persisted as any)?.decisions || null, jobId });

      return respond(200, { updated: Number(persisted?.updated || 0), inferred: null, provider: String(json?.provider || (persisted?.provider || 'external')), modelId: typeof json?.modelId === 'string' ? json.modelId : null, tookMs, messageIds: (persisted as any)?.messageIds || [], decisions: (persisted as any)?.decisions || null, jobId });
    }

    // Default path: run inside Convex (may be mock or external depending on Convex env)
    // Fallback path: if explicit messageIds were provided but external triage is disabled or failed above,
    // we still run the Convex action on a small window (limit set to messageIds.length or provided limit)
    const took0 = Date.now();
    const effLimit = Array.isArray(overrideMessageIds) && overrideMessageIds.length > 0 ? overrideMessageIds.length : limit;
    try { console.log(JSON.stringify({ where: 'ui.api.triage.convexFallback', sessionId, effLimit, hadOverride: (overrideMessageIds.length > 0) })); } catch {}
    try { if (jobId) { await client.mutation("functions/triage:updateJobStatus", { jobId, status: 'running' }); } } catch {}
    const res = await client.mutation("functions/triage:runForSession", { sessionId, limit: effLimit });
    const tookMs = Date.now() - took0;
    try {
      console.log(JSON.stringify({ where: 'ui.api.triage', sessionId, limit, convexUrl: convexBaseUrl(), result: { updated: res?.updated, inferred: res?.inferred, provider: res?.provider, modelId: res?.modelId, tookMs } }));
    } catch {}
    
    // Emit triage done event for convex fallback
    await emitEvent("triage_done", { updated: Number(res?.updated || 0), provider: res?.provider || 'convex', tookMs, messageIds: (res as any)?.messageIds || [], decisions: (res as any)?.decisions || null, jobId });
      
      return respond(200, { updated: Number(res?.updated || 0), inferred: res?.inferred || null, provider: res?.provider || null, modelId: res?.modelId || null, tookMs, messageIds: (res as any)?.messageIds || [], decisions: (res as any)?.decisions || null, jobId });
  } catch (err: unknown) {
    try { console.error('[triage] POST failed', err); } catch {}
    return respond(502, { error: "Convex action failed" });
  }
}
