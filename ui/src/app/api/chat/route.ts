export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Request-Id, X-Tracked-Skill-Id",
  "Access-Control-Expose-Headers": "X-Request-Id",
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
  const { search } = new URL(request.url);
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

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Explicitly prevent Next.js from buffering
      "X-Accel-Buffering": "no",
      "X-Request-Id": requestId,
      ...corsHeaders,
    },
  });
}
