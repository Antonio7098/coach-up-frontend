export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function aiApiBaseUrl() {
  return (
    process.env.AI_API_BASE_URL ||
    process.env.NEXT_PUBLIC_AI_API_BASE_URL ||
    "http://localhost:8000"
  );
}

export async function GET(request: Request) {
  const controller = new AbortController();
  const upstreamUrl = `${aiApiBaseUrl()}/chat/stream`;

  // Propagate client abort to upstream
  request.signal.addEventListener("abort", () => controller.abort());

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
      },
      signal: controller.signal,
    });
  } catch (err) {
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
    },
  });
}
