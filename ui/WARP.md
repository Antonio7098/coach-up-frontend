# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

Project type: Next.js 15 app router UI with server-side API routes, Convex backend integration (cloud dev deployment or mock), Clerk (optional), Playwright for E2E, Vitest for unit/integration.

Quick commands
- Dev server
  - Default: npm run dev
  - With mocked Convex: npm run dev:mock  (MOCK_CONVEX=1)
  - With WASM CSS transformer (fixes local lightningcss issues): npm run dev:wasm
- Build/Start
  - Build: npm run build
  - Start (after build): npm start
- Lint
  - npm run lint
- Tests
  - Unit/integration (Vitest):
    - All: npm run test:unit
    - Watch: npm run test:unit:watch
    - Single file: npm run test:unit -- tests/unit/api.v1.transcripts.spec.ts
    - By test name: npm run test:unit -- -t "should persist transcript"
  - E2E (Playwright):
    - All (default mock Convex): npm run test:e2e
    - Single file: npx playwright test tests/e2e/ui.session-summary.spec.ts --project=chromium
    - Headed debug: npm run test:e2e:headed
    - Protect-all routes (auth enforced): npm run test:e2e:protected
    - Against real Convex: npm run test:e2e:real-convex  (set CONVEX_URL if not in .env.local)
- Smoke checks (useful during dev)
  - Skills API: npm run smoke:skills
  - Storage presign/download: npm run smoke:storage / npm run smoke:storage:download
  - Transcripts: npm run smoke:transcripts
  - STT (single and multipart): npm run smoke:stt / npm run smoke:stt:multipart
  - TTS: npm run smoke:tts

Environment and services
- .env.local (UI) typical settings
  - MOCK_CONVEX=0 or 1 (1 = in-memory mock Convex; 0 = query cloud Convex)
  - CONVEX_URL and NEXT_PUBLIC_CONVEX_URL (when using real Convex)
  - AI_API_BASE_URL and NEXT_PUBLIC_AI_API_BASE_URL (FastAPI AI API base; defaults to http://127.0.0.1:8000)
  - Clerk (optional): NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY
  - CLERK_PROTECT_ALL=0|1 to toggle route protection via middleware
- Starting dependent services
  - Convex dev (from coach-up-frontend/): npx convex dev
  - AI API (from coach-up-ai-api/): python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000
- Playwright-managed web servers (when running E2E)
  - Will start AI API (unless SKIP_AI_CONTRACTS=1)
  - Will start Next.js dev server with CSS_TRANSFORMER_WASM=1 and CLERK_ENABLED=0 for tests

How the UI talks to backends
- Convex
  - Real mode (MOCK_CONVEX=0): server routes call makeConvex(CONVEX_URL) to query/mutate Convex cloud functions.
  - Mock mode (MOCK_CONVEX=1): server routes call in-memory mockConvex helpers; E2E defaults to this for hermetic runs.
- AI API (FastAPI)
  - /api/chat proxies to AI API /chat/stream via SSE, passing X-Request-Id and optional X-Tracked-Skill-Id.
  - /api/v1/session-summary POST calls AI API /api/v1/session-summary/generate to synthesize rolling summaries.

High-level architecture
- Next.js App Router
  - Pages under src/app provide views for chat (/chat), coach, analytics, and minimal variants (/coach-min) used for fast E2E.
  - Client contexts manage audio/mic/voice state (src/context/* and src/context/minimal/* for lighter pages).
- API routes (src/app/api)
  - api/chat/route.ts: SSE proxy to AI API chat. Enhancements:
    - Optionally injects latest server-side session summary (as a system message) into the client-provided history by fetching from Convex functions/summaries:getLatest.
    - Supports MOCK_CONVEX=1 mode to attach mock user profile/goals to upstream query params for demo/testing.
    - Streams upstream body directly to the client and records Prometheus metrics (first token latency, disconnects, durations).
  - api/v1/session-summary/route.ts: Server-facing summary API.
    - GET returns latest summary payload plus threshold/turns hints; always 200 with default payload if missing (cloud) or mock payload (mock mode).
    - POST synthesizes a rolling summary via AI API and persists to Convex (cloud) or in-memory (mock). Handles empty-summary responses via X-Summary-Empty=1.
    - Optional cadence: can fetch interactions since last cutoff in Convex when SUMMARY_FETCH_FROM_CONVEX=1; otherwise uses client-provided recent messages.
    - Includes simple in-memory rate limiting per client key.
  - api/v1/sessions/metrics/route.ts: Computes session metrics. Uses denormalized fields from sessions:getBySessionId and falls back to interactions:listBySession if missing.
  - Additional v1 routes mirror domain features (skills, transcripts, tts/stt, interactions, events, storage presign) and rely on makeConvex in real mode or mockConvex in mock mode.
- Convex integration
  - Convex client helpers in src/app/api/lib/convex.ts; mockConvex implements a parallel in-memory surface for tests and MOCK_CONVEX flows.
  - UI never assumes client-side Convex; all Convex access is on the server routes to preserve authoritative state.
- Auth and middleware
  - Optional Clerk gating via requireAuth in API routes; guarded by CLERK_ENABLED/CLERK_PROTECT_ALL. Public sign-in is mounted under /sign-in via the (auth) segment.
- TypeScript and paths
  - TS paths: @/* maps to src/*; @/convex/* maps to ../convex/*.

Testing specifics
- Unit/integration (Vitest)
  - Env: node environment, globals on, setup file tests/setup.vitest.ts.
  - Convex is mocked globally (convex/browser and server codegen) to allow importing convex/functions/* in tests.
  - Single test examples:
    - File: npm run test:unit -- tests/integration/api.v1.core.integration.spec.ts
    - Name: npm run test:unit -- -t "returns 200 with default payload"
- E2E (Playwright)
  - Projects: chromium and chromium:real-convex
  - Mock defaults: MOCK_CONVEX=1, CLERK_ENABLED=0, STT/TTS mocked, CSS_TRANSFORMER_WASM=1
  - Real Convex run: set CONVEX_URL (and optionally NEXT_PUBLIC_CONVEX_URL), then npm run test:e2e:real-convex
  - To skip AI API contracts startup: SKIP_AI_CONTRACTS=1 npx playwright test

Lint/build configuration notes
- ESLint uses next/core-web-vitals + next/typescript with relaxed any rules in tests and API routes. Run npm run lint.
- next.config.ts sets output: 'standalone' in production and ignoreDuringBuilds: true for ESLint (to not block builds), and enables experimental.externalDir in development.

Operational diagnostics
- Metrics: server routes use prom-client to record request counts, durations, chat first-token latency, and disconnect reasons.
- SSE proxy: api/chat uses TransformStream and a dual-reader tee to measure time-to-first-byte before piping to client.

Gotchas and tips from repo docs
- SSR-safe randoms: For client-visible IDs used in components rendered on both server and client, derive them on the client (inside useEffect) and persist to sessionStorage to avoid hydration mismatches (see README “SSR-safe random values” and src/app/chat/page.tsx pattern).

Appendix: common env toggles
- MOCK_CONVEX=1: Use in-memory mock Convex for API routes and E2E.
- CLERK_PROTECT_ALL=1: Enforce auth via middleware; keep 0 for most local/dev.
- SUMMARY_FETCH_FROM_CONVEX=1: Server-side summary POST will pull recent interactions from Convex using the last cutoff timestamp.
- PROMPT_DEBUG=1: Enables debug prompt preview saving in api/chat.

