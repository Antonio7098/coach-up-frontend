/* eslint-disable no-console */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { makeConvex } from "../../../lib/convex";
import * as mockConvex from "../../../lib/mockConvex";
import { promMetrics } from "../../../lib/metrics";
import { clientKeyFromHeaders, rateLimit } from "../../../lib/ratelimit";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Request-Id, Authorization",
  "Access-Control-Expose-Headers": "X-Request-Id",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

function convexBaseUrl() {
  return process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL || "http://127.0.0.1:3210";
}

function safeUUID(): string {
  try {
    const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
    return g.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

function wrapRespond(routePath: string, method: string, requestId: string, mode: string, endTimer: ReturnType<typeof promMetrics.requestDurationSeconds.startTimer>) {
  return function respond(status: number, body: unknown, extraHeaders?: Record<string, string>) {
    const labels = { route: routePath, method, status: String(status), mode } as const;
    promMetrics.requestsTotal.labels(labels.route, labels.method, labels.status, labels.mode).inc();
    if (status >= 500) promMetrics.requestErrorsTotal.labels(labels.route, labels.method, labels.status, labels.mode).inc();
    endTimer(labels);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...corsHeaders, ...(extraHeaders || {}) },
    });
  };
}

export async function GET(request: Request) {
  const headersIn = new Headers(request.headers);
  const requestId = headersIn.get("x-request-id") || safeUUID();
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId") || undefined;
  const started = Date.now();
  const mode = process.env.MOCK_CONVEX === '1' ? 'mock' : 'real';
  const routePath = '/api/v1/users/goals';
  const method = 'GET';
  const endTimer = promMetrics.requestDurationSeconds.startTimer();
  const respond = wrapRespond(routePath, method, requestId, mode, endTimer);
  // Rate limit per client (best-effort; in-memory only)
  const rlKey = clientKeyFromHeaders(headersIn);
  const rl = rateLimit(`users-goals:${method}:${rlKey}`);
  if (!rl.ok) {
    const labels = { route: routePath, method, status: '429', mode } as const;
    promMetrics.rateLimitedTotal.labels(labels.route, labels.method, labels.status, labels.mode).inc();
    console.log(JSON.stringify({ level: 'warn', route: routePath, requestId, status: 429, reason: 'rate_limited', retryAfterSec: rl.retryAfterSec }));
    return respond(429, { error: "Rate limit exceeded" }, { "Retry-After": String(rl.retryAfterSec), "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.resetSec) });
  }
  const rateHeaders = { "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.resetSec) };

  if (!userId) {
    console.log(JSON.stringify({ level: 'warn', route: routePath, requestId, status: 400, msg: 'Missing userId', mode, latencyMs: Date.now() - started }));
    return respond(400, { error: "userId required" }, rateHeaders);
  }

  try {
    if (process.env.MOCK_CONVEX === '1') {
      const goals = await mockConvex.listUserGoals({ userId });
      console.log(JSON.stringify({ level: 'info', route: routePath, requestId, userId, status: 200, itemsReturned: goals.length, mode, latencyMs: Date.now() - started }));
      return respond(200, { goals }, rateHeaders);
    }
    const client = makeConvex(convexBaseUrl());
    const goals = await client.query("functions/users:listGoals", { userId }) as any[];
    console.log(JSON.stringify({ level: 'info', route: routePath, requestId, userId, status: 200, itemsReturned: Array.isArray(goals) ? goals.length : 0, mode, latencyMs: Date.now() - started }));
    return respond(200, { goals: Array.isArray(goals) ? goals : [] }, rateHeaders);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e ?? 'Convex query failed');
    console.log(JSON.stringify({ level: 'error', route: routePath, requestId, userId, status: 502, error: msg, mode, latencyMs: Date.now() - started }));
    return respond(502, { error: "Convex query failed" }, rateHeaders);
  }
}

export async function POST(request: Request) {
  const headersIn = new Headers(request.headers);
  const requestId = headersIn.get("x-request-id") || safeUUID();
  const started = Date.now();
  const mode = process.env.MOCK_CONVEX === '1' ? 'mock' : 'real';
  const routePath = '/api/v1/users/goals';
  const method = 'POST';
  const endTimer = promMetrics.requestDurationSeconds.startTimer();
  const respond = wrapRespond(routePath, method, requestId, mode, endTimer);
  // Rate limit per client (best-effort; in-memory only)
  const rlKey = clientKeyFromHeaders(headersIn);
  const rl = rateLimit(`users-goals:${method}:${rlKey}`);
  if (!rl.ok) {
    const labels = { route: routePath, method, status: '429', mode } as const;
    promMetrics.rateLimitedTotal.labels(labels.route, labels.method, labels.status, labels.mode).inc();
    console.log(JSON.stringify({ level: 'warn', route: routePath, requestId, status: 429, reason: 'rate_limited', retryAfterSec: rl.retryAfterSec }));
    return respond(429, { error: "Rate limit exceeded" }, { "Retry-After": String(rl.retryAfterSec), "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.resetSec) });
  }
  const rateHeaders = { "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.resetSec) };

  let body: any = {};
  try { body = await request.json(); } catch {}
  const { userId, goalId, title, description, status, targetDateMs, tags } = body || {};
  if (!userId || !goalId || !title || !status) {
    console.log(JSON.stringify({ level: 'warn', route: routePath, requestId, status: 400, msg: 'Missing required fields', mode, latencyMs: Date.now() - started }));
    return respond(400, { error: "userId, goalId, title, status are required" }, rateHeaders);
  }

  try {
    if (process.env.MOCK_CONVEX === '1') {
      const res = await mockConvex.addOrUpdateGoal({ userId, goalId, title, description, status, targetDateMs, tags });
      console.log(JSON.stringify({ level: 'info', route: routePath, requestId, userId, goalId, status: 200, created: !!res?.created, mode, latencyMs: Date.now() - started }));
      return respond(200, { ok: true, created: !!res?.created }, rateHeaders);
    }
    const client = makeConvex(convexBaseUrl());
    const res = await client.mutation("functions/users:addGoal", { userId, goalId, title, description, status, targetDateMs, tags }) as any;
    console.log(JSON.stringify({ level: 'info', route: routePath, requestId, userId, goalId, status: 200, created: !!res?.created, mode, latencyMs: Date.now() - started }));
    return respond(200, { ok: true, created: !!res?.created }, rateHeaders);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e ?? 'Convex mutation failed');
    console.log(JSON.stringify({ level: 'error', route: routePath, requestId, userId, goalId, status: 502, error: msg, mode, latencyMs: Date.now() - started }));
    return respond(502, { error: "Convex mutation failed" }, rateHeaders);
  }
}

export async function PATCH(request: Request) {
  const headersIn = new Headers(request.headers);
  const requestId = headersIn.get("x-request-id") || safeUUID();
  const started = Date.now();
  const mode = process.env.MOCK_CONVEX === '1' ? 'mock' : 'real';
  const routePath = '/api/v1/users/goals';
  const method = 'PATCH';
  const endTimer = promMetrics.requestDurationSeconds.startTimer();
  const respond = wrapRespond(routePath, method, requestId, mode, endTimer);
  // Rate limit per client (best-effort; in-memory only)
  const rlKey = clientKeyFromHeaders(headersIn);
  const rl = rateLimit(`users-goals:${method}:${rlKey}`);
  if (!rl.ok) {
    const labels = { route: routePath, method, status: '429', mode } as const;
    promMetrics.rateLimitedTotal.labels(labels.route, labels.method, labels.status, labels.mode).inc();
    console.log(JSON.stringify({ level: 'warn', route: routePath, requestId, status: 429, reason: 'rate_limited', retryAfterSec: rl.retryAfterSec }));
    return respond(429, { error: "Rate limit exceeded" }, { "Retry-After": String(rl.retryAfterSec), "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.resetSec) });
  }
  const rateHeaders = { "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.resetSec) };

  let body: any = {};
  try { body = await request.json(); } catch {}
  const { userId, goalId, ...updates } = body || {};
  if (!userId || !goalId) {
    console.log(JSON.stringify({ level: 'warn', route: routePath, requestId, status: 400, msg: 'Missing userId or goalId', mode, latencyMs: Date.now() - started }));
    return respond(400, { error: "userId and goalId are required" }, rateHeaders);
  }

  try {
    if (process.env.MOCK_CONVEX === '1') {
      const res = await mockConvex.updateGoal({ userId, goalId, ...updates });
      console.log(JSON.stringify({ level: 'info', route: routePath, requestId, userId, goalId, status: 200, ok: !!res?.ok, mode, latencyMs: Date.now() - started }));
      return respond(200, { ok: true }, rateHeaders);
    }
    const client = makeConvex(convexBaseUrl());
    await client.mutation("functions/users:updateGoal", { userId, goalId, ...updates });
    console.log(JSON.stringify({ level: 'info', route: routePath, requestId, userId, goalId, status: 200, ok: true, mode, latencyMs: Date.now() - started }));
    return respond(200, { ok: true }, rateHeaders);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e ?? 'Convex mutation failed');
    console.log(JSON.stringify({ level: 'error', route: routePath, requestId, userId, goalId, status: 502, error: msg, mode, latencyMs: Date.now() - started }));
    return respond(502, { error: "Convex mutation failed" }, rateHeaders);
  }
}

export async function DELETE(request: Request) {
  const headersIn = new Headers(request.headers);
  const requestId = headersIn.get("x-request-id") || safeUUID();
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId") || undefined;
  const goalId = url.searchParams.get("goalId") || undefined;
  const started = Date.now();
  const mode = process.env.MOCK_CONVEX === '1' ? 'mock' : 'real';
  const routePath = '/api/v1/users/goals';
  const method = 'DELETE';
  const endTimer = promMetrics.requestDurationSeconds.startTimer();
  const respond = wrapRespond(routePath, method, requestId, mode, endTimer);
  // Rate limit per client (best-effort; in-memory only)
  const rlKey = clientKeyFromHeaders(headersIn);
  const rl = rateLimit(`users-goals:${method}:${rlKey}`);
  if (!rl.ok) {
    const labels = { route: routePath, method, status: '429', mode } as const;
    promMetrics.rateLimitedTotal.labels(labels.route, labels.method, labels.status, labels.mode).inc();
    console.log(JSON.stringify({ level: 'warn', route: routePath, requestId, status: 429, reason: 'rate_limited', retryAfterSec: rl.retryAfterSec }));
    return respond(429, { error: "Rate limit exceeded" }, { "Retry-After": String(rl.retryAfterSec), "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.resetSec) });
  }
  const rateHeaders = { "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.resetSec) };

  if (!userId || !goalId) {
    console.log(JSON.stringify({ level: 'warn', route: routePath, requestId, status: 400, msg: 'Missing userId or goalId', mode, latencyMs: Date.now() - started }));
    return respond(400, { error: "userId and goalId are required" }, rateHeaders);
  }

  try {
    if (process.env.MOCK_CONVEX === '1') {
      const res = await mockConvex.deleteGoal({ userId, goalId });
      console.log(JSON.stringify({ level: 'info', route: routePath, requestId, userId, goalId, status: 200, deleted: !!res?.deleted, mode, latencyMs: Date.now() - started }));
      return respond(200, { ok: true, deleted: !!res?.deleted }, rateHeaders);
    }
    const client = makeConvex(convexBaseUrl());
    const res = await client.mutation("functions/users:deleteGoal", { userId, goalId }) as any;
    console.log(JSON.stringify({ level: 'info', route: routePath, requestId, userId, goalId, status: 200, deleted: !!res?.deleted, mode, latencyMs: Date.now() - started }));
    return respond(200, { ok: true, deleted: !!res?.deleted }, rateHeaders);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e ?? 'Convex mutation failed');
    console.log(JSON.stringify({ level: 'error', route: routePath, requestId, userId, goalId, status: 502, error: msg, mode, latencyMs: Date.now() - started }));
    return respond(502, { error: "Convex mutation failed" }, rateHeaders);
  }
}
