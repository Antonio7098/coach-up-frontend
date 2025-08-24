/* eslint-disable no-console */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { makeConvex } from "../../lib/convex";
import * as mockConvex from "../../lib/mockConvex";
import { promMetrics } from "../../lib/metrics";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Request-Id, X-Tracked-Skill-Id, Authorization",
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

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const category = url.searchParams.get("category");
  const started = Date.now();
  const mode = process.env.MOCK_CONVEX === '1' ? 'mock' : 'real';
  const routePath = '/api/v1/skills';
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

  if (id !== null && id.trim().length === 0) {
    console.log(JSON.stringify({ level: 'warn', route: routePath, requestId, id, category, status: 400, msg: 'Empty id parameter', mode, latencyMs: Date.now() - started }));
    return respond(400, { error: "id must be a non-empty string" });
  }

  const convexUrl = convexBaseUrl();

  try {
    if (process.env.MOCK_CONVEX === '1') {
      // Ensure some defaults exist for local dev/testing
      try { mockConvex.__devSeedDefaultSkills(); } catch {}
      if (id) {
        const skill = await mockConvex.getSkillById({ id });
        console.log(JSON.stringify({ level: 'info', route: routePath, requestId, id, category, status: 200, itemsReturned: skill ? 1 : 0, mode, latencyMs: Date.now() - started }));
        return respond(200, { skill: skill ?? null });
      }
      if (category) {
        const skills = await mockConvex.listSkillsByCategory({ category });
        const payload = { skills: Array.isArray(skills) ? skills : [] };
        console.log(JSON.stringify({ level: 'info', route: routePath, requestId, id, category, status: 200, itemsReturned: payload.skills.length, mode, latencyMs: Date.now() - started }));
        return respond(200, payload);
      }
      const skills = await mockConvex.listActiveSkills();
      const payload = { skills: Array.isArray(skills) ? skills : [] };
      console.log(JSON.stringify({ level: 'info', route: routePath, requestId, id, category, status: 200, itemsReturned: payload.skills.length, mode, latencyMs: Date.now() - started }));
      return respond(200, payload);
    }

    const client = makeConvex(convexUrl);
    if (id) {
      const skill = await client.query("functions/skills:getSkillById", { id });
      console.log(JSON.stringify({ level: 'info', route: routePath, requestId, id, category, status: 200, itemsReturned: skill ? 1 : 0, mode, latencyMs: Date.now() - started }));
      return respond(200, { skill: skill ?? null });
    }
    if (category) {
      const skills = await client.query("functions/skills:getSkillsByCategory", { category }) as unknown as Array<Record<string, unknown>> | null | undefined;
      const payload = { skills: Array.isArray(skills) ? skills : [] };
      console.log(JSON.stringify({ level: 'info', route: routePath, requestId, id, category, status: 200, itemsReturned: payload.skills.length, mode, latencyMs: Date.now() - started }));
      return respond(200, payload);
    }
    const skills = await client.query("functions/skills:getAllActiveSkills", {}) as unknown as Array<Record<string, unknown>> | null | undefined;
    const payload = { skills: Array.isArray(skills) ? skills : [] };
    console.log(JSON.stringify({ level: 'info', route: routePath, requestId, id, category, status: 200, itemsReturned: payload.skills.length, mode, latencyMs: Date.now() - started }));
    return respond(200, payload);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e ?? 'Convex query failed');
    console.log(JSON.stringify({ level: 'error', route: routePath, requestId, id, category, status: 502, error: msg, mode, latencyMs: Date.now() - started }));
    return respond(502, { error: "Convex query failed" });
  }
}
