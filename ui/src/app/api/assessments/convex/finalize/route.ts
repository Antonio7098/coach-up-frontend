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
  skillId: string;
  skillHash: string;
  level: number; // 0..10
  confidence?: number; // 0..1
  levelFeedback: {
    currentLevel: number;
    nextLevelCriteria: string[];
    strengths: string[];
    improvements: string[];
    focus: string[];
    examples?: string[];
  };
  assessmentMetadata: {
    provider?: string;
    modelId?: string;
    promptVersion?: string;
    processingTimeMs?: number;
    tokenCount?: number;
    costCents?: number;
  };
  sourceContext: {
    interactionCount?: number;
    transcriptLength?: number;
    assessmentType?: string;
    sessionDuration?: number;
  };
  // Legacy fields for backward compatibility
  metCriteria?: string[];
  unmetCriteria?: string[];
  feedback?: string[];
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
    if (!isNonEmptyString((item as any).skillId)) {
      return respond(400, { error: err('skillId must be non-empty string') });
    }
    if (!isNonEmptyString((item as any).skillHash)) {
      return respond(400, { error: err('skillHash must be non-empty string') });
    }
    const lvl = Number((item as any).level);
    if (!Number.isFinite(lvl) || lvl < 0 || lvl > 10) {
      return respond(400, { error: err('level must be a number between 0 and 10') });
    }
    const conf = (item as any).confidence;
    if (conf !== undefined && (typeof conf !== 'number' || conf < 0 || conf > 1)) {
      return respond(400, { error: err('confidence must be a number between 0 and 1') });
    }
    
    // Validate levelFeedback structure
    const levelFeedback = (item as any).levelFeedback;
    if (!levelFeedback || typeof levelFeedback !== 'object') {
      return respond(400, { error: err('levelFeedback must be an object') });
    }
    const lfErr = (msg: string) => err(`levelFeedback.${msg}`);
    const lvl2 = Number(levelFeedback.currentLevel);
    if (!Number.isFinite(lvl2) || lvl2 < 0 || lvl2 > 10) {
      return respond(400, { error: lfErr('currentLevel must be a number between 0 and 10') });
    }
    const isStrArr = (a: unknown) => Array.isArray(a) && a.every((x) => typeof x === 'string');
    if (!isStrArr(levelFeedback.nextLevelCriteria)) {
      return respond(400, { error: lfErr('nextLevelCriteria must be string[]') });
    }
    if (!isStrArr(levelFeedback.strengths)) {
      return respond(400, { error: lfErr('strengths must be string[]') });
    }
    if (!isStrArr(levelFeedback.improvements)) {
      return respond(400, { error: lfErr('improvements must be string[]') });
    }
    if (!isStrArr(levelFeedback.focus)) {
      return respond(400, { error: lfErr('focus must be string[]') });
    }
    if (levelFeedback.examples && !isStrArr(levelFeedback.examples)) {
      return respond(400, { error: lfErr('examples must be string[]') });
    }
    
    // Validate assessmentMetadata structure
    const assessmentMetadata = (item as any).assessmentMetadata;
    if (!assessmentMetadata || typeof assessmentMetadata !== 'object') {
      return respond(400, { error: err('assessmentMetadata must be an object') });
    }
    
    // Validate sourceContext structure
    const sourceContext = (item as any).sourceContext;
    if (!sourceContext || typeof sourceContext !== 'object') {
      return respond(400, { error: err('sourceContext must be an object') });
    }
  }

  // Compute privacy-preserving trackedSkillId hash from header (if present)
  const trackedSkillId = (request.headers.get("x-tracked-skill-id") || "").trim();
  const trackedSkillIdHash = trackedSkillId ? sha256Hex(trackedSkillId) : undefined;

  // Debug logging to verify incoming hashes and auth presence (no secrets logged)
  try {
    const hasAuth = !!(request.headers.get("authorization") || "").trim();
    const hashes = Array.from(new Set((payload!.summary.skillAssessments || []).map((a: any) => a.skillHash)));
    console.log(
      JSON.stringify(
        {
          where: "assess.finalize.request",
          sessionId: payload!.sessionId,
          groupId: payload!.groupId,
          assessments: (payload!.summary.skillAssessments || []).length,
          hashes,
          hasAuth,
        },
        null,
        0
      )
    );
  } catch {}

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
          skillId: item.skillId,
          skillHash: item.skillHash,
          level: item.level,
          confidence: item.confidence,
          levelFeedback: item.levelFeedback,
          assessmentMetadata: item.assessmentMetadata,
          sourceContext: item.sourceContext,
          rubricVersion: 'v2',
          // Legacy fields for backward compatibility
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

    const session = (await client.query("functions/sessions:getBySessionId", { sessionId: payload.sessionId })) as any;
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
        skillId: item.skillId,
        skillHash: item.skillHash,
        level: item.level,
        confidence: item.confidence,
        levelFeedback: item.levelFeedback,
        assessmentMetadata: item.assessmentMetadata,
        sourceContext: item.sourceContext,
        rubricVersion: 'v2',
        // Legacy fields for backward compatibility
        feedback: item.feedback,
        metCriteria: item.metCriteria,
        unmetCriteria: item.unmetCriteria,
        trackedSkillIdHash,
      });
    }
    for (const skillHash of uniqueSkillHashes) {
      await client.mutation("functions/skills:updateLevelFromRecentAssessments", {
        userId,
        sessionId: payload.sessionId,
        groupId: payload.groupId,
        skillHash,
      });
    }

    // Optionally persist a high-level summary document for this group so UI can retrieve latest summary
    try {
      const skillsCount = Array.isArray(payload.summary?.skillAssessments)
        ? payload.summary.skillAssessments.length
        : 0;
      const summaryDoc = {
        highlights: [],
        recommendations: [],
        rubricKeyPoints: [],
        meta: {
          skillsCount,
        },
      } as const;
      await client.mutation("assessments:persistAssessmentSummaryV2", {
        sessionId: payload.sessionId,
        groupId: payload.groupId,
        rubricVersion: 'v2',
        summary: summaryDoc,
      });
    } catch (e) {
      try { console.warn('[assessments.finalize] persist summary failed (non-fatal)', e); } catch {}
    }

    // Emit an assess event for observability
    try {
      const hashes = Array.from(uniqueSkillHashes);
      await client.mutation("events:logEvent", {
        userId,
        sessionId: payload.sessionId,
        groupId: payload.groupId,
        requestId: undefined,
        trackedSkillIdHash: trackedSkillIdHash,
        kind: 'assess_finalize_group',
        payload: { groupId: payload.groupId, skillsCount: hashes.length, hashes },
      });
    } catch {}

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
