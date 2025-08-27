export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { makeConvex } from "../../../lib/convex";
import * as mockConvex from "../../../lib/mockConvex";
import { sha256Hex } from "../../../lib/hash";
import { promMetrics } from "../../../lib/metrics";

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
    // Metrics: record as 500
    const modeLabel = process.env.MOCK_CONVEX === '1' ? 'mock' : 'real';
    promMetrics.requestsTotal.inc({ route: "assessments/convex/finalize", method: "POST", status: "500", mode: modeLabel });
    promMetrics.requestErrorsTotal.inc({ route: "assessments/convex/finalize", method: "POST", status: "500", mode: modeLabel });
    return new Response(JSON.stringify({ error: "Missing CONVEX_URL" }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders },
    });
  }

  // Optional bearer enforcement for server-to-server calls
  const expectedBearer = (process.env.PERSIST_ASSESSMENTS_SECRET || "").trim();
  const mockMode = process.env.MOCK_CONVEX === '1';
  const routeLabel = "assessments/convex/finalize";
  const methodLabel = "POST";
  const modeLabel = mockMode ? "mock" : "real";
  const endTimer = promMetrics.requestDurationSeconds.startTimer({ route: routeLabel, method: methodLabel, mode: modeLabel });

  const respond = (status: number, body: any) => {
    promMetrics.requestsTotal.inc({ route: routeLabel, method: methodLabel, status: String(status), mode: modeLabel });
    if (status >= 500) {
      promMetrics.requestErrorsTotal.inc({ route: routeLabel, method: methodLabel, status: String(status), mode: modeLabel });
    }
    endTimer({ status: String(status) });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders },
    });
  };
  if (expectedBearer && !mockMode) {
    const auth = (request.headers.get("authorization") || "").trim();
    if (auth !== `Bearer ${expectedBearer}`) {
      return respond(401, { error: "Unauthorized" });
    }
  }

  let payload: V2FinalizePayload | null = null;
  try {
    const text = await request.text();
    payload = JSON.parse(text);
  } catch {
    return respond(400, { error: "Invalid JSON" });
  }

  if (!payload?.sessionId || !payload?.groupId || !payload?.summary) {
    return respond(400, { error: "sessionId, groupId, and summary are required" });
  }

  // Runtime validations
  const isNonEmptyString = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
  if (!isNonEmptyString(payload.sessionId)) {
    return respond(400, { error: "sessionId must be a non-empty string" });
  }
  if (!isNonEmptyString(payload.groupId)) {
    return respond(400, { error: "groupId must be a non-empty string" });
  }
  if ((payload as any).rubricVersion !== 'v2') {
    return respond(400, { error: "rubricVersion must be 'v2'" });
  }
  const s = payload.summary as unknown;
  if (!s || typeof s !== 'object' || Array.isArray(s)) {
    return respond(400, { error: "summary must be an object" });
  }
  const sa = (s as any).skillAssessments as unknown;
  if (!Array.isArray(sa) || sa.length === 0) {
    return respond(400, { error: "summary.skillAssessments must be a non-empty array" });
  }
  for (const [idx, item] of (sa as any[]).entries()) {
    const err = (msg: string) => `skillAssessments[${idx}]: ${msg}`;
    if (!item || typeof item !== 'object') {
      return respond(400, { error: err('must be object') });
    }
    if (!isNonEmptyString((item as any).skillHash)) {
      return respond(400, { error: err('skillHash must be non-empty string') });
    }
    const lvl = Number((item as any).level);
    if (!Number.isFinite(lvl) || lvl < 0 || lvl > 10) {
      return respond(400, { error: err('level must be a number between 0 and 10') });
    }
    const isStrArr = (a: unknown) => Array.isArray(a) && a.every((x) => typeof x === 'string');
    if (!isStrArr((item as any).metCriteria)) {
      return respond(400, { error: err('metCriteria must be string[]') });
    }
    if (!isStrArr((item as any).unmetCriteria)) {
      return respond(400, { error: err('unmetCriteria must be string[]') });
    }
    if (!isStrArr((item as any).feedback)) {
      return respond(400, { error: err('feedback must be string[]') });
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
      return respond(200, { ok: true, mock: true });
    }

    // Real Convex path: first check idempotency, then resolve user and write per-skill rows
    const client = makeConvex(convexUrl);
    const existingFinalize = await client.query("assessments:checkFinalizeIdempotency", {
      sessionId: payload.sessionId,
      groupId: payload.groupId,
    });
    if (
      existingFinalize &&
      typeof (existingFinalize as any).completedAt === 'number' &&
      typeof (existingFinalize as any).expiresAt === 'number' &&
      Date.now() <= (existingFinalize as any).expiresAt
    ) {
      return respond(200, { status: "ok", processed: 0, idempotent: true });
    }

    const session = (await client.query("sessions:getBySessionId", { sessionId: payload.sessionId })) as any;
    const userId = session?.userId;
    if (!isNonEmptyString(userId)) {
      return respond(404, { error: "Could not resolve userId for sessionId" });
    }

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
        trackedSkillIdHash,
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

    // Mark as completed for idempotency
    await client.mutation("assessments:markFinalizeCompleted", {
      sessionId: payload.sessionId,
      groupId: payload.groupId,
    });

    return respond(200, { status: "ok", processed: payload.summary.skillAssessments.length, idempotent: false });
  } catch (err) {
    return respond(502, { error: "Finalize v2 failed", detail: String(err ?? '') });
  }
}
