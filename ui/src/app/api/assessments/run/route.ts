export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Convex helper
import { makeConvex } from "../../lib/convex";
import * as mockConvex from "../../lib/mockConvex";
import { getBus } from "../../lib/events";
import { getEnvString, getEnvBool } from "../../lib/env";
import { json, badRequest, unauthorized, withTimeout, serverBaseUrl } from "../../lib/http";
import { devLog } from "../../lib/observability";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Request-Id, X-Tracked-Skill-Id",
  "Access-Control-Expose-Headers": "X-Request-Id",
};

function aiApiBaseUrl() {
  return (
    getEnvString("AI_API_BASE_URL") ||
    getEnvString("NEXT_PUBLIC_AI_API_BASE_URL") ||
    "http://127.0.0.1:8000"
  );
}

function convexBaseUrl() {
  return getEnvString("CONVEX_URL") || getEnvString("NEXT_PUBLIC_CONVEX_URL") || "http://127.0.0.1:3210";
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: Request) {
  const controller = new AbortController();
  request.signal.addEventListener("abort", () => controller.abort());

  // Pass-through original request body (as bytes) to avoid stream issues in Node fetch
  const headers = new Headers(request.headers);
  const requestId = headers.get("x-request-id") || (() => {
    try {
      const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
      return g.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
    } catch {
      return Math.random().toString(36).slice(2);
    }
  })();
  headers.set("X-Request-Id", requestId);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  const bodyBytes = await request.arrayBuffer();

  devLog("debug", "Assessment run initiated", {
    requestId,
    hasBody: bodyBytes.byteLength > 0,
    timestamp: new Date().toISOString()
  });
  // Attempt to parse sessionId from JSON body so we can also include it as a query param (workaround)
  let sessionIdParam = "";
  let sessionIdFromBody: string | null = null;
  try {
    const text = new TextDecoder().decode(bodyBytes);
    if (text) {
      const obj = JSON.parse(text);
      if (obj && typeof obj === "object" && obj.sessionId) {
        sessionIdFromBody = String(obj.sessionId);
        sessionIdParam = `?sessionId=${encodeURIComponent(sessionIdFromBody)}`;
        devLog("debug", "Parsed sessionId from request body", {
          requestId,
          sessionId: sessionIdFromBody
        });
      }
    }
  } catch (e) {
    devLog("debug", "Failed to parse sessionId from request body", {
      requestId,
      error: String(e)
    });
  }

  // If the incoming request already has a query string, pass it through to upstream verbatim.
  // Otherwise, fall back to the sessionId derived from body (if any).
  const incomingSearch = (() => {
    try {
      return new URL(request.url).search || "";
    } catch {
      return "";
    }
  })();
  const searchSuffix = incomingSearch || sessionIdParam;
  const sessionIdFromQS = (() => {
    try {
      return new URL(request.url).searchParams.get("sessionId");
    } catch {
      return null;
    }
  })();
  const sessionId = sessionIdFromQS || sessionIdFromBody || "";
  devLog("debug", "Assessment session determined", {
    requestId,
    sessionId,
    source: sessionIdFromQS ? "query_string" : (sessionIdFromBody ? "body" : "none")
  });

  let upstream: Response;
  // Helper to emit a Convex event (best-effort) and also push to in-memory bus for live UI updates
  const emitEvent = async (kind: string, payload: Record<string, unknown> = {}) => {
    try {
      if (!sessionId) return;
      // Persist to Convex events (mock or real)
      const convexUrl = convexBaseUrl();
      if (getEnvString("MOCK_CONVEX") === '1') {
        await mockConvex.logEvent({ userId: "unknown", sessionId, requestId, kind, payload });
      } else {
        const client = makeConvex(convexUrl);
        await client.mutation("functions/events:logEvent", { userId: "unknown", sessionId, requestId, kind, payload });
      }
      // Also broadcast on local bus so active pages can update immediately
      try { const bus = getBus('assess', sessionId); bus.emit('event', { type: kind.replace('_', ':'), sessionId, ...(payload || {}) }); } catch {}
    } catch {}
  };
  // Ensure rubricVersion is forced to v3 when forwarding to the AI API
  let forwardBodyBytes: ArrayBuffer = bodyBytes;
  try {
    const text = new TextDecoder().decode(bodyBytes);
    if (text) {
      const obj = JSON.parse(text);
      if (obj && typeof obj === 'object') {
        (obj as any).rubricVersion = 'v3';
        const encoded = new TextEncoder().encode(JSON.stringify(obj));
        forwardBodyBytes = encoded.buffer;
      }
    }
  } catch {}

  try {
    // Emit assessment start event prior to calling upstream
    await emitEvent("assess_run_initiated", {});
    devLog("debug", "Calling upstream AI API for assessment", {
      requestId,
      sessionId,
      upstreamUrl: `${aiApiBaseUrl()}/assessments/run${searchSuffix}`
    });

    upstream = await fetch(`${aiApiBaseUrl()}/assessments/run${searchSuffix}`, {
      method: "POST",
      headers,
      body: forwardBodyBytes,
      signal: controller.signal,
    });

    devLog("debug", "Upstream AI API response received", {
      requestId,
      sessionId,
      status: upstream.status,
      statusText: upstream.statusText
    });
  } catch (error) {
    devLog("error", "Upstream AI API call failed", {
      requestId,
      sessionId,
      error: String(error)
    });
    return new Response("Upstream unavailable", { status: 502 });
  }
  const convexUrl = getEnvString("CONVEX_URL") || getEnvString("NEXT_PUBLIC_CONVEX_URL") || "http://127.0.0.1:3210";
  const text = await upstream.text();
  devLog("debug", "Processing upstream response", {
    requestId,
    sessionId,
    upstreamOk: upstream.ok,
    responseLength: text.length
  });

  // Fire-and-forget: persist group/session baseline in Convex on success
  if (upstream.ok && text) {
    try {
      const payload = JSON.parse(text);
      const groupId: string | undefined = payload?.groupId;
      devLog("debug", "Processing successful assessment response", {
        requestId,
        sessionId,
        groupId,
        hasGroupId: !!groupId
      });

      // Emit accepted event with groupId
      await emitEvent("assess_upstream_accepted", { groupId });
      if (groupId && sessionId && convexUrl) {
        // Kick off orchestration to poll results and finalize into Convex, emitting assess_* events along the way
        try {
          const authz = headers.get("Authorization") || headers.get("authorization") || '';
          const { finalizeAssessmentsForGroups } = await import("../../assessments/orchestrator");
          // Run in background without awaiting response; UI will observe events and latest results
          void finalizeAssessmentsForGroups({
            sessionId,
            groupIds: [groupId],
            requestId,
            authz,
            logger: async (kind, payload) => { await emitEvent(kind, payload || {}); },
          });
          // Inform UI that orchestration has started for this group
          await emitEvent("assess_cadence_started", { groups: 1, skills: 0, groupId });
          devLog("debug", "Assessment orchestration started", {
            requestId,
            sessionId,
            groupId,
            orchestrationStarted: true
          });
        } catch (orchestratorError) {
          devLog("error", "Assessment orchestration failed", {
            requestId,
            sessionId,
            groupId,
            error: String(orchestratorError)
          });
          try { await emitEvent("assess_orchestrator_error", { groupId, error: String(orchestratorError || '') }); } catch {}
        }
      }
    } catch (parseError) {
      devLog("warn", "Failed to parse upstream response JSON", {
        requestId,
        sessionId,
        error: String(parseError)
      });
      // ignore JSON parse or Convex errors for proxy response path
    }
  }
  devLog("info", "Assessment run completed", {
    requestId,
    sessionId,
    upstreamStatus: upstream.status,
    responseLength: text.length
  });

  return new Response(text, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ||
        "application/json; charset=utf-8",
      "X-Accel-Buffering": "no",
      "Cache-Control": "no-store",
      "X-Request-Id": requestId,
      ...corsHeaders,
    },
  });
}

