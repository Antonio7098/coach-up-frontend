export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { ConvexHttpClient } from "convex/browser";
import * as mockConvex from "../../../lib/mockConvex";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Request-Id, Authorization",
  "Access-Control-Expose-Headers": "X-Request-Id",
};

type SummaryPayload = {
  sessionId: string;
  groupId: string;
  rubricVersion?: string;
  summary: {
    highlights: string[];
    recommendations: string[];
    rubricKeyPoints: string[];
  };
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: Request) {
  const convexUrl = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL || "http://127.0.0.1:3210";
  if (!convexUrl) {
    return new Response(JSON.stringify({ error: "Missing CONVEX_URL" }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders },
    });
  }

  // Optional bearer enforcement for server-to-server calls
  const expectedBearer = (process.env.PERSIST_ASSESSMENTS_SECRET || "").trim();
  const mockMode = process.env.MOCK_CONVEX === '1';
  if (expectedBearer && !mockMode) {
    const auth = (request.headers.get("authorization") || "").trim();
    if (auth !== `Bearer ${expectedBearer}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders },
      });
    }
  }

  let payload: SummaryPayload | null = null;
  try {
    const text = await request.text();
    payload = JSON.parse(text);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders },
    });
  }

  if (!payload?.sessionId || !payload?.groupId || !payload?.summary) {
    return new Response(JSON.stringify({ error: "sessionId, groupId, and summary are required" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders },
    });
  }

  try {
    const result = process.env.MOCK_CONVEX === '1'
      ? await mockConvex.finalizeAssessmentSummary({
          sessionId: payload.sessionId,
          groupId: payload.groupId,
          rubricVersion: payload.rubricVersion ?? "v1",
          summary: payload.summary,
        })
      : await new ConvexHttpClient(convexUrl).mutation("assessments:finalizeAssessmentSummary" as any, {
          sessionId: payload.sessionId,
          groupId: payload.groupId,
          rubricVersion: payload.rubricVersion ?? "v1",
          summary: payload.summary,
        });
    return new Response(JSON.stringify(result ?? { ok: true }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Convex mutation failed" }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders },
    });
  }
}
