/* eslint-disable no-console */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { requireAuth } from "../../../../lib/auth";
import { promMetrics } from "../../../../lib/metrics";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Request-Id, Authorization",
  "Access-Control-Expose-Headers": "X-Request-Id",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: Request) {
  const headersIn = new Headers(request.headers);
  const requestId = headersIn.get("x-request-id") || safeUUID();
  const routePath = "/api/v1/storage/audio/presign";
  const method = "GET";
  const started = Date.now();
  let mode: "s3" | "mock" = "mock";
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

  // Auth (optional)
  const auth = await requireAuth(request);
  if (!auth.ok) {
    console.log(JSON.stringify({ level: 'warn', route: routePath, requestId, status: 401, reason: auth.reason, latencyMs: Date.now() - started }));
    return respond(401, { error: "Unauthorized" });
  }

  const url = new URL(request.url);
  const objectKey = url.searchParams.get('objectKey') || '';
  if (!objectKey) {
    console.log(JSON.stringify({ level: 'warn', route: routePath, requestId, status: 400, msg: 'Missing objectKey', latencyMs: Date.now() - started }));
    return respond(400, { error: "objectKey is required" });
  }

  const provider = (process.env.STORAGE_PROVIDER || "s3").toLowerCase();
  const bucket = process.env.S3_BUCKET_AUDIO || "";
  const region = process.env.S3_REGION || "us-east-1";
  const endpoint = process.env.S3_ENDPOINT_URL || undefined;
  const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === "1";

  const now = Date.now();

  if (provider === "s3" && bucket) {
    try {
      const credentials = (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
        ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID!, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY! }
        : undefined;
      const s3 = new S3Client({
        region,
        endpoint,
        forcePathStyle,
        credentials,
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
      });
      const cmd = new GetObjectCommand({ Bucket: bucket, Key: objectKey });
      const expiresIn = 15 * 60; // 15 minutes
      const signed = await getSignedUrl(s3, cmd, { expiresIn });
      mode = "s3";
      const payload = {
        url: signed,
        method: "GET",
        headers: {},
        expiresAt: now + expiresIn * 1000,
        objectKey,
      } as const;
      console.log(JSON.stringify({ level: 'info', route: routePath, requestId, status: 200, mode, objectKey, bucket, region, endpoint: endpoint ? true : false, forcePathStyle, latencyMs: Date.now() - started }));
      return respond(200, payload);
    } catch (err: any) {
      console.log(JSON.stringify({ level: 'error', route: routePath, requestId, status: 500, mode: 's3', msg: 'Download presign failed', error: err?.message, latencyMs: Date.now() - started }));
      return respond(500, { error: "Presign failed" });
    }
  }

  // Fallback mock
  const mockUrl = `https://example.local/download/${encodeURIComponent(objectKey)}?signature=mock`;
  const expiresAt = now + 5 * 60 * 1000;
  const payload = { url: mockUrl, method: "GET", headers: {}, expiresAt, objectKey } as const;
  console.log(JSON.stringify({ level: 'info', route: routePath, requestId, status: 200, mode, objectKey, latencyMs: Date.now() - started }));
  return respond(200, payload);
}

