/* eslint-disable no-console */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { makeConvex } from "../../../lib/convex";
import * as mockConvex from "../../../lib/mockConvex";
import { promMetrics } from "../../../lib/metrics";
import { requireAuth } from "../../../lib/auth";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Request-Id, Authorization",
  "Access-Control-Expose-Headers": "X-Request-Id",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

function convexBaseUrl() {
  return process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL || "http://127.0.0.1:3210";
}

function safeUUID(): string {
  try {
    const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
    return g.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

export async function GET(request: Request) {
  const headersIn = new Headers(request.headers);
  const requestId = headersIn.get("x-request-id") || safeUUID();

  const started = Date.now();
  const mode = process.env.MOCK_CONVEX === '1' ? 'mock' : 'real';
  const routePath = '/api/v1/skills/tracked';
  const method = 'GET';
  const endTimer = promMetrics.requestDurationSeconds.startTimer();

  function respond(status: number, body: unknown) {
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
  }

  const authRes = await requireAuth(request);
  if (!authRes.ok) {
    console.log(JSON.stringify({ level: 'warn', route: routePath, requestId, status: 401, msg: 'Unauthorized', mode, latencyMs: Date.now() - started }));
    return respond(401, { error: "Unauthorized" });
  }
  const effectiveUserId = String(authRes.userId || 'anonymous');

  const convexUrl = convexBaseUrl();

  try {
    if (process.env.MOCK_CONVEX === '1') {
      try { mockConvex.__devSeedDefaultSkills(); } catch {}
      try { mockConvex.__devEnsureTrackedForUser({ userId: effectiveUserId }); } catch {}
      const rows = await mockConvex.listTrackedSkillsForUser({ userId: effectiveUserId });
      const payload = { tracked: Array.isArray(rows) ? rows : [] };
      console.log(JSON.stringify({ level: 'info', route: routePath, requestId, status: 200, itemsReturned: payload.tracked.length, mode, latencyMs: Date.now() - started }));
      return respond(200, payload);
    }

    const client = makeConvex(convexUrl);
    const rows = await client.query("functions/skills:getTrackedSkillsForUser", { userId: effectiveUserId }) as unknown as Array<Record<string, unknown>> | null | undefined;
    const payload = { tracked: Array.isArray(rows) ? rows : [] };
    console.log(JSON.stringify({ level: 'info', route: routePath, requestId, status: 200, itemsReturned: payload.tracked.length, mode, latencyMs: Date.now() - started }));
    return respond(200, payload);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e ?? 'Convex query failed');
    console.log(JSON.stringify({ level: 'error', route: routePath, requestId, status: 502, error: msg, mode, latencyMs: Date.now() - started }));
    return respond(502, { error: "Convex query failed" });
  }
}
