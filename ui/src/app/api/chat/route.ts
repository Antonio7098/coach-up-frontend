export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Request-Id, X-Tracked-Skill-Id",
  // Expose provider/model so clients and benchmarks can read them
  "Access-Control-Expose-Headers": "X-Request-Id, X-Chat-Provider, X-Chat-Model",
};

function aiApiBaseUrl() {
  return (
    process.env.AI_API_BASE_URL ||
    process.env.NEXT_PUBLIC_AI_API_BASE_URL ||
    "http://127.0.0.1:8000"
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: Request) {
  const controller = new AbortController();
  const url = new URL(request.url);
  const { search } = url;
  const promptParam = url.searchParams.get("prompt") || "";
  try {
    const prev = promptParam.slice(0, 200).replace(/\n/g, " \\n ");
    console.log(`[ui/api/chat] promptLen=%d preview="%s"`, promptParam.length, prev);
  } catch {}
  const upstreamUrl = `${aiApiBaseUrl()}/chat/stream${search}`;
  const requestId = (() => {
    try {
      const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
      return g.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
    } catch {
      return Math.random().toString(36).slice(2);
    }
  })();

  // Propagate client abort to upstream
  request.signal.addEventListener("abort", () => controller.abort());

  let upstream: Response;
  try {
    const incoming = new Headers(request.headers);
    const trackedSkillId = incoming.get("x-tracked-skill-id");
    try { console.log(`[ui/api/chat] x-tracked-skill-id=%s requestId=%s`, trackedSkillId || "-", requestId); } catch {}
    const headers = new Headers({
      Accept: "text/event-stream",
      "X-Request-Id": requestId,
    });
    if (trackedSkillId) headers.set("X-Tracked-Skill-Id", trackedSkillId);
    upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
  } catch {
    return new Response("Upstream unavailable", { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return new Response("Upstream error", { status: 502 });
  }

  const { readable, writable } = new TransformStream();

  // Pipe upstream SSE bytes through unchanged
  upstream.body
    .pipeTo(writable)
    .catch(() => {
      // Ignore errors during pipe (client disconnect or abort)
      try {
        controller.abort();
      } catch {}
    });

  // Build response headers, passing through provider/model if set upstream
  const respHeaders: Record<string, string> = {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Explicitly prevent Next.js from buffering
    "X-Accel-Buffering": "no",
    "X-Request-Id": requestId,
    ...corsHeaders,
  };
  const upstreamProvider = upstream.headers.get("X-Chat-Provider") || upstream.headers.get("x-chat-provider");
  const upstreamModel = upstream.headers.get("X-Chat-Model") || upstream.headers.get("x-chat-model");
  if (upstreamProvider) respHeaders["X-Chat-Provider"] = upstreamProvider;
  if (upstreamModel) respHeaders["X-Chat-Model"] = upstreamModel;

  return new Response(readable, { headers: respHeaders });
}
