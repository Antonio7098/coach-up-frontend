 
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { requireAuth } from "../../lib/auth";
import { promMetrics } from "../../lib/metrics";
import { makeConvex } from "../../lib/convex";
import * as mockConvex from "../../lib/mockConvex";
import { clientKeyFromHeaders, rateLimit } from "../../lib/ratelimit";
import { generateSummaryText } from "../../lib/summarizer";
import { getLatestSummary, upsertSummary } from "../../lib/summaries";
import { sha256Hex } from "../../lib/hash";
import { devLog } from "../../lib/observability";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Request-Id, Authorization, Idempotency-Key",
  "Access-Control-Expose-Headers": "X-Request-Id, Idempotency-Key",
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
  return process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL || "http://127.0.0.1:3210";
}

function aiApiBaseUrl() {
  return (
    process.env.AI_API_BASE_URL ||
    process.env.NEXT_PUBLIC_AI_API_BASE_URL ||
    "http://127.0.0.1:8000"
  );
}

// Compact lite endpoint for frequent polling
export async function GET(request: Request) {
  const urlObj = new URL(request.url);
  const isLite = urlObj.pathname.endsWith('/lite') || urlObj.searchParams.get('lite') === 'true';
  const headersIn = new Headers(request.headers);
  const requestId = headersIn.get("x-request-id") || safeUUID();
  const started = Date.now();

  devLog("debug", "session-summary: GET request initiated", {
    requestId,
    isLite,
    sessionId: urlObj.searchParams.get("sessionId") || "missing",
    timestamp: new Date().toISOString()
  });

  const idempotencyKey = headersIn.get("idempotency-key") || headersIn.get("Idempotency-Key") || "";
  const routePath = "/api/v1/session-summary";
  const method = "GET";
  const mode = process.env.MOCK_CONVEX === '1' ? 'mock' : 'convex';
  const endTimer = promMetrics.requestDurationSeconds.startTimer();

  const respond = (status: number, body: unknown, extraHeaders?: Record<string, string>) => {
    const labels = { route: routePath, method, status: String(status), mode } as const;
    promMetrics.requestsTotal.labels(labels.route, labels.method, labels.status, labels.mode).inc();
    if (status >= 500) {
      promMetrics.requestErrorsTotal.labels(labels.route, labels.method, labels.status, labels.mode).inc();
    }
    endTimer(labels);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}), ...corsHeaders, ...(extraHeaders || {}) },
    });
  };

  // Rate limit per client (best-effort; in-memory only)
  const rlKey = clientKeyFromHeaders(headersIn);
  const rl = rateLimit(`session-summary:${rlKey}`);
  if (!rl.ok) {
    const labels = { route: routePath, method, status: '429', mode } as const;
    promMetrics.rateLimitedTotal.labels(labels.route, labels.method, labels.status, labels.mode).inc();
    return respond(429, { error: "Rate limit exceeded" }, { "Retry-After": String((rl as any).retryAfterSec), "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.resetSec) });
  }

  // Optional auth gating via CLERK_ENABLED
  const auth = await requireAuth(request);
  if (!auth.ok) {
    return respond(401, { error: "Unauthorized" }, { "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.resetSec) });
  }

  const sessionId = urlObj.searchParams.get("sessionId") || "";
  if (!sessionId) {
    return respond(400, { error: "sessionId is required" }, { "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.resetSec) });
  }

  try {
    if (mode === 'mock') {
      // Helper: derive cadence like prod (assistantSince, thresholdTurns)
      // Match prod: assistantSince since last completed summary
      const deriveCadence = async (): Promise<{ turnsSince?: number; thresholdTurns?: number; interactions?: any[]; msgsSinceCutoff?: Array<{ role: string; text: string }> }> => {
        try {
          const last = getLatestSummary(sessionId);
          const cutoffTs = typeof last?.updatedAt === 'number' ? last!.updatedAt : 0;
          // Load recent interactions from mock store
          const docs: any[] = await mockConvex.listInteractionsBySession({ sessionId, limit: 300 }) as any[];
          const arr = Array.isArray(docs) ? docs : [];
          // assistantSince: assistant messages strictly after last summary
          const after = cutoffTs > 0 ? arr.filter(d => Number(d?.ts || 0) > cutoffTs) : arr;
          const assistantSince = after.filter(d => String(d?.role||'') === 'assistant').length;
          const thr = Math.max(1, Math.min(20, Number(process.env.NEXT_PUBLIC_SUMMARY_REFRESH_TURNS || 4)));
          const msgsSinceCutoff = after.map(d => ({ role: String(d?.role||''), text: String(d?.text||'') })).filter(m => m.text);
          return { turnsSince: assistantSince, thresholdTurns: thr, interactions: arr, msgsSinceCutoff };
        } catch { return {}; }
      };

      // Lite mode in mock: provide cadence and last summary preview like prod
      if (isLite) {
        const cadence = await deriveCadence();
        const last = getLatestSummary(sessionId);
        const updatedAt = last ? last.updatedAt : 0;
        const due = typeof cadence.turnsSince === 'number' && typeof cadence.thresholdTurns === 'number'
          ? cadence.turnsSince >= cadence.thresholdTurns : false;
        const litePayload = {
          sessionId,
          due,
          lastSummary: last ? {
            version: last.version ?? 0,
            cutoffIndex: undefined as number | undefined,
            updatedAt,
            preview: String(last.text || '').substring(0, 100) + (String(last.text || '').length > 100 ? '...' : '')
          } : null,
          reservation: {
            inProgress: false,
            lastJobAt: undefined as number | undefined,
          },
          turnsSince: cadence.turnsSince ?? 0,
        } as const;
        return respond(200, litePayload, {
          "X-RateLimit-Limit": String(rl.limit),
          "X-RateLimit-Remaining": String(rl.remaining),
          "X-RateLimit-Reset": String(rl.resetSec)
        });
      }

      // First try to get server summary from AI API for complete metadata'},
      try {
        const serverRes = await fetch(`${aiApiBaseUrl()}/api/v1/session-summary?sessionId=${encodeURIComponent(sessionId)}`, {
          method: 'GET',
          headers: { 'x-request-id': requestId }
        });
        if (serverRes.ok) {
          const serverData = await serverRes.json();

          // Load local (mock) latest summary as well
          const localRow = getLatestSummary(sessionId);

          // Decide which cutoff to use for cadence: prefer the freshest known cutoff
          const serverUpdatedAt = Number(serverData?.updatedAt || 0) || 0;
          const localUpdatedAt = Number(localRow?.updatedAt || 0) || 0;
          const cutoffTs = Math.max(serverUpdatedAt, localUpdatedAt);

          // Prefer server-provided counters; otherwise compute using chosen cutoff
          let turnsSince: number | undefined = typeof serverData?.turnsSince === 'number' ? serverData.turnsSince : undefined;
          let thresholdTurns: number | undefined = typeof serverData?.thresholdTurns === 'number' ? serverData.thresholdTurns : undefined;
          let messagesSinceCutoff: Array<{ role: string; text: string }> | undefined = undefined;

          try {
            const docs: any[] = await mockConvex.listInteractionsBySession({ sessionId, limit: 300 }) as any[];
            const arr = Array.isArray(docs) ? docs : [];
            const after = cutoffTs > 0 ? arr.filter(d => Number(d?.ts || 0) > cutoffTs) : arr;
            const assistantSince = after.filter(d => String(d?.role||'') === 'assistant').length;
            if (turnsSince === undefined) turnsSince = assistantSince;
            const thr = Math.max(1, Math.min(20, Number(process.env.NEXT_PUBLIC_SUMMARY_REFRESH_TURNS || 4)));
            if (thresholdTurns === undefined) thresholdTurns = thr;
            messagesSinceCutoff = after.map(d => ({ role: String(d?.role||''), text: String(d?.text||'') })).filter(m => m.text);
          } catch {}

          const turnsUntilDue = typeof turnsSince === 'number' && typeof thresholdTurns === 'number' ? Math.max(0, thresholdTurns - turnsSince) : undefined;

          // Choose payload source for text/updatedAt/version: prefer local if fresher or server has no text
          const serverText = String((serverData?.summaryText ?? serverData?.text ?? ''));
          const useLocal = !!localRow && (localUpdatedAt >= serverUpdatedAt || !serverText);

          const payload = useLocal ? {
            sessionId,
            text: String(localRow?.text || ''),
            lastMessageTs: typeof localRow?.lastMessageTs === 'number' ? localRow!.lastMessageTs : undefined,
            updatedAt: localUpdatedAt || Date.now(),
            version: typeof localRow?.version === 'number' ? localRow!.version : 1,
            thresholdTurns,
            turnsSince,
            turnsUntilDue,
            cutoffIndex: undefined as number | undefined,
            inProgress: false,
            secondsSince: (localUpdatedAt > 0 ? Math.max(0, Math.floor((Date.now() - localUpdatedAt) / 1000)) : undefined),
            messagesSinceCutoff,
            messagesSinceCutoffPreview: Array.isArray(messagesSinceCutoff) ? messagesSinceCutoff.slice(0,12).map(m => `${m.role}: ${m.text.length>160?m.text.slice(0,157)+'…':m.text}`) : undefined,
          } : {
            sessionId,
            text: serverText,
            lastMessageTs: typeof serverData?.lastMessageTs === 'number' ? serverData.lastMessageTs : undefined,
            updatedAt: serverUpdatedAt || Date.now(),
            version: typeof serverData?.version === 'number' ? serverData.version : 1,
            thresholdTurns,
            turnsSince,
            turnsUntilDue,
            cutoffIndex: typeof serverData?.cutoffIndex === 'number' ? serverData.cutoffIndex : undefined,
            inProgress: serverData?.inProgress === true,
            secondsSince: typeof serverData?.secondsSince === 'number' ? serverData.secondsSince : (serverUpdatedAt > 0 ? Math.max(0, Math.floor((Date.now() - serverUpdatedAt) / 1000)) : undefined),
            messagesSinceCutoff,
            messagesSinceCutoffPreview: Array.isArray(messagesSinceCutoff) ? messagesSinceCutoff.slice(0,12).map(m => `${m.role}: ${m.text.length>160?m.text.slice(0,157)+'…':m.text}`) : undefined,
          };

          return respond(200, payload, { "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.resetSec) });
        }
      } catch {}
      
      // Fallback to local mock summary
      const row = getLatestSummary(sessionId);
      if (!row) {
        // No summary yet — return 404
        return respond(404, { error: "No summary found" }, { "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.resetSec) });
      }
      const cadence = await deriveCadence();
      const turnsSince = cadence.turnsSince ?? 0;
      const thresholdTurns = cadence.thresholdTurns ?? Math.max(1, Math.min(20, Number(process.env.NEXT_PUBLIC_SUMMARY_REFRESH_TURNS || 4)));
      const turnsUntilDue = Math.max(0, thresholdTurns - turnsSince);
      const payload = {
        sessionId,
        text: row.text,
        lastMessageTs: typeof row.lastMessageTs === 'number' ? row.lastMessageTs : undefined,
        updatedAt: row.updatedAt,
        version: row.version,
        thresholdTurns,
        turnsSince,
        turnsUntilDue,
        messagesSinceCutoff: Array.isArray(cadence.msgsSinceCutoff) ? cadence.msgsSinceCutoff : undefined,
        messagesSinceCutoffPreview: Array.isArray(cadence.msgsSinceCutoff) ? cadence.msgsSinceCutoff.slice(0,12).map(m => `${m.role}: ${m.text.length>160?m.text.slice(0,157)+'…':m.text}`) : undefined,
      } as const;
      return respond(200, payload, { "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.resetSec) });
    }
    const client = makeConvex(convexBaseUrl());
    const status: any = await client.query("functions/summaries:getStatus", { sessionId }).catch(() => null);

    const last = status?.lastSummary || null;
    const latest = status?.latest || null;
    const updatedAt = typeof last?.updatedAt === 'number' ? last.updatedAt : 0;

    // Build messages since last completed cutoff to aid UI display.
    // Note: We don't have the previous cutoff from Convex here, so we expose
    // the messages since the last cutoff up to "now" (pending to be incorporated).
    let messagesSinceCutoff: Array<{ id: string; index: number; role: string; text: string }> = [];
    let messagesSinceCutoffPreview: string[] = [];
    try {
      const cut = typeof last?.cutoffIndex === 'number' ? Number(last.cutoffIndex) : undefined;
      if (Number.isFinite(cut)) {
        const listed: any = await client.query("functions/interactions:listBySession", { sessionId, limit: 200 }).catch(() => null);
        const docs: any[] = (listed && typeof listed === 'object' && 'value' in listed) ? (listed.value as any[]) : (Array.isArray(listed) ? listed : []);
        // docs are expected in chronological order; build indices based on array order
        messagesSinceCutoff = docs
          .map((d, i) => ({ i, d }))
          .filter(({ i }) => i > (cut as number))
          .map(({ i, d }) => ({ id: String(d?.messageId || `${sessionId}:${i}`), index: i, role: String(d?.role || ''), text: String(d?.text || '') }))
          .filter((m) => m.text && m.text.trim().length > 0);
        messagesSinceCutoffPreview = messagesSinceCutoff.slice(0, 12).map((m) => `${m.role}: ${m.text.length > 160 ? m.text.slice(0,157) + '…' : m.text}`);
      }
    } catch {}

    // Return compact payload for lite mode (frequent polling)
    if (isLite) {
      const litePayload = {
        sessionId,
        due: typeof status?.assistantSince === 'number' && typeof status?.thresholdTurns === 'number'
          ? status.assistantSince >= status.thresholdTurns : false,
        lastSummary: last ? {
          version: typeof last.version === 'number' ? last.version : 0,
          cutoffIndex: typeof last.cutoffIndex === 'number' ? last.cutoffIndex : undefined,
          updatedAt,
          preview: String(last.text || "").substring(0, 100) + (String(last.text || "").length > 100 ? "..." : "")
        } : null,
        reservation: {
          inProgress: latest?.inProgress === true,
          lastJobAt: typeof status?.lastJobAt === 'number' ? status.lastJobAt : undefined
        },
        turnsSince: typeof status?.assistantSince === 'number' ? status.assistantSince : 0
      };
      return respond(200, litePayload, {
        "X-RateLimit-Limit": String(rl.limit),
        "X-RateLimit-Remaining": String(rl.remaining),
        "X-RateLimit-Reset": String(rl.resetSec)
      });
    }

    // Full payload for regular requests
    const payload = {
      sessionId,
      text: String(last?.text || ""),
      lastMessageTs: undefined,
      updatedAt,
      version: typeof last?.version === 'number' ? last.version : 0,
      thresholdTurns: typeof status?.thresholdTurns === 'number' ? status.thresholdTurns : undefined,
      turnsSince: typeof status?.assistantSince === 'number' ? status.assistantSince : undefined,
      cutoffIndex: typeof last?.cutoffIndex === 'number' ? last.cutoffIndex : undefined,
      inProgress: latest?.inProgress === true,
      secondsSince: typeof status?.ageSec === 'number' ? status.ageSec : (updatedAt > 0 ? Math.max(0, Math.floor((Date.now() - updatedAt) / 1000)) : undefined),
      messagesSinceCutoff,
      messagesSinceCutoffPreview,
    } as const;
    return respond(200, payload, { "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.resetSec) });
  } catch (err: unknown) {
    devLog("error", "session-summary: GET failed", { sessionId, isLite, requestId, error: String(err) });
    return respond(502, { error: "Backend query failed" });
  }
}

// In-memory idempotency cache and hysteresis guards (best-effort, per-instance)
const idemCache = new Map<string, { ts: number; status: number; body: any }>();
const notDueCooldown = new Map<string, number>();

export async function POST(request: Request) {
  const headersIn = new Headers(request.headers);
  const requestId = headersIn.get("x-request-id") || safeUUID();
  const routePath = "/api/v1/session-summary";
  const method = "POST";
  const started = Date.now();
  const mode = process.env.MOCK_CONVEX === '1' ? 'mock' : 'convex';
  const endTimer = promMetrics.requestDurationSeconds.startTimer();

  const respond = (status: number, body: unknown, extraHeaders?: Record<string, string>) => {
    const labels = { route: routePath, method, status: String(status), mode } as const;
    promMetrics.requestsTotal.labels(labels.route, labels.method, labels.status, labels.mode).inc();
    if (status >= 500) {
      promMetrics.requestErrorsTotal.labels(labels.route, labels.method, labels.status, labels.mode).inc();
    }
    endTimer(labels);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders, ...(extraHeaders || {}) },
    });
  };

  const auth = await requireAuth(request);
  if (!auth.ok) {
    devLog("warn", "session-summary: authentication failed", { requestId, status: 401, reason: auth.reason, latencyMs: Date.now() - started });
    return respond(401, { error: "Unauthorized" });
  }

  let body: any = null;
  try { body = await request.json(); } catch { return respond(400, { error: "Invalid JSON" }); }
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
  const prevSummary = typeof body?.prevSummary === 'string' ? body.prevSummary : '';
  const clientMessages = Array.isArray(body?.messages) ? body.messages : (Array.isArray(body?.recentMessages) ? body.recentMessages : []);
  const tokenBudget = Number(body?.tokenBudget) || undefined;
  if (!sessionId.trim()) return respond(400, { error: "sessionId is required" });

  // Idempotency: if Idempotency-Key header provided and recently processed, replay cached response (TTL 60s)
  const idemKey = headersIn.get('Idempotency-Key') || headersIn.get('idempotency-key') || '';
  if (idemKey) {
    const hit = idemCache.get(idemKey);
    if (hit && Date.now() - hit.ts < 60000) {
      return respond(hit.status, hit.body, { 'Idempotency-Key': idemKey });
    }
  }

  // Hysteresis: if we rejected as not_due within a short TTL, return fast not_due without re-hitting backend
  const lastNotDueAt = notDueCooldown.get(sessionId) || 0;
  if (Date.now() - lastNotDueAt < 2000) {
    const resp = { status: 'rejected', accepted: false, reason: 'not_due_hysteresis' };
    if (idemKey) idemCache.set(idemKey, { ts: Date.now(), status: 200, body: resp });
    return respond(200, resp, idemKey ? { 'Idempotency-Key': idemKey } : undefined);
  }

  // Cadence cooldown intentionally disabled for simplicity (no-op)
  const cadenceSeconds = 0;

  // Note: triage enforcement moved to after ensureJob acceptance so it aligns to the reserved cutoffIndex.

  try {
    if (mode === 'mock') {
      // Enforce ensureJob-like cadence: reject when not due
      const deriveCadence = async (): Promise<{ turnsSince: number; thresholdTurns: number; cutoffIndex: number }> => {
        const docs: any[] = await mockConvex.listInteractionsBySession({ sessionId, limit: 300 }) as any[];
        const arr = Array.isArray(docs) ? docs : [];
        // compute turnsSince
        let turnsSince = 0;
        let seenAssistant = false;
        for (let i = arr.length - 1; i >= 0; i--) {
          const r = String(arr[i]?.role || '');
          if (r === 'assistant') { seenAssistant = true; break; }
          if (r === 'user') turnsSince++;
        }
        if (!seenAssistant) turnsSince = arr.filter(d => String(d?.role||'') === 'user').length;
        const thresholdTurns = Math.max(1, Math.min(20, Number(process.env.NEXT_PUBLIC_SUMMARY_REFRESH_TURNS || 4)));
        const cutoffIndex = arr.length > 0 ? arr.length - 1 : 0;
        return { turnsSince, thresholdTurns, cutoffIndex };
      };

      try {
        const { turnsSince, thresholdTurns, cutoffIndex } = await deriveCadence();
        if (turnsSince < thresholdTurns) {
          // Mirror Convex ensureJob 'not_due'
          const resp = { status: 'rejected', accepted: false, reason: 'not_due', cutoffIndex };
          // brief cooldown as in GET route
          notDueCooldown.set(sessionId, Date.now());
          return respond(200, resp);
        }
      } catch {}

      // Try to delegate to the AI API server for generation
      try {
        const generateRes = await fetch(`${aiApiBaseUrl()}/api/v1/session-summary/generate`, {
          method: 'POST',
          headers: { 
            'content-type': 'application/json',
            'x-request-id': requestId 
          },
          body: JSON.stringify({ 
            sessionId, 
            prevSummary: prevSummary || '', 
            messages: clientMessages, 
            tokenBudget 
          })
        });
        if (generateRes.ok) {
          const generateData = await generateRes.json();
          return respond(200, {
            status: 'generated',
            accepted: true,
            version: typeof generateData?.version === 'number' ? generateData.version : 1,
            updatedAt: typeof generateData?.updatedAt === 'number' ? generateData.updatedAt : Date.now(),
            lastMessageTs: typeof generateData?.lastMessageTs === 'number' ? generateData.lastMessageTs : Date.now(),
          });
        }
      } catch {}
      
      // Fallback to local mock generation
      
      try {
        const prevRow = getLatestSummary(sessionId);
        const prevText = (prevRow?.text || prevSummary || '').toString();
        // Collect recent interactions (bounded) from the in-memory mock store
        const docs: any[] = await mockConvex.listInteractionsBySession({ sessionId, limit: 200 }) as any[];
        const recent = (Array.isArray(docs) ? docs : [])
          .map((d: any) => ({ role: String(d?.role || ''), content: String(d?.text || '') }))
          .filter((m) => m.content && m.content.trim().length > 0);
        const text = generateSummaryText(prevText, recent, tokenBudget);
        // Determine last message timestamp for cutoff tracking
        const lastMessageTs = (Array.isArray(docs) && docs.length > 0)
          ? Math.max(...docs.map((d: any) => Number(d?.ts || d?.createdAt || 0)).filter((n: number) => Number.isFinite(n)))
          : Date.now();
        const row = upsertSummary({ sessionId, text, lastMessageTs, meta: { tokenBudget } });
        return respond(200, { status: 'generated', accepted: true, version: row.version, updatedAt: row.updatedAt, lastMessageTs: row.lastMessageTs });
      } catch (e) {
        return respond(502, { error: 'mock_generate_failed' });
      }
    }
    const convex = makeConvex(convexBaseUrl());

    // Try to reserve a job (single-flight) without touching turn counters here
    // The server (FastAPI) already bumps turns after assistant interactions
    const nowMs = Date.now();
    try {
      const job: any = await convex.mutation("functions/summaries:ensureJob", { sessionId, nowMs });
      const val = job && typeof job === 'object' && 'accepted' in job ? job : job?.value;
      if (val && val.accepted) {
        // Option B: enforce triage before returning accepted, aligned to reserved cutoffIndex
        try {
          const triageEnabled = String(process.env.AI_TRIAGE_ENABLED || '').toLowerCase();
          const triageOnSummary = String(process.env.TRIAGE_ON_SUMMARY || '0').toLowerCase();
          if ((triageEnabled === '1' || triageEnabled === 'true') && (triageOnSummary === '1' || triageOnSummary === 'true')) {
            const authz = headersIn.get('authorization') || headersIn.get('Authorization') || '';
            const triageUrl = `/api/v1/triage?sessionId=${encodeURIComponent(sessionId)}&limit=20&cutoffIndex=${encodeURIComponent(String(val.cutoffIndex))}`;
            const ctrl = new AbortController();
            const triageTimeoutMs = Math.max(1000, Math.min(5000, Number(process.env.TRIAGE_TIMEOUT_MS || 4000)));
            const to = setTimeout(() => ctrl.abort(), triageTimeoutMs);
            const triageHeaders: Record<string, string> = { 'accept': 'application/json', 'x-request-id': requestId };
            if (authz) triageHeaders['authorization'] = authz;
            const triageRes = await fetch(triageUrl, { method: 'POST', headers: triageHeaders, signal: ctrl.signal });
            const triageText = await triageRes.text();
            try { console.log(JSON.stringify({ where: 'summary.pre.triage', sessionId, status: triageRes.status, tookMs: triageTimeoutMs, cutoffIndex: val.cutoffIndex, textPreview: triageText.slice(0, 240) })); } catch {}
            try { clearTimeout(to); } catch {}
          }
        } catch (e) {
          try { console.warn(JSON.stringify({ where: 'summary.pre.triage.error', sessionId, error: String(e) })); } catch {}
          // Proceed regardless; triage is best-effort but intended to run first
        }

        // Assessments step (legacy pre-summary path) is hard-disabled
        try {
          const allowPreSummary = false; // hard-disabled
          try { console.log(JSON.stringify({ where: 'summary.pre.assess.skip', sessionId, reason: 'hard_disabled' })); } catch {}
          if (allowPreSummary) {
            // No-op: legacy path removed
          }
        } catch (e) {
          // Proceed regardless
          try { console.warn(JSON.stringify({ where: 'summary.pre.assess.error', sessionId, error: String(e) })); } catch {}
        }

        const resp = { status: 'accepted', accepted: true, version: val.version, cutoffIndex: val.cutoffIndex };
        if (idemKey) idemCache.set(idemKey, { ts: Date.now(), status: 200, body: resp });
        return respond(200, resp, idemKey ? { 'Idempotency-Key': idemKey } : undefined);
      }
      const resp = { status: 'rejected', accepted: false, reason: val?.reason || 'not_due' };
      notDueCooldown.set(sessionId, Date.now());
      if (idemKey) idemCache.set(idemKey, { ts: Date.now(), status: 200, body: resp });
      return respond(200, resp, idemKey ? { 'Idempotency-Key': idemKey } : undefined);
    } catch (e) {
      return respond(502, { error: 'ensureJob failed' });
    }
  } catch (e) {
    console.log(JSON.stringify({ level: 'error', route: routePath, requestId, status: 500, sessionId, msg: 'summary generate failed', error: (e as any)?.message, latencyMs: Date.now() - started }));
    return respond(500, { error: "summary generate failed" });
  }
}
