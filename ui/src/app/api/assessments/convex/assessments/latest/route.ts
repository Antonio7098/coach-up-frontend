export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { makeConvex } from "../../../../lib/convex";
import { devLog } from "../../../../lib/observability";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Request-Id, Authorization",
  "Access-Control-Expose-Headers": "X-Request-Id",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

function convexBaseUrl() {
  return process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL || "http://127.0.0.1:3210";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('sessionId') || '';
  const requestId = (Math.random().toString(36).slice(2));

  devLog("debug", "assess-latest: GET request initiated", {
    requestId,
    sessionId,
    timestamp: new Date().toISOString()
  });
  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'sessionId required' }), { status: 400, headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders } });
  }
  const client = makeConvex(convexBaseUrl());
  try {
    // Try session pointer first
    const sess: any = await client.query("functions/sessions:getBySessionId", { sessionId }).catch(() => null);
    const latestAssessmentId = typeof sess?.latestAssessmentId === 'string' ? sess.latestAssessmentId : null;
    let assessment: any = null;
    let results: any[] = [];
    if (latestAssessmentId) {
      const byId: any = await client.query("assessments:getById", { assessmentId: latestAssessmentId }).catch(() => null);
      if (byId) {
        assessment = byId.assessment || null;
        results = Array.isArray(byId.skillResults) ? byId.skillResults : [];
      }
    }
    if (!assessment) {
      const latest = await client.query("assessments:getLatestBySession", { sessionId }).catch(() => null);
      if (latest) {
        assessment = latest?.assessment || null;
        results = Array.isArray(latest?.skillResults) ? latest.skillResults : [];
      }
    }
    const body = { sessionId, latestAssessmentId: latestAssessmentId || (assessment?._id || null), assessment, results };
    try {
      devLog("info", "assess-latest: assessment data retrieved", {
      sessionId,
      hasAssessment: !!assessment,
      groupId: assessment?.groupId || null,
      resultsLen: Array.isArray(results) ? results.length : 0,
      latestAssessmentId: latestAssessmentId || (assessment?._id || null)
    });
    } catch {}
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'X-Request-Id': requestId, ...corsHeaders } });
  } catch (e) {
    devLog("error", "assess-latest: convex query failed", { sessionId, error: String(e || '') });
    return new Response(JSON.stringify({ error: 'Convex query failed' }), { status: 502, headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders } });
  }
}

