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
      const payload = { sessionId, text: row.text, lastIndex: undefined as number | undefined, updatedAt: row.updatedAt, version: row.version };
      return respond(200, payload, { "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.resetSec) });
    }
    const client = makeConvex(convexBaseUrl());
    const data: any = await client.query("functions/summaries:getLatest", { sessionId });
    if (!data) {
      console.log(JSON.stringify({ level: 'info', route: routePath, requestId, status: 404, sessionId, mode, rlLimit: rl.limit, rlRemaining: rl.remaining, rlResetSec: rl.resetSec, latencyMs: Date.now() - started }));
      return respond(404, { sessionId, summary: null }, { "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.resetSec) });
    }
    const payload = {
      sessionId,
      text: String(data.text || ""),
      lastIndex: undefined as number | undefined,
      updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : Date.now(),
      version: typeof data.version === 'number' ? data.version : 1,
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
  const recentMessages = Array.isArray(body?.messages) ? body.messages : (Array.isArray(body?.recentMessages) ? body.recentMessages : []);
  const tokenBudget = Number(body?.tokenBudget) || undefined;
  if (!sessionId.trim()) return respond(400, { error: "sessionId is required" });

  // Cadence cooldown intentionally disabled for simplicity (no-op)
  const cadenceSeconds = 0;

  try {
    if (mode === 'mock') {
      // In mock mode, synthesize text and persist to in-memory store
      const prev = prevSummary || getLatestSummary(sessionId)?.text || '';
      const combined = generateSummaryText(prev, recentMessages, tokenBudget);
      const row = upsertSummary({ sessionId, text: combined, lastMessageTs: Date.now(), meta: { tokenBudget } });
      const payload = { status: 'completed', summary: { sessionId, version: row.version, updatedAt: row.updatedAt } };
      return respond(200, payload);
    }
    const convex = makeConvex(convexBaseUrl());
    // Fetch latest for prev text
    const latest: any = await convex.query("functions/summaries:getLatest", { sessionId });
    // No cooldown enforcement
    const prev = prevSummary || latest?.text || '';
    const combined = generateSummaryText(prev, recentMessages, tokenBudget);
    const res: any = await convex.mutation("functions/summaries:insert", { sessionId, text: combined, lastMessageTs: Date.now(), meta: { tokenBudget } });
    const payload = { status: 'completed', summary: { sessionId, version: res?.version || 1, updatedAt: res?.updatedAt || Date.now() } };
    return respond(200, payload);
  } catch (e) {
    console.log(JSON.stringify({ level: 'error', route: routePath, requestId, status: 500, sessionId, msg: 'summary generate failed', error: (e as any)?.message, latencyMs: Date.now() - started }));
    return respond(500, { error: "summary generate failed" });
  }
}
