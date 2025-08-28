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
  const routePath = '/api/v1/skills/level-history';
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
      // In mock mode, generate some historical data for the user's tracked skills
      const tracked = await mockConvex.listTrackedSkillsForUser({ userId: effectiveUserId });
      const skillIds = tracked.map((t: any) => t.skillId);

      const historyData: Record<string, Array<{ level: number; timestamp: number }>> = {};

      // Generate mock historical data for each skill
      for (const skillId of skillIds) {
        const history: Array<{ level: number; timestamp: number }> = [];
        const now = Date.now();
        const daysBack = 16; // Last 16 days

        for (let i = daysBack - 1; i >= 0; i--) {
          const timestamp = now - (i * 24 * 60 * 60 * 1000); // Days ago
          // Start at level 0 and gradually increase (with some variation)
          const baseLevel = Math.max(0, Math.min(10, Math.floor((daysBack - i) / 2)));
          const variation = Math.floor(Math.random() * 3) - 1; // -1, 0, or 1
          const level = Math.max(0, Math.min(10, baseLevel + variation));
          history.push({ level, timestamp });
        }

        historyData[skillId] = history;
      }

      console.log(JSON.stringify({ level: 'info', route: routePath, requestId, status: 200, skillsReturned: Object.keys(historyData).length, mode, latencyMs: Date.now() - started }));
      return respond(200, { history: historyData });
    }

    const client = makeConvex(convexUrl);
    // This would need to be implemented in the Convex backend
    // For now, return empty data
    console.log(JSON.stringify({ level: 'info', route: routePath, requestId, status: 200, skillsReturned: 0, mode, latencyMs: Date.now() - started }));
    return respond(200, { history: {} });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e ?? 'Convex query failed');
    console.log(JSON.stringify({ level: 'error', route: routePath, requestId, status: 502, error: msg, mode, latencyMs: Date.now() - started }));
    return respond(502, { error: "Convex query failed" });
  }
}
