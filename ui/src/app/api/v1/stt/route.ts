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

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Request-Id, Authorization, X-Detect-Ms",
  "Access-Control-Expose-Headers": "X-Request-Id",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

async function persistInteraction(opts: {
  sessionId?: string;
  groupId?: string;
  requestId: string;
  text?: string | null;
  audioUrl?: string | null;
  objectKey?: string | null;
}) {
  try {
    const { sessionId, groupId } = opts;
    // Persist when sessionId is present; groupId is optional metadata
    if (!sessionId) return;
    const messageId = safeUUID();
    const role = "user" as const;
    const ts = Date.now();
    const basis = (opts.audioUrl || "") + "|" + (opts.objectKey || "") + "|" + (opts.text || "");
    let contentHash = "";
    try {
      contentHash = crypto.createHash("sha256").update(basis).digest("hex");
    } catch {
      contentHash = String(Math.abs(basis.length * 2654435761 % 2 ** 31));
    }
    const useMock = process.env.MOCK_CONVEX === "1";
    if (useMock) {
      await mockConvex.appendInteraction({ sessionId, groupId, messageId, role, contentHash, text: opts.text ?? undefined, audioUrl: opts.audioUrl ?? undefined, ts });
      return;
    }
    const convexUrl = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL || "http://127.0.0.1:3210";
    const client = makeConvex(convexUrl);
    await client.mutation("functions/interactions:appendInteraction", { sessionId, groupId, messageId, role, contentHash, text: opts.text ?? undefined, audioUrl: opts.audioUrl ?? undefined, ts });
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

export async function POST(request: Request) {
  const headersIn = new Headers(request.headers);
  const requestId = headersIn.get("x-request-id") || safeUUID();
  const detectMsHeader = headersIn.get("x-detect-ms");
  const clientDetectMs = detectMsHeader ? Number(detectMsHeader) : undefined;
  const routePath = "/api/v1/stt";
  const method = "POST";
  const started = Date.now();
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
    console.log(JSON.stringify({ level: 'warn', route: routePath, requestId, status: 401, reason: auth.reason, latencyMs: Date.now() - started }));
    return respond(401, { error: "Unauthorized" });
  }

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

        const result = await provider.transcribe({ audioUrl: dataUrl, objectKey: null, languageHint: languageHint ?? null });
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
        } as const;

        // Persist transcript only (no audioUrl/objectKey for privacy)
        persistInteraction({ sessionId, groupId, requestId, text: result.text ?? null, audioUrl: null, objectKey: null }).catch(() => {});

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
      const result = await provider.transcribe({ audioUrl: null, objectKey: uploaded.objectKey, languageHint: languageHint ?? null });
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
      } as const;

      // Persist with audio metadata when stored
      persistInteraction({ sessionId, groupId, requestId, text: result.text ?? null, audioUrl: uploaded.audioUrl ?? null, objectKey: uploaded.objectKey ?? null }).catch(() => {});

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
    const result = await provider.transcribe({ audioUrl: audioUrl ?? null, objectKey: objectKey ?? null, languageHint: languageHint ?? null });
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
    } as const;

    // Fire-and-forget persistence of interaction row (user role)
    persistInteraction({ sessionId, groupId, requestId, text: result.text ?? null, audioUrl: audioUrl ?? null, objectKey: objectKey ?? null }).catch(() => {});

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
