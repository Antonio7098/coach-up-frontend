/* eslint-disable no-console */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import crypto from "node:crypto";
import { requireAuth } from "../../lib/auth";
import { promMetrics } from "../../lib/metrics";
import { makeConvex } from "../../lib/convex";
import * as mockConvex from "../../lib/mockConvex";
import { ProviderNotConfiguredError, getSttProvider } from "../../lib/speech/stt";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { CostCalculator } from "../../lib/cost-calculator";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Request-Id, Authorization, X-Detect-Ms",
  "Access-Control-Expose-Headers": "X-Request-Id",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

async function persistInteraction(client: any, opts: {
  sessionId?: string;
  groupId?: string;
  requestId: string;
  text?: string | null;
  audioUrl?: string | null;
  objectKey?: string | null;
  sttCostCents?: number;
  sttDurationMs?: number;
}) {
  try {
    const { sessionId, groupId } = opts;
    // Persist when sessionId is present; groupId is optional metadata
    if (!sessionId) return;

    // Skip empty or meaningless text content
    const text = opts.text?.trim();
    if (!text || text.length === 0) {
      console.log("[stt] Skipping empty interaction - no meaningful text content");
      return;
    }
    const messageId = safeUUID();
    const role = "user" as const;
    const ts = Date.now();
    const basis = (opts.audioUrl || "") + "|" + (opts.objectKey || "") + "|" + text;
    let contentHash = "";
    try {
      contentHash = crypto.createHash("sha256").update(basis).digest("hex");
    } catch {
      contentHash = String(Math.abs(basis.length * 2654435761 % 2 ** 31));
    }
    const useMock = process.env.MOCK_CONVEX === "1";
    if (useMock) {
      await mockConvex.appendInteraction({ sessionId, groupId, messageId, role, contentHash, text: text, audioUrl: opts.audioUrl ?? undefined, ts });
      return;
    }

    await client.mutation("functions/interactions:appendInteraction", {
      sessionId,
      groupId,
      messageId,
      role,
      contentHash,
      text: text,
      audioUrl: opts.audioUrl ?? undefined,
      sttCostCents: opts.sttCostCents,
      sttDurationMs: opts.sttDurationMs,
      ts
    });
  } catch (e) {
    try { console.error("[stt] persistInteraction failed", e); } catch {}
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

async function calculateSTTCost(provider: string, modelId: string | undefined, durationMs: number): Promise<{ costCents: number; durationMs: number }> {
  try {
    const result = CostCalculator.calculate({
      provider,
      service: 'stt',
      modelId,
      durationMs,
    });
    return {
      costCents: result.costCents,
      durationMs: result.usage.durationMs || durationMs,
    };
  } catch (error) {
    console.error('[stt] Cost calculation failed:', error);
    return { costCents: 0, durationMs };
  }
}

export async function POST(request: Request) {
  const headersIn = new Headers(request.headers);
  const requestId = headersIn.get("x-request-id") || safeUUID();
  const detectMsHeader = headersIn.get("x-detect-ms");
  const clientDetectMs = detectMsHeader ? Number(detectMsHeader) : undefined;
  const routePath = "/api/v1/stt";
  const method = "POST";
  const started = Date.now();
  // Safe diagnostics: meta only, no secrets
  let host = "";
  let path = "";
  try { const u = new URL(request.url); host = u.host; path = u.pathname; } catch {}
  const hasAuthHeader = !!headersIn.get("authorization");
  const hasCookie = !!headersIn.get("cookie");
  try { console.log(JSON.stringify({ level: 'debug', where: 'stt.entry', host, path, method, hasAuthHeader, hasCookie })); } catch {}
  let provider = getSttProvider(process.env.STT_PROVIDER);
  let mode = provider.name;
  const endTimer = promMetrics.requestDurationSeconds.startTimer();

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
    console.log(JSON.stringify({ level: 'warn', where: 'stt.authFail', route: routePath, requestId, status: 401, reason: auth.reason, host, path, hasAuthHeader, hasCookie, latencyMs: Date.now() - started }));
    // Include reason in body to help diagnose production 401s
    return respond(401, { error: "Unauthorized", reason: auth.reason });
  }
  try { console.log(JSON.stringify({ level: 'info', where: 'stt.authOk', route: routePath, requestId, userId: !!auth?.userId, latencyMs: Date.now() - started })); } catch {}

  // Determine content type
  const ct = (headersIn.get("content-type") || "").toLowerCase();
  const isMultipart = ct.includes("multipart/form-data");
  const allowedTypes = new Set(["audio/webm", "audio/wav", "audio/mpeg", "audio/mp4", "audio/x-m4a"]);
  const maxBytes = Number(process.env.STT_MAX_AUDIO_BYTES) > 0 ? Number(process.env.STT_MAX_AUDIO_BYTES) : 25 * 1024 * 1024;

  function extFromContentType(mime: string): string {
    switch (mime) {
      case "audio/webm": return "webm";
      case "audio/wav": return "wav";
      case "audio/mpeg": return "mp3";
      case "audio/mp4": return "m4a";
      case "audio/x-m4a": return "m4a";
      default: return "bin";
    }
  }

  function isBlobLikeFile(v: any): v is { arrayBuffer: () => Promise<ArrayBuffer>; type?: string; size?: number } {
    return v && typeof v === 'object' && typeof v.arrayBuffer === 'function'
  }

  async function uploadToS3AndGetKey(file: { arrayBuffer: () => Promise<ArrayBuffer>; type?: string }): Promise<{ objectKey: string; audioUrl?: string } | null> {
    const provider = (process.env.STORAGE_PROVIDER || "s3").toLowerCase();
    const bucket = process.env.S3_BUCKET_AUDIO || "";
    if (provider !== "s3" || !bucket) return null;
    const region = process.env.S3_REGION || "us-east-1";
    const endpoint = process.env.S3_ENDPOINT_URL || undefined;
    const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === "1";
    const s3 = new S3Client({ region, endpoint, forcePathStyle });
    const now = Date.now();
    const key = `audio/${new Date(now).toISOString().slice(0,10)}/${safeUUID()}.${extFromContentType(file.type || "application/octet-stream")}`;
    const buf = Buffer.from(await file.arrayBuffer());
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buf, ContentType: file.type || "application/octet-stream" }));
    // Construct a URL if endpoint resembles a local/public endpoint
    let audioUrl: string | undefined;
    if (endpoint) {
      const base = endpoint.replace(/\/$/, "");
      audioUrl = process.env.S3_FORCE_PATH_STYLE === "1" ? `${base}/${bucket}/${key}` : `${base}/${key}`;
    }
    return { objectKey: key, audioUrl };
  }

  // Multipart branch
  if (isMultipart) {
    try {
      const form = await request.formData();
      const audio = form.get("audio");
      const sessionId = typeof form.get("sessionId") === 'string' ? String(form.get("sessionId")) : undefined;
      const groupId = typeof form.get("groupId") === 'string' ? String(form.get("groupId")) : undefined;

      const languageHint = typeof form.get("languageHint") === 'string' ? String(form.get("languageHint")) : undefined;

      // Initialize Convex client
      const convexUrl = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL || "http://127.0.0.1:3210";
      const client = makeConvex(convexUrl);

      // Start session ensureActiveSession in parallel to STT for low latency
      const ensureSessionPromise = (async () => {
        try {
          const hint = sessionId || undefined;
          const res: any = await client.mutation("functions/sessions:ensureActiveSession", {
            userId: auth.userId,
            sessionIdHint: hint,
            nowMs: Date.now(),
            idleThresholdMs: 10 * 60 * 1000,
          });
          return (res && typeof res === 'object' && res.sessionId) ? String(res.sessionId) : hint;
        } catch {
          return sessionId || undefined;
        }
      })();
      // Optional provider override via form
      if (process.env.ALLOW_PROVIDER_OVERRIDE === '1') {
        const requested = typeof form.get("provider") === 'string' ? String(form.get("provider")) : undefined;
        if (requested) {
          provider = getSttProvider(requested);
          mode = provider.name;
        }
      }

      if (!isBlobLikeFile(audio)) {
        console.log(JSON.stringify({ level: 'warn', route: routePath, requestId, status: 400, msg: 'audio file missing', latencyMs: Date.now() - started }));
        return respond(400, { error: "audio file is required in form field 'audio'" });
      }
      const mime = (audio.type || '').toLowerCase();
      if (!allowedTypes.has(mime)) {
        console.log(JSON.stringify({ level: 'warn', route: routePath, requestId, status: 400, msg: 'Unsupported contentType', contentType: mime, latencyMs: Date.now() - started }));
        return respond(400, { error: "Unsupported contentType" });
      }
      const size = audio.size || 0;
      if (!(size > 0) || size > maxBytes) {
        console.log(JSON.stringify({ level: 'warn', route: routePath, requestId, status: 413, msg: 'Invalid size', size, maxBytes, latencyMs: Date.now() - started }));
        return respond(413, { error: "Audio too large", maxBytes });
      }

      // Decide path: data URL (privacy-first) vs storage upload
      // Default is storage upload unless explicitly enabled via STT_MULTIPART_DATAURL_ENABLED=1
      const enableDataUrl = process.env.STT_MULTIPART_DATAURL_ENABLED === "1";
      if (enableDataUrl) {
        // Privacy-first: bypass storage entirely by posting bytes directly to the provider.
        // Encode the uploaded blob as a data URL that providers can fetch via standard fetch.
        const ab = await audio.arrayBuffer();
        const b64 = Buffer.from(ab).toString('base64');
        const dataUrl = `data:${mime};base64,${b64}`;

      const [result, effectiveSessionId] = await Promise.all([
        provider.transcribe({ audioUrl: dataUrl, objectKey: null, languageHint: languageHint ?? null }),
        ensureSessionPromise,
      ]);
        
        // Calculate STT cost based on audio duration
        const sttCost = await calculateSTTCost(result.provider || mode, result.model, Math.max(size * 0.5, 1000)); // Better estimate: 0.5ms per byte, minimum 1 second
        
        const payload = {
          provider: result.provider || mode,
          text: result.text,
          confidence: result.confidence ?? undefined,
          language: result.language ?? languageHint ?? undefined,
          model: result.model ?? undefined,
          clientDetectMs: typeof clientDetectMs === 'number' && isFinite(clientDetectMs) ? clientDetectMs : undefined,
          sessionId: sessionId ?? null,
          groupId: groupId ?? null,
          audioUrl: null,
          objectKey: null,
          sttCostCents: sttCost.costCents,
          sttDurationMs: sttCost.durationMs,
        } as const;

      // Persist transcript with cost data (no audioUrl/objectKey for privacy)
        const sidEff = effectiveSessionId || sessionId;
        persistInteraction(client, {
          sessionId: sidEff,
        groupId,
        requestId,
        text: result.text ?? null,
        audioUrl: undefined,
        objectKey: undefined,
        sttCostCents: sttCost.costCents,
        sttDurationMs: sttCost.durationMs,
      }).catch(() => {});

      // Update denormalized session metrics (lastActivityAt, interactionCount, costs)
      try {
        if (sessionId) {
          await client.mutation("functions/sessions:updateActivity", {
            sessionId,
            lastActivityAt: Date.now(),
            incInteractionCount: 1,
            sttCostCentsDelta: sttCost.costCents,
          });
        }
      } catch {}

        // Note: Session cost updates are handled separately by the frontend

        // Metrics: audio bytes in (multipart path)
        try {
          const labels = { route: routePath, method, status: "200", mode } as const;
          promMetrics.audioBytesIn.labels(labels.route, labels.method, labels.status, labels.mode).inc(size);
        } catch {}

        // Metrics: clientDetectMs and sttLatencyMs
        try {
          const labels = { route: routePath, method, status: "200", mode } as const;
          if (typeof clientDetectMs === 'number' && isFinite(clientDetectMs) && clientDetectMs >= 0) {
            promMetrics.clientDetectMs.labels(labels.route, labels.method, labels.status, labels.mode).observe(clientDetectMs);
          }
          promMetrics.sttLatencyMs.labels(labels.route, labels.method, labels.status, labels.mode).observe(Date.now() - started);
        } catch {}
        console.log(JSON.stringify({ level: 'info', route: routePath, requestId, status: 200, mode, sessionId, groupId, multipart: true, size, mime, model: result.model, clientDetectMs, usedDataUrl: true, latencyMs: Date.now() - started }));
        return respond(200, payload);
      }

      // Upload to storage and pass objectKey to provider (preferred path when privacy gating is disabled)
      const uploaded = await uploadToS3AndGetKey(audio);
      if (!uploaded) {
        console.log(JSON.stringify({ level: 'error', route: routePath, requestId, status: 501, mode, msg: 'Storage not configured', latencyMs: Date.now() - started }));
        return respond(501, { error: "Storage not configured" });
      }
      const [result, effectiveSessionId] = await Promise.all([
        provider.transcribe({ audioUrl: null, objectKey: uploaded.objectKey, languageHint: languageHint ?? null }),
        ensureSessionPromise,
      ]);
      
      // Calculate STT cost based on audio duration
      const sttCost = await calculateSTTCost(result.provider || mode, result.model, Math.max(size * 0.5, 1000)); // Better estimate: 0.5ms per byte, minimum 1 second
      
      const payload = {
        provider: result.provider || mode,
        text: result.text,
        confidence: result.confidence ?? undefined,
        language: result.language ?? languageHint ?? undefined,
        model: result.model ?? undefined,
        clientDetectMs: typeof clientDetectMs === 'number' && isFinite(clientDetectMs) ? clientDetectMs : undefined,
        sessionId: sessionId ?? null,
        groupId: groupId ?? null,
        audioUrl: uploaded.audioUrl ?? null,
        objectKey: uploaded.objectKey ?? null,
        sttCostCents: sttCost.costCents,
        sttDurationMs: sttCost.durationMs,
      } as const;

      // Persist with audio metadata and cost data when stored
      const sidEff = effectiveSessionId || sessionId;
      persistInteraction(client, {
        sessionId: sidEff,
        groupId,
        requestId,
        text: result.text ?? null,
        audioUrl: uploaded.audioUrl ?? undefined,
        objectKey: uploaded.objectKey ?? undefined,
        sttCostCents: sttCost.costCents,
        sttDurationMs: sttCost.durationMs,
      }).catch(() => {});

      // Update denormalized session metrics (lastActivityAt, interactionCount, costs)
      try {
        if (sidEff) {
          await client.mutation("functions/sessions:updateActivity", {
            sessionId: sidEff,
            lastActivityAt: Date.now(),
            incInteractionCount: 1,
            sttCostCentsDelta: sttCost.costCents,
          });
        }
      } catch {}

      // Note: Session cost updates are handled by the Chat API during streaming

      // Metrics: audio bytes in (multipart path)
      try {
        const labels = { route: routePath, method, status: "200", mode } as const;
        promMetrics.audioBytesIn.labels(labels.route, labels.method, labels.status, labels.mode).inc(size);
      } catch {}

      // Metrics: clientDetectMs and sttLatencyMs
      try {
        const labels = { route: routePath, method, status: "200", mode } as const;
        if (typeof clientDetectMs === 'number' && isFinite(clientDetectMs) && clientDetectMs >= 0) {
          promMetrics.clientDetectMs.labels(labels.route, labels.method, labels.status, labels.mode).observe(clientDetectMs);
        }
        promMetrics.sttLatencyMs.labels(labels.route, labels.method, labels.status, labels.mode).observe(Date.now() - started);
      } catch {}
      console.log(JSON.stringify({ level: 'info', route: routePath, requestId, status: 200, mode, sessionId, groupId, multipart: true, size, mime, model: result.model, clientDetectMs, usedDataUrl: false, objectKey: uploaded.objectKey, latencyMs: Date.now() - started }));
      return respond(200, payload);
    } catch (err: any) {
      if (err?.name === 'ProviderNotConfiguredError' || err instanceof ProviderNotConfiguredError) {
        console.log(JSON.stringify({ level: 'error', route: routePath, requestId, status: 501, mode, msg: 'STT provider not configured', error: err?.message, latencyMs: Date.now() - started }));
        return respond(501, { error: "STT provider not configured" });
      }
      console.log(JSON.stringify({ level: 'error', route: routePath, requestId, status: 500, mode, msg: 'STT failed (multipart)', error: err?.message, latencyMs: Date.now() - started }));
      return respond(500, { error: "STT failed" });
    }
  }

  // JSON branch (existing)
  let body: any;
  try { body = await request.json(); }
  catch {
    console.log(JSON.stringify({ level: 'warn', route: routePath, requestId, status: 400, msg: 'Invalid JSON', latencyMs: Date.now() - started }));
    return respond(400, { error: "Invalid JSON" });
  }

  // Optional provider override for dev/testing
  if (process.env.ALLOW_PROVIDER_OVERRIDE === '1') {
    const requested = typeof body?.provider === 'string' ? body.provider : undefined;
    if (requested) {
      provider = getSttProvider(requested);
      mode = provider.name;
    }
  }

  const audioUrl = typeof body?.audioUrl === 'string' ? body.audioUrl : undefined;
  const objectKey = typeof body?.objectKey === 'string' ? body.objectKey : undefined;
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : undefined;
  const groupId = typeof body?.groupId === 'string' ? body.groupId : undefined;
  const languageHint = typeof body?.languageHint === 'string' ? body.languageHint : undefined;

  if (!audioUrl && !objectKey) {
    console.log(JSON.stringify({ level: 'warn', route: routePath, requestId, status: 400, msg: 'audioUrl or objectKey required', latencyMs: Date.now() - started }));
    return respond(400, { error: "audioUrl or objectKey is required" });
  }

  try {
    // Start ensureActiveSession in parallel for JSON path
    const ensureSessionPromise = (async () => {
      try {
        const hint = sessionId || undefined;
        const res: any = await makeConvex(process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL || "http://127.0.0.1:3210").mutation("functions/sessions:ensureActiveSession", {
          userId: auth.userId,
          sessionIdHint: hint,
          nowMs: Date.now(),
          idleThresholdMs: 10 * 60 * 1000,
        });
        return (res && typeof res === 'object' && res.sessionId) ? String(res.sessionId) : hint;
      } catch {
        return sessionId || undefined;
      }
    })();

    const [result, effectiveSessionId] = await Promise.all([
      provider.transcribe({ audioUrl: audioUrl ?? null, objectKey: objectKey ?? null, languageHint: languageHint ?? null }),
      ensureSessionPromise,
    ]);
    
    // Calculate STT cost - estimate duration from file size if not available
    let estimatedDuration = 60000; // Default 1 minute
    if (objectKey) {
      try {
        const provider = (process.env.STORAGE_PROVIDER || "s3").toLowerCase();
        const bucket = process.env.S3_BUCKET_AUDIO || "";
        if (provider === "s3" && bucket) {
          const region = process.env.S3_REGION || "us-east-1";
          const endpoint = process.env.S3_ENDPOINT_URL || undefined;
          const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === "1";
          const s3 = new S3Client({ region, endpoint, forcePathStyle });
          const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey } as any));
          const bytes = Number(head.ContentLength || 0);
          estimatedDuration = bytes * 8; // Rough estimate: 8ms per byte
        }
      } catch {}
    }
    
    const sttCost = await calculateSTTCost(result.provider || mode, result.model, estimatedDuration);
    
    const payload = {
      provider: result.provider || mode,
      text: result.text,
      confidence: result.confidence ?? undefined,
      language: result.language ?? languageHint ?? undefined,
      model: result.model ?? undefined,
      clientDetectMs: typeof clientDetectMs === 'number' && isFinite(clientDetectMs) ? clientDetectMs : undefined,
      sessionId: sessionId ?? null,
      groupId: groupId ?? null,
      audioUrl: audioUrl ?? null,
      objectKey: objectKey ?? null,
      sttCostCents: sttCost.costCents,
      sttDurationMs: sttCost.durationMs,
    } as const;

    // Initialize Convex client for persistence
    const convexUrl = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL || "http://127.0.0.1:3210";
    const client = makeConvex(convexUrl);

    // Fire-and-forget persistence of interaction row with cost data
    const sidEff = effectiveSessionId || sessionId;
    persistInteraction(client, {
      sessionId: sidEff,
      groupId,
      requestId,
      text: result.text ?? null,
      audioUrl: audioUrl ?? undefined,
      objectKey: objectKey ?? undefined,
      sttCostCents: sttCost.costCents,
      sttDurationMs: sttCost.durationMs,
    }).catch(() => {});

    // Update denormalized session metrics (lastActivityAt, interactionCount, costs)
    try {
      if (sidEff) {
        await client.mutation("functions/sessions:updateActivity", {
          sessionId: sidEff,
          lastActivityAt: Date.now(),
          incInteractionCount: 1,
          sttCostCentsDelta: sttCost.costCents,
        });
      }
    } catch {}

    // Note: Session cost updates are handled by the Chat API during streaming

    // Metrics: audio bytes in (best-effort for server-side fetch when objectKey is provided)
    try {
      if (objectKey) {
        const provider = (process.env.STORAGE_PROVIDER || "s3").toLowerCase();
        const bucket = process.env.S3_BUCKET_AUDIO || "";
        if (provider === "s3" && bucket) {
          const region = process.env.S3_REGION || "us-east-1";
          const endpoint = process.env.S3_ENDPOINT_URL || undefined;
          const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === "1";
          const s3 = new S3Client({ region, endpoint, forcePathStyle });
          const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey } as any));
          const bytes = Number(head.ContentLength || 0);
          if (bytes > 0) {
            const labels = { route: routePath, method, status: "200", mode } as const;
            promMetrics.audioBytesIn.labels(labels.route, labels.method, labels.status, labels.mode).inc(bytes);
          }
        }
      }
    } catch {}

    // Metrics: clientDetectMs and sttLatencyMs
    try {
      const labels = { route: routePath, method, status: "200", mode } as const;
      if (typeof clientDetectMs === 'number' && isFinite(clientDetectMs) && clientDetectMs >= 0) {
        promMetrics.clientDetectMs.labels(labels.route, labels.method, labels.status, labels.mode).observe(clientDetectMs);
      }
      promMetrics.sttLatencyMs.labels(labels.route, labels.method, labels.status, labels.mode).observe(Date.now() - started);
    } catch {}
    console.log(JSON.stringify({ level: 'info', route: routePath, requestId, status: 200, mode, sessionId, groupId, hasAudioUrl: !!audioUrl, hasObjectKey: !!objectKey, model: result.model, clientDetectMs, latencyMs: Date.now() - started }));
    return respond(200, payload);
  } catch (err: any) {
    if (err?.name === 'ProviderNotConfiguredError' || err instanceof ProviderNotConfiguredError) {
      console.log(JSON.stringify({ level: 'error', route: routePath, requestId, status: 501, mode, msg: 'STT provider not configured', error: err?.message, latencyMs: Date.now() - started }));
      return respond(501, { error: "STT provider not configured" });
    }
    console.log(JSON.stringify({ level: 'error', route: routePath, requestId, status: 500, mode, msg: 'STT failed', error: err?.message, latencyMs: Date.now() - started }));
    return respond(500, { error: "STT failed" });
  }
}
