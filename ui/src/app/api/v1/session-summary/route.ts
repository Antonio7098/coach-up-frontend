/* eslint-disable no-console */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { requireAuth } from "../../lib/auth";
import { promMetrics } from "../../lib/metrics";
import { makeConvex } from "../../lib/convex";
import * as mockConvex from "../../lib/mockConvex";
import { clientKeyFromHeaders, rateLimit } from "../../lib/ratelimit";
import { generateSummaryText } from "../../lib/summarizer";
import { getLatestSummary, upsertSummary } from "../../lib/summaries";

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

export async function GET(request: Request) {
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
    console.log(JSON.stringify({ level: 'warn', route: routePath, requestId, status: 429, reason: 'rate_limited', retryAfterSec: rl.retryAfterSec }));
    return respond(429, { error: "Rate limit exceeded" }, { "Retry-After": String(rl.retryAfterSec), "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.resetSec) });
  }

  // Optional auth gating via CLERK_ENABLED
  const auth = await requireAuth(request);
  if (!auth.ok) {
    console.log(JSON.stringify({ level: 'warn', route: routePath, requestId, status: 401, reason: auth.reason, latencyMs: Date.now() - started }));
    return respond(401, { error: "Unauthorized" }, { "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.resetSec) });
  }

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId") || "";
  if (!sessionId) {
    console.log(JSON.stringify({ level: 'warn', route: routePath, requestId, status: 400, msg: 'Missing sessionId', latencyMs: Date.now() - started }));
    return respond(400, { error: "sessionId is required" }, { "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.resetSec) });
  }

  try {
    if (mode === 'mock') {
      const row = getLatestSummary(sessionId);
      if (!row) {
        console.log(JSON.stringify({ level: 'info', route: routePath, requestId, status: 404, sessionId, mode, rlLimit: rl.limit, rlRemaining: rl.remaining, rlResetSec: rl.resetSec, latencyMs: Date.now() - started }));
        return respond(404, { sessionId, summary: null }, { "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.resetSec) });
      }
      const payload = { sessionId, text: row.text, lastMessageTs: typeof row.lastMessageTs === 'number' ? row.lastMessageTs : undefined, updatedAt: row.updatedAt, version: row.version };
      return respond(200, payload, { "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.resetSec) });
    }
    const client = makeConvex(convexBaseUrl());
    const [data, state]: any = await Promise.all([
      client.query("functions/summaries:getLatest", { sessionId }),
      client.query("functions/summary_state:getState", { sessionId }).catch(() => null),
    ]);
    if (!data) {
      console.log(JSON.stringify({ level: 'info', route: routePath, requestId, status: 404, sessionId, mode, rlLimit: rl.limit, rlRemaining: rl.remaining, rlResetSec: rl.resetSec, latencyMs: Date.now() - started }));
      return respond(404, { sessionId, summary: null }, { "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.resetSec) });
    }
    const payload = {
      sessionId,
      text: String(data.text || ""),
      lastMessageTs: typeof data.lastMessageTs === 'number' ? data.lastMessageTs : undefined,
      updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : Date.now(),
      version: typeof data.version === 'number' ? data.version : 1,
      thresholdTurns: typeof state?.thresholdTurns === 'number' ? state.thresholdTurns : undefined,
      turnsSince: typeof state?.turnsSince === 'number' ? state.turnsSince : undefined,
    };
    console.log(JSON.stringify({ level: 'info', route: routePath, requestId, status: 200, sessionId, mode, hasText: !!payload.text, rlLimit: rl.limit, rlRemaining: rl.remaining, rlResetSec: rl.resetSec, latencyMs: Date.now() - started }));
    return respond(200, payload, { "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.resetSec) });
  } catch (err: unknown) {
    try { console.error('[session-summary] GET failed', err); } catch {}
    return respond(502, { error: "Backend query failed" });
  }
}

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

  // Cadence cooldown intentionally disabled for simplicity (no-op)
  const cadenceSeconds = 0;

  try {
    if (mode === 'mock') {
      // In mock mode, synthesize text and persist to in-memory store
      const prev = prevSummary || getLatestSummary(sessionId)?.text || '';
      const combined = generateSummaryText(prev, clientMessages, tokenBudget);
      const row = upsertSummary({ sessionId, text: combined, lastMessageTs: Date.now(), meta: { tokenBudget } });
      const payload = { status: 'completed', summary: { sessionId, version: row.version, updatedAt: row.updatedAt } };
      return respond(200, payload);
    }
    const convex = makeConvex(convexBaseUrl());
    // Fetch latest for previous text and cutoff
    const latest: any = await convex.query("functions/summaries:getLatest", { sessionId });
    const prev = prevSummary || latest?.text || '';
    const cutoffTs = Number(latest?.lastMessageTs || 0);

    // Optionally fetch interactions since cutoff from Convex (bounded), else use client-provided messages
    let recentMessages: Array<{ role: 'user'|'assistant'; content: string }> = [];
    const useServerFetch = String(process.env.SUMMARY_FETCH_FROM_CONVEX || '').trim() === '1';
    if (useServerFetch) {
      try {
        let interactions: any[] = await convex.query("functions/interactions:listBySession", { sessionId, limit: 200 }) as any[];
        interactions = Array.isArray(interactions) ? interactions : [];
        const filtered = interactions
          .filter((d: any) => (Number(d?.ts) || 0) > cutoffTs)
          .map((d: any) => ({ role: d?.role === 'assistant' ? 'assistant' as const : 'user' as const, content: String(d?.text || "") }))
          .filter((m: any) => m.content && m.content.trim().length > 0);
        // Fallbacks:
        // 1) If none strictly after cutoff, prefer client-provided messages when available
        // 2) Otherwise use the last few interactions as a safety net
        if (filtered.length > 0) {
          recentMessages = filtered.slice(-40);
        } else if (Array.isArray(clientMessages) && clientMessages.length > 0) {
          recentMessages = clientMessages as any;
        } else {
          recentMessages = interactions
            .slice(-8)
            .map((d: any) => ({ role: d?.role === 'assistant' ? 'assistant' as const : 'user' as const, content: String(d?.text || "") }))
            .filter((m: any) => m.content && m.content.trim().length > 0);
        }
      } catch {
        recentMessages = Array.isArray(clientMessages) ? clientMessages : [];
      }
    } else {
      recentMessages = Array.isArray(clientMessages) ? clientMessages : [];
    }

    // Call AI API to generate the rolling summary text
    let text = '';
    try {
      const res = await fetch(`${aiApiBaseUrl().replace(/\/$/, '')}/api/v1/session-summary/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-request-id': requestId },
        body: JSON.stringify({ sessionId, prevSummary: prev, messages: recentMessages, tokenBudget }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String((data as any)?.error || res.status));
      const headerEmpty = String(res.headers.get('x-summary-empty') || '').trim() === '1';
      text = String((data as any)?.text || '');
      if (headerEmpty || !text || text.trim().length === 0) {
        console.log(JSON.stringify({ level: 'info', route: routePath, requestId, status: 200, sessionId, msg: 'ai_returned_empty', headerEmpty }));
        // Do not persist a new summary row; signal emptiness explicitly to the client
        return new Response(JSON.stringify({ status: 'empty' }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8', 'X-Request-Id': requestId, 'X-Summary-Empty': '1', ...corsHeaders },
        });
      }
    } catch (e) {
      // If AI API fails, return upstream error
      console.log(JSON.stringify({ level: 'error', route: routePath, requestId, status: 502, sessionId, msg: 'ai_api_generate_failed', error: (e as any)?.message, latencyMs: Date.now() - started }));
      return respond(502, { error: "ai generate failed" });
    }

    // At this point, text is non-empty due to early return above
    let effectiveText = text;
    let effectiveLastMessageTs = Date.now();
    // Persist new summary row in Convex
    const resIns: any = await convex.mutation("functions/summaries:insert", { sessionId, text: effectiveText, lastMessageTs: effectiveLastMessageTs, meta: { tokenBudget } });
    const payload = { status: 'completed', summary: { sessionId, version: resIns?.version || 1, updatedAt: resIns?.updatedAt || Date.now() } };
    return respond(200, payload);
  } catch (e) {
    console.log(JSON.stringify({ level: 'error', route: routePath, requestId, status: 500, sessionId, msg: 'summary generate failed', error: (e as any)?.message, latencyMs: Date.now() - started }));
    return respond(500, { error: "summary generate failed" });
  }
}
