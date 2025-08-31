## Voice Chat Stability Tracker

Purpose: Track improvements to the /coach voice chat experience across backend SSE, frontend EventSource handling, STT/TTS pipeline, audio playback, and observability.

### Scope
- Backend AI API `GET /chat/stream` SSE and related prompts/context.
- Frontend proxy `GET /api/chat` and contexts: `ConversationContext`, `VoiceContext`, `AudioContext`.
- Voice loop: STT → chat SSE → TTS → playback.
- Observability: metrics, logs, dashboards, alerts.

### Owners and Cadence
- Tech owner(s): <assign>
- PM/EM: <assign>
- Check-in cadence: 2x weekly until green SLO; then weekly.

---

## Workstreams and Checklists

### Current Status (2025-08-30)
- Completed: Backend SSE heartbeats/headers; non-audible notices; frontend EventSource cleanup + bounded retry; atomic abort-turn; TTS segmentation/backpressure; minimal barge-in (VAD speech cancels TTS + playback; recording active during playback).
- In progress: Acceptance test validation, dashboard panels/alerts wiring, rollout notes; TTFT/metrics implementation.

### Validation Snapshot
- Backend unit/integration:
  - [x] SSE/request-id/metrics tests passed (backend).
  - [x] Heartbeat manual check via `curl -N` (local dev): headers correct; `:` pings visible.
- Frontend e2e/dev:
  - [x] EventSource unmount cleanup verified via route change test.
  - [x] Bounded retry triggers only when no partial text.
  - [x] Abort turn immediately stops stream and audio.
  - [x] TTS segmentation produces natural chunks under bursty tokens.


### 1) Backend SSE hardening (/chat/stream)
- [x] Emit SSE heartbeat comments every 10–15s (e.g., `:ping\n\n`).
- [x] Response headers include `Content-Type: text/event-stream; charset=utf-8`.
- [x] Response headers include `Cache-Control: no-cache, no-transform` and `Connection: keep-alive`.
- [x] Remove or gate audible fallback stub notices; emit non-audible comments or env-gated text.
- [ ] Redact/disable verbose prompt/system logs in non-dev environments.
- [x] Redact/disable verbose prompt/system logs in non-dev environments (gated by `AI_CHAT_DEBUG_LOGS`).
- [ ] Clamp and document envs: `AI_CHAT_TTFT_TIMEOUT_SECONDS`, `AI_CHAT_PROMPT_TIMEOUT_SECONDS`, `AI_CHAT_ENABLED`, `AI_CHAT_MODEL`.
- [x] Clamp/document envs and add `AI_CHAT_SSE_HEARTBEAT_SECONDS`, `AI_CHAT_DEBUG_LOGS`.
- [x] Unit test: SSE format (no buffering, correct headers, DONE terminator).
- [ ] Integration test: TTFT timeout path emits notice but not audible text by default.
- [x] Integration test: Heartbeats present for long-lived streams and not buffered by proxy (unit-configured short interval).

Acceptance criteria
- Heartbeats visible in `curl -N` and not buffered by Nginx/Next proxy.
- Headers match exactly; clients see first token consistently < configured timeout or clean fallback.
- No PII prompt logging in prod logs.

### 2) Frontend EventSource robustness (/api/chat proxy + ConversationContext)
- [x] Provider-level unmount/route-change cleanup closes any active `EventSource`.
- [x] Error handling: bounded backoff retry (e.g., 0.2s → 1s → 2s; max 3) only when no partial text.
- [x] Expose a consolidated "abort turn" that cancels SSE, cancels TTS, and stops/clears playback atomically.
- [x] Ensure `X-Request-Id` threading and log correlation from proxy to backend.
- [x] Ensure proxy sets `text/event-stream; charset=utf-8`, `no-cache, no-transform`, `keep-alive`, `X-Accel-Buffering: no` (asserted in test).

Acceptance criteria
- Navigating away or component unmount never leaves a live stream.
- Transient drops auto-recover if zero partial; otherwise resolve with partial text.
- One-click barge-in consistently stops all assistant audio and stream.

