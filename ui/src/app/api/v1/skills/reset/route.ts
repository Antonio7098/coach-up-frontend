export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { requireAuth } from "../../../lib/auth";
import { promMetrics } from "../../../lib/metrics";
import { makeConvex } from "../../../lib/convex";
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
  const routePath = "/api/v1/skills/reset";
  const method = "POST";
  const mode = process.env.MOCK_CONVEX === '1' ? 'mock' : 'convex';
  const endTimer = promMetrics.requestDurationSeconds.startTimer();

  devLog("debug", "skills-reset: POST request initiated", {
    requestId,
    mode,
    timestamp: new Date().toISOString()
  });

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

  // Require auth (Clerk) in dev too; restrict to admin by secret header if you want harder gate
  const auth = await requireAuth(request);
  if (!auth.ok) return respond(401, { error: "Unauthorized" });

  let body: any;
  try { body = await request.json(); } catch { return respond(400, { error: "Invalid JSON" }); }
  const skills = Array.isArray(body?.skills) ? body.skills : [];
  const confirm = String(body?.confirm || '').toLowerCase();
  if (confirm !== 'yes') return respond(400, { error: "confirm='yes' required" });
  if (skills.length === 0) return respond(400, { error: "skills array required" });

  try {
    const client = makeConvex(convexBaseUrl());
    const res = await client.mutation("functions/skills_admin:resetSkills", { skills, confirm: 'yes' }) as any;
    return respond(200, { ok: true, ...res });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e ?? 'Convex mutation failed');
    return respond(502, { error: msg });
  }
}
