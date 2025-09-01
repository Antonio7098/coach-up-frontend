/* eslint-disable no-console */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { requireAuth } from "../../lib/auth";
import { promMetrics } from "../../lib/metrics";
import { makeConvex } from "../../lib/convex";
import * as mockConvex from "../../lib/mockConvex";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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
  return process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL || "http://127.0.0.1:3210";
}

export async function GET(request: Request) {
  const headersIn = new Headers(request.headers);
  const requestId = headersIn.get("x-request-id") || safeUUID();
  const routePath = "/api/v1/sessions";
  const method = "GET";
  const started = Date.now();
  const mode = process.env.MOCK_CONVEX === '1' ? 'mock' : 'convex';
  const endTimer = promMetrics.requestDurationSeconds.startTimer();

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

  // Optional auth gating
  const auth = await requireAuth(request);
  if (!auth.ok) {
    console.log(JSON.stringify({ level: 'warn', route: routePath, requestId, status: 401, reason: auth.reason, latencyMs: Date.now() - started }));
    return respond(401, { error: "Unauthorized" });
  }

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId") || "";
  if (!sessionId.trim()) {
    console.log(JSON.stringify({ level: 'warn', route: routePath, requestId, status: 400, msg: 'Missing sessionId', latencyMs: Date.now() - started }));
    return respond(400, { error: "sessionId is required" });
  }

  try {
    if (mode === 'mock') {
      const doc = await mockConvex.getSessionById?.({ sessionId });
      const payload = { session: doc ?? null };
      console.log(JSON.stringify({ level: 'info', route: routePath, requestId, status: 200, sessionId, mode, hasSession: !!doc, latencyMs: Date.now() - started }));
      return respond(200, payload);
    }
    const client = makeConvex(convexBaseUrl());
    const data: any = await client.query("functions/sessions:getBySessionId", { sessionId });
    const payload = { session: data ?? null };
    console.log(JSON.stringify({ level: 'info', route: routePath, requestId, status: 200, sessionId, mode, hasSession: !!data, latencyMs: Date.now() - started }));
    return respond(200, payload);
  } catch (err: unknown) {
    try { console.error('[sessions] GET failed', err); } catch {}
    return respond(502, { error: "Backend query failed" });
  }
}


