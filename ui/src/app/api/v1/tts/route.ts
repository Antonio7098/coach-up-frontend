 
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import crypto from "node:crypto";
import { requireAuth } from "../../lib/auth";
import { promMetrics } from "../../lib/metrics";
import { makeConvex } from "../../lib/convex";
import * as mockConvex from "../../lib/mockConvex";
import { ProviderNotConfiguredError, getTtsProvider } from "../../lib/speech/tts";
import { CostCalculator } from "../../lib/cost-calculator";
import { getEnvString, getEnvBool } from "../../lib/env";
import { json, badRequest, unauthorized, withTimeout, serverBaseUrl } from "../../lib/http";
import { devLog } from "../../lib/observability";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Request-Id, Authorization",
  "Access-Control-Expose-Headers": "X-Request-Id",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

async function persistInteraction(opts: {
  sessionId?: string;
  groupId?: string;
  text: string;
  audioUrl?: string | null;
  ttsCostCents?: number;
  ttsCharacters?: number;
}) {
  const { sessionId, groupId, text } = opts;
  try {
    // Persist when sessionId is present; groupId is optional metadata
    if (!sessionId) return;
    
    // Skip empty or meaningless text content
    const trimmedText = text?.trim();
    if (!trimmedText || trimmedText.length === 0) {
      devLog("warn", "tts: skipping empty interaction - no meaningful text content", { sessionId });
      return;
    }
    const messageId = safeUUID();
    const role = "assistant" as const;
    const ts = Date.now();
    let contentHash = "";
    try {
      contentHash = crypto.createHash("sha256").update(trimmedText).digest("hex");
    } catch {
      contentHash = String(Math.abs(trimmedText.length * 2654435761 % 2 ** 31));
    }
    const useMock = getEnvString("MOCK_CONVEX") === "1";
    if (useMock) {
      await mockConvex.appendInteraction({ sessionId, groupId, messageId, role, contentHash, text: trimmedText, audioUrl: opts.audioUrl ?? undefined, ts });
      return;
    }
    const convexUrl = getEnvString("CONVEX_URL") || getEnvString("NEXT_PUBLIC_CONVEX_URL") || "http://127.0.0.1:3210";
    const client = makeConvex(convexUrl);
    await client.mutation("functions/interactions:appendInteraction", { 
      sessionId, 
      groupId, 
      messageId, 
      role, 
      contentHash, 
      text: trimmedText,
      audioUrl: opts.audioUrl ?? undefined, 
      ttsCostCents: opts.ttsCostCents,
      ttsCharacters: opts.ttsCharacters,
      ts 
    });
  } catch (e) {
    devLog("error", "tts: persistInteraction failed", { sessionId, error: String(e) });
  }
}

