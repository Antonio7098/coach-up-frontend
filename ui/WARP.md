# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

Project type: Next.js 15 (App Router) UI with optional Convex backend integration, optional Clerk auth gating, Playwright for E2E, and Vitest for unit/integration tests.

Common commands
- Dev server
  - Default: npm run dev
  - With mocked Convex: npm run dev:mock  (sets MOCK_CONVEX=1)
  - With WASM CSS transformer (fix local lightningcss issues): npm run dev:wasm
- Build/Start
  - Build: npm run build
  - Start (after build): npm start
- Lint
  - npm run lint
- Tests
  - Unit/integration (Vitest):
    - All: npm run test:unit
    - Watch: npm run test:unit:watch
    - Single file: npm run test:unit -- tests/unit/<file>.spec.ts
    - By test name: npm run test:unit -- -t "<name>"
  - E2E (Playwright):
    - All (mock Convex by default): npm run test:e2e
    - Single file: npx playwright test tests/e2e/<file>.spec.ts --project=chromium
    - Headed debug: npm run test:e2e:headed
    - Protect-all routes (auth enforced): npm run test:e2e:protected
    - Against real Convex: npm run test:e2e:real-convex  (set CONVEX_URL if not in .env.local)
- Smoke checks (for manual API verification)
  - Skills API: npm run smoke:skills
  - Storage presign/download: npm run smoke:storage / npm run smoke:storage:download
  - Transcripts: npm run smoke:transcripts
  - STT (single and multipart): npm run smoke:stt / npm run smoke:stt:multipart
  - TTS: npm run smoke:tts

Environment and services
- UI .env.local (set as needed)
  - MOCK_CONVEX=0|1 (1 = in-memory mock Convex)
  - CONVEX_URL and NEXT_PUBLIC_CONVEX_URL (for real Convex)
  - AI_API_BASE_URL and NEXT_PUBLIC_AI_API_BASE_URL (FastAPI base; defaults to http://127.0.0.1:8000)
  - Triage:
    - AI_TRIAGE_ENABLED=0|1 (enable triage routes)
    - TRIAGE_ON_USER_INGEST=0|1 (run triage every user message; sends last two interactions)
    - TRIAGE_ON_SUMMARY=0|1 (legacy pre-summary triage; off by default)
    - TRIAGE_PROVIDER=mock|external (mock for local dev; external calls AI API /triage/batch)
    - TRIAGE_TIMEOUT_MS (e.g., 1200 for user-ingest path)
  - Clerk (optional): NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY, CLERK_PROTECT_ALL=0|1
- Local backends
  - Convex dev (from repo root coach-up-frontend/): npx convex dev
  - AI API (from coach-up-ai-api/): python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000
- E2E-managed servers
  - Playwright starts AI API unless SKIP_AI_CONTRACTS=1
  - Playwright starts Next.js dev with CSS_TRANSFORMER_WASM=1 and CLERK_ENABLED=0 for tests

Architecture overview
- Next.js App Router UI (src/app)
  - src/app/layout.tsx defines app shell; src/app/page.tsx is the default landing view.
  - Client state is organized via React Contexts under src/context (Audio, Chat, Conversation, Mic, MicUI, Voice) and hooks under src/hooks (e.g., useInteractionsCache, useSessionSummary).
  - Shared UI components live under src/components (e.g., audio controls and SkillChart).
  - Global styles in src/app/globals.css and theme in src/styles/theme.css.
- Convex integration
  - The project includes convex/_generated/* and test scaffolding to mock Convex clients.
  - In unit/integration tests, Convex browser client and server codegen are mocked in tests/setup.vitest.ts, enabling tests without real Convex.
  - When running against a real Convex dev deployment, set CONVEX_URL/NEXT_PUBLIC_CONVEX_URL and run npx convex dev from the frontend repo root.
- Auth and middleware
  - src/middleware.ts provides optional Clerk-based gating controlled by CLERK_PROTECT_ALL; keep it disabled for most local dev and E2E.
- Testing strategy
  - Vitest: node environment, globals enabled, setup at tests/setup.vitest.ts; includes tests under tests/unit and tests/integration.
  - Playwright: projects chromium and chromium:real-convex; by default uses MOCK_CONVEX and disables Clerk during runs. It can also boot the AI API via uvicorn when contracts are enabled.
- Build/lint configuration
  - next.config.ts sets output: 'standalone' in production, enables experimental.externalDir in development, and ignores ESLint errors during builds.
  - ESLint uses next/core-web-vitals and next/typescript via eslint.config.mjs with relaxed any rules in tests and API code.

Notes from README
- E2E Quickstart (mock Convex):
  - Install: npm install && npx playwright install --with-deps chromium
  - Run: PERSIST_ASSESSMENTS_SECRET=test-secret npx playwright test --project=chromium
  - Useful toggles: SKIP_AI_CONTRACTS=1 (skip AI API), MOCK_CONVEX=1 (default)
- Real Convex Quickstart: configure ui/.env.local with CONVEX_URL/NEXT_PUBLIC_CONVEX_URL and AI API URLs, start npx convex dev, run npm run dev:wasm, and use npm run test:e2e:real-convex as needed.
- Clerk Quickstart: add keys to .env.local and optionally set CLERK_PROTECT_ALL=1; default to 0 for local dev and E2E.
- SSR-safe random values: For IDs used across SSR and client, generate on client in useEffect and persist to sessionStorage (see README and src/app/page.tsx pattern).
