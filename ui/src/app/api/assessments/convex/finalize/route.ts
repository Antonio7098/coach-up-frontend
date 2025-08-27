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

type V2SkillAssessment = {
  skillHash: string;
  level: number; // 0..10
  metCriteria: string[];
  unmetCriteria: string[];
  feedback: string[];
};

type V2FinalizePayload = {
  sessionId: string;
  groupId: string;
  rubricVersion: "v2";
  summary: {
    skillAssessments: V2SkillAssessment[];
    meta?: Record<string, unknown>;
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

  let payload: V2FinalizePayload | null = null;
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
  if ((payload as any).rubricVersion !== 'v2') {
    return new Response(JSON.stringify({ error: "rubricVersion must be 'v2'" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders },
    });
  }
  const s = payload.summary as unknown;
  if (!s || typeof s !== 'object' || Array.isArray(s)) {
    return new Response(JSON.stringify({ error: "summary must be an object" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders },
    });
  }
  const sa = (s as any).skillAssessments as unknown;
  if (!Array.isArray(sa) || sa.length === 0) {
    return new Response(JSON.stringify({ error: "summary.skillAssessments must be a non-empty array" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders },
    });
  }
  for (const [idx, item] of (sa as any[]).entries()) {
    const err = (msg: string) => `skillAssessments[${idx}]: ${msg}`;
    if (!item || typeof item !== 'object') {
      return new Response(JSON.stringify({ error: err('must be object') }), { status: 400, headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders } });
    }
    if (!isNonEmptyString((item as any).skillHash)) {
      return new Response(JSON.stringify({ error: err('skillHash must be non-empty string') }), { status: 400, headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders } });
    }
    const lvl = Number((item as any).level);
    if (!Number.isFinite(lvl) || lvl < 0 || lvl > 10) {
      return new Response(JSON.stringify({ error: err('level must be a number between 0 and 10') }), { status: 400, headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders } });
    }
    const isStrArr = (a: unknown) => Array.isArray(a) && a.every((x) => typeof x === 'string');
    if (!isStrArr((item as any).metCriteria)) {
      return new Response(JSON.stringify({ error: err('metCriteria must be string[]') }), { status: 400, headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders } });
    }
    if (!isStrArr((item as any).unmetCriteria)) {
      return new Response(JSON.stringify({ error: err('unmetCriteria must be string[]') }), { status: 400, headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders } });
    }
    if (!isStrArr((item as any).feedback)) {
      return new Response(JSON.stringify({ error: err('feedback must be string[]') }), { status: 400, headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders } });
    }
  }

  // Compute privacy-preserving trackedSkillId hash from header (if present)
  const trackedSkillId = (request.headers.get("x-tracked-skill-id") || "").trim();
  const trackedSkillIdHash = trackedSkillId ? sha256Hex(trackedSkillId) : undefined;

  try {
    const isMock = process.env.MOCK_CONVEX === '1';
    if (isMock) {
      // Mock path: accept and record per-skill rows, then simulate level updates
      const uniqueSkillHashes = new Set<string>();
      for (const item of payload.summary.skillAssessments) {
        uniqueSkillHashes.add(item.skillHash);
        await mockConvex.recordSkillAssessmentV2({
          userId: 'unknown',
          sessionId: payload.sessionId,
          groupId: payload.groupId,
          skillHash: item.skillHash,
          level: item.level,
          rubricVersion: 'v2',
          feedback: item.feedback,
          metCriteria: item.metCriteria,
          unmetCriteria: item.unmetCriteria,
          trackedSkillIdHash,
        });
      }
      for (const skillHash of uniqueSkillHashes) {
        await mockConvex.updateLevelFromRecentAssessments({
          userId: 'unknown',
          sessionId: payload.sessionId,
          groupId: payload.groupId,
          skillHash,
        });
      }
      return new Response(JSON.stringify({ ok: true, mock: true }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders },
      });
    }

    // Real Convex path: resolve userId then write per-skill rows (v2-only API)
    const client = makeConvex(convexUrl);
    const session = (await client.query("sessions:getBySessionId", { sessionId: payload.sessionId })) as any;
    const userId = session?.userId;
    if (!isNonEmptyString(userId)) {
      return new Response(JSON.stringify({ error: "Could not resolve userId for sessionId" }), {
        status: 404,
        headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders },
      });
    }

    try {
      const uniqueSkillHashes = new Set<string>();
      for (const item of payload.summary.skillAssessments) {
        uniqueSkillHashes.add(item.skillHash);
        await client.mutation("assessments:recordSkillAssessmentV2", {
          userId,
          sessionId: payload.sessionId,
          groupId: payload.groupId,
          skillHash: item.skillHash,
          level: item.level,
          rubricVersion: 'v2',
          feedback: item.feedback,
          metCriteria: item.metCriteria,
          unmetCriteria: item.unmetCriteria,
        });
      }
      for (const skillHash of uniqueSkillHashes) {
        await client.mutation("skills:updateLevelFromRecentAssessments", {
          userId,
          sessionId: payload.sessionId,
          groupId: payload.groupId,
          skillHash,
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Convex v2 functions not available yet", detail: String(err ?? '') }), {
        status: 501,
        headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders },
      });
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: "Finalize v2 failed", detail: String(e ?? '') }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders },
    });
  }
}
