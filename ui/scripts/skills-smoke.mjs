#!/usr/bin/env node
/*
  Skills API Smoke Test
  - Hits /api/v1/skills and /api/v1/skills/tracked on a running UI server
  - Usage:
      UI_BASE_URL=http://localhost:3000 node scripts/skills-smoke.mjs
    Optional env:
      - AUTH_BEARER: Bearer token for protected runs when CLERK_ENABLED=1
      - REQUEST_ID: custom X-Request-Id
      - VERBOSE=1: print full JSON responses
*/

const UI_BASE_URL = process.env.UI_BASE_URL || 'http://localhost:3000';
const AUTH_BEARER = process.env.AUTH_BEARER || '';
const REQUEST_ID = process.env.REQUEST_ID || `smoke-${Date.now()}`;
const VERBOSE = process.env.VERBOSE === '1';

async function doGet(path) {
  const headers = { 'X-Request-Id': REQUEST_ID };
  if (AUTH_BEARER) headers['Authorization'] = `Bearer ${AUTH_BEARER}`;
  const url = `${UI_BASE_URL}${path}`;
  const res = await fetch(url, { headers });
  let bodyText = '';
  try {
    bodyText = await res.text();
  } catch {}
  let json;
  try {
    json = bodyText ? JSON.parse(bodyText) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, ok: res.ok, json, bodyText };
}

(async () => {
  console.log(`[skills-smoke] Base URL: ${UI_BASE_URL}`);
  const skills = await doGet('/api/v1/skills');
  console.log(`[skills-smoke] GET /api/v1/skills -> ${skills.status}`);
  if (!skills.ok) {
    console.error('[skills-smoke] /skills failed');
    if (skills.status === 502) console.error('Hint: Convex function path or Convex URL may be misconfigured.');
    process.exit(1);
  }
  if (VERBOSE) console.log(JSON.stringify(skills.json, null, 2));

  const tracked = await doGet('/api/v1/skills/tracked');
  console.log(`[skills-smoke] GET /api/v1/skills/tracked -> ${tracked.status}`);
  if (!tracked.ok) {
    if (tracked.status === 401) {
      console.error('Unauthorized. If Clerk is enabled (CLERK_ENABLED=1), set AUTH_BEARER with a valid token.');
    } else {
      console.error('[skills-smoke] /skills/tracked failed');
    }
    process.exit(2);
  }
  if (VERBOSE) console.log(JSON.stringify(tracked.json, null, 2));

  console.log('[skills-smoke] OK');
  process.exit(0);
})().catch((err) => {
  console.error('[skills-smoke] Error:', err);
  process.exit(99);
});
