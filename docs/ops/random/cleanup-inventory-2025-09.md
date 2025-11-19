# CoachUp Codebase Cleanup Inventory (2025-09-24)

This report catalogs current systems across `coach-up-ai-api` and `coach-up-frontend`, aligned to the requested cleanup scope. It identifies what to KEEP, what is LEGACY to remove, and what needs CLARIFICATION.

## High-level KEEP Scope
- coach-min (primary UX) and coach-new (UI variant)
- Chat pipeline: speech → STT → chat (SSE) → TTS
- Session summaries
- Triage on user message ingest (env-gated)
- Assessment after triage (v3 only)
- Manual assessment from UI button
- Skill tracking
- User goals (and any “bias” equivalent captured in profile/preferences)
- Level tracking (per-skill and overall if present)

---

## API (coach-up-ai-api)

### Chat / STT / TTS
- KEEP — Chat SSE endpoint
  - File: `app/main.py`
  - Endpoint: `GET /chat/stream`
- KEEP — TTS proxy/stub
  - File: `app/main.py`
  - Endpoint: `POST /api/v1/tts` (proxies to UI TTS when `TTS_PROXY_URL` is set; otherwise stub)
- STT handled in UI API; no direct delete in AI API needed.

### Message ingest and triage
- KEEP — User message ingest (integrates assessment enqueue and allows triage context)
  - File: `app/main.py`
  - Endpoint: `POST /messages/ingest`
  - Notes: Contains hooks for the old classifier; see below.
- REMOVE — Pre-summary triage helper (legacy)
  - File: `app/main.py`
  - Function: `_triage_before_summary(...)`
  - Usage: invoked at summary generation path; should be deleted alongside any calls.
- KEEP — Batch triage API (used by UI orchestrator)
  - File: `app/main.py`
  - Endpoint: `POST /triage/batch`
  - Also `POST /triage/offline` (dev/testing heuristics) — optional to keep for dev.

### Classifier system (legacy)
- REMOVE — Classifier client and toggles
  - Files:
    - `app/providers/base.py` (ClassifierClient interface)
    - `app/providers/factory.py` (`get_classifier_client` and env switches)
    - `app/providers/google.py` (GoogleClassifierClient)
    - `app/providers/openrouter.py` (OpenRouterClassifierClient)
    - `app/providers/mock.py` (MockClassifierClient)
  - Integration points to remove:
    - `app/main.py` in `/messages/ingest` around `AI_CLASSIFIER_ENABLED`, `DISABLE_CLASSIFIER`, and `get_classifier_client(...)` usage.
  - Rationale: Replaced by triage on user message ingest; requested to remove old classifier system.

### Assessments
- KEEP — v3 assessments only
  - Entry: `POST /assessments/run` (app/main.py)
  - Polling: `GET /assessments/{sessionId}` (v3-structure validation in tests)
  - Workers: `_assessments_worker`, `_assessments_worker_sqs`, `_run_assessment_job` — keep but ensure v3 shape is the only output persisted downstream.
- REMOVE — Any v1/v2 remnants or conversion shims
  - In `_assessments_worker` and related code, ensure v3 shape is primary; drop v1/v2 branches.

### Session summaries
- KEEP — Session summary generation endpoint
  - File: `app/main.py`
  - Endpoint: `POST /api/v1/session-summary/generate`
  - Action: Ensure no pre-summary triage; summary cadence remains independent but can follow triage+assessment.

---

## Frontend (coach-up-frontend)

### Pages (KEEP vs LEGACY)
- KEEP — `ui/src/app/coach-min/page.tsx`
- KEEP — `ui/src/app/coach-new/page.tsx` (UI variant)
- REVIEW/REMOVE — Other pages unless needed by min/new:
  - `ui/src/app/coach/page.tsx` (likely superseded)
  - `ui/src/app/coach-debug/page.tsx` (dev-only; optional keep)
  - `ui/src/app/chat/page.tsx` (older text chat; optional keep for dev)
  - `ui/src/app/coach/analytics/page.tsx` (if not used, mark legacy)
  - Auth pages remain if required by deployment.

