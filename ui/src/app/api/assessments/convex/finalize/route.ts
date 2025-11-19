export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { makeConvex } from "../../../lib/convex";
import { sha256Hex } from "../../../lib/hash";
import { promMetrics } from "../../../lib/metrics";

// Only import mock functions when in mock mode to avoid TypeScript errors
const mockConvex = process.env.MOCK_CONVEX === '1' ? await import("../../../lib/mockConvex") : null;

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

type V3SkillAssessment = {
  skillId: string;
  skillHash: string;
  level: number;
  confidence?: number;
  structuredFeedback: {
    primaryTakeaway: string;
    primaryFocus: {
      description: string;
      nextLevelCriteria: string;
      exampleToPractice?: string;
    };
    annotatedExamples: Array<{
      userQuote: string;
      annotation: string;
      classification: 'strength' | 'improvement_opportunity';
      relevantLevel: number;
    }>;
  };
  quantitativeMetrics?: {
    averageTUnitLength?: number;
    subordinationIndex?: number;
    yngveScore?: number;
    nominalizationCount?: number;
    conjunctionVariety?: string[];
  };
  assessmentMetadata?: {
    provider?: string;
    modelId?: string;
    promptVersion?: string;
    tokenCount?: number;
    costCents?: number;
    processingTimeMs?: number;
  };
  sourceContext?: {
    assessmentType?: string;
    interactionCount?: number;
    transcriptLength?: number;
    sessionDuration?: number;
  };
  // Legacy fields for backward compatibility
  metCriteria?: string[];
  unmetCriteria?: string[];
  feedback?: string[];
};

type V3FinalizePayload = {
  sessionId: string;
  groupId: string;
  rubricVersion: "v3";
  results: {
    skillAssessments: V3SkillAssessment[];
    highlights: string[];
    recommendations: string[];
    rubricKeyPoints: string[];
    meta: {
      skillsCount: number;
      provider?: string;
      modelId?: string;
    };
    kpis: {
      averageLevel: number;
      totalScore: number;
    };
    assessmentMetadata?: {
      provider?: string;
      modelId?: string;
      promptVersion?: string;
      tokenCount?: number;
      costCents?: number;
      processingTimeMs?: number;
    };
  };
};

function sanitizeAssessmentMetadata(meta: any) {
  try {
    const out: any = {};
    if (!meta || typeof meta !== 'object') return out;
    const provider = typeof meta.provider === 'string' ? meta.provider : undefined;
    const modelId = typeof meta.modelId === 'string' ? meta.modelId : undefined;
    const promptVersion = typeof meta.promptVersion === 'string' ? meta.promptVersion : undefined;
    const processingTimeMs = Number(meta.processingTimeMs);
    const tokenCount = Number(meta.tokenCount);
    const rawCost = (meta as any).costCents;
    const costCents = (rawCost === null || rawCost === undefined)
      ? undefined
      : (typeof rawCost === 'number' && Number.isFinite(rawCost))
        ? rawCost
        : (Number.isFinite(Number(rawCost)) ? Number(rawCost) : undefined);
    if (provider) out.provider = provider;
    if (modelId) out.modelId = modelId;
    if (promptVersion) out.promptVersion = promptVersion;
    if (Number.isFinite(processingTimeMs)) out.processingTimeMs = processingTimeMs;
    if (Number.isFinite(tokenCount)) out.tokenCount = tokenCount;
    if (costCents !== undefined) out.costCents = costCents;
    return out;
  } catch {
    return {};
  }
}

