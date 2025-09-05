/* eslint-disable no-console */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { requireAuth } from "../../../lib/auth";
import { makeConvex } from "../../../lib/convex";

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

  // Optional auth gating (same as other v1 routes)
  const auth = await requireAuth(request);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId") || "";
  if (!sessionId.trim()) {
    return new Response(JSON.stringify({ error: "sessionId is required" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }

  try {
    const client = makeConvex(convexBaseUrl());

    // Fetch session doc first (denormalized metrics)
    const session: any = await client.query("functions/sessions:getBySessionId", { sessionId });

    // If denormalized fields missing, fallback to interactions to compute lastActivity and interactionCount
    let lastActivityAt: number | null = typeof session?.lastActivityAt === 'number' ? session.lastActivityAt : null;
    let interactionCount: number | null = typeof session?.interactionCount === 'number' ? session.interactionCount : null;

    if (lastActivityAt == null || interactionCount == null) {
      try {
        const docs: any[] = await client.query("functions/interactions:listBySession", { sessionId, limit: 200 });
        if (Array.isArray(docs) && docs.length > 0) {
          const tsVals = docs.map((d) => Number(d?.ts || d?.createdAt || 0)).filter((n) => Number.isFinite(n) && n > 0);
          if (tsVals.length > 0) {
            lastActivityAt = Math.max(...tsVals);
          }
          interactionCount = docs.length;
        } else {
          lastActivityAt = lastActivityAt ?? Number(session?.startTime || 0) || null;
          interactionCount = interactionCount ?? 0;
        }
      } catch {
        // leave fallbacks/nulls
      }
    }

    const payload = {
      sessionId,
      lastActivityAt: lastActivityAt ?? null,
      interactionCount: interactionCount ?? 0,
      sttCostCents: Number(session?.sttCostCents || 0),
      llmCostCents: Number(session?.llmCostCents || 0),
      ttsCostCents: Number(session?.ttsCostCents || 0),
      totalCostCents: Number(session?.totalCostCents || 0),
      startTime: typeof session?.startTime === 'number' ? session.startTime : null,
    } as const;

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  } catch (err: unknown) {
    try { console.error('[sessions/metrics] failed', err); } catch {}
    return new Response(JSON.stringify({ error: "Backend query failed" }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }
}
