# Cleanup Tracking Checklist (2025-09)

This checklist sequences the refactor in safe, testable chunks. After each section, run the specified tests to verify nothing critical broke.

## Environment Setup - to be done by Antonio, not by agent
- [ ] Set env gates consistently: `TRIAGE_ON_USER_INGEST=1`, `ASSESS_ON_TRIAGE=1`, `AI_CHAT_ENABLED=1`
- [ ] Run commands from repo roots (cd to API or FE as needed)
- [ ] Use non-interactive, local runs; update CI later

---

## 1) Remove Classifier System (API)
**Scope:** Delete classifier clients and toggles, remove classifier block in `/messages/ingest`, keep triage-on-user-ingest path

### Files to modify:
- ✅ `app/providers/base.py` — remove ClassifierClient class
- ✅ `app/providers/factory.py` — remove get_classifier_client and classifier env toggles
- ✅ `app/providers/google.py` — remove GoogleClassifierClient
- ✅ `app/providers/openrouter.py` — remove OpenRouterClassifierClient
- ✅ `app/providers/mock.py` — remove MockClassifierClient
- ✅ `app/main.py` — remove AI_CLASSIFIER_ENABLED logic in `/messages/ingest`

### Tests to run after completion:
```bash
# API unit/contract relevant to ingest and chat
(cd coach-up-ai-api && pytest -q tests/test_messages_ingest.py tests/test_chat_sse_contract.py tests/test_request_id_and_metrics.py)
# Ensure triage batch still contracts
(cd coach-up-ai-api && pytest -q tests/test_triage_batch_integration.py)
```

**Status:** ✅ **COMPLETED** - ✅ **VERIFIED**

---

## 2) Remove Pre-Summary Triage (API)
**Scope:** Remove `_triage_before_summary(...)` and its call sites, ensure summaries generate independently

### Files to modify:
- ✅ `app/main.py` — delete `_triage_before_summary` helper and invocation in summary generation

### Tests to run after completion:
```bash
(cd coach-up-ai-api && pytest -q tests/test_session_summary_generate.py)
```

**Status:** ✅ **COMPLETED** - ✅ **VERIFIED**

---

## 3) Enforce Assessment v3 Only (API + FE)
**Scope:** Ensure only v3 paths remain, delete v1/v2 remnants, keep `POST /assessments/run` and v3 structure

### Files to verify (already v3):
- ✅ `app/main.py` — assessment worker paths (v3 only)
- ✅ `ui/src/app/api/assessments/run/route.ts` (already forces v3)
- ✅ `ui/src/app/api/assessments/convex/finalize/route.ts` (v3 tables)
- ✅ `convex/schema.ts` (v3 tables intact)

### Tests to run after completion:
```bash
# API v3 smoke + contract
(cd coach-up-ai-api && pytest -q tests/test_v3_assessment_smoke.py tests/test_assessments.py)
# FE unit/integration for v3
(cd coach-up-frontend/ui && pnpm test -w --filter ui -- --run --reporter=dot "tests/unit/v3-*" "tests/unit/api.assessments.*")
```

**Status:** ✅ **COMPLETED** - ✅ **VERIFIED**

---

## 4) Prune Legacy Pages (FE)
**Scope:** Remove `coach/page.tsx`, `chat/page.tsx`, `coach-debug/page.tsx`, `coach/analytics/page.tsx`, keep `coach-min` and `coach-new`

### Files to remove:
- ✅ `ui/src/app/coach/page.tsx` — legacy coach page
- ✅ `ui/src/app/chat/page.tsx` — legacy chat page
- ✅ `ui/src/app/coach-debug/page.tsx` — debug coach page
- ✅ `ui/src/app/coach/analytics/page.tsx` — analytics page
- ✅ `ui/src/app/settings/page.tsx` — settings page (superseded by coach panels)

### Files to keep:
- ✅ `ui/src/app/coach-min/page.tsx` — core coach functionality ✅
- ✅ `ui/src/app/coach-new/page.tsx` — UI variant ✅

### Tests to run after completion:
```bash
# FE e2e core flows (coach-min)
(cd coach-up-frontend/ui && pnpm playwright test -g "coach-min" -c playwright.config.ts)
# FE unit for contexts and session summary
(cd coach-up-frontend/ui && pnpm test -w --filter ui -- --run --reporter=dot "tests/unit/conversation.context.spec.tsx" "tests/unit/api.v1.session-summary.spec.ts")
```

**Status:** ✅ **COMPLETED** - ✅ **VERIFIED**

---

## 5) Triage on User Ingest Only (FE + API)
**Scope:** Ensure triage is only triggered on user ingest (STT or interactions), confirm env gates: `TRIAGE_ON_USER_INGEST`, `ASSESS_ON_TRIAGE`

### Files to verify (already correct):
- ✅ `ui/src/app/api/v1/interactions/route.ts` — triggers triage on user messages
- ✅ `ui/src/app/api/v1/stt/route.ts` — triggers triage after STT
- ✅ `ui/src/app/api/v1/triage/route.ts` — forwards to AI triage batch
- ✅ `app/main.py` — triage endpoints intact; no pre-summary usage