function sanitizeSourceContext(ctx: any) {
  try {
    const out: any = {};
    if (!ctx || typeof ctx !== 'object') {
      out.assessmentType = 'unknown';
      return out;
    }
    const interactionCount = Number(ctx.interactionCount);
    if (Number.isFinite(interactionCount)) out.interactionCount = interactionCount;
    const transcriptLength = Number(ctx.transcriptLength);
    if (Number.isFinite(transcriptLength)) out.transcriptLength = transcriptLength;
    const sessionDuration = Number(ctx.sessionDuration);
    if (Number.isFinite(sessionDuration)) out.sessionDuration = sessionDuration;
    out.assessmentType = typeof ctx.assessmentType === 'string' ? ctx.assessmentType : 'unknown';
    return out;
  } catch {
    return { assessmentType: 'unknown' };
  }
}

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

  if (!payload?.sessionId || !payload?.groupId || !payload?.results) {
    return respond(400, { error: "sessionId, groupId, and results are required" });
  }

  // Runtime validations
  const isNonEmptyString = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
  if (!isNonEmptyString(payload.sessionId)) {
    return respond(400, { error: "sessionId must be a non-empty string" });
  }
  if (!isNonEmptyString(payload.groupId)) {
    return respond(400, { error: "groupId must be a non-empty string" });
  }
  if ((payload as any).rubricVersion !== 'v3') {
    return respond(400, { error: "rubricVersion must be 'v3'" });
  }
  const r = payload.results as unknown;
  if (!r || typeof r !== 'object' || Array.isArray(r)) {
    return respond(400, { error: "results must be an object" });
  }
  const sa = (r as any).skillAssessments as unknown;
  if (!Array.isArray(sa) || sa.length === 0) {
    return respond(400, { error: "results.skillAssessments must be a non-empty array" });
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

    // Validate structuredFeedback structure
    const structuredFeedback = (item as any).structuredFeedback;
    if (!structuredFeedback || typeof structuredFeedback !== 'object') {
      return respond(400, { error: err('structuredFeedback must be an object') });
    }
    const sfErr = (msg: string) => err(`structuredFeedback.${msg}`);
    if (!isNonEmptyString(structuredFeedback.primaryTakeaway)) {
      return respond(400, { error: sfErr('primaryTakeaway must be non-empty string') });
    }
    const primaryFocus = structuredFeedback.primaryFocus;
    if (!primaryFocus || typeof primaryFocus !== 'object') {
      return respond(400, { error: sfErr('primaryFocus must be an object') });
    }
    if (!isNonEmptyString(primaryFocus.description)) {
      return respond(400, { error: sfErr('primaryFocus.description must be non-empty string') });
    }
    if (!isNonEmptyString(primaryFocus.nextLevelCriteria)) {
      return respond(400, { error: sfErr('primaryFocus.nextLevelCriteria must be non-empty string') });
    }
    const annotatedExamples = structuredFeedback.annotatedExamples;
    if (!Array.isArray(annotatedExamples)) {
      return respond(400, { error: sfErr('annotatedExamples must be array') });
    }
    for (const [exIdx, example] of annotatedExamples.entries()) {
      const exErr = (msg: string) => sfErr(`annotatedExamples[${exIdx}].${msg}`);
      if (!example || typeof example !== 'object') {
        return respond(400, { error: exErr('must be object') });
      }
      if (!isNonEmptyString(example.userQuote)) {
        return respond(400, { error: exErr('userQuote must be non-empty string') });
      }
      if (!isNonEmptyString(example.annotation)) {
        return respond(400, { error: exErr('annotation must be non-empty string') });
      }
      if (!['strength', 'improvement_opportunity'].includes(example.classification)) {
        return respond(400, { error: exErr('classification must be "strength" or "improvement_opportunity"') });
      }
      const relLvl = Number(example.relevantLevel);
      if (!Number.isFinite(relLvl) || relLvl < 0 || relLvl > 10) {
        return respond(400, { error: exErr('relevantLevel must be a number between 0 and 10') });
      }
    }

    // Validate quantitativeMetrics structure (optional)
    const quantitativeMetrics = (item as any).quantitativeMetrics;
    if (quantitativeMetrics && typeof quantitativeMetrics === 'object') {
      const qmErr = (msg: string) => err(`quantitativeMetrics.${msg}`);
      // All fields are optional, just validate types if present
      if (quantitativeMetrics.averageTUnitLength !== undefined && typeof quantitativeMetrics.averageTUnitLength !== 'number') {
        return respond(400, { error: qmErr('averageTUnitLength must be a number') });
      }
      if (quantitativeMetrics.subordinationIndex !== undefined && typeof quantitativeMetrics.subordinationIndex !== 'number') {
        return respond(400, { error: qmErr('subordinationIndex must be a number') });
      }
      if (quantitativeMetrics.yngveScore !== undefined && typeof quantitativeMetrics.yngveScore !== 'number') {
        return respond(400, { error: qmErr('yngveScore must be a number') });
      }
      if (quantitativeMetrics.nominalizationCount !== undefined && typeof quantitativeMetrics.nominalizationCount !== 'number') {
        return respond(400, { error: qmErr('nominalizationCount must be a number') });
      }
      if (quantitativeMetrics.conjunctionVariety !== undefined && !Array.isArray(quantitativeMetrics.conjunctionVariety)) {
        return respond(400, { error: qmErr('conjunctionVariety must be an array') });
      }
    }

    // Validate assessmentMetadata structure (optional)
    const assessmentMetadata = (item as any).assessmentMetadata;
    if (assessmentMetadata && typeof assessmentMetadata === 'object') {
      // All fields are optional, just validate types if present
      if (assessmentMetadata.provider && typeof assessmentMetadata.provider !== 'string') {
        return respond(400, { error: err('assessmentMetadata.provider must be a string') });
      }
      if (assessmentMetadata.modelId && typeof assessmentMetadata.modelId !== 'string') {
        return respond(400, { error: err('assessmentMetadata.modelId must be a string') });
      }
      if (assessmentMetadata.promptVersion && typeof assessmentMetadata.promptVersion !== 'string') {
        return respond(400, { error: err('assessmentMetadata.promptVersion must be a string') });
      }
      if (assessmentMetadata.tokenCount !== undefined && typeof assessmentMetadata.tokenCount !== 'number') {
        return respond(400, { error: err('assessmentMetadata.tokenCount must be a number') });
      }
      if (assessmentMetadata.costCents !== undefined && typeof assessmentMetadata.costCents !== 'number') {
        return respond(400, { error: err('assessmentMetadata.costCents must be a number') });
      }
      if (assessmentMetadata.processingTimeMs !== undefined && typeof assessmentMetadata.processingTimeMs !== 'number') {
        return respond(400, { error: err('assessmentMetadata.processingTimeMs must be a number') });
      }
    }

    // Validate sourceContext structure (optional)
    const sourceContext = (item as any).sourceContext;
    if (sourceContext && typeof sourceContext === 'object') {
      // All fields are optional, just validate types if present
      if (sourceContext.assessmentType && typeof sourceContext.assessmentType !== 'string') {
        return respond(400, { error: err('sourceContext.assessmentType must be a string') });
      }
      if (sourceContext.interactionCount !== undefined && typeof sourceContext.interactionCount !== 'number') {
        return respond(400, { error: err('sourceContext.interactionCount must be a number') });
      }
      if (sourceContext.transcriptLength !== undefined && typeof sourceContext.transcriptLength !== 'number') {
        return respond(400, { error: err('sourceContext.transcriptLength must be a number') });
      }
      if (sourceContext.sessionDuration !== undefined && typeof sourceContext.sessionDuration !== 'number') {
        return respond(400, { error: err('sourceContext.sessionDuration must be a number') });
      }
    }
  }

  // Compute privacy-preserving trackedSkillId hash from header (if present)
  const trackedSkillId = (request.headers.get("x-tracked-skill-id") || "").trim();
  const trackedSkillIdHash = trackedSkillId ? sha256Hex(trackedSkillId) : undefined;

  // Debug logging to verify incoming hashes and auth presence (no secrets logged)
  try {
    const hasAuth = !!(request.headers.get("authorization") || "").trim();
    const hashes = Array.from(new Set((payload!.results.skillAssessments || []).map((a: any) => a.skillHash)));
    console.log(
      JSON.stringify(
        {
          where: "assess.finalize.request",
          sessionId: payload!.sessionId,
          groupId: payload!.groupId,
          assessments: (payload!.results.skillAssessments || []).length,
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
    // Log validation success summary (no sensitive fields)
    try {
      console.log(JSON.stringify({ where: 'assess.finalize.validated', sessionId: payload.sessionId, groupId: payload.groupId, items: payload.results.skillAssessments.length }));
    } catch {}
    if (isMock) {
      // Mock path: accept and record per-skill rows, then simulate level updates
      const uniqueSkillHashes = new Set<string>();
for (const item of payload.results.skillAssessments) {
        uniqueSkillHashes.add(item.skillHash);
        const sanitizedMeta = sanitizeAssessmentMetadata(item.assessmentMetadata);
        const sanitizedCtx = sanitizeSourceContext(item.sourceContext);
        if ((item as any)?.assessmentMetadata?.costCents === null) {
          try { console.log(JSON.stringify({ where: 'assess.finalize.sanitize', field: 'assessmentMetadata.costCents', from: null, to: undefined })); } catch {}
        }
        if (typeof (item as any)?.sourceContext?.assessmentType !== 'string') {
          try { console.log(JSON.stringify({ where: 'assess.finalize.sanitize', field: 'sourceContext.assessmentType', from: (item as any)?.sourceContext?.assessmentType ?? null, to: sanitizedCtx.assessmentType })); } catch {}
        }
        await (mockConvex as any)?.recordSkillAssessmentV3({
          userId: 'unknown',
          sessionId: payload.sessionId,
          groupId: payload.groupId,
          skillId: item.skillId,
          skillHash: item.skillHash,
          level: item.level,
          confidence: item.confidence,
          structuredFeedback: item.structuredFeedback,
          quantitativeMetrics: item.quantitativeMetrics,
          assessmentMetadata: sanitizedMeta,
          sourceContext: sanitizedCtx,
          rubricVersion: 'v3',
          // Legacy fields for backward compatibility
          feedback: item.feedback,
          metCriteria: item.metCriteria,
          unmetCriteria: item.unmetCriteria,
          trackedSkillIdHash,
        });
      }
      for (const skillHash of uniqueSkillHashes) {
        await (mockConvex as any)?.updateLevelFromRecentAssessments({
          userId: 'unknown',
          sessionId: payload.sessionId,
          groupId: payload.groupId,
          skillHash,
        });
      }
      // Update session pointer so UI can pick up the latest group immediately
      try {
        await (mockConvex as any)?.updateSessionState({
          userId: 'unknown',
          sessionId: payload.sessionId,
          state: {},
          latestGroupId: payload.groupId,
        });
      } catch {}
      return respond(200, { ok: true, mock: true });
    }

    // Real Convex path: first check idempotency, then resolve user and write per-skill rows
    const client = makeConvex(convexUrl);
    try { console.log(JSON.stringify({ where: 'assess.finalize.step', step: 'check_idempotency_start', sessionId: payload.sessionId, groupId: payload.groupId })); } catch {}
    const existingFinalize = await client.query("assessments:checkFinalizeIdempotency", {
      sessionId: payload.sessionId,
      groupId: payload.groupId,
    });
    try { console.log(JSON.stringify({ where: 'assess.finalize.step', step: 'check_idempotency_end', hasExisting: !!existingFinalize })); } catch {}
    if (
      existingFinalize &&
      typeof (existingFinalize as any).completedAt === 'number' &&
      typeof (existingFinalize as any).expiresAt === 'number' &&
      Date.now() <= (existingFinalize as any).expiresAt
    ) {
      return respond(200, { status: "ok", processed: 0, idempotent: true });
    }

    try { console.log(JSON.stringify({ where: 'assess.finalize.step', step: 'get_session_start' })); } catch {}
    const session = (await client.query("functions/sessions:getBySessionId", { sessionId: payload.sessionId })) as any;
    try { console.log(JSON.stringify({ where: 'assess.finalize.step', step: 'get_session_end', hasSession: !!session })); } catch {}
    const userId = session?.userId;
    if (!isNonEmptyString(userId)) {
      return respond(404, { error: "Could not resolve userId for sessionId" });
    }

    // Create group-level assessment and set latestAssessmentId
    let assessmentId: string | null = null;
    try {
      const itemsArr: any[] = Array.isArray(payload.results?.skillAssessments) ? payload.results!.skillAssessments as any[] : [];
      const levels = itemsArr.map((i) => Number((i as any).level)).filter((n) => Number.isFinite(n));
      const skillsCount = itemsArr.length;
      const averageLevel = levels.length > 0 ? (levels.reduce((a, b) => a + b, 0) / levels.length) : 0;
      const totalScore = averageLevel / 10;
      const resultsDoc = { 
        highlights: Array.isArray(payload.results.highlights) ? payload.results.highlights : [],
        recommendations: Array.isArray(payload.results.recommendations) ? payload.results.recommendations : [],
        rubricKeyPoints: Array.isArray(payload.results.rubricKeyPoints) ? payload.results.rubricKeyPoints : [],
        meta: { skillsCount, ...(payload.results.meta || {}) }
      } as const;
      try { console.log(JSON.stringify({ where: 'assess.finalize.step', step: 'create_assessment_v3_start', skillsCount })); } catch {}
      const created: any = await client.mutation("assessments_v3:createAssessmentV3", {
        userId,
        sessionId: payload.sessionId,
        groupId: payload.groupId,
        results: {
          highlights: payload.results.highlights || [],
          recommendations: payload.results.recommendations || [],
          rubricKeyPoints: payload.results.rubricKeyPoints || [],
          meta: payload.results.meta,
        },
        kpis: payload.results.kpis,
        assessmentMetadata: payload.results.assessmentMetadata,
      });
      try { console.log(JSON.stringify({ where: 'assess.finalize.step', step: 'create_assessment_end', assessmentId: created?.assessmentId || null })); } catch {}
      assessmentId = (created && typeof created.assessmentId === 'string') ? created.assessmentId : null;
      try { await client.mutation("functions/events:logEvent", { userId, sessionId: payload.sessionId, groupId: payload.groupId, requestId: undefined, kind: 'assess_create_result', payload: { assessmentId, skillsCount, averageLevel, totalScore } }); } catch {}
      if (assessmentId) {
        try {
          await client.mutation("functions/sessions:updateSessionState", {
            userId,
            sessionId: payload.sessionId,
            state: {},
            latestAssessmentId: assessmentId,
          });
        } catch (e) {
          try { console.warn(JSON.stringify({ where: 'assess.finalize.latestAssessment.warn', sessionId: payload.sessionId, assessmentId, error: String(e || '') })); } catch {}
        }
      }
    } catch (e) {
      try { await client.mutation("functions/events:logEvent", { userId, sessionId: payload.sessionId, groupId: payload.groupId, requestId: undefined, kind: 'assess_create_error', payload: { error: String(e || '') } }); } catch {}
    }

    // Insert per-skill results and collect hashes for level updates
    const uniqueSkillHashes = new Set<string>();
    const perItemForUpdate: Array<{ skillId: string; skillHash: string }> = [];
    try {
      const items: any[] = Array.isArray(payload.results?.skillAssessments) ? payload.results!.skillAssessments as any[] : [];
      try { console.log(JSON.stringify({ where: 'assess.finalize.step', step: 'insert_skill_results_prepare', count: items.length })); } catch {}
      const mapped = items.map((it) => {
        const sid = String((it as any).skillId || '');
        const sh = String((it as any).skillHash || '');
        perItemForUpdate.push({ skillId: sid, skillHash: sh });
        uniqueSkillHashes.add(sh);
        const sanitizedMeta = sanitizeAssessmentMetadata((it as any).assessmentMetadata);
        const sanitizedCtx = sanitizeSourceContext((it as any).sourceContext);
        const lvl = Number((it as any).level || 0);
        return {
          assessmentId,
          userId,
          sessionId: payload.sessionId,
          groupId: payload.groupId,
          skillId: sid,
          skillHash: sh,
          level: lvl,
          confidence: (it as any).confidence,
          structuredFeedback: (it as any).structuredFeedback || {
            primaryTakeaway: '',
            primaryFocus: {
              description: '',
              nextLevelCriteria: '',
            },
            annotatedExamples: [],
          },
          quantitativeMetrics: (it as any).quantitativeMetrics,
          assessmentMetadata: sanitizedMeta,
          sourceContext: sanitizedCtx,
        };
      });
      await client.mutation("skill_assessment_v3:insertSkillResultsV3", { items: mapped });
      try { console.log(JSON.stringify({ where: 'assess.finalize.step', step: 'insert_skill_results_end', inserted: mapped.length })); } catch {}
      try { await client.mutation("functions/events:logEvent", { userId, sessionId: payload.sessionId, groupId: payload.groupId, requestId: undefined, kind: 'assess_insert_result', payload: { count: mapped.length } }); } catch {}
    } catch (e) {
      try { await client.mutation("functions/events:logEvent", { userId, sessionId: payload.sessionId, groupId: payload.groupId, requestId: undefined, kind: 'assess_insert_error', payload: { error: String(e || '') } }); } catch {}
      try { console.warn(JSON.stringify({ where: 'assess.finalize.error', step: 'insert_skill_results', error: String(e || '') })); } catch {}
    }

    // Level updates (non-fatal). Pass both skillHash and skillId for future-proofing.
    for (const item of perItemForUpdate) {
      const skillHash = item.skillHash;
      const skillIdForFallback = item.skillId;
      try {
        await client.mutation("functions/skills:updateLevelFromRecentAssessments", {
          userId,
          sessionId: payload.sessionId,
          groupId: payload.groupId,
          skillHash,
          // Optional extra param; safe to include even if Convex ignores it today.
          skillId: skillIdForFallback,
        } as any);
      } catch (e) {
        try {
          console.warn(JSON.stringify({ where: 'assess.finalize.levelUpdate.warn', sessionId: payload.sessionId, groupId: payload.groupId, skillHash, skillId: skillIdForFallback, error: String(e || '') }));
        } catch {}
        // Continue without failing the whole finalize
      }
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
    try { console.log(JSON.stringify({ where: 'assess.finalize.step', step: 'mark_finalize_completed_start' })); } catch {}
    await client.mutation("assessments:markFinalizeCompleted", {
      sessionId: payload.sessionId,
      groupId: payload.groupId,
    });
    try { console.log(JSON.stringify({ where: 'assess.finalize.step', step: 'mark_finalize_completed_end' })); } catch {}

    // Update session pointer so UI can pick up the latest group immediately
    try {
      // Ensure session exists (and rotate if needed) before updating state
      const idleRaw = process.env.UI_SESSION_IDLE_MS;
      const idleN = idleRaw ? Number(idleRaw) : NaN;
      const idleThresholdMs = Number.isFinite(idleN) && idleN > 0 ? idleN : 10 * 60 * 1000;
      const nowMs = Date.now();
      try {
        await client.mutation("functions/sessions:ensureActiveSession", {
          userId,
          sessionIdHint: payload.sessionId,
          nowMs,
          idleThresholdMs,
        });
      } catch {}

      await client.mutation("functions/sessions:updateSessionState", {
        userId,
        sessionId: payload.sessionId,
        state: {},
        latestGroupId: payload.groupId,
      });
    } catch (e) {
      try { console.warn(JSON.stringify({ where: 'assess.finalize.latestGroup.warn', sessionId: payload.sessionId, groupId: payload.groupId, error: String(e || '') })); } catch {}
    }

    return respond(200, { status: "ok", processed: payload.results.skillAssessments.length, idempotent: false });
  } catch (err) {
    try {
      console.warn(JSON.stringify({ where: 'assess.finalize.error', error: String((err as any)?.message || err), stack: (err as any)?.stack || null }));
    } catch {}
    // Add minimal context for debugging 502s without leaking payload content
    try {
      console.warn(JSON.stringify({ where: 'assess.finalize.catch', sessionId: payload?.sessionId || null, groupId: payload?.groupId || null }));
    } catch {}
    return respond(502, { error: "Finalize v2 failed", detail: String(err ?? '') });
  }
}