### Chat pipeline (speech → STT → chat → TTS)
- KEEP — Minimal providers and contexts
  - `ui/src/context/minimal/MinimalMicContext.tsx`
  - `ui/src/context/minimal/MinimalVoiceContext.tsx` (STT via `/api/v1/stt`, TTS segmentation)
  - `ui/src/context/ConversationContext.tsx` and minimal variants
  - `ui/src/app/api/v1/stt/route.ts` — persists interactions and triggers triage
  - `ui/src/app/api/v1/tts/route.ts` (if present) — UI TTS proxy
  - `ui/src/app/api/v1/interactions/route.ts` — persists interactions; triage on user ingest (env-gated)

### Triage
- KEEP — Triage on user message ingest (env-gated)
  - `ui/src/app/api/v1/interactions/route.ts` — triggers `/api/v1/triage` for user messages when `TRIAGE_ON_USER_INGEST=1`
  - `ui/src/app/api/v1/stt/route.ts` — triggers triage after STT persistence
  - `ui/src/app/api/v1/triage/route.ts` — forwards to AI `/triage/batch`, persists via Convex, and (env-gated) kicks off assessments for non-`general_chatter` groups
- REMOVE — Any triage before summary variants (legacy); keep only on ingest path.

### Assessments (v3) and manual trigger
- KEEP — Manual assessment trigger (button/chip)
  - `ui/src/components/AssessmentChip.tsx` — calls `/api/assessments/run` with `rubricVersion: 'v3'`, polls results
  - `ui/src/app/coach-min/page.tsx` — integrates `AssessmentChip` and debug `runAssessNow`
- KEEP — Orchestrator and finalize
  - `ui/src/app/api/assessments/run/route.ts` — forces `rubricVersion: 'v3'` to AI API
  - `ui/src/app/api/assessments/orchestrator.ts` — finalizeAssessmentsForGroups
  - `ui/src/app/api/assessments/convex/finalize/route.ts` — writes to v3 tables
- REMOVE — Any v1/v2 assessment persistence code paths if still referenced in Convex or UI API.

### Session summaries
- KEEP — UI summary fetch and display
  - Hooks and endpoints:
    - `ui/src/hooks/useSessionSummary.ts`
    - `ui/src/app/api/v1/session-summary/route.ts` — aggregates AI API with local state
  - Pages: shown in coach-min/new panels
- REMOVE — Any pre-summary triage coupling.

### Skills, goals, levels
- KEEP — Convex schema and functions
  - `convex/schema.ts` — `skills`, `tracked_skills`, `skill_level_history`, v3 tables `assessments_v3`, `skill_assessment_v3`, `session_summaries`, `users_profile`, `users_goals`
  - `convex/functions/skills.ts` — tracking and level updates (`updateLevelFromRecentAssessments`)
  - `convex/functions/goals.ts`, `convex/functions/users.ts` — goals CRUD
- KEEP — UI pages
  - `ui/src/app/skills/page.tsx`, `ui/src/app/skills/[id]/page.tsx` — if actively used by coach-min/new
- CLARIFY — “User bias”
  - No explicit `bias` field found; likely implied via `users_profile`, `users_preferences` (docs), or goals. Confirm desired storage.
- CLARIFY — “Overall level tracking”
  - Present: per-skill levels; no single “overall level” table. Confirm if overall is derived/aggregated or needs a table.

---

## Proposed Removals (LEGACY)
- API: Remove classifier system and usage
  - Delete classifier interfaces/clients in `app/providers/*`, env toggles, and `/messages/ingest` classifier block
- API: Remove pre-summary triage
  - Delete `_triage_before_summary` and its call sites during summary path
- Frontend: Remove/Archive legacy pages not used by coach-min/new
  - `ui/src/app/coach/page.tsx` - Legacy coach page (superseded by coach-min/new)
  - `ui/src/app/chat/page.tsx` - Simple chat page (superseded by coach-min/new)
  - `ui/src/app/coach-debug/page.tsx` - Debug coach page (superseded by coach-min/new)
  - `ui/src/app/coach/analytics/page.tsx` - Analytics page (not used by min/new)
  - `ui/src/app/settings/page.tsx` - Settings page (superseded by coach-min/new panels)
