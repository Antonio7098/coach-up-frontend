export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { makeConvex } from "../../lib/convex";
import * as mockConvex from "../../lib/mockConvex";
import { sha256Hex } from "../../lib/hash";

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
  const trackedSkillId = headersIn.get("x-tracked-skill-id") || undefined;
  const trackedSkillIdHash = trackedSkillId ? sha256Hex(trackedSkillId) : undefined;

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId") || "";
  const limitParam = url.searchParams.get("limit");
  const limit = Math.max(1, Math.min(200, Number.isFinite(Number(limitParam)) ? Number(limitParam) : 50));

  if (!sessionId.trim()) {
    return new Response(JSON.stringify({ error: "sessionId required" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }

  const convexUrl = convexBaseUrl();

  try {
    if (process.env.MOCK_CONVEX === '1') {
      const events = await mockConvex.listEventsBySession({ sessionId, limit });
      const body = Array.isArray(events) ? events : [];
      return new Response(JSON.stringify({ sessionId, trackedSkillIdHash, events: body }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
      });
    }

    // Query Convex for events by sessionId, newest first
    const client = makeConvex(convexUrl);
    const events = await client.query("events:listBySession", { sessionId, limit }) as unknown as Array<Record<string, unknown>> | null | undefined;

    const body = Array.isArray(events) ? events : [];
    return new Response(JSON.stringify({ sessionId, trackedSkillIdHash, events: body }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Convex query failed" }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }
}
