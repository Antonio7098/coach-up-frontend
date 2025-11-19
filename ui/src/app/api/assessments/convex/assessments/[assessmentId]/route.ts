export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { makeConvex } from "../../../../lib/convex";

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

export async function GET(_request: Request, context: { params: Promise<{ assessmentId: string }> }) {
  const params = await context.params;
  const assessmentId = params?.assessmentId || '';
  const requestId = (Math.random().toString(36).slice(2));
  if (!assessmentId) {
    return new Response(JSON.stringify({ error: 'assessmentId required' }), { status: 400, headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders } });
  }
  const client = makeConvex(convexBaseUrl());
  try {
    const resp = await client.query("assessments:getById", { assessmentId });
    return new Response(JSON.stringify(resp || {}), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'X-Request-Id': requestId, ...corsHeaders } });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Convex query failed' }), { status: 502, headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders } });
  }
}

