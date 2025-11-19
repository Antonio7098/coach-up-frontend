export const runtime = "nodejs";

import { makeConvex } from "../lib/convex";
import * as mockConvex from "../lib/mockConvex";
import { sha256Hex } from "../lib/hash";

function convexBaseUrl() {
  return process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL || "http://127.0.0.1:3210";
}

// Deterministic aggregation of per-skill results into group-level summary
function aggregateToV3GroupResults(skillAssessments: any[]) {
  const highlights: string[] = [];
  const recommendations: string[] = [];
  const rubricKeyPoints: string[] = [];
  let skillsCount = skillAssessments.length;
  let provider: string | undefined;
  let modelId: string | undefined;
  let totalTokenCount = 0;
  let totalCostCents = 0;
  let totalProcessingTimeMs = 0;

  for (const skill of skillAssessments) {
    // Collect highlights from primaryTakeaway or strength examples
    if (skill.structuredFeedback?.primaryTakeaway) {
      highlights.push(skill.structuredFeedback.primaryTakeaway);
    }

    // Collect recommendations from primaryFocus.description
    if (skill.structuredFeedback?.primaryFocus?.description) {
      recommendations.push(skill.structuredFeedback.primaryFocus.description);
    }

    // Collect rubricKeyPoints from nextLevelCriteria
    if (skill.structuredFeedback?.primaryFocus?.nextLevelCriteria) {
      rubricKeyPoints.push(skill.structuredFeedback.primaryFocus.nextLevelCriteria);
    }

    // Aggregate metadata
    const meta = skill.assessmentMetadata || {};
    if (meta.provider && !provider) provider = meta.provider;
    if (meta.modelId && !modelId) modelId = meta.modelId;
    if (meta.tokenCount) totalTokenCount += meta.tokenCount;
    if (meta.costCents) totalCostCents += meta.costCents;
    if (meta.processingTimeMs) totalProcessingTimeMs += meta.processingTimeMs;
  }

  // Dedupe and cap arrays
  const deduplicatedHighlights = [...new Set(highlights)].slice(0, 3);
  const deduplicatedRecommendations = [...new Set(recommendations)].slice(0, 3);
  const deduplicatedRubricKeyPoints = [...new Set(rubricKeyPoints)].slice(0, 5);

  const meta = {
    skillsCount,
    ...(provider && { provider }),
    ...(modelId && { modelId }),
  };

  // Calculate KPIs
  const levels = skillAssessments.map(s => s.level).filter(l => Number.isFinite(l));
  const averageLevel = levels.length > 0 ? levels.reduce((a, b) => a + b, 0) / levels.length : 0;
  const totalScore = averageLevel / 10;

  const kpis = {
    averageLevel,
    totalScore,
  };

  const assessmentMetadata = {
    ...(totalTokenCount > 0 && { tokenCount: totalTokenCount }),
    ...(totalCostCents > 0 && { costCents: totalCostCents }),
    ...(totalProcessingTimeMs > 0 && { processingTimeMs: totalProcessingTimeMs }),
  };

  return {
    highlights: deduplicatedHighlights,
    recommendations: deduplicatedRecommendations,
    rubricKeyPoints: deduplicatedRubricKeyPoints,
    meta,
    kpis,
    assessmentMetadata: Object.keys(assessmentMetadata).length > 0 ? assessmentMetadata : undefined,
  };
}

function getBearerFromEnvOrAuth(authz: string | null | undefined): string | undefined {
  const s2s = (process.env.PERSIST_ASSESSMENTS_SECRET || "").trim();
  if (s2s) return `Bearer ${s2s}`;
  if (authz && authz.trim()) return authz.trim();
  return undefined;
}

