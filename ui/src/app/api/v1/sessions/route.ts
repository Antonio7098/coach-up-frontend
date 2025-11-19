 
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { requireAuth } from "../../lib/auth";
import { promMetrics } from "../../lib/metrics";
import { makeConvex } from "../../lib/convex";
import * as mockConvex from "../../lib/mockConvex";
import { devLog } from "../../lib/observability";

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

  devLog("debug", "sessions: GET request initiated", {
    requestId,
    mode,
    sessionId: new URL(request.url).searchParams.get("sessionId") || "missing",
    timestamp: new Date().toISOString()
  });

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
    devLog("warn", "sessions: authentication failed", { requestId });
    return respond(401, { error: "Unauthorized" });
  }

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId") || "";
  if (!sessionId.trim()) {
    devLog("warn", "sessions: missing sessionId parameter", { requestId });
    return respond(400, { error: "sessionId is required" });
  }

  try {
    if (mode === 'mock') {
      devLog("debug", "sessions: using mock mode", { requestId, sessionId });
      const doc = await mockConvex.getSessionById?.({ sessionId });
      const payload = { session: doc ?? null, hasSession: !!doc };
      devLog("info", "sessions: mock query completed", {
        requestId,
        sessionId,
        hasSession: !!doc,
        processingTimeMs: Date.now() - started
      });
      return respond(200, payload);
    }
    const client = makeConvex(convexBaseUrl());
    devLog("debug", "sessions: querying Convex", { requestId, sessionId, convexUrl: convexBaseUrl() });
    const queryResult = await client.query("functions/sessions:getBySessionId", { sessionId });
    const data: any = (queryResult as { value?: any })?.value || null;
    const payload = { session: data ?? null, hasSession: !!data };
    devLog("info", "sessions: convex query completed", {
      requestId,
      sessionId,
      hasSession: !!data,
      processingTimeMs: Date.now() - started
    });
    return respond(200, payload);
  } catch (err: unknown) {
    devLog("error", "sessions: GET failed", { sessionId, error: String(err), mode });
    return respond(502, { error: "Backend query failed" });
  }
}