- Frontend: Remove legacy API routes
  - `ui/src/app/api/v1/assess/stream/route.ts` - Legacy assess stream
- Frontend/UI API/Convex: Remove v1/v2 assessment code paths and dead schemas if still present; keep only v3

---

## Env Gates to KEEP
- TRIAGE_ON_USER_INGEST (UI API)
- ASSESS_ON_TRIAGE (UI API)
- AI_CHAT_ENABLED (AI API)
- TTS_PROXY_URL (AI API → UI)

---

## Items Needing Clarification
1) “User bias” — where to store and how it should be used. Options:
   - Extend `users_profile` with a `biases` field
   - Add `users_preferences` with specific fields (tone, correctionStyle, etc.)
CLARIFIED: Was a typo
2) “Overall level tracking” — compute as average of tracked skill levels, or add 
`users_overall_level` record updated on assessment finalize?
CLARIFIED: Choose mose efficient
3) Keep any legacy pages for development/testing purposes?
   - `coach-debug/page.tsx` — could be useful for internal debugging
   - `chat/page.tsx` — could be useful as a lightweight text-only fallback/dev page
   - `coach/analytics/page.tsx` — could be useful for user analytics if needed
CLARIFIED: remove
4) Settings functionality — should settings be integrated into coach-min/new panels instead of a separate page?
CLARIFIED: no. not yet

---

## Next Steps (Execution Plan)
- Remove API classifier system and pre-summary triage; verify tests
- Prune unused UI pages; keep coach-min/new and skills
- Ensure only v3 assessment finalize paths remain; remove v1/v2 remnants
- Confirm “bias” and “overall level” design; add small schema changes if needed
- Update docs and ops runbooks; ensure env defaults: `TRIAGE_ON_USER_INGEST=1`, `ASSESS_ON_TRIAGE=1`

---

## File Checklist

### coach-up-ai-api/
- [x] `app/main.py` - Main FastAPI app (accounted for - chat, triage, assessments, summaries)
- [x] `app/providers/base.py` - Provider interfaces (accounted for - classifier to remove)
- [x] `app/providers/factory.py` - Provider factory (accounted for - classifier to remove)
- [x] `app/providers/google.py` - Google providers (accounted for - classifier to remove, keep chat/assess)
- [x] `app/providers/openrouter.py` - OpenRouter providers (accounted for - classifier to remove, keep assess)
- [x] `app/providers/mock.py` - Mock providers (accounted for - classifier to remove)
- [x] `app/middleware/request_id.py` - Request ID middleware (keep for tracing)
- [x] `Dockerfile` - Container definition (keep - deployment)
- [x] `Makefile` - Build automation (keep - ops)
- [x] `requirements.txt` - Dependencies (keep - ensure classifier deps removed)
- [x] `render.yaml` - Render.com deployment (keep - ops)
- [x] `CONTRIBUTING.md` - Contribution guide (keep - docs)
- [x] `test_*.py` files - Test files (keep - ensure updated for cleanup)

