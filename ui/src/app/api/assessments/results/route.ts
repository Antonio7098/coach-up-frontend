export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Proxy endpoint to fetch AI assessment results for a session/group.
import { devLog } from "../../lib/observability";
// Tries multiple upstream shapes and normalizes into a stable response the UI/orchestrator can consume.
// Query params:
// - sessionId: string (required)
// - groupId: string (optional)
// - timeoutMs: number (optional, for future polling support; currently single fetch)

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Request-Id, Authorization",
  "Access-Control-Expose-Headers": "X-Request-Id",
};

function aiApiBaseUrl() {
  return (
    process.env.AI_API_BASE_URL ||
    process.env.NEXT_PUBLIC_AI_API_BASE_URL ||
    "http://127.0.0.1:8000"
  ).replace(/\/$/, "");
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = (url.searchParams.get("sessionId") || "").trim();
  const groupId = (url.searchParams.get("groupId") || "").trim() || undefined;
  const requestId = Math.random().toString(36).slice(2);

  devLog("debug", "assess-results: GET request initiated", {
    requestId,
    sessionId,
    groupId,
    timestamp: new Date().toISOString()
  });

  if (!sessionId) {
    return new Response(JSON.stringify({ error: "sessionId required" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders },
    });
  }

  const base = aiApiBaseUrl();

  // Helper to log (best effort only)
  const log = (obj: any) => { try { devLog("info", "assess-results: log", obj); } catch {}
  };

  // 1) Try a hypothetical results endpoint that may exist in AI API
  try {
    const maybeResultsUrl = `${base}/assessments/results?sessionId=${encodeURIComponent(sessionId)}${groupId ? `&groupId=${encodeURIComponent(groupId)}` : ""}`;
    const res = await fetch(maybeResultsUrl, { method: 'GET', headers: { Accept: 'application/json', 'X-Request-Id': requestId } });
    const text = await res.text().catch(() => '');
    if (res.ok && text) {
      let json: any = {};
      try { json = JSON.parse(text); } catch {}
      const results = (json?.results && typeof json.results === 'object') ? json.results : {};
      const skillAssessments: any[] = Array.isArray(results?.skillAssessments) ? results.skillAssessments : [];
      const body = {
        sessionId,
        groupId: groupId || json?.groupId || null,
        results: { skillAssessments },
        summary: json?.summary || null,
        provider: json?.provider || undefined,
        modelId: json?.modelId || undefined,
      };
      log({ where: 'assess.results.proxy.ok', sessionId, groupId: body.groupId, count: skillAssessments.length });
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'X-Request-Id': requestId, ...corsHeaders } });
    } else {
      log({ where: 'assess.results.proxy.tryResultsEndpoint', status: res.status });
    }
  } catch (e) {
    log({ where: 'assess.results.proxy.resultsEndpoint.error', error: String(e || '') });
  }

  // 2) Fallback to GET /assessments/{sessionId} (current AI API shape)
  try {
    const url2 = `${base}/assessments/${encodeURIComponent(sessionId)}`;
    const res2 = await fetch(url2, { method: 'GET', headers: { Accept: 'application/json', 'X-Request-Id': requestId } });
    const text2 = await res2.text().catch(() => '');
    let json2: any = {};
    try { json2 = JSON.parse(text2); } catch {}
    // Prefer results.skillAssessments from API; if absent, fallback to summary.skillAssessments (V2 projection)
    const apiResults = (json2?.results && typeof json2.results === 'object') ? json2.results : {};
    const skillAssessments: any[] = Array.isArray(apiResults?.skillAssessments)
      ? apiResults.skillAssessments
      : (Array.isArray(json2?.summary?.skillAssessments) ? json2.summary.skillAssessments : []);
    const body = {
      sessionId,
      groupId: groupId || json2?.groupId || json2?.latestGroupId || null,
      results: {
        skillAssessments,
        highlights: Array.isArray(apiResults?.highlights) ? apiResults.highlights : [],
        recommendations: Array.isArray(apiResults?.recommendations) ? apiResults.recommendations : [],
        rubricKeyPoints: Array.isArray(apiResults?.rubricKeyPoints) ? apiResults.rubricKeyPoints : [],
        meta: (apiResults?.meta && typeof apiResults.meta === 'object') ? apiResults.meta : {},
      },
      summary: json2?.summary || null,
      provider: json2?.provider || undefined,
      modelId: json2?.modelId || undefined,
    };
    log({ where: 'assess.results.proxy.fallback', sessionId, groupId: body.groupId, summaryKeys: body.summary ? Object.keys(body.summary || {}) : [], count: body.results.skillAssessments.length, previewSkill: body.results.skillAssessments[0] || null });
    const status = res2.ok ? 200 : 200; // normalize to 200 with empty results to simplify clients
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'X-Request-Id': requestId, ...corsHeaders } });
  } catch (e) {
    log({ where: 'assess.results.proxy.fallback.error', error: String(e || '') });
    return new Response(JSON.stringify({ error: 'AI results unavailable' }), { status: 502, headers: { 'content-type': 'application/json; charset=utf-8', 'X-Request-Id': requestId, ...corsHeaders } });
  }
}

