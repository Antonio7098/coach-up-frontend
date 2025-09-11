 
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
  const idempotencyKey = headersIn.get("idempotency-key") || headersIn.get("Idempotency-Key") || "";
  const routePath = "/api/v1/session-summary";
  const method = "GET";
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
      const row = getLatestSummary(sessionId);
      if (!row) {
        // No summary yet — return 404
        return respond(404, { error: "No summary found" }, { "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.resetSec) });
      }
      const payload = { sessionId, text: row.text, lastMessageTs: typeof row.lastMessageTs === 'number' ? row.lastMessageTs : undefined, updatedAt: row.updatedAt, version: row.version };
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
    try { console.error('[session-summary] GET failed', err); } catch {}
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
    console.log(JSON.stringify({ level: 'warn', route: routePath, requestId, status: 401, reason: auth.reason, latencyMs: Date.now() - started }));
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
      // In mock mode, simulate an accepted reservation without generating text
      const prev = getLatestSummary(sessionId);
      const nextVersion = typeof prev?.version === 'number' ? prev.version + 1 : 1;
      return respond(200, { status: 'accepted', accepted: true, version: nextVersion });
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
          if (triageEnabled === '1' || triageEnabled === 'true') {
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

        // Assessments step (best-effort): after triage, before summary
        try {
          const assessEnabled = String(process.env.AI_ASSESS_ENABLED || '').toLowerCase();
          if (assessEnabled === '1' || assessEnabled === 'true') {
            const maxGroups = Math.max(1, Math.min(20, Number(process.env.ASSESS_MAX_GROUPS || 5)));
            const maxSkills = Math.max(1, Math.min(50, Number(process.env.ASSESS_MAX_SKILLS || 8)));
            const assessTimeoutMs = Math.max(500, Math.min(8000, Number(process.env.ASSESS_TIMEOUT_MS || 5000)));
            const salt = (process.env.SKILL_HASH_SALT || 'test_salt').trim();
            try { console.log(JSON.stringify({ where: 'summary.pre.assess.start', sessionId, maxGroups, maxSkills, assessTimeoutMs })); } catch {}

            // Determine slice between previous cutoff and this reservation cutoffIndex
            let prevCut: number | undefined = undefined;
            try {
              const prevLatest: any = await convex.query("functions/summaries:getLatest", { sessionId }).catch(() => null);
              const cut = Number(prevLatest?.cutoffIndex);
              if (Number.isFinite(cut)) prevCut = cut as number;
            } catch {}
            // Prefer interactions with triage annotations (groupId, triageProcessedAt)
            let groupIds: string[] = [];
            try {
              let docs: Array<any> = await convex.query("functions/interactions:listBySession", { sessionId, limit: 300 }).catch(() => []) as any[];
              docs = Array.isArray(docs) ? docs : [];
              // Restrict to window between previous cutoff and reserved cutoffIndex when available
              let windowed = docs.map((d, i) => ({ i, d }))
                .filter(({ i }) => (typeof prevCut === 'number' ? i > prevCut : true) && i <= Number(val.cutoffIndex))
                .map(({ d }) => d);
              if (windowed.length === 0) windowed = docs.slice(-50);
              const annotated = windowed
                .filter((d: any) => typeof d?.groupId === 'string' && d.groupId.trim().length > 0)
                .sort((a: any, b: any) => Number(b?.triageProcessedAt || 0) - Number(a?.triageProcessedAt || 0));
              groupIds = Array.from(new Set(annotated.map((d: any) => String(d.groupId)))).slice(0, maxGroups);
              try { console.log(JSON.stringify({ where: 'summary.pre.assess.groups', sessionId, docs: docs.length, windowed: windowed.length, annotated: annotated.length, groupIds })); } catch {}
            } catch {}

            // Resolve userId and load tracked skills
            const sessionDoc: any = await convex.query("functions/sessions:getBySessionId", { sessionId }).catch(() => null);
            const userId = String(sessionDoc?.userId || auth.userId || 'unknown');
            const rows: any[] = await convex.query("functions/skills:getTrackedSkillsForUser", { userId }).catch(() => []) as any[];
            const trackedList = Array.isArray(rows) ? rows : [];
            const skills = trackedList.map((r) => ({
              id: String(r?.skillId || r?.skill?.id || r?.id || ''),
              level: (() => { const lv = Number(r?.currentLevel); return Number.isFinite(lv) && lv >= 0 && lv <= 10 ? lv : 5; })(),
            })).filter((s) => s.id).slice(0, maxSkills);
            try { console.log(JSON.stringify({ where: 'summary.pre.assess.skills', sessionId, userId, skillsCount: skills.length, sample: skills.slice(0,3) })); } catch {}

            if (groupIds.length > 0 && skills.length > 0) {
              try { console.log(JSON.stringify({ where: 'summary.pre.assess.ready', sessionId, groups: groupIds.length, skills: skills.length })); } catch {}
              // Prefer server-to-server secret for finalize endpoint if configured; fallback to incoming auth
              const authz = headersIn.get('authorization') || headersIn.get('Authorization') || '';
              const s2sSecret = (process.env.PERSIST_ASSESSMENTS_SECRET || '').trim();
              const headers: Record<string, string> = { 'content-type': 'application/json', 'x-request-id': requestId };
              if (s2sSecret) {
                headers['authorization'] = `Bearer ${s2sSecret}`;
              } else if (authz) {
                headers['authorization'] = authz;
              }

              // Log attempt
              try {
                await convex.mutation("functions/events:logEvent", {
                  userId,
                  sessionId,
                  requestId,
                  kind: 'assess_cadence_started',
                  payload: { groups: groupIds.length, skills: skills.length, cutoffIndex: val.cutoffIndex }
                });
              } catch {}

              let completed = 0;
              for (const gid of groupIds) {
                const skillAssessments = skills.map((s) => ({
                  skillHash: sha256Hex(`${salt}:${s.id}`),
                  level: s.level,
                  metCriteria: [],
                  unmetCriteria: [],
                  feedback: [],
                }));
                const payload = { sessionId, groupId: gid, rubricVersion: 'v2' as const, summary: { skillAssessments } };
                const ctrl = new AbortController();
                const to = setTimeout(() => ctrl.abort(), assessTimeoutMs);
                try {
                  try { console.log(JSON.stringify({ where: 'summary.pre.assess.finalize.attempt', sessionId, groupId: gid, skills: skills.length })); } catch {}
                  const res = await fetch('/api/assessments/convex/finalize', {
                    method: 'POST', headers, body: JSON.stringify(payload), cache: 'no-store', signal: ctrl.signal,
                  });
                  const txt = await res.text().catch(() => '');
                  try { console.log(JSON.stringify({ where: 'summary.pre.assess.finalize.result', sessionId, groupId: gid, status: res.status, len: txt.length })); } catch {}
                  completed++;
                } catch (e) {
                  try { console.warn(JSON.stringify({ where: 'summary.pre.assess.finalize.error', sessionId, groupId: gid, error: String(e) })); } catch {}
                }
                try { clearTimeout(to); } catch {}
              }

              // Log completion
              try {
                await convex.mutation("functions/events:logEvent", {
                  userId,
                  sessionId,
                  requestId,
                  kind: 'assess_cadence_completed',
                  payload: { groups: groupIds.length, skills: skills.length, completed, cutoffIndex: val.cutoffIndex }
                });
              } catch {}
            } else {
              try { console.log(JSON.stringify({ where: 'summary.pre.assess.skipped', sessionId, reason: groupIds.length === 0 ? 'no_groups' : 'no_skills', groups: groupIds.length, skills: skills.length })); } catch {}
            }
          }
        } catch (e) {
          try { console.warn(JSON.stringify({ where: 'summary.pre.assess.error', sessionId, error: String(e) })); } catch {}
          // Proceed regardless
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