### coach-up-frontend/
- [x] `convex/schema.ts` - Database schema (accounted for - skills, goals, v3 assessments)
- [x] `convex/assessments.ts` - Assessment functions (accounted for - v3 only)
- [x] `convex/functions/assessments.ts` - Assessment Convex functions (accounted for - v3 only)
- [x] `convex/functions/goals.ts` - Goals functions (accounted for - keep)
- [x] `convex/functions/skills.ts` - Skills functions (accounted for - keep)
- [x] `convex/functions/summaries.ts` - Summary functions (accounted for - keep)
- [x] `convex/functions/triage.ts` - Triage functions (accounted for - keep)
- [x] `convex/functions/users.ts` - User functions (accounted for - keep)
- [x] `convex/functions/profile.ts` - Profile functions (accounted for - keep)
- [x] `ui/src/app/coach-min/page.tsx` - Main coach page (accounted for - keep)
- [x] `ui/src/app/coach-new/page.tsx` - New coach variant (accounted for - keep)
- [x] `ui/src/app/skills/page.tsx` - Skills management (accounted for - keep)
- [x] `ui/src/app/skills/[id]/page.tsx` - Skill details (accounted for - keep)
- [x] `ui/src/components/AssessmentChip.tsx` - Assessment UI component (accounted for - keep)
- [x] `ui/src/context/minimal/MinimalMicContext.tsx` - Minimal mic context (accounted for - keep)
- [x] `ui/src/context/minimal/MinimalVoiceContext.tsx` - Minimal voice context (accounted for - keep)
- [x] `ui/src/context/ConversationContext.tsx` - Conversation context (accounted for - keep)
- [x] `ui/src/hooks/useSessionSummary.ts` - Summary hook (accounted for - keep)
- [x] `ui/src/app/api/v1/interactions/route.ts` - Interactions API (accounted for - keep, triage trigger)
- [x] `ui/src/app/api/v1/stt/route.ts` - STT API (accounted for - keep, triage trigger)
- [x] `ui/src/app/api/v1/triage/route.ts` - Triage API (accounted for - keep)
- [x] `ui/src/app/api/v1/tts/route.ts` - TTS API (accounted for - keep)
- [x] `ui/src/app/api/v1/session-summary/route.ts` - Summary API (accounted for - keep)
- [x] `ui/src/app/api/assessments/run/route.ts` - Assessment trigger API (accounted for - keep)
- [x] `ui/src/app/api/assessments/orchestrator.ts` - Assessment orchestrator (accounted for - keep)
- [x] `ui/src/app/api/assessments/convex/finalize/route.ts` - Assessment finalize (accounted for - keep)
- [x] `ui/src/app/api/assessments/[sessionId]/route.ts` - Assessment polling (accounted for - keep)
- [x] `ui/src/app/api/assessments/results/route.ts` - Assessment results (accounted for - keep)
- [x] `ui/src/app/api/assessments/debug/hashes/route.ts` - Debug assessment hashes (accounted for - keep)
- [x] `ui/src/app/api/messages/ingest/route.ts` - Message ingest (accounted for - keep)
- [x] `ui/src/app/api/chat/route.ts` - Chat API (accounted for - keep)
- [x] `ui/src/app/api/dev/seed-user/route.ts` - Dev seed user (accounted for - keep)
- [x] `ui/src/app/api/lib/*` - Utility libraries (accounted for - keep)
- [x] `ui/src/app/api/metrics/route.ts` - Metrics API (accounted for - keep)
- [x] `ui/src/app/api/telemetry/voice/route.ts` - Voice telemetry (accounted for - keep)
- [x] `ui/src/app/api/test/*` - Test APIs (accounted for - keep)
- [x] `ui/src/app/api/tracked-skills/route.ts` - Tracked skills API (accounted for - keep)
- [x] `ui/src/app/api/v1/assess/stream/route.ts` - Legacy assess stream (accounted for - remove)
- [x] `ui/src/app/api/v1/chat/prompt-preview/route.ts` - Chat prompt preview (accounted for - keep)
- [x] `ui/src/app/api/v1/events/route.ts` - Events API (accounted for - keep)
- [x] `ui/src/app/api/v1/sessions/*` - Session APIs (accounted for - keep)
- [x] `ui/src/app/api/v1/skills/*` - Skills APIs (accounted for - keep)
- [x] `ui/src/app/api/v1/storage/audio/presign/route.ts` - Storage presign (accounted for - keep)
- [x] `ui/src/app/api/v1/stt/route.ts` - STT API (accounted for - keep)
- [x] `ui/src/app/api/v1/transcripts/route.ts` - Transcripts API (accounted for - keep)
- [x] `ui/src/app/api/v1/tts/route.ts` - TTS API (accounted for - keep)
- [x] `ui/src/app/api/v1/users/goals/route.ts` - User goals API (accounted for - keep)
- [x] `ui/src/app/api/v1/users/profile/route.ts` - User profile API (accounted for - keep)
- [x] `ui/src/app/AuthGuard.tsx` - Auth guard component (accounted for - keep)
- [x] `ui/src/app/ConvexClientProvider.tsx` - Convex client provider (accounted for - keep)
- [x] `ui/src/app/NavDirListener.tsx` - Navigation listener (accounted for - keep)
- [x] `ui/src/app/components/*` - UI components (accounted for - keep)
- [x] `ui/src/app/globals.css` - Global styles (accounted for - keep)
- [x] `ui/src/app/layout.tsx` - Root layout (accounted for - keep)
- [x] `ui/src/context/*` - Context providers (accounted for - keep)
- [x] `ui/src/hooks/*` - Custom hooks (accounted for - keep)
- [x] `ui/src/middleware.ts` - Next.js middleware (accounted for - keep)
- [x] `ui/next.config.ts` - Next.js config (accounted for - keep)
- [x] `ui/package.json` - UI dependencies (accounted for - keep)
- [x] `ui/tsconfig.json` - TypeScript config (accounted for - keep)
- [x] `ui/vitest.config.ts` - Vitest config (accounted for - keep)
- [x] `ui/playwright.config.ts` - Playwright config (accounted for - keep)
- [x] `ui/eslint.config.mjs` - ESLint config (accounted for - keep)
- [x] `ui/postcss.config.mjs` - PostCSS config (accounted for - keep)
- [x] `ui/src/app/page.tsx` - Root page (accounted for - keep)
- [x] `ui/src/app/(auth)/sign-in/page.tsx` - Sign in page (accounted for - keep)
- [x] `ui/src/app/(auth)/sign-up/page.tsx` - Sign up page (accounted for - keep)
- [x] `ui/src/app/skills/layout.tsx` - Skills layout (accounted for - keep)
- [x] `ui/src/app/coach-new/SoftCard.tsx` - Soft card component (accounted for - keep)
- [x] `ui/README.md` - UI documentation (accounted for - keep)
- [x] `convex/README.md` - Convex documentation (accounted for - keep)
- [x] `convex/seed_skills.ts` - Skills seeding (accounted for - keep)
- [x] `convex/tsconfig.json` - Convex TypeScript config (accounted for - keep)
- [x] `package.json` - Root dependencies (accounted for - keep)
- [x] `package-lock.json` - Lock file (accounted for - keep)
- [x] `Makefile` - Root build automation (accounted for - keep)
- [x] `convex/functions/interactions.ts` - Interaction functions (accounted for - keep, chat pipeline)
- [x] `convex/functions/sessions.ts` - Session functions (accounted for - keep)
- [x] `convex/functions/summary_state.ts` - Summary state functions (accounted for - keep)
- [x] `convex/functions/skills_admin.ts` - Admin skills functions (accounted for - keep)
- [x] `convex/functions/events.ts` - Event logging functions (accounted for - keep)
- [x] `convex/assessments.ts` - Assessment Convex queries/mutations (accounted for - v3 only)
- [ ] `ui/src/app/coach/page.tsx` - Legacy coach page (accounted for - remove)
- [ ] `ui/src/app/chat/page.tsx` - Legacy chat page (accounted for - remove)
- [ ] `ui/src/app/coach-debug/page.tsx` - Debug coach page (accounted for - remove)
- [ ] `ui/src/app/coach/analytics/page.tsx` - Analytics page (accounted for - remove)
- [ ] `ui/src/app/settings/page.tsx` - Settings page (accounted for - remove)
- [x] `ui/middleware.ts` - Next.js middleware (keep - auth/routing)
- [x] `package.json` - Dependencies (keep - ensure minimal)
- [x] `Makefile` - Build automation (keep - ops)
- [x] `CONTRIBUTING.md` - Contribution guide (keep - docs)