### 3) TTS segmentation and queueing (ConversationContext + VoiceContext + AudioContext)
- [x] Minimum segment size by chars and time (e.g., ≥12 chars or ≥250ms) before enqueue. (chars via ConversationContext; time via idle debounce)
- [x] Punctuation-aware flush: terminal punctuation triggers a flush; merge tiny segments.
- [x] Queue backpressure: cap at N pending segments; coalesce when cap is exceeded.
- [x] On [DONE], flush any remainder exactly once.
- [x] After error, if partial exists, flush remainder and resolve; else retry once with backoff.
 - [x] Minimal contexts: added playback status and pipelined TTS so segments are queued immediately while loop restarts after final playback.

Acceptance criteria
- No "machine-gun" TTS; segments are natural and not <100ms playback.
- After brief lag and bursty tokens, queue size remains bounded and audio plays naturally.

### 4) Autoplay UX and audio lifecycle (AudioContext)
- [x] Persistent and explicit "Enable audio" banner until unlocked; retry pending playback upon unlock.
- [x] Clear, user-visible error if playback fails twice.
- [x] Ensure all `AudioContext`/`HTMLAudioElement` instances are closed on stop/unmount.

Acceptance criteria
- Zero reports of "silent responses" after banner interaction.
- No orphaned audio contexts in performance profiles upon navigation.

### 5) Observability, SLOs, and docs
- [ ] Backend metrics: `chat_stream_first_token`, `chat_stream_complete` present with provider/model.
- [x] Frontend metrics: proxy tracks first-byte, total duration, and disconnect reason.
- [ ] Instrument disconnect reasons (client abort vs network vs server error) with `X-Request-Id` correlation.
- [ ] Grafana dashboard: add heartbeat presence, TTFT p50/p95, error rates, retry rates.
- [ ] Alerting: TTFT p95 > Xs for Y mins; disconnects per 1k streams > Z.
- [ ] Documentation updated: troubleshooting w/ typical root causes and check commands.

### 6) Barge-in (serialized lifecycle)
- [x] During playback, mic capture remains active and VAD detects speech.
- [x] On first speech detection, cancel active TTS and stop playback immediately.
- [x] After barge-in, proceed through STT → chat → TTS/Playback again.

Acceptance criteria
- Playback is interruptible within <150ms of user speech onset.
- No overlapping audio after barge-in; previous playback is fully stopped.

Acceptance criteria
- Dashboard can answer: "Was this a provider issue or client disconnect?" within 1 minute.
- Alerts trigger before users report regressions.

---

## Release Plan
1. Backend SSE headers + heartbeat (low risk) → canary on staging; verify with `curl -N` and Playwright mocks.
2. Frontend unmount cleanup + abort turn + bounded retry.
3. TTS segmentation rules + queue cap.
4. Logging reductions (prod) and observability additions.
5. Roll out guarded by feature flags; progressive enablement.

Rollback: kill-switch envs to disable new behavior (e.g., `AI_CHAT_HEARTBEAT_ENABLED=0`, `VOICE_TTS_SEGMENTATION_V2=0`).

---

## Acceptance Tests (add/verify)

Backend
- [x] HTTP: `GET /chat/stream` emits `Content-Type: text/event-stream; charset=utf-8`.
- [x] Long stream contains at least one heartbeat comment `:` line (tested with short interval env).
- [x] TTFT timeout path yields SSE comment (non-audible) notice and still ends with DONE.

Frontend
- [ ] Unmount closes active SSE (no further onmessage after unmount).
- [ ] Error before any partial triggers bounded retry; resolve with partial if any.
- [ ] Abort turn stops SSE, cancels TTS, and clears playback within 100ms.
- [ ] Segments: min length/time respected; no more than N items in queue; punctuation flush works.
- [ ] Autoplay banner appears when blocked; after unlock, queued audio plays.
  
Verified (e2e):
- [x] Proxy response headers: Content-Type event-stream; no-cache/no-transform; keep-alive; X-Accel-Buffering: no; X-Request-Id present.

---