async function fetchTrackedSkillsForSession(sessionId: string): Promise<Array<{ id: string; level: number }>> {
const useMock = process.env.MOCK_CONVEX === '1';
  if (useMock) {
    try {
      const sess: any = await mockConvex.getSessionById({ sessionId }).catch(() => null);
      const userId = String(sess?.userId || 'mock_user');
      const rows: any[] = await mockConvex.listTrackedSkillsForUser({ userId }).catch(() => []) as any[];
      return (Array.isArray(rows) ? rows : [])
        .map((r) => ({ id: String(r?.skillId || r?.skill?.id || r?.id || ''), level: (() => { const lv = Number(r?.currentLevel); return Number.isFinite(lv) && lv >= 0 && lv <= 10 ? lv : 5; })() }))
        .filter((s) => s.id);
    } catch { return []; }
  }
  const client = makeConvex(convexBaseUrl());
  try {
    const sess: any = await client.query("functions/sessions:getBySessionId", { sessionId }).catch(() => null);
    const userId = String(sess?.userId || 'unknown');
    const rows: any[] = await client.query("functions/skills:getTrackedSkillsForUser", { userId }).catch(() => []) as any[];
    return (Array.isArray(rows) ? rows : [])
      .map((r) => ({ id: String(r?.skillId || r?.skill?.id || r?.id || ''), level: (() => { const lv = Number(r?.currentLevel); return Number.isFinite(lv) && lv >= 0 && lv <= 10 ? lv : 5; })() }))
      .filter((s) => s.id);
  } catch { return []; }
}