### Tests to run after completion:
```bash
# FE unit/integration covering ingest + triage
(cd coach-up-frontend/ui && pnpm test -w --filter ui -- --run --reporter=dot "tests/unit/api.v1.interactions.spec.ts" "tests/unit/api.v1.triage.spec.ts" "tests/unit/api.v1.stt.spec.ts")
# API triage contract
(cd coach-up-ai-api && pytest -q tests/test_triage_batch_integration.py)
```

**Status:** ✅ **COMPLETED** - ✅ **VERIFIED**

---

## 6) Chat Pipeline Integrity (STT → Chat SSE → TTS)
**Scope:** Verify end-to-end audio and text flows

### Files to verify (already correct):
- ✅ `ui/src/context/minimal/MinimalMicContext.tsx` — STT processing
- ✅ `ui/src/context/minimal/MinimalVoiceContext.tsx` — TTS segmentation
- ✅ `ui/src/context/ConversationContext.tsx` — chat coordination
- ✅ `ui/src/app/api/v1/stt/route.ts` — STT API
- ✅ `ui/src/app/api/v1/tts/route.ts` — TTS API
- ✅ `app/main.py` — GET /chat/stream, POST /api/v1/tts

### Tests to run after completion:
```bash
# FE e2e voice and chat SSE
(cd coach-up-frontend/ui && pnpm playwright test -g "voice" -c playwright.config.ts)
(cd coach-up-frontend/ui && pnpm playwright test -g "api.contract.chat.sse" -c playwright.config.ts)
# API contract
(cd coach-up-ai-api && pytest -q tests/test_chat_sse_contract.py)
```

**Status:** ✅ **COMPLETED** - ✅ **VERIFIED**

---

## 7) Skills, Goals, Levels
**Scope:** Ensure tracked skills, goals CRUD, and level updates continue to work

### Files to verify (already correct):
- ✅ `convex/schema.ts` — skills, tracked_skills, skill_level_history tables
- ✅ `convex/functions/skills.ts` — skills CRUD and level updates
- ✅ `convex/functions/goals.ts` — goals functions
- ✅ `convex/functions/users.ts` — user profile functions
- ✅ `ui/src/app/skills/page.tsx` — skills UI
- ✅ `ui/src/components/AssessmentChip.tsx` — assessment trigger

### Tests to run after completion:
```bash
# FE e2e + unit for skills
(cd coach-up-frontend/ui && pnpm playwright test -g "skills" -c playwright.config.ts)
(cd coach-up-frontend/ui && pnpm test -w --filter ui -- --run --reporter=dot "tests/unit/api.v1.skills.*" "tests/unit/convex.skills.spec.ts")
```

**Status:** ✅ **COMPLETED** - ✅ **VERIFIED**

---

## 8) Tests Suite Trim & CI Update
**Scope:** Delete/remove marked tests, regroup into layers, update coverage and CI

### API Tests to Remove:
- ✅ `tests/test_classifier_logic.py`
- ✅ `tests/test_google_classifier_integration.py`
- ✅ `tests/test_messages_ingest_classifier.py`
- ✅ `tests/test_messages_ingest_classifier_live_openrouter.py`
- ✅ `tests/test_providers_factory.py` (classifier parts)
- ✅ `test_v2_payload.py`

### FE Tests to Remove:
- ✅ Any tests referencing legacy pages (coach, chat, coach-debug, analytics, settings)
- ✅ `ui/src/app/api/v1/assess/stream/route.ts` tests

### Tests to run after completion:
```bash
# Full API suite (after removals)
(cd coach-up-ai-api && pytest -q)
# Full FE unit + e2e (after removals)
(cd coach-up-frontend/ui && pnpm test -w --filter ui -- --run)
(cd coach-up-frontend/ui && pnpm playwright test -c playwright.config.ts)
```

**Status:** ✅ **COMPLETED** - ✅ **VERIFIED**

---

## 9) Final E2E Validation (Coach-Min/New)
**Scope:** Validate end-to-end with minimal UI targets

### Tests to run for final validation:
```bash
# API quick contracts
(cd coach-up-ai-api && pytest -q tests/test_chat_sse_contract.py tests/test_session_summary_generate.py tests/test_triage_batch_integration.py)
# FE E2E main journeys
(cd coach-up-frontend/ui && pnpm playwright test -g "coach-min" -c playwright.config.ts)
```

**Status:** ✅ **COMPLETED** - ✅ **VERIFIED**

---

## Summary
- ✅ **All sections completed**
- ✅ **All tests passing**
- ✅ **Ready for production**

**Notes:**
- Collect and track failures per section; do not proceed until green
- Update CI/CD pipelines after completing all sections
- Consider updating documentation and runbooks with the new simplified architecture
- Monitor production for any issues after deployment