function safeUUID(): string {
  try {
    const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
    return g.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

function extFromContentType(ct: string): string {
  switch (ct) {
    case "audio/webm": return "webm";
    case "audio/wav": return "wav";
    case "audio/mpeg": return "mp3";
    case "audio/mp4": return "m4a";
    case "audio/x-m4a": return "m4a";
    default: return "bin";
  }
}

export async function POST(request: Request) {
  const headersIn = new Headers(request.headers);
  const requestId = headersIn.get("x-request-id") || safeUUID();
  const routePath = "/api/v1/storage/audio/presign";
  const method = "POST";
  const started = Date.now();
  let mode: "s3" | "mock" = "mock";
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

  // Auth (optional gating via CLERK_ENABLED)
  const auth = await requireAuth(request);
  if (!auth.ok) {
    console.log(JSON.stringify({ level: 'warn', route: routePath, requestId, status: 401, reason: auth.reason, latencyMs: Date.now() - started }));
    return respond(401, { error: "Unauthorized" });
  }

  // Validate body
  let body: any;
  try {
    body = await request.json();
  } catch {
    console.log(JSON.stringify({ level: 'warn', route: routePath, requestId, status: 400, msg: 'Invalid JSON', latencyMs: Date.now() - started }));
    return respond(400, { error: "Invalid JSON" });
  }

  const contentType = typeof body?.contentType === 'string' ? body.contentType : '';
  const sizeBytes = Number.isFinite(body?.sizeBytes) ? Number(body.sizeBytes) : 0;
  const allowed = new Set(["audio/webm", "audio/wav", "audio/mpeg", "audio/mp4", "audio/x-m4a"]);

  if (!allowed.has(contentType)) {
    console.log(JSON.stringify({ level: 'warn', route: routePath, requestId, status: 400, msg: 'Unsupported contentType', contentType, latencyMs: Date.now() - started }));
    return respond(400, { error: "Unsupported contentType" });
  }
  if (!(sizeBytes > 0)) {
    console.log(JSON.stringify({ level: 'warn', route: routePath, requestId, status: 400, msg: 'Invalid sizeBytes', sizeBytes, latencyMs: Date.now() - started }));
    return respond(400, { error: "sizeBytes must be > 0" });
  }

  // Try S3 presign when configured; otherwise fall back to mock
  const provider = (process.env.STORAGE_PROVIDER || "s3").toLowerCase();
  const bucket = process.env.S3_BUCKET_AUDIO || "";
  const region = process.env.S3_REGION || "us-east-1";
  const endpoint = process.env.S3_ENDPOINT_URL || undefined;
  const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === "1";

  const now = Date.now();
  const ext = extFromContentType(contentType);
  const objectKey = `audio/${new Date(now).toISOString().slice(0,10)}/${safeUUID()}.${ext}`;

  if (provider === "s3" && bucket) {
    try {
      const credentials = (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
        ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID!, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY! }
        : undefined; // use default provider chain if not explicitly set
      // Disable default flexible checksum behavior for broader S3 compatibility (e.g., LocalStack/MinIO)
      // See: https://docs.aws.amazon.com/sdkref/latest/guide/feature-dataintegrity.html
      const s3 = new S3Client({
        region,
        endpoint,
        forcePathStyle,
        credentials,
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
      });
      const cmd = new PutObjectCommand({ Bucket: bucket, Key: objectKey, ContentType: contentType });
      const expiresIn = 15 * 60; // 15 minutes
      const url = await getSignedUrl(s3, cmd, { expiresIn });
      mode = "s3";
      const payload = {
        url,
        method: "PUT",
        headers: { "Content-Type": contentType },
        expiresAt: now + expiresIn * 1000,
        objectKey,
        contentType,
      } as const;
      console.log(JSON.stringify({ level: 'info', route: routePath, requestId, status: 200, mode, objectKey, bucket, region, endpoint: endpoint ? true : false, forcePathStyle, latencyMs: Date.now() - started }));
      return respond(200, payload);
    } catch (err: any) {
      console.log(JSON.stringify({ level: 'error', route: routePath, requestId, status: 500, mode: 's3', msg: 'Presign failed', error: err?.message, latencyMs: Date.now() - started }));
      return respond(500, { error: "Presign failed" });
    }
  }

  // Fallback mock (when S3 not configured)
  const expiresAt = now + 5 * 60 * 1000; // 5 minutes
  const url = `https://example.local/upload/${encodeURIComponent(objectKey)}?signature=mock`;
  const payload = {
    url,
    method: "PUT",
    headers: { "Content-Type": contentType },
    expiresAt,
    objectKey,
    contentType,
  } as const;
  console.log(JSON.stringify({ level: 'info', route: routePath, requestId, status: 200, mode, objectKey, latencyMs: Date.now() - started }));
  return respond(200, payload);
}
