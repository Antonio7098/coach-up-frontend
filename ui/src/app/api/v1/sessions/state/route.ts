export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { makeConvex } from "../../../lib/convex";
import * as mockConvex from "../../../lib/mockConvex";
import { sha256Hex } from "../../../lib/hash";
import { requireAuth } from "../../../lib/auth";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Request-Id, X-Tracked-Skill-Id, Authorization",
  "Access-Control-Expose-Headers": "X-Request-Id",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

function convexBaseUrl() {
  return process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL || "http://127.0.0.1:3210";
}

export async function POST(request: Request) {
  const controller = new AbortController();
  request.signal.addEventListener("abort", () => controller.abort());

  const headersIn = new Headers(request.headers);
  const requestId = headersIn.get("x-request-id") || (() => {
    try {
      const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
      return g.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
    } catch {
      return Math.random().toString(36).slice(2);
    }
  })();
  const trackedSkillId = headersIn.get("x-tracked-skill-id") || undefined;
  const trackedSkillIdHash = trackedSkillId ? sha256Hex(trackedSkillId) : undefined;

  // Optional Clerk gating (enabled when CLERK_ENABLED=1)
  const authRes = await requireAuth(request);
  if (!authRes.ok) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }

  const obj = (json ?? {}) as Record<string, unknown>;
  if (!obj?.userId || !obj?.sessionId) {
    return new Response(JSON.stringify({ error: "userId and sessionId are required" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }

  // Runtime validations
  const isNonEmptyString = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
  if (!isNonEmptyString(obj.userId)) {
    return new Response(JSON.stringify({ error: "userId must be a non-empty string" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }
  if (!isNonEmptyString(obj.sessionId)) {
    return new Response(JSON.stringify({ error: "sessionId must be a non-empty string" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }
  if (obj.latestGroupId !== undefined && obj.latestGroupId !== null && !isNonEmptyString(obj.latestGroupId)) {
    return new Response(JSON.stringify({ error: "latestGroupId, if provided, must be a non-empty string" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }
  if (Object.prototype.hasOwnProperty.call(obj, 'state')) {
    const s = obj.state as unknown;
    if (s !== undefined && s !== null && (typeof s !== 'object' || Array.isArray(s))) {
      return new Response(JSON.stringify({ error: "state, if provided, must be an object" }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
      });
    }
  }

  const convexUrl = convexBaseUrl();
  try {
    const authedUserId = authRes.userId && authRes.userId !== 'anonymous' ? authRes.userId : undefined;
    const effectiveUserId = (v: unknown) => String(authedUserId || v || 'unknown');
    if (process.env.MOCK_CONVEX === '1') {
      const result = await mockConvex.updateSessionState({
        userId: effectiveUserId(obj.userId),
        sessionId: String(obj.sessionId),
        state: (obj.state as Record<string, unknown> | undefined) ?? {},
        latestGroupId: obj.latestGroupId ? String(obj.latestGroupId) : undefined,
      });
      // Optional event log for observability
      await mockConvex.logEvent({
        userId: effectiveUserId(obj.userId),
        sessionId: String(obj.sessionId),
        groupId: obj.latestGroupId ? String(obj.latestGroupId) : undefined,
        requestId,
        trackedSkillIdHash,
        kind: 'session_state_updated',
        payload: { latestGroupId: (obj.latestGroupId as string | undefined) ?? null },
      });
      return new Response(JSON.stringify(result ?? { ok: true }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
      });
    }

    const client = makeConvex(convexUrl);
    const result = await client.mutation("sessions:updateSessionState", {
      userId: effectiveUserId(obj.userId),
      sessionId: String(obj.sessionId),
      state: (obj.state as Record<string, unknown> | undefined) ?? {},
      latestGroupId: obj.latestGroupId ? String(obj.latestGroupId) : undefined,
    });
    await client.mutation("functions/events:logEvent", {
      userId: effectiveUserId(obj.userId),
      sessionId: String(obj.sessionId),
      groupId: obj.latestGroupId ? String(obj.latestGroupId) : undefined,
      requestId,
      trackedSkillIdHash,
      kind: 'session_state_updated',
      payload: { latestGroupId: (obj.latestGroupId as string | undefined) ?? null },
    });

    return new Response(JSON.stringify(result ?? { ok: true }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  } catch (err: unknown) {
    const maybeMessage = (err && typeof err === 'object' && 'message' in err)
      ? (err as { message?: unknown }).message
      : undefined;
    const msg = typeof maybeMessage === 'string' ? maybeMessage : String(err);
    // Log for server diagnostics
    try { console.error('[sessions/state] Convex error:', err); } catch {}
    return new Response(JSON.stringify({ error: "Convex mutation failed", message: msg }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }
}