## Telemetry and Dashboards
- Prometheus/Grafana panels:
  - TTFT (p50/p95) per provider/model.
  - Total stream duration distribution.
  - Disconnect reason breakdown.
  - Heartbeat absence rate (missing ping > 20s while stream open).
  - Frontend retry outcomes and counts.

---

## Engineering Notes and Env Matrix
- Backend envs: `AI_CHAT_ENABLED`, `AI_CHAT_MODEL`, `AI_CHAT_TTFT_TIMEOUT_SECONDS`, `AI_CHAT_PROMPT_TIMEOUT_SECONDS`.
- Frontend envs: `NEXT_PUBLIC_TTS_TIMEOUT_MS`, `NEXT_PUBLIC_STT_TIMEOUT_MS`, `NEXT_PUBLIC_MESSAGE_CONTEXT_LENGTH`.
- Feature flags: add as needed for heartbeat and segmentation changes.

---

## Rollout Plan & Monitoring

Pre-deploy
- [ ] Verify backend envs present and sane: `AI_CHAT_ENABLED`, `AI_CHAT_TTFT_TIMEOUT_SECONDS` (<= 5s), `AI_CHAT_PROMPT_TIMEOUT_SECONDS` (<= 2s).
- [ ] Verify frontend envs present: `NEXT_PUBLIC_TTS_TIMEOUT_MS`, `NEXT_PUBLIC_STT_TIMEOUT_MS`.
- [ ] Ensure prod logging redaction is enabled for prompts/system text.

Canary & Feature Flags
- [ ] Enable heartbeats and headers globally (low risk). Optionally gate via `AI_CHAT_SSE_HEARTBEAT_SECONDS`.
- [ ] Ship EventSource cleanup/retry and abort-turn (frontend) behind a soft flag if desired.
- [ ] Gradual rollout: 5% → 25% → 100% over 24h while monitoring SLOs.

Monitoring (first 24–48h)
- [ ] Grafana: TTFT p95, total duration p95, disconnects per 1k streams, retry rate, heartbeat absence.
- [ ] Logs: spike in `chat_stream_provider_runtime_error`, client disconnects.
- [ ] UX: track rate of “audio locked” prompts; confirm unlock flow resolves queued audio.

Post-deploy Checks
- [x] `curl -N` on `/chat/stream` shows `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`, periodic `:` heartbeats (validated in dev).
- [ ] Route changes do not leak streams (no messages after unmount in dev tools).
- [ ] Abort turn instantly stops audio and no further TTS enqueues occur.

Rollback
- [ ] Disable new behavior via envs/flags, redeploy: `AI_CHAT_SSE_HEARTBEAT_SECONDS=0` (or unset), feature flags off; keep proxy headers intact.

---

## Changelog

2025-08-30
- Initialized tracker with workstreams, acceptance tests, and release plan.
- Identified highest-impact items: backend heartbeats/headers, frontend unmount cleanup, retry policy, abort turn coupling, TTS segmentation.

2025-08-30 (later)
- Implemented backend SSE heartbeat and header fixes; converted provider timeout/runtime notices to non-audible SSE comments.
- Implemented frontend EventSource unmount cleanup and bounded backoff retry (when no partial text) in `ConversationContext` for both `sendPrompt` and `chatToTextWithTTS`.
- Implemented atomic abort-turn (SSE cancel + TTS cancel + audio clear) exposed via `ConversationContext.abortTurn()`.
- Implemented TTS segmentation hardening and backpressure in `VoiceContext` (merge small segments, queue cap/coalesce); ensured punctuation and idle debounce flushing in `ConversationContext`.

---

## Links
- Backend SSE: `coach-up-ai-api/app/main.py` (`/chat/stream`).
- Proxy: `coach-up-frontend/ui/src/app/api/chat/route.ts`.
- Contexts: `ui/src/context/ConversationContext.tsx`, `ui/src/context/VoiceContext.tsx`, `ui/src/context/AudioContext.tsx`.
- Related tests: `coach-up-ai-api/tests/*`, `coach-up-frontend/ui/tests/e2e/*`.


