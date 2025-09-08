/* eslint-disable no-console */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { requireAuth } from "../../../lib/auth";
import { promMetrics } from "../../../lib/metrics";
import { makeConvex } from "../../../lib/convex";
import * as mockConvex from "../../../lib/mockConvex";
import { clientKeyFromHeaders, rateLimit } from "../../../lib/ratelimit";
import { getLatestSummary } from "../../../lib/summaries";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Request-Id, Authorization",
  "Access-Control-Expose-Headers": "X-Request-Id, ETag",
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
  const routePath = "/api/v1/session-summary/lite";
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
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders, ...(extraHeaders || {}) },
    });
  };

  // Rate limit per client (best-effort; in-memory only) - more lenient for lite endpoint
  const rlKey = clientKeyFromHeaders(headersIn);
  const rl = rateLimit(`session-summary-lite:${rlKey}`, { windowMs: 10000, maxRequests: 20 }); // 20 requests per 10 seconds
  if (!rl.ok) {
    const labels = { route: routePath, method, status: '429', mode } as const;
    promMetrics.rateLimitedTotal.labels(labels.route, labels.method, labels.status, labels.mode).inc();
    return respond(429, { error: "Rate limit exceeded" }, { "Retry-After": String(rl.retryAfterSec), "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.resetSec) });
  }

  // Optional auth gating via CLERK_ENABLED
  const auth = await requireAuth(request);
  if (!auth.ok) {
    return respond(401, { error: "Unauthorized" }, { "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.resetSec) });
  }

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId") || "";
  if (!sessionId) {
    return respond(400, { error: "sessionId is required" }, { "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.resetSec) });
  }

  try {
    if (mode === 'mock') {
      const row = getLatestSummary(sessionId);
      const litePayload = {
        sessionId,
        due: false, // Mock: always not due
        lastSummary: row ? {
          version: row.version,
          cutoffIndex: undefined,
          updatedAt: row.updatedAt,
          preview: String(row.text || "").substring(0, 100) + (String(row.text || "").length > 100 ? "..." : "")
        } : null,
        reservation: {
          inProgress: false,
          lastJobAt: undefined
        },
        turnsSince: 0
      };
      return respond(200, litePayload, { "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.resetSec) });
    }

    const client = makeConvex(convexBaseUrl());
    const status: any = await client.query("functions/summaries:getStatus", { sessionId }).catch(() => null);

    const last = status?.lastSummary || null;
    const latest = status?.latest || null;
    const updatedAt = typeof last?.updatedAt === 'number' ? last.updatedAt : 0;

    // Ultra-compact lite payload for frequent polling
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

    return respond(200, litePayload, { "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.resetSec) });
  } catch (err: unknown) {
    try { console.error('[session-summary-lite] GET failed', err); } catch {}
    return respond(502, { error: "Backend query failed" });
  }
}
