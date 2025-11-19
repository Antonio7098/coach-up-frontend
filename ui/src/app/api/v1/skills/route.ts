 
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { makeConvex } from "../../lib/convex";
import * as mockConvex from "../../lib/mockConvex";
import { promMetrics } from "../../lib/metrics";
import { devLog } from "../../lib/observability";

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
    devLog("warn", "skills: empty id parameter", { requestId, id, category, status: 400, latencyMs: Date.now() - started });
    return respond(400, { error: "id must be a non-empty string" });
  }

  const convexUrl = convexBaseUrl();

  try {
    if (process.env.MOCK_CONVEX === '1') {
      // Ensure some defaults exist for local dev/testing
      try { mockConvex.__devSeedDefaultSkills(); } catch {}
      if (id) {
        const skill = await mockConvex.getSkillById({ id });
        devLog("info", "skills: get skill by id (mock)", { requestId, id, category, status: 200, itemsReturned: skill ? 1 : 0, latencyMs: Date.now() - started });
        return respond(200, { skill: skill ?? null });
      }
      if (category) {
        const skills = await mockConvex.listSkillsByCategory({ category });
        const payload = { skills: Array.isArray(skills) ? skills : [] };
        devLog("info", "skills: list skills by category (mock)", { requestId, id, category, status: 200, itemsReturned: payload.skills.length, latencyMs: Date.now() - started });
        return respond(200, payload);
      }
      const skills = await mockConvex.listActiveSkills();
      const payload = { skills: Array.isArray(skills) ? skills : [] };
      devLog("info", "skills: list all active skills (mock)", { requestId, id, category, status: 200, itemsReturned: payload.skills.length, latencyMs: Date.now() - started });
      return respond(200, payload);
    }

    const client = makeConvex(convexUrl);

    // Add timeout to prevent hanging queries (30 second timeout)
    const queryTimeout = 30000; // 30 seconds
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Convex query timeout')), queryTimeout);
    });

    if (id) {
      try {
        const skill = await Promise.race([
          client.query("functions/skills:getSkillById", { id }),
          timeoutPromise
        ]);
        devLog("info", "skills: get skill by id (convex)", { requestId, id, category, status: 200, itemsReturned: skill ? 1 : 0, latencyMs: Date.now() - started });
        return respond(200, { skill: skill ?? null });
      } catch (queryError: any) {
        devLog("warn", "skills: convex query failed for id", { id, requestId, error: queryError.message, mode });
        throw queryError; // Let the outer catch handle it
      }
    }
    if (category) {
      try {
        const skills = await Promise.race([
          client.query("functions/skills:getSkillsByCategory", { category }),
          timeoutPromise
        ]) as unknown as Array<Record<string, unknown>> | null | undefined;
        const payload = { skills: Array.isArray(skills) ? skills : [] };
        devLog("info", "skills: list skills by category (convex)", { requestId, id, category, status: 200, itemsReturned: payload.skills.length, latencyMs: Date.now() - started });
        return respond(200, payload);
      } catch (queryError: any) {
        devLog("warn", "skills: convex query failed for category", { category, requestId, error: queryError.message, mode });
        throw queryError; // Let the outer catch handle it
      }
    }
    try {
      const skills = await Promise.race([
        client.query("functions/skills:getAllActiveSkills", {}),
        timeoutPromise
      ]) as unknown as Array<Record<string, unknown>> | null | undefined;
      const payload = { skills: Array.isArray(skills) ? skills : [] };
        devLog("info", "skills: list all active skills (convex)", { requestId, id, category, status: 200, itemsReturned: payload.skills.length, latencyMs: Date.now() - started });
      return respond(200, payload);
    } catch (queryError: any) {
      devLog("warn", "skills: convex query failed for all skills", { requestId, error: queryError.message, mode });
      throw queryError; // Let the outer catch handle it
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e ?? 'Convex query failed');
    devLog("error", "skills: convex query failed", { requestId, id, category, status: 502, error: msg, latencyMs: Date.now() - started });
    return respond(502, { error: "Convex query failed" });
  }
}
