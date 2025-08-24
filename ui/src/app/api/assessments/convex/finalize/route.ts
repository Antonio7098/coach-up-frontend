export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { makeConvex } from "../../../lib/convex";
import * as mockConvex from "../../../lib/mockConvex";
import { sha256Hex } from "../../../lib/hash";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Request-Id, X-Tracked-Skill-Id, Authorization",
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

  // Runtime validations
  const isNonEmptyString = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
  if (!isNonEmptyString(payload.sessionId)) {
    return new Response(JSON.stringify({ error: "sessionId must be a non-empty string" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders },
    });
  }
  if (!isNonEmptyString(payload.groupId)) {
    return new Response(JSON.stringify({ error: "groupId must be a non-empty string" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders },
    });
  }
  if (payload.rubricVersion !== undefined && payload.rubricVersion !== null && !isNonEmptyString(payload.rubricVersion)) {
    return new Response(JSON.stringify({ error: "rubricVersion, if provided, must be a non-empty string" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders },
    });
  }
  const s = payload.summary as unknown;
  const isStringArray = (a: unknown) => Array.isArray(a) && a.every((x) => typeof x === 'string');
  if (
    !s || typeof s !== 'object' || Array.isArray(s) ||
    !isStringArray((s as { highlights: unknown }).highlights) ||
    !isStringArray((s as { recommendations: unknown }).recommendations) ||
    !isStringArray((s as { rubricKeyPoints: unknown }).rubricKeyPoints)
  ) {
    return new Response(JSON.stringify({ error: "summary must include arrays of strings for highlights, recommendations, and rubricKeyPoints" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders },
    });
  }

  // Compute privacy-preserving trackedSkillId hash from header (if present)
  const trackedSkillId = (request.headers.get("x-tracked-skill-id") || "").trim();
  const trackedSkillIdHash = trackedSkillId ? sha256Hex(trackedSkillId) : undefined;

  try {
    const result = process.env.MOCK_CONVEX === '1'
      ? await mockConvex.persistAssessmentSummary({
          sessionId: payload.sessionId,
          groupId: payload.groupId,
          rubricVersion: (payload.rubricVersion ?? "v1") as string,
          summary: payload.summary,
          trackedSkillIdHash,
        })
      : await ((): Promise<unknown> => {
          const client = makeConvex(convexUrl);
          return client.mutation("assessments:persistAssessmentSummary", {
            sessionId: payload.sessionId,
            groupId: payload.groupId,
            rubricVersion: payload.rubricVersion ?? "v1",
            summary: payload.summary,
            trackedSkillIdHash,
          });
        })();
    return new Response(JSON.stringify(result ?? { ok: true }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Convex mutation failed" }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders },
    });
  }
}
