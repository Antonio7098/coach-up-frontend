 
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { makeConvex } from "../../../lib/convex";
import * as mockConvex from "../../../lib/mockConvex";
import { promMetrics } from "../../../lib/metrics";
import { requireAuth } from "../../../lib/auth";
import { devLog } from "../../../lib/observability";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

export async function POST(request: Request) {
  const headersIn = new Headers(request.headers);
  const requestId = headersIn.get("x-request-id") || safeUUID();

  const started = Date.now();
  const mode = process.env.MOCK_CONVEX === '1' ? 'mock' : 'real';
  const routePath = '/api/v1/skills/track';
  const method = 'POST';
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
    devLog("warn", "skills-track: authentication failed", { requestId, status: 401, latencyMs: Date.now() - started });
    return respond(401, { error: "Unauthorized" });
  }
  const effectiveUserId = String(authRes.userId || 'anonymous');

  let body: any;
  try {
    body = await request.json();
  } catch {
    return respond(400, { error: "Invalid JSON" });
  }
  const skillId = typeof body?.skillId === 'string' ? body.skillId.trim() : '';
  const order = body?.order;
  if (!skillId) {
    return respond(400, { error: "skillId is required" });
  }

  const convexUrl = convexBaseUrl();

  try {
    if (process.env.MOCK_CONVEX === '1') {
      try { mockConvex.__devSeedDefaultSkills(); } catch {}
      const res = await mockConvex.trackSkill({ userId: effectiveUserId, skillId, order });
      devLog("info", "skills-track: skill tracked (mock)", { requestId, status: 200, created: res.created, latencyMs: Date.now() - started });
      return respond(200, { ok: true, created: res.created });
    }

    const client = makeConvex(convexUrl);
    const res = await client.mutation("functions/skills:trackSkill", { userId: effectiveUserId, skillId, order }) as { created: boolean };
    devLog("info", "skills-track: skill tracked (convex)", { requestId, status: 200, created: res?.created === true, latencyMs: Date.now() - started });
    return respond(200, { ok: true, created: res?.created === true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e ?? 'Convex mutation failed');
    devLog("error", "skills-track: convex mutation failed", { requestId, status: 502, error: msg, latencyMs: Date.now() - started });
    return respond(502, { error: "Convex mutation failed" });
  }
}