function safeUUID(): string {
  try {
    const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
    return g.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

async function calculateTTSCost(provider: string, modelId: string | undefined, characters: number): Promise<{ costCents: number; characters: number }> {
  try {
    const result = CostCalculator.calculate({
      provider,
      service: 'tts',
      modelId,
      characters,
    });
    return {
      costCents: result.costCents,
      characters: result.usage.characters || characters,
    };
  } catch (error) {
    devLog("error", "tts: cost calculation failed", { error: String(error) });
    return { costCents: 0, characters };
  }
}

export async function POST(request: Request) {
  const headersIn = new Headers(request.headers);
  const requestId = headersIn.get("x-request-id") || safeUUID();
  const routePath = "/api/v1/tts";
  const method = "POST";
  const started = Date.now();
  let provider = getTtsProvider(getEnvString("TTS_PROVIDER"));
  let mode = provider.name;
  const endTimer = promMetrics.requestDurationSeconds.startTimer();

  devLog("debug", "tts: POST request initiated", {
    requestId,
    mode,
    timestamp: new Date().toISOString()
  });

  function respond(status: number, body: unknown) {
    const labels = { route: routePath, method, status: String(status), mode } as const;
    promMetrics.requestsTotal.labels(labels.route, labels.method, labels.status, labels.mode).inc();
    if (status >= 500) {
      promMetrics.requestErrorsTotal.labels(labels.route, labels.method, labels.status, labels.mode).inc();
    }
    endTimer(labels);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders },
    });
  }

  const auth = await requireAuth(request);
  if (!auth.ok) {
    devLog("warn", "tts: authentication failed", { requestId, status: 401, reason: auth.reason, latencyMs: Date.now() - started });
    return respond(401, { error: "Unauthorized" });
  }

  let body: any;
  try { body = await request.json(); }
  catch {
    devLog("warn", "tts: invalid JSON", { requestId, status: 400, latencyMs: Date.now() - started });
    return respond(400, { error: "Invalid JSON" });
  }

  // Optional provider override for dev/testing
  if (getEnvString("ALLOW_PROVIDER_OVERRIDE") === '1') {
    const requested = typeof body?.provider === 'string' ? body.provider : undefined;
    if (requested) {
      provider = getTtsProvider(requested);
      mode = provider.name;
    }
  }

  const text = typeof body?.text === 'string' ? body.text : undefined;
  // Let providers apply their own default voice when none is passed
  const voiceId = typeof body?.voiceId === 'string' ? body.voiceId : undefined;
  const format = typeof body?.format === 'string' ? body.format : (getEnvString("TTS_FORMAT") || 'audio/mpeg');
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : undefined;
  const groupId = typeof body?.groupId === 'string' ? body.groupId : undefined;

  if (!text || text.trim().length === 0) {
    console.log(JSON.stringify({ level: 'warn', route: routePath, requestId, status: 400, msg: 'text is required', latencyMs: Date.now() - started }));
    return respond(400, { error: "text is required" });
  }

  try {
    const result = await provider.synthesize({ text, voiceId, format });
    
    // Calculate TTS cost based on character count
    const ttsCost = await calculateTTSCost(result.provider || mode, result.voiceId, text.length);
    
    const payload = {
      provider: result.provider || mode,
      text,
      voiceId: result.voiceId ?? voiceId,
      format: result.format ?? format,
      sessionId: sessionId ?? null,
      groupId: groupId ?? null,
      audioUrl: result.audioUrl,
      durationMs: result.durationMs ?? undefined,
      note: result.note ?? undefined,
      ttsCostCents: ttsCost.costCents,
      ttsCharacters: ttsCost.characters,
    } as const;

    // NOTE: Assistant interaction persistence and cadence triggers happen server-side (chat/stream).
    // TTS endpoint is synthesis-only to avoid double-write and duplicate cadence triggers.

    // Metrics: audio bytes out and storage uploaded bytes
    try {
      const bytesOut = Number(result.sizeBytes || 0);
      if (bytesOut > 0) {
        const labels = { route: routePath, method, status: "200", mode } as const;
        promMetrics.audioBytesOut.labels(labels.route, labels.method, labels.status, labels.mode).inc(bytesOut);
      }
      const uploaded = Number(result.uploadedBytes || 0);
      if (result.uploadedToStorage && uploaded > 0) {
        const labels = { route: routePath, method, status: "200", mode } as const;
        promMetrics.storageBytesUploaded.labels(labels.route, labels.method, labels.status, labels.mode).inc(uploaded);
      }
    } catch {}

    // Metrics: ttsLatencyMs
    try {
      const labels = { route: routePath, method, status: "200", mode } as const;
      promMetrics.ttsLatencyMs.labels(labels.route, labels.method, labels.status, labels.mode).observe(Date.now() - started);
    } catch {}
    return respond(200, payload);
  } catch (err: any) {
    if (err?.name === 'ProviderNotConfiguredError' || err instanceof ProviderNotConfiguredError) {
      return respond(501, { error: "TTS provider not configured" });
    }
    return respond(500, { error: "TTS failed" });
  }
}
