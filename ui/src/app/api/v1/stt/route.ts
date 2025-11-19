 
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
import { getEnvString, getEnvBool } from "../../lib/env";
import { json, badRequest, unauthorized, withTimeout, serverBaseUrl } from "../../lib/http";
import { devLog } from "../../lib/observability";

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
  const { sessionId, groupId } = opts;
  try {
    devLog("debug", "stt: persistInteraction called", {
      sessionId,
      groupId,
      requestId: opts.requestId,
      textLength: opts.text?.length || 0,
      textPreview: opts.text?.slice(0, 50) || '(no text)',
      sttCostCents: opts.sttCostCents,
    });
    
    // Persist when sessionId is present; groupId is optional metadata
    if (!sessionId) {
      devLog("warn", "stt: skipping interaction - no sessionId", { requestId: opts.requestId });
      return;
    }

    // Skip empty or meaningless text content
    const text = opts.text?.trim();
    if (!text || text.length === 0) {
      devLog("warn", "stt: skipping empty interaction - no meaningful text content", { requestId: opts.requestId });
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
    
    const useMock = getEnvString("MOCK_CONVEX") === "1";
    devLog("debug", "stt: about to persist user interaction", {
      messageId,
      role,
      sessionId,
      groupId,
      text,
      useMock,
      ts,
    });
    
    if (useMock) {
      await mockConvex.appendInteraction({ sessionId, groupId, messageId, role, contentHash, text: text, audioUrl: opts.audioUrl ?? undefined, ts });
      devLog("info", "stt: successfully persisted to mock Convex", { messageId, sessionId, requestId: opts.requestId });
      
      // Trigger triage after user interaction is saved (mock path)
      try {
        const triageOnUser = String(getEnvString("TRIAGE_ON_USER_INGEST") || '1').toLowerCase();
        if (triageOnUser === '1' || triageOnUser === 'true') {
          // Fetch last 2 message IDs for triage from mock (using optimized tail query)
          const docs: Array<any> = await mockConvex.listIdsTail({ sessionId, limit: 2 }) || [];
          const messageIds = docs.map((d: any) => String(d?.messageId || '')).filter(Boolean);
          
          if (messageIds.length > 0) {
            const ctrl = new AbortController();
            const to = setTimeout(() => ctrl.abort(), Math.max(300, Math.min(2000, Number(getEnvString("TRIAGE_TIMEOUT_MS") || 1200))));
            
            // Call triage API internally
            try {
              const url = `/api/v1/triage?sessionId=${encodeURIComponent(sessionId)}`;
              const headers: Record<string, string> = { 'content-type': 'application/json', 'x-request-id': opts.requestId };
              
              // Use server-side relative URL for internal API call
              const baseUrl = getEnvString("VERCEL_URL") ? `https://${getEnvString("VERCEL_URL")}` : 'http://localhost:3000';
              const fullUrl = `${baseUrl}${url}`;
            
            ;(async () => {
              try {
                const res = await fetch(fullUrl, {
                  method: 'POST',
                  headers,
                  body: JSON.stringify({ messageIds }),
                  signal: ctrl.signal,
                });
                if (!res.ok) {
                  // Fallback to mockConvex persistence to avoid stuck PENDING
                  try {
                    const updates = messageIds.map(m => ({ sessionId, messageId: m, assessmentType: 'general_chatter' as any }));
                    await mockConvex.setTriageResults({ sessionId, updates });
                  } catch {}
                }
              } catch {
                try {
                  const updates = messageIds.map(m => ({ sessionId, messageId: m, assessmentType: 'general_chatter' as any }));
                  await mockConvex.setTriageResults({ sessionId, updates });
                } catch {}
              } finally {
                try { clearTimeout(to); } catch {}
              }
            })();
            
            devLog("info", "stt: triggered triage for user message (mock)", { sessionId, messageIds, requestId: opts.requestId });
            } catch (e) {
              devLog("warn", "stt: triage trigger failed (mock)", { sessionId, requestId: opts.requestId, error: String(e) });
            }
          }
        }
      } catch (e) {
        devLog("warn", "stt: triage setup failed (mock)", { sessionId, requestId: opts.requestId, error: String(e) });
      }
      
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
    
    devLog("info", "stt: successfully persisted to real Convex", { messageId, sessionId, requestId: opts.requestId });
    
    // Trigger triage after user interaction is saved
    try {
      const triageOnUser = String(getEnvString("TRIAGE_ON_USER_INGEST") || '1').toLowerCase();
      if (triageOnUser === '1' || triageOnUser === 'true') {
        // Fetch last 2 message IDs for triage (using optimized tail query)
        const docs: Array<any> = await client.query("functions/interactions:listIdsTail", { sessionId, limit: 2 }).catch(() => []) as any[];
        const messageIds = docs.map((d: any) => String(d?.messageId || '')).filter(Boolean);
        
        if (messageIds.length > 0) {
          const ctrl = new AbortController();
          const to = setTimeout(() => ctrl.abort(), Math.max(300, Math.min(2000, Number(getEnvString("TRIAGE_TIMEOUT_MS") || 1200))));
          
          // Call triage API internally
          try {
            const url = `/api/v1/triage?sessionId=${encodeURIComponent(sessionId)}`;
            const headers: Record<string, string> = { 'content-type': 'application/json', 'x-request-id': opts.requestId };
            
            // Use server-side relative URL for internal API call
            const baseUrl = getEnvString("VERCEL_URL") ? `https://${getEnvString("VERCEL_URL")}` : 'http://localhost:3000';
            const fullUrl = `${baseUrl}${url}`;
            
            ;(async () => {
              try {
                const res = await fetch(fullUrl, {
                  method: 'POST',
                  headers,
                  body: JSON.stringify({ messageIds }),
                  signal: ctrl.signal,
                });
                if (!res.ok) {
                  // Fallback to Convex action to avoid stuck PENDING
                  try { await (client as any).action("functions/triage:runForSession", { sessionId, limit: messageIds.length || 2 }); } catch {}
                }
              } catch {
                try { await (client as any).action("functions/triage:runForSession", { sessionId, limit: messageIds.length || 2 }); } catch {}
              } finally {
                try { clearTimeout(to); } catch {}
              }
            })();
            
            devLog("info", "stt: triggered triage for user message", { sessionId, messageIds, requestId: opts.requestId });
          } catch (e) {
            devLog("warn", "stt: triage trigger failed", { sessionId, requestId: opts.requestId, error: String(e) });
          }
        }
      }
    } catch (e) {
      devLog("warn", "stt: triage setup failed", { sessionId, requestId: opts.requestId, error: String(e) });
    }
  } catch (e) {
    devLog("error", "stt: persistInteraction failed", { sessionId, requestId: opts.requestId, error: String(e) });
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
    devLog("error", "stt: cost calculation failed", { error: String(error) });
    return { costCents: 0, durationMs };
  }
}

export async function POST(request: Request) {
  const headersIn = new Headers(request.headers);
  const requestId = headersIn.get("x-request-id") || safeUUID();
  const startTime = Date.now();

  devLog("debug", "stt: POST request initiated", {
    requestId,
    timestamp: new Date().toISOString()
  });
  const detectMsHeader = headersIn.get("x-detect-ms");
  const clientDetectMs = detectMsHeader ? Number(detectMsHeader) : undefined;
  const routePath = "/api/v1/stt";
  const method = "POST";
  // startTime is already defined above
  // Safe diagnostics: meta only, no secrets
  let host = "";
  let path = "";
  try { const u = new URL(request.url); host = u.host; path = u.pathname; } catch {}
  const hasAuthHeader = !!headersIn.get("authorization");
  const hasCookie = !!headersIn.get("cookie");
  let provider = getSttProvider(getEnvString("STT_PROVIDER"));
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
    // Include reason in body to help diagnose production 401s
    return respond(401, { error: "Unauthorized", reason: auth.reason });
  }

  // Determine content type
  const ct = (headersIn.get("content-type") || "").toLowerCase();
  const isMultipart = ct.includes("multipart/form-data");
  const allowedTypes = new Set(["audio/webm", "audio/wav", "audio/mpeg", "audio/mp4", "audio/x-m4a"]);
  const maxBytes = Number(getEnvString("STT_MAX_AUDIO_BYTES")) > 0 ? Number(getEnvString("STT_MAX_AUDIO_BYTES")) : 25 * 1024 * 1024;

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
    const provider = (getEnvString("STORAGE_PROVIDER") || "s3").toLowerCase();
    const bucket = getEnvString("S3_BUCKET_AUDIO") || "";
    if (provider !== "s3" || !bucket) return null;
    const region = getEnvString("S3_REGION") || "us-east-1";
    const endpoint = getEnvString("S3_ENDPOINT_URL") || undefined;
    const forcePathStyle = getEnvString("S3_FORCE_PATH_STYLE") === "1";
    const s3 = new S3Client({ region, endpoint, forcePathStyle });
    const now = Date.now();
    const key = `audio/${new Date(now).toISOString().slice(0,10)}/${safeUUID()}.${extFromContentType(file.type || "application/octet-stream")}`;
    const buf = Buffer.from(await file.arrayBuffer());
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buf, ContentType: file.type || "application/octet-stream" }));
    // Construct a URL if endpoint resembles a local/public endpoint
    let audioUrl: string | undefined;
    if (endpoint) {
      const base = endpoint.replace(/\/$/, "");
      audioUrl = getEnvString("S3_FORCE_PATH_STYLE") === "1" ? `${base}/${bucket}/${key}` : `${base}/${key}`;
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
      const convexUrl = getEnvString("CONVEX_URL") || getEnvString("NEXT_PUBLIC_CONVEX_URL") || "http://127.0.0.1:3210";
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
      if (getEnvString("ALLOW_PROVIDER_OVERRIDE") === '1') {
        const requested = typeof form.get("provider") === 'string' ? String(form.get("provider")) : undefined;
        if (requested) {
          provider = getSttProvider(requested);
          mode = provider.name;
        }
      }

      if (!isBlobLikeFile(audio)) {
        return respond(400, { error: "audio file is required in form field 'audio'" });
      }
      const mime = (audio.type || '').toLowerCase();
      if (!allowedTypes.has(mime)) {
        return respond(400, { error: "Unsupported contentType" });
      }
      const size = audio.size || 0;
      if (!(size > 0) || size > maxBytes) {
        return respond(413, { error: "Audio too large", maxBytes });
      }

      // Decide path: data URL (privacy-first) vs storage upload
      // Default is storage upload unless explicitly enabled via STT_MULTIPART_DATAURL_ENABLED=1
      // NOTE: Use process.env directly because getEnvString only looks in predefined serverEnv object
      const enableDataUrl = process.env.STT_MULTIPART_DATAURL_ENABLED === "1";
      
      // DEBUG: Force log to see what's happening
      console.log("[STT DEBUG]", {
        enableDataUrl,
        STT_MULTIPART_DATAURL_ENABLED: process.env.STT_MULTIPART_DATAURL_ENABLED,
        STT_PROVIDER: process.env.STT_PROVIDER,
        provider: provider.name,
        size,
        mime
      });
      
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
        // Use sessionId from frontend if provided, fallback to effectiveSessionId
        const sidEff = sessionId || effectiveSessionId;
        persistInteraction(client, {
          sessionId: sidEff,
        groupId,
        requestId,
        text: result.text ?? null,
        audioUrl: undefined,
        objectKey: undefined,
        sttCostCents: sttCost.costCents,
        sttDurationMs: sttCost.durationMs,
      }).catch((e) => { devLog("error", "stt: persistInteraction failed in multipart dataUrl path", { error: String(e), sessionId }); });

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
          promMetrics.sttLatencyMs.labels(labels.route, labels.method, labels.status, labels.mode).observe(Date.now() - startTime);
        } catch {}
        return respond(200, payload);
      }

      // Upload to storage and pass objectKey to provider (preferred path when privacy gating is disabled)
      const uploaded = await uploadToS3AndGetKey(audio);
      if (!uploaded) {
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
      // Use sessionId from frontend if provided, fallback to effectiveSessionId
      const sidEff = sessionId || effectiveSessionId;
      persistInteraction(client, {
        sessionId: sidEff,
        groupId,
        requestId,
        text: result.text ?? null,
        audioUrl: uploaded.audioUrl ?? undefined,
        objectKey: uploaded.objectKey ?? undefined,
        sttCostCents: sttCost.costCents,
        sttDurationMs: sttCost.durationMs,
      }).catch((e) => { devLog("error", "stt: persistInteraction failed in multipart storage path", { error: String(e), sessionId }); });

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
        promMetrics.sttLatencyMs.labels(labels.route, labels.method, labels.status, labels.mode).observe(Date.now() - startTime);
      } catch {}
      return respond(200, payload);
    } catch (err: any) {
      if (err?.name === 'ProviderNotConfiguredError' || err instanceof ProviderNotConfiguredError) {
        return respond(501, { error: "STT provider not configured" });
      }
      return respond(500, { error: "STT failed" });
    }
  }

  // JSON branch (existing)
  let body: any;
  try { body = await request.json(); }
  catch {
    devLog("warn", "stt: invalid JSON", { requestId, status: 400, latencyMs: Date.now() - startTime });
    return respond(400, { error: "Invalid JSON" });
  }

  // Optional provider override for dev/testing
  if (getEnvString("ALLOW_PROVIDER_OVERRIDE") === '1') {
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
    devLog("warn", "stt: audioUrl or objectKey required", { requestId, status: 400, latencyMs: Date.now() - startTime });
    return respond(400, { error: "audioUrl or objectKey is required" });
  }

  try {
    // Start ensureActiveSession in parallel for JSON path
    const ensureSessionPromise = (async () => {
      try {
        const hint = sessionId || undefined;
        const res: any = await makeConvex(getEnvString("CONVEX_URL") || getEnvString("NEXT_PUBLIC_CONVEX_URL") || "http://127.0.0.1:3210").mutation("functions/sessions:ensureActiveSession", {
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
        const provider = (getEnvString("STORAGE_PROVIDER") || "s3").toLowerCase();
        const bucket = getEnvString("S3_BUCKET_AUDIO") || "";
        if (provider === "s3" && bucket) {
          const region = getEnvString("S3_REGION") || "us-east-1";
          const endpoint = getEnvString("S3_ENDPOINT_URL") || undefined;
          const forcePathStyle = getEnvString("S3_FORCE_PATH_STYLE") === "1";
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
    const convexUrl = getEnvString("CONVEX_URL") || getEnvString("NEXT_PUBLIC_CONVEX_URL") || "http://127.0.0.1:3210";
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
    }).catch((e) => { devLog("error", "stt: persistInteraction failed in JSON path", { error: String(e), sessionId }); });

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
        const provider = (getEnvString("STORAGE_PROVIDER") || "s3").toLowerCase();
        const bucket = getEnvString("S3_BUCKET_AUDIO") || "";
        if (provider === "s3" && bucket) {
          const region = getEnvString("S3_REGION") || "us-east-1";
          const endpoint = getEnvString("S3_ENDPOINT_URL") || undefined;
          const forcePathStyle = getEnvString("S3_FORCE_PATH_STYLE") === "1";
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
      promMetrics.sttLatencyMs.labels(labels.route, labels.method, labels.status, labels.mode).observe(Date.now() - startTime);
    } catch {}
    devLog("info", "stt: 200 OK response", {
      requestId,
      status: 200,
      mode,
      sessionId,
      groupId,
      hasAudioUrl: !!audioUrl,
      hasObjectKey: !!objectKey,
      model: result.model,
      clientDetectMs,
      latencyMs: Date.now() - startTime
    });
    return respond(200, payload);
  } catch (err: any) {
    if (err?.name === 'ProviderNotConfiguredError' || err instanceof ProviderNotConfiguredError) {
      devLog("error", "stt: STT provider not configured", {
        requestId,
        status: 501,
        mode,
        error: err?.message,
        latencyMs: Date.now() - startTime
      });
      return respond(501, { error: "STT provider not configured" });
    }
    devLog("error", "stt: STT failed", {
      requestId,
      status: 500,
      mode,
      error: err?.message,
      latencyMs: Date.now() - startTime
    });
    return respond(500, { error: "STT failed" });
  }
}
