# Lean Architecture Review (2025-09)

This report proposes concrete, high‑impact actions to make the system leaner, cleaner, and more efficient across API, FE routes, Convex, and shared infrastructure, with a pragmatic migration plan and validation steps.

## Executive Summary

- Modularize API orchestration out of `app/main.py` into focused units; reduce duplication; centralize configuration and logging.
- Consolidate FE API patterns (auth, ETag, abort/timeout, triage trigger) into shared helpers to eliminate repeated code.
- Extract a headless voice/chat engine for contexts to avoid overlapping state machines between minimal and full variants.
- Tighten Convex data access with consistent indexed queries/pagination and smaller payloads.
- Normalize environment handling (typed getters) and reduce per-call `os.getenv`/`process.env` parsing.
- Strengthen observability (uniform JSON logger, metrics labels) while cutting repetitive try/except noise.

Each recommendation includes target files, an approach, expected benefit, and test commands.

---

## API (FastAPI) – Modularity, Config, and Logging

### Current
- `app/main.py` contains endpoints, orchestration, background workers, provider selection, env parsing, and JSON logging with repeated try/excepts.
- Env parsing is repeated (`os.getenv` → string checks) and interwoven with request logic.
- JSON logging calls are scattered with ad‑hoc safeguards.

### Recommendations
1) Split `app/main.py` into cohesive modules:
   - `app/http/chat_sse.py` (GET `/chat/stream`)
   - `app/http/messages.py` (POST `/messages/ingest`)
   - `app/http/triage.py` (POST `/triage/batch`, `/triage/offline` if retained)
   - `app/http/assessments.py` (POST `/assessments/run`, GET `/assessments/results`)
   - `app/http/session_summary.py` (GET/POST session summary routes)
   - `app/services/assessments.py` (enqueue, run, ensure result)
   - `app/services/triage.py` (provider selection, normalization)
   - `app/config.py` (typed env access: bool/int/str/durations with defaults)
   - `app/log.py` (structured JSON logger helpers: `info(event, **fields)`, `error(event, **fields)`, safe truncation)
   - `app/metrics.py` (centralize prometheus metric definitions and wrappers: `observe_latency`, `inc_errors`)

   Benefit: smaller units, improved testability, reduced cognitive load; easier to profile and maintain.

2) Centralize environment parsing in `app/config.py`:
   - Add `get_bool(name, default)`, `get_int(name, default, bounds=None)`, `get_str(name, default)`, `get_ms(name, default)`.
   - Replace repeated `os.getenv(...).strip().lower()` with simple calls.

   Benefit: fewer bugs (string handling), consistent behavior, faster code reviews.

3) Uniform JSON logging helper in `app/log.py`:
   - Functions: `log_info(event: str, **fields)`, `log_warn(...)`, `log_error(...)`;
   - Handle truncation (`preview`, `len`), header extraction, request id, and exception serialization in one place.
   - Gate debug verbosity by `LOG_VERBOSE=1`.

   Benefit: eliminates repeated try/except, shortens handlers by 10–20%+.

4) Normalize provider selection and headers:
   - Encapsulate chat and triage provider selection with default/fallback in `app/providers/factory.py` (already partially present) but move env logic into `config.py`.

   Benefit: reduces scattered env checks and easier to swap providers.

5) Background workers alignment:
   - Keep a single queue abstraction with pluggable backends (memory/SQS) via `app/services/queue.py`.
   - Ensure idempotency semantics and enqueue timestamps are consistently observed; add `job_id` in logs.

   Benefit: predictable processing; simpler debugging; removes duplicated in‑function queue handling.

### Validation
```bash
(cd coach-up-ai-api && pytest -q tests/test_chat_sse_contract.py tests/test_triage_batch_integration.py tests/test_session_summary_generate.py tests/test_v3_assessment_smoke.py)
```

---

## FE API Routes – Consolidate HTTP & Triage Patterns

### Current
- `ui/src/app/api/v1/interactions/route.ts`, `stt/route.ts`, `tts/route.ts`, `triage/route.ts` share repeated logic: auth checks, ETag generation, abort/timeouts, internal triage fetch.
- Mock vs. real Convex handling is interwoven inside route bodies.

### Recommendations
1) Introduce `ui/src/app/api/lib/http.ts`:
   - `json(status, body, headers?)`, `badRequest(msg)`, `unauthorized()`, `withAbort(request)`, `withTimeout(ms)`
   - `etagFor(...parts: string[]): string`
   - `serverBaseUrl()` to unify internal POSTs.

2) Introduce `ui/src/app/api/lib/triage.ts`:
   - `triggerTriage(sessionId: string, messageIds: string[], requestId: string, auth?: string)`
   - Hides mock vs. real path; centralizes headers/timeouts.

3) Auth header normalization:
   - `headersFromAuth(request)` helper returns authorization header if present.

4) Mock injection:
   - Wrap mock Convex (`mockConvex`) behind interfaces; route bodies call an injected `client` so branches disappear from handlers.

   Benefit: less duplication; smaller route handlers (+ easier to audit permissions and timeouts).

### Validation
```bash
# Unit tests for interactions/triage/stt/tts
(cd coach-up-frontend/ui && pnpm test -w --filter ui -- --run --reporter=dot "tests/unit/api.v1.*.spec.ts*" )
```

---

## FE Contexts – Headless Engine + Adapter Contexts