export async function finalizeAssessmentsForGroups(opts: {
  sessionId: string;
  groupIds: string[];
  requestId?: string;
  authz?: string | null;
  logger?: (kind: string, payload?: Record<string, unknown>) => Promise<void> | void;
}) {
  const { sessionId, groupIds, requestId, authz, logger } = opts;
  if (!sessionId || !Array.isArray(groupIds) || groupIds.length === 0) return;

  // Resolve tracked skills (vital to build V2 payload)
  const skills = await fetchTrackedSkillsForSession(sessionId);
  if (!skills || skills.length === 0) {
    try { await logger?.('assess_skipped_no_skills', { sessionId }); } catch {}
    return;
  }

  // Build V2 skillAssessments skeleton
  const salt = (process.env.SKILL_HASH_SALT || process.env.NEXT_PUBLIC_SKILL_HASH_SALT || 'test_salt').trim();
  const baseAssessments = skills.map((s) => ({
    skillId: s.id,
    skillHash: sha256Hex(`${salt}:${s.id}`),
    level: s.level,
    levelFeedback: {
      currentLevel: s.level,
      nextLevelCriteria: [],
      strengths: [],
      improvements: [],
      focus: [],
      examples: [],
    },
    assessmentMetadata: {},
    sourceContext: { assessmentType: 'single_qa_pair' },
  }));

  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  const bearer = getBearerFromEnvOrAuth(authz);
  if (bearer) headers['authorization'] = bearer;

  // Emit started
  try { await logger?.('assess_cadence_started', { sessionId, groups: groupIds.length, skills: skills.length }); } catch {}

  let completed = 0;
  // Resolve UI base URL to call our internal routes
  const uiBase = (process.env.UI_BASE_URL || process.env.NEXT_PUBLIC_UI_ORIGIN || 'http://127.0.0.1:3000').replace(/\/$/, '');

  for (const gid of groupIds) {
    if (!gid || typeof gid !== 'string') continue;

    // 1) Try to fetch LLM-produced assessments with polling (if enabled)
    let enriched = baseAssessments;
    let groupLevelResults: { highlights?: string[]; recommendations?: string[]; rubricKeyPoints?: string[]; meta?: Record<string, unknown> } = {};
    
    // Default to polling enabled unless explicitly disabled
    const enablePolling = (process.env.ASSESS_RESULTS_POLL || '1') !== '0';
    
    if (enablePolling) {
      // New polling approach
      try {
        // 1a) First trigger the AI API job
        const llmUrl = `${uiBase}/api/assessments/run?sessionId=${encodeURIComponent(sessionId)}&groupId=${encodeURIComponent(gid)}`;
        const llmRes = await fetch(llmUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ sessionId, groupId: gid, rubricVersion: 'v3', trackedSkills: skills }),
          cache: 'no-store',
        } as RequestInit);
        
        const triggerText = await llmRes.text().catch(() => '');
        if (!llmRes.ok) {
          try { await logger?.('assess_llm_trigger_error', { groupId: gid, status: llmRes.status, bodyPreview: triggerText.slice(0, 240) }); } catch {}
        } else {
          try { await logger?.('assess_llm_trigger_ok', { groupId: gid, status: llmRes.status }); } catch {}
          
          // 1b) Now poll for results
          const pollTimeoutMs = parseInt(process.env.ASSESS_RESULTS_POLL_TIMEOUT_MS || '20000', 10);
          const maxAttempts = parseInt(process.env.ASSESS_RESULTS_POLL_MAX_ATTEMPTS || '10', 10);
          const intervalMs = parseInt(process.env.ASSESS_RESULTS_POLL_INTERVAL_MS || '1500', 10);
          
          const startTime = Date.now();
          let attempt = 0;
          let pollSuccess = false;
          
          try { await logger?.('assess_poll_start', { groupId: gid, timeoutMs: pollTimeoutMs, maxAttempts, intervalMs }); } catch {}
          
          while (attempt < maxAttempts && (Date.now() - startTime) < pollTimeoutMs && !pollSuccess) {
            attempt++;
            
            try {
              const resultsUrl = `${uiBase}/api/assessments/results?sessionId=${encodeURIComponent(sessionId)}&groupId=${encodeURIComponent(gid)}`;
              const resultsRes = await fetch(resultsUrl, {
                method: 'GET',
                headers: { 'content-type': 'application/json' },
                cache: 'no-store',
              });
              
              if (resultsRes.ok) {
                const resultsJson = await resultsRes.json();
                const skillAssessments = resultsJson?.results?.skillAssessments || [];
                
                if (skillAssessments.length > 0) {
                  // Successfully got results - normalize them
                  enriched = skillAssessments.map((it: any) => {
                    const sid = String(it?.skillId || '');
                    const lvl = Number(it?.level ?? 0);
                    const lf = it?.levelFeedback || {};
                    const meta = it?.assessmentMetadata || {};
                    const sc = it?.sourceContext || {};
                    
                    return {
                      skillId: sid,
                      skillHash: String(it?.skillHash || sha256Hex(`${salt}:${sid}`)),
                      level: Number.isFinite(lvl) ? lvl : 0,
                      confidence: typeof it?.confidence === 'number' ? it.confidence : undefined,
                      levelFeedback: {
                        currentLevel: Number(lf?.currentLevel ?? lvl) || 0,
                        nextLevelCriteria: Array.isArray(lf?.nextLevelCriteria) ? lf.nextLevelCriteria : [],
                        strengths: Array.isArray(lf?.strengths) ? lf.strengths : [],
                        improvements: Array.isArray(lf?.improvements) ? lf.improvements : [],
                        focus: Array.isArray(lf?.focus) ? lf.focus : [],
                        examples: Array.isArray(lf?.examples) ? lf.examples : [],
                      },
                      assessmentMetadata: {
                        provider: typeof meta?.provider === 'string' ? meta.provider : undefined,
                        modelId: typeof meta?.modelId === 'string' ? meta.modelId : undefined,
                        promptVersion: typeof meta?.promptVersion === 'string' ? meta.promptVersion : undefined,
                        processingTimeMs: typeof meta?.processingTimeMs === 'number' ? meta.processingTimeMs : undefined,
                        tokenCount: typeof meta?.tokenCount === 'number' ? meta.tokenCount : undefined,
                        costCents: typeof meta?.costCents === 'number' ? meta.costCents : undefined,
                      },
                      sourceContext: {
                        assessmentType: typeof sc?.assessmentType === 'string' ? sc.assessmentType : 'single_qa_pair',
                        interactionCount: typeof sc?.interactionCount === 'number' ? sc.interactionCount : undefined,
                        transcriptLength: typeof sc?.transcriptLength === 'number' ? sc.transcriptLength : undefined,
                        sessionDuration: typeof sc?.sessionDuration === 'number' ? sc.sessionDuration : undefined,
                      },
                      // Legacy fields
                      metCriteria: Array.isArray(it?.metCriteria) ? it.metCriteria : [],
                      unmetCriteria: Array.isArray(it?.unmetCriteria) ? it.unmetCriteria : [],
                      feedback: Array.isArray(it?.feedback) ? it.feedback : [],
                    };
                  });
                  
                  // Extract group-level results
                  groupLevelResults = {
                    highlights: Array.isArray(resultsJson?.results?.highlights) ? resultsJson.results.highlights : [],
                    recommendations: Array.isArray(resultsJson?.results?.recommendations) ? resultsJson.results.recommendations : [],
                    rubricKeyPoints: Array.isArray(resultsJson?.results?.rubricKeyPoints) ? resultsJson.results.rubricKeyPoints : [],
                    meta: resultsJson?.results?.meta || {},
                  };
                  
                  pollSuccess = true;
                  const elapsedMs = Date.now() - startTime;
                  try { await logger?.('assess_poll_success', { groupId: gid, attempt, elapsedMs, skillCount: enriched.length, hasGroupLevel: Object.keys(groupLevelResults).length > 0 }); } catch {}
                  break;
                } else {
                  // No results yet, continue polling
                  try { await logger?.('assess_poll_attempt', { groupId: gid, attempt, skillCount: skillAssessments.length }); } catch {}
                }
              } else {
                try { await logger?.('assess_poll_error', { groupId: gid, attempt, status: resultsRes.status }); } catch {}
              }
            } catch (pollError) {
              try { await logger?.('assess_poll_error', { groupId: gid, attempt, error: String(pollError || '') }); } catch {}
            }
            
            // Wait before next attempt (if not last attempt and not timed out)
            if (attempt < maxAttempts && (Date.now() - startTime) < pollTimeoutMs && !pollSuccess) {
              await new Promise(resolve => setTimeout(resolve, intervalMs));
            }
          }
          
          if (!pollSuccess) {
            const elapsedMs = Date.now() - startTime;
            try { await logger?.('assess_poll_timeout', { groupId: gid, attempts: attempt, elapsedMs, fallbackToSkeleton: true }); } catch {}
            // Best-effort: ask AI API to compute on-demand via GET /assessments/{sessionId}?groupId=...
            try {
              const forceUrl = `${uiBase}/api/assessments/results?sessionId=${encodeURIComponent(sessionId)}&groupId=${encodeURIComponent(gid)}`;
              // Trigger the AI API's internal compute path by hitting our proxy which will call upstream
              await fetch(forceUrl, { method: 'GET', headers: { 'content-type': 'application/json' }, cache: 'no-store' } as RequestInit);
              // One more attempt to fetch results directly from AI API after forcing compute
              const resultsUrl2 = `${uiBase}/api/assessments/results?sessionId=${encodeURIComponent(sessionId)}&groupId=${encodeURIComponent(gid)}`;
              const res2 = await fetch(resultsUrl2, { method: 'GET', headers: { 'content-type': 'application/json' }, cache: 'no-store' });
              if (res2.ok) {
                const j2 = await res2.json();
                const items2 = Array.isArray(j2?.results?.skillAssessments) ? j2.results.skillAssessments : [];
                if (items2.length > 0) {
                  enriched = items2.map((it: any) => ({
                    skillId: String(it?.skillId || ''),
                    skillHash: String(it?.skillHash || ''),
                    level: Number(it?.level || 0),
                    confidence: typeof it?.confidence === 'number' ? it.confidence : undefined,
                    levelFeedback: it?.levelFeedback || {},
                    assessmentMetadata: it?.assessmentMetadata || {},
                    sourceContext: it?.sourceContext || {},
                    metCriteria: Array.isArray(it?.metCriteria) ? it.metCriteria : [],
                    unmetCriteria: Array.isArray(it?.unmetCriteria) ? it.unmetCriteria : [],
                    feedback: Array.isArray(it?.feedback) ? it.feedback : [],
                  }));
                  groupLevelResults = {
                    highlights: Array.isArray(j2?.results?.highlights) ? j2.results.highlights : [],
                    recommendations: Array.isArray(j2?.results?.recommendations) ? j2.results.recommendations : [],
                    rubricKeyPoints: Array.isArray(j2?.results?.rubricKeyPoints) ? j2.results.rubricKeyPoints : [],
                    meta: (j2?.results?.meta && typeof j2.results.meta === 'object') ? j2.results.meta : {},
                  } as any;
                  try { await logger?.('assess_poll_forced_success', { groupId: gid, skillCount: enriched.length }); } catch {}
                }
              }
            } catch (forceErr) {
              try { await logger?.('assess_poll_forced_error', { groupId: gid, error: String(forceErr || '') }); } catch {}
            }
          }
        }
      } catch (e) {
        try { await logger?.('assess_poll_error', { groupId: gid, error: String(e || '') }); } catch {}
      }
    } else {
      // Legacy approach: try to get results directly from run endpoint
      try {
        const llmUrl = `${uiBase}/api/assessments/run?sessionId=${encodeURIComponent(sessionId)}&groupId=${encodeURIComponent(gid)}`;
        const llmRes = await fetch(llmUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ sessionId, groupId: gid, rubricVersion: 'v3', trackedSkills: skills }),
          cache: 'no-store',
        } as RequestInit);
        const text = await llmRes.text().catch(() => '');
        if (!llmRes.ok) {
          try { await logger?.('assess_llm_error', { groupId: gid, status: llmRes.status, bodyPreview: text.slice(0, 240) }); } catch {}
        } else {
          try {
            const json = JSON.parse(text);
            const arr: any[] = Array.isArray(json?.results?.skillAssessments)
              ? json.results.skillAssessments
              : (Array.isArray(json?.skillAssessments) ? json.skillAssessments : []);
            if (arr.length > 0) {
              // Normalize to V2 items using legacy approach
              enriched = arr.map((it: any) => {
                const sid = String(it?.skillId || '');
                const lvl = Number(it?.level ?? it?.results?.level ?? 0);
                const lf = (it?.levelFeedback ?? it?.results?.levelFeedback) || {};
                const meta = (typeof it?.assessmentMetadata === 'object' && it?.assessmentMetadata) ? it.assessmentMetadata : {};
                const sc = (typeof it?.sourceContext === 'object' && it?.sourceContext) ? it.sourceContext : {};
                const out = {
                  skillId: sid,
                  skillHash: String(it?.skillHash || sha256Hex(`${salt}:${sid}`)),
                  level: Number.isFinite(lvl) ? lvl : 0,
                  confidence: typeof it?.confidence === 'number' ? it.confidence : undefined,
                  levelFeedback: {
                    currentLevel: Number(lf?.currentLevel ?? lvl) || 0,
                    nextLevelCriteria: Array.isArray(lf?.nextLevelCriteria) ? lf.nextLevelCriteria : [],
                    strengths: Array.isArray(lf?.strengths) ? lf.strengths : [],
                    improvements: Array.isArray(lf?.improvements) ? lf.improvements : [],
                    focus: Array.isArray(lf?.focus) ? lf.focus : [],
                    examples: Array.isArray(lf?.examples) ? lf.examples : [],
                  },
                  assessmentMetadata: (() => {
                    const provider = typeof meta?.provider === 'string' ? meta.provider : undefined;
                    const modelId = typeof meta?.modelId === 'string' ? meta.modelId : undefined;
                    const promptVersion = typeof meta?.promptVersion === 'string' ? meta.promptVersion : undefined;
                    const processingTimeMs = Number(meta?.processingTimeMs);
                    const tokenCount = Number(meta?.tokenCount);
                    const costRaw = (meta as any)?.costCents;
                    const costCents = (typeof costRaw === 'number' && Number.isFinite(costRaw)) ? costRaw : (Number.isFinite(Number(costRaw)) ? Number(costRaw) : undefined);
                    const outMeta: any = {};
                    if (provider) outMeta.provider = provider;
                    if (modelId) outMeta.modelId = modelId;
                    if (promptVersion) outMeta.promptVersion = promptVersion;
                    if (Number.isFinite(processingTimeMs)) outMeta.processingTimeMs = processingTimeMs;
                    if (Number.isFinite(tokenCount)) outMeta.tokenCount = tokenCount;
                    if (costCents !== undefined) outMeta.costCents = costCents;
                    return outMeta;
                  })(),
                  sourceContext: (() => {
                    const assessmentType = typeof sc?.assessmentType === 'string' ? sc.assessmentType : 'single_qa_pair';
                    const interactionCount = Number(sc?.interactionCount);
                    const transcriptLength = Number(sc?.transcriptLength);
                    const sessionDuration = Number(sc?.sessionDuration);
                    const outCtx: any = { assessmentType };
                    if (Number.isFinite(interactionCount)) outCtx.interactionCount = interactionCount;
                    if (Number.isFinite(transcriptLength)) outCtx.transcriptLength = transcriptLength;
                    if (Number.isFinite(sessionDuration)) outCtx.sessionDuration = sessionDuration;
                    return outCtx;
                  })(),
                  // Legacy passthroughs if present
                  metCriteria: Array.isArray(it?.metCriteria) ? it.metCriteria : [],
                  unmetCriteria: Array.isArray(it?.unmetCriteria) ? it.unmetCriteria : [],
                  feedback: Array.isArray(it?.feedback) ? it.feedback : [],
                };
                return out;
              });
              try { await logger?.('assess_llm_results_ok', { groupId: gid, count: enriched.length }); } catch {}
            } else {
              try { await logger?.('assess_llm_results_empty', { groupId: gid }); } catch {}
              // If no results returned, skip finalize for this group in legacy path
              continue;
            }
          } catch (e) {
            try { await logger?.('assess_llm_error', { groupId: gid, error: String(e || '') }); } catch {}
          }
        }
      } catch (e) {
        try { await logger?.('assess_llm_error', { groupId: gid, error: String(e || '') }); } catch {}
      }
    }

    // Aggregate per-skill results into group-level summary (deterministic only)
    const groupResults = aggregateToV3GroupResults(enriched);

    const payload = {
      sessionId,
      groupId: gid,
      rubricVersion: 'v3' as const,
      results: {
        skillAssessments: enriched,
        ...groupResults
      },
    };

    // Emit attempt
    try { await logger?.('assess_finalize_attempt', { groupId: gid, skills: enriched.length }); } catch {}

    try {
      const res = await fetch(`${uiBase}/api/assessments/convex/finalize`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        cache: 'no-store',
      } as RequestInit);
      const respText = await res.text().catch(() => '');
      if (!res.ok) {
        try { await logger?.('assess_finalize_result', { groupId: gid, status: res.status, bodyPreview: respText.slice(0, 240) }); } catch {}
      } else {
        try { await logger?.('assess_finalize_result', { groupId: gid, status: res.status }); } catch {}
      }
      completed++;
    } catch (e) {
      try { await logger?.('assess_finalize_result', { groupId: gid, status: 'error', error: String(e || '') }); } catch {}
    }
  }

  // Emit completed
  try { await logger?.('assess_cadence_completed', { sessionId, groups: groupIds.length, skills: skills.length, completed }); } catch {}
}
