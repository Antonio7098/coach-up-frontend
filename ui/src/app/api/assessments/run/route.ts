export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Convex helper
import { makeConvex } from "../../lib/convex";
import * as mockConvex from "../../lib/mockConvex";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Request-Id, X-Tracked-Skill-Id",
  "Access-Control-Expose-Headers": "X-Request-Id",
};

function aiApiBaseUrl() {
  return (
    process.env.AI_API_BASE_URL ||
    process.env.NEXT_PUBLIC_AI_API_BASE_URL ||
    "http://127.0.0.1:8000"
  );
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
      }
    }
  } catch {}

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

  let upstream: Response;
  try {
    upstream = await fetch(`${aiApiBaseUrl()}/assessments/run${searchSuffix}`, {
      method: "POST",
      headers,
      body: bodyBytes,
      signal: controller.signal,
    });
  } catch {
    return new Response("Upstream unavailable", { status: 502 });
  }
  const convexUrl = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL || "http://127.0.0.1:3210";
  const text = await upstream.text();
  // Fire-and-forget: persist group/session baseline in Convex on success
  if (upstream.ok && text) {
    try {
      const payload = JSON.parse(text);
      const groupId: string | undefined = payload?.groupId;
      if (groupId && sessionId && convexUrl) {
        if (process.env.MOCK_CONVEX === '1') {
          await mockConvex.createAssessmentGroup({
            sessionId,
            groupId,
            rubricVersion: "v1",
          });
        } else {
          const client = makeConvex(convexUrl);
          await client.mutation("assessments:createAssessmentGroup", {
            sessionId,
            groupId,
            rubricVersion: "v1",
          });
        }
      }
    } catch {
      // ignore JSON parse or Convex errors for proxy response path
    }
  }
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