### Current
- `MicContext.tsx` and minimal context variants manage overlapping state (VAD loop, recording lifecycle, transcript/assistant text, busy states) and duplicated logging.

### Recommendations
1) Extract a headless voice/chat engine:
   - `ui/src/context/engine/useVoiceChatEngine.ts` returning a clean state machine: `{state, start(), stop(), onVad(), onTtsChunk(), onSseToken(), reset()}`.
   - Move VAD calibration and loop control into this engine.

2) Adapter contexts:
   - `MicContext` and `MinimalMicContext` wrap the headless engine; expose only the props needed for their respective UIs.

3) Dev logging gate:
   - Centralize `devLog()` and disable in production builds.

   Benefit: reduces duplication, improves reliability (one state machine), lowers risk of divergence.

### Validation
```bash
(cd coach-up-frontend/ui && pnpm test -w --filter ui -- --run --reporter=dot "tests/unit/conversation.context*" )
```

---

## Convex – Indexed Access and Smaller Payloads

### Current
- Indexed queries (e.g., `by_session_ts`) exist, but some access patterns still fetch large windows then slice.
- Multiple list calls on interactions to compute small recent tails for triage/summary.

### Recommendations
1) Consistent tail queries:
   - Create `functions/interactions:listTailBySession` using `by_session_ts` and a `gt ts` or `desc` emulation (collect then slice minimal) with `limit` param only.
   - Replace all routes that fetch N=200 then slice last 2 with this function.

2) Projected fields for hot paths:
   - When fetching recent tails for triage/summary, return `{messageId, role, text, ts}` only.

3) Add `functions/interactions:listIdsTail(sessionId, limit)` used by triage triggers.

   Benefit: lower bandwidth/CPU; simpler code; faster triage.

### Validation
```bash
# FE routes leveraging new tails
(cd coach-up-frontend/ui && pnpm test -w --filter ui -- --run --reporter=dot "tests/unit/api.v1.interactions.spec.ts" "tests/unit/api.v1.triage.spec.ts")
```

---

## Environment Handling – Typed and Centralized

### Current
- Repeated `os.getenv(...).strip().lower()` (API) and `process.env` checks (FE) across code.

### Recommendations
- API: `app/config.py` with typed getters; FE: `ui/src/app/api/lib/env.ts` with typed helpers.
- Replace in‑body parsing with a one‑liner.

   Benefit: consistent behavior, simplified diffs, fewer edge cases.

---

## Observability – Uniform Logger and Metrics

### Current
- Scattered `logger.info(json.dumps(...))` with try/except, and console logs in FE.

### Recommendations
- API: `app/log.py` and `app/metrics.py` wrappers; FE: `devLog()` and `perfMark()`.
- Standardize event names and fields; cap payloads; include `requestId`, `sessionId`, `groupId`, `provider`, `model` when relevant.

   Benefit: consistent telemetry with less code and fewer errors.

---

## Optional Cleanups & Deletions

- Delete stale backups and unused assets (done for `app/main.py.bak-...`).
- Review `/triage/offline` route: keep only if used in CI/dev flows; otherwise remove.
- Move benchmarking examples/tests into a separate optional package or guard behind `BENCH=1` to keep core installs slim.

---

## Prioritized Execution Plan

1) API modularization (medium effort, high ROI)
   - Create `config.py`, `log.py`, `metrics.py`; move env/logging to helpers.
   - Split `app/main.py` into http/services modules.
   - Run API contract tests.

2) FE API consolidation (low/medium effort, high ROI)
   - Add `http.ts`, `triage.ts`, `env.ts` and refactor `interactions`, `stt`, `tts`, `triage` routes.
   - Run relevant unit tests.

3) Contexts engine extraction (medium effort, medium/high ROI)
   - Implement headless engine; adapt `MicContext` and minimal provider.
   - Run conversation/voice tests.

4) Convex tails + projections (low effort, high ROI)
   - Add tail queries; refactor routes to use them; reduce payloads.

5) Optional pruning & bench isolation (low effort)

---

## Success Criteria & KPIs
- Code size reduction in `app/main.py` (>30%).
- FE route duplication reduced (≥4 shared helpers adopted).
- Triage trigger path fetch count reduced; recent tails fetched via indexed functions.
- First token latency and SSE completion latency tracked; stable or improved.
- Unit/contract tests green across API/FE.

---

## Validation Commands (Rollup)
```bash
# API contracts & assessments
(cd coach-up-ai-api && pytest -q tests/test_chat_sse_contract.py tests/test_triage_batch_integration.py tests/test_session_summary_generate.py tests/test_v3_assessment_smoke.py)

# FE unit target areas (adjust filters as needed)
(cd coach-up-frontend/ui && pnpm test -w --filter ui -- --run --reporter=dot "tests/unit/api.v1.*" "tests/unit/conversation.context*")

# FE e2e (voice/chat)
(cd coach-up-frontend/ui && pnpm playwright test -g "voice|api.contract.chat.sse" -c playwright.config.ts)
```

---

## Appendix: Quick Wins (Can be done immediately)
- Add `app/config.py` and replace 10+ env checks in `app/main.py`.
- Add `app/log.py` and replace 10+ JSON logging try/except blocks.
- Create `ui/src/app/api/lib/http.ts` with `json`, `badRequest`, `unauthorized`, `etagFor` and adopt in one route as a pattern.
- Add `functions/interactions:listIdsTail` and switch triage trigger to use it.
