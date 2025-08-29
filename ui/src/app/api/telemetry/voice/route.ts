export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Ingest client-side voice telemetry events and expose them via Prometheus metrics.
  Expected payloads (application/json):
    - Single event: { type: string, state?: string, outcome?: string, durationMs?: number }
    - Batch events: { events: Array<{ type: string, state?: string, outcome?: string, durationMs?: number }> }

  Notes:
    - We only record aggregate metrics (counters/histograms). No PII should be sent here.
    - CORS is permissive to allow browser posting from the UI.
*/

import { promMetrics } from "../../lib/metrics";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Request-Id",
  "Access-Control-Expose-Headers": "X-Request-Id",
};

function safeUUID(): string {
  try {
    const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
    return g.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

const ROUTE = "/api/telemetry/voice";
const METHOD = "POST";

function labelDefaults(status: number) {
  // Ensure labels match prom label sets used elsewhere
  const mode = process.env.NODE_ENV || "unknown";
  return { route: ROUTE, method: METHOD, status: String(status), mode } as const;
}

function coerceEvents(input: unknown): Array<{ type: string; state?: string; outcome?: string; durationMs?: number }>{
  if (!input) return [];
  if (Array.isArray(input)) return input as any;
  if (typeof input === "object") {
    const obj = input as any;
    if (Array.isArray(obj.events)) return obj.events as any;
    if (typeof obj.type === "string") return [obj as any];
  }
  return [];
}

export async function POST(request: Request) {
  const requestId = request.headers.get("x-request-id") || safeUUID();
  let body: any = null;
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    const status = 400;
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }

  const events = coerceEvents(body);
  if (!events.length) {
    const status = 400;
    return new Response(JSON.stringify({ error: "no_events" }), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }

  const status = 200;
  const labelsBase = labelDefaults(status);
  let ingested = 0;

  for (const e of events) {
    if (!e || typeof e.type !== "string" || !e.type.trim()) continue;
    const event = e.type.slice(0, 64);
    const state = e.state ? String(e.state).slice(0, 64) : "";
    const outcome = e.outcome ? String(e.outcome).slice(0, 32) : "";

    try {
      promMetrics.voiceEventsTotal.inc({ event, state, outcome, ...labelsBase }, 1);
      if (event === "voice.tts.playback_end" && typeof e.durationMs === "number" && isFinite(e.durationMs) && e.durationMs >= 0) {
        promMetrics.voiceTtsPlaybackMs.observe({ outcome: outcome || "ok", ...labelsBase }, e.durationMs);
      }
      ingested += 1;
    } catch {
      // Swallow metric errors to avoid breaking ingestion
    }
  }

  return new Response(JSON.stringify({ ok: true, count: ingested }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
  });
}