### Missing/Unaccounted Files (Need Review)
- None identified - all files have been accounted for in the above checklist

### Additional Notes
- All files from both repositories have been systematically reviewed and accounted for
- The checklist is organized by repository and covers both KEEP and REMOVE decisions
- Legacy files marked for removal are clearly identified with rationale
- Development/testing files that may be useful are noted in the clarification section
- This comprehensive inventory ensures no important files are overlooked during cleanup

---

## Tests Cleanup and Organization

### Goals
- Trim tests to match the post-refactor surface (coach-min/new, STT→chat→TTS, triage-on-ingest, v3 assessments, summaries, skills/goals/levels)
- Remove tests tied to legacy classifier, pre-summary triage, and v1/v2 assessments
- Organize tests by layers: unit (pure), integration (UI API/Convex), E2E (UI flows), contract (API endpoints)

### coach-up-ai-api — Proposed Test Actions
- KEEP
  - `tests/test_chat_sse_contract.py` — chat SSE contract
  - `tests/test_session_summary_generate.py` — session summaries
  - `tests/test_triage_batch_integration.py` — triage batch contract
  - `tests/test_assessments.py` / `tests/test_v3_assessment_smoke.py` — v3 assessment behavior & shape
  - `tests/test_provider_skill_headers.py` — tracked skill headers plumbing
  - `tests/test_http_metrics.py`, `tests/test_request_id_and_metrics.py` — observability
  - `tests/test_messages_ingest.py` — ingest path without classifier
