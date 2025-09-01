export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { getPromptPreview } from "../../../lib/promptPreviewStore";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Request-Id",
  "Access-Control-Expose-Headers": "X-Request-Id",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rid = url.searchParams.get("rid") || url.searchParams.get("requestId") || "";
  if (!rid) {
    return new Response(JSON.stringify({ error: "rid required" }), { status: 400, headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders } });
  }
  try {
    const data = getPromptPreview(rid);
    if (!data) {
      return new Response(JSON.stringify({ preview: null }), { status: 404, headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders } });
    }
    return new Response(JSON.stringify({ preview: data }), { status: 200, headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders } });
  } catch {
    return new Response(JSON.stringify({ error: "failed" }), { status: 500, headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders } });
  }
}