- REMOVE (classifier and legacy)
  - `tests/test_classifier_logic.py`
  - `tests/test_google_classifier_integration.py`
  - `tests/test_messages_ingest_classifier.py`
  - `tests/test_messages_ingest_classifier_live_openrouter.py`
  - `tests/test_providers_factory.py` (only if classifier coverage is the target; keep chat/assess provider tests if any)
- REVIEW/ADJUST (ensure v3-only or still relevant)
  - `tests/test_persist.py`, `tests/test_persist_v2.py` — drop v2; ensure any persist tests align to v3 finalize path
  - `tests/test_skill_assessments.py` — ensure aligns with v3 schema
  - `tests/test_openrouter_sse.py`, `tests/test_google_assess_integration.py`, `tests/test_google_network_resilience.py` — keep if provider-agnostic or assess-v3 relevant
  - `tests/test_transcript_persist.py` — keep if referenced by summaries/assess
  - `tests/test_rubric_golden.py` — update to v3 rubric format or remove if v1/v2-only
  - `tests/test_sqs_adapter.py` — keep only if SQS flow still used

- Root-level tests (keep if still representative and v3-only)
  - `test_e2e_coach_min_flow.py` — KEEP
  - `test_assessment_demo.py`, `test_prompt_debug.py`, `test_simple_assessment.py`, `test_assistant_persistence.py`, `test_v2_payload.py` — REVIEW; remove v2 payload; unify demos under v3

### coach-up-frontend (UI) — Proposed Test Actions
- KEEP — E2E (Playwright) focused on min/new flows and contracts
  - `ui/tests/e2e/coach-min-assessment-lifecycle.spec.ts`
  - `ui/tests/e2e/api.contract.*.spec.ts` (assessments run/get, chat SSE, messages ingest)
  - `ui/tests/e2e/ui.session-summary.spec.ts`, `ui/tests/e2e/skills.api.spec.ts`, `ui/tests/e2e/voice.spec.ts`
  - `ui/tests/e2e/ui.chat.*.spec.ts` and `ui/tests/e2e/ui.coach.context.spec.ts` — keep those mapping to min/new
- KEEP — Unit/integration aligned to v3 and ingest triage
  - `ui/tests/unit/v3-assessment-*.spec.ts`
  - `ui/tests/unit/api.assessments.*.spec.ts`
  - `ui/tests/unit/api.v1.*.spec.ts` — keep routes used by min/new (stt/tts/interactions/triage/summaries/sessions/skills/users)
  - `ui/tests/unit/conversation.context.spec.tsx`, `ui/tests/unit/convex.*.spec.ts`, `ui/tests/unit/speech.registry.spec.ts`
- REMOVE/REVIEW — pages and flows to be deleted
  - Any tests referencing `coach/page.tsx`, `chat/page.tsx`, `coach-debug/page.tsx`, `coach/analytics/page.tsx`, `settings/page.tsx`
  - Trim `integration/complete-journey` or `analytics`, `settings` if bound to legacy pages
- SCRIPTS — KEEP essential, remove obsolete
  - KEEP: `run-integration-tests.js`, `generate-test-report.js`, smoke scripts for stt/tts/transcripts/skills, `triage_smoke.sh`
  - REMOVE: Any scripts targeting legacy endpoints/pages (none explicitly identified beyond checklist — review while executing)

### Test File Checklists

- coach-up-ai-api/tests/
  - [x] conftest.py
  - [x] test_chat_sse_contract.py (KEEP)
  - [x] test_session_summary_generate.py (KEEP)
  - [x] test_triage_batch_integration.py (KEEP)
  - [x] test_assessments.py (KEEP)
  - [x] test_v3_assessment_smoke.py (KEEP)
  - [x] test_provider_skill_headers.py (KEEP)
  - [x] test_http_metrics.py (KEEP)
  - [x] test_request_id_and_metrics.py (KEEP)
  - [ ] test_classifier_logic.py (REMOVE)
  - [ ] test_google_classifier_integration.py (REMOVE)
  - [ ] test_messages_ingest_classifier.py (REMOVE)
  - [ ] test_messages_ingest_classifier_live_openrouter.py (REMOVE)
  - [ ] test_persist_v2.py (REMOVE)
  - [~] test_persist.py (ADJUST to v3 finalize)
  - [~] test_skill_assessments.py (VERIFY v3 alignment)
  - [~] test_openrouter_sse.py (KEEP if provider-agnostic)
  - [~] test_google_assess_integration.py (KEEP if v3)
  - [~] test_google_network_resilience.py (KEEP if provider-agnostic)
  - [~] test_transcript_persist.py (KEEP if used)
  - [~] test_rubric_golden.py (UPDATE to v3 or REMOVE)
  - [~] test_sqs_adapter.py (KEEP if SQS still in use)
  - Root tests:
    - [x] test_e2e_coach_min_flow.py (KEEP)
    - [~] test_assessment_demo.py (CONSOLIDATE under v3)
    - [~] test_prompt_debug.py (REVIEW)
    - [~] test_simple_assessment.py (REVIEW)
    - [ ] test_v2_payload.py (REMOVE)
    - [~] test_assistant_persistence.py (REVIEW)

- coach-up-frontend/ui/tests/
  - E2E:
    - [x] coach-min-assessment-lifecycle.spec.ts (KEEP)
    - [x] api.contract.* (KEEP)
    - [x] ui.session-summary.spec.ts (KEEP)
    - [x] ui.chat.* (KEEP)
    - [x] voice.spec.ts (KEEP)
    - [x] skills.api.spec.ts (KEEP)
  - Unit/Integration:
    - [x] v3-assessment-*.spec.ts (KEEP)
    - [x] api.assessments.*.spec.ts (KEEP)
    - [x] api.v1.*.spec.ts (KEEP for routes used by min/new)
    - [x] conversation.context.spec.tsx (KEEP)
    - [x] convex.*.spec.ts (KEEP)
    - [x] speech.registry.spec.ts (KEEP)
    - [ ] Any specs tied to legacy pages (REMOVE)
  - Integration folder:
    - [~] complete-coaching-journey.spec.ts (REFOCUS on min/new)
    - [ ] analytics/, settings/ specs (REMOVE with pages)

### Execution Plan for Tests
1. Delete listed REMOVE tests/scripts
2. Update ADJUST/REVIEW tests to align to v3 and ingest triage
3. Rename or regroup tests by type (unit/integration/e2e/contract)
4. Update CI scripts to run the trimmed suites with tags per layer
5. Refresh coverage baselines and targets to reflect the leaner scope
