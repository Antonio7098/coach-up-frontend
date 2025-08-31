## Minimal Voice Contexts Plan (scaffold → iterate)

Goal: Create ultra‑minimal versions of voice chat contexts side‑by‑side to isolate regressions, validate a stable baseline, then incrementally re‑introduce features.

Scope in v0 (baseline, no extras):
- MinimalAudioContext: single HTMLAudioElement; enqueueAudio(url), stop() only.
- MinimalVoiceContext: enqueueTTSSegment(text) → POST /api/v1/tts → audioUrl → enqueueAudio; sttFromBlob passthrough to existing API.
- MinimalConversationContext: chatToText(prompt) via EventSource, no tee/metrics/history; 1 retry only if zero tokens received.
- MinimalMicContext: startRecording() → MediaRecorder → sttFromBlob → chatToText → enqueueTTSSegment(reply); no VAD, no loop, manual tap only.
- New page /coach-min mounted with Minimal* providers.

Out of scope in v0:
- VAD, voice loop, barge‑in, autoplay prompts, queues, segmentation, TTFT metrics, assessments, dashboards.

Acceptance checks (v0):
- Manual: 3 consecutive one‑shot turns (tap → speak → reply) with no mic stalls or late TTS; single early‑error retry if HMR/glitch before first token.
- CURL sanity: /api/chat responds with [DONE]; /api/v1/tts returns audioUrl.

Rollout steps:
1) Scaffold Minimal* contexts alongside current contexts; add /coach-min.
2) Validate in dev and prod (no HMR): 3 turns stable.
3) Incrementally add features behind flags, updating this doc.

Changelog:
- [x] Scaffold MinimalAudioContext, MinimalVoiceContext, MinimalConversationContext, MinimalMicContext
- [x] Add /coach-min page and providers
- [x] Validate v0 acceptance checks
- [x] Enable history param (last N=2)
- [x] Add punctuation-based TTS segmentation
- [x] Add voice loop (simple)
- [x] Add VAD silence auto‑stop (RMS-based; ~700ms end-of-silence)
- [x] Remove timer-based loop; keep VAD-only loop
- [x] Add playback pipeline status and pipelined TTS enqueue
- [x] Add autoplay banner + simple queue (unlock prompt + queued playback)
- [x] Add barge‑in (serialized lifecycle): detect speech → cancel TTS + stop playback; stop-and-resume capture (discard pre‑speech), STT on post‑barge‑in speech end
- [x] Fix STT after barge‑in: skip STT for pre‑barge‑in buffer, auto‑restart capture, then run STT after silence
- [x] Add TTFT/metrics (UI API): chatFirstTokenMs in `/api/chat`; sttLatencyMs & ttsLatencyMs in `/api/v1/stt` and `/api/v1/tts`; `/api/metrics` export enabled

History rollout (incremental):
- [ ] History v1 (immediate only, minimal): include last N=2 turns (user/assistant) in `MinimalConversationContext` history param. Keep simple char-bounded trimming.

- [x] History v2 (background summary): wire `useSessionSummary(sessionId, { autoloadOnMount: false })`; call `onTurn()` after each turn to refresh in background by thresholds (turns/seconds). Expose cached `summary?.text` to `MinimalConversationContext`.
- [x] UI v1 (panel minimal): add History panel on `/coach-min` showing last N turns and current cached summary with updatedAt; collapsible; manual Refresh button.
- [x] History v3 (cached composition, non-blocking): compose prompt as [cached summary if present] + [last N immediate]. If no cached summary yet, send immediate-only. Never block chat; optional soft-wait budget default=0ms.
- [ ] History v4 (budgets & trimming): enforce char/token budgets across summary+immediate; trim oldest immediate first, then summary tail.
- [x] UI v2 (polish): highlight current turn; auto-refresh on new turns via `onTurn()`; loading/empty states.
- [x] Observability: log component lengths, count summary 404/429; ensure no PII in logs.

Behavioral details:
- Immediate history cache: keep last N=2 turns in-memory on the client (no network); compose into the prompt every turn. Configurable via `NEXT_PUBLIC_HISTORY_TURNS`.
- Summary refresh policy: do NOT fetch per turn. Use `useSessionSummary(sessionId, { autoloadOnMount: false })` and call `onTurn()` after each completed turn. Refresh when either: turns since last ≥ T (default 8) or age ≥ S seconds (default 120). Fetch runs in background and never blocks chat.
- Composition policy: prepend the latest cached summary if present (even if a fresh refresh is in-flight or failed/404/429), then append last N immediate turns. If no cached summary exists yet (e.g., very first turns), send immediate turns only.
- Latency and waiting: default is non-blocking (zero extra wait). Optionally support a soft-wait budget (e.g., 0–200ms) before opening SSE only if a fresh summary promise is already resolving; default=0 to keep TTFT low.
- Retry/consistency: when summary endpoint returns 404 (not ready), schedule capped retries (existing hook: attempts=3, delay=1500ms). When it later resolves, it will be used on subsequent turns automatically.
- Budgets/limits: prefer token-budgeting (e.g., with a lightweight tokenizer) with a fallback char budget (e.g., 2000 chars) for dev. Trim order: oldest immediate turns first, then summary tail. Expose `NEXT_PUBLIC_HISTORY_TOKEN_BUDGET` when ready.
- Prompt template: structure prompt with clear sections:
  - "Summary:" (cached summary text)
  - "Recent messages:" (most recent N user/assistant turns)
  This helps the model weight context correctly while keeping composition simple.
- De-duplication: if the latest assistant/user turn is already covered in the cached summary, avoid duplicating it in the immediate list (simple string overlap check).
- URL size guardrails: since history is sent in a query string today, keep total URL length small (< ~1500–2000 chars). If composition exceeds this, truncate per budget rules; consider a future POST proxy variant if needed.
- UI panel: display last N immediate turns and the current summary with a timestamp (updatedAt), show loading/empty states, and a manual Refresh button (calls `refresh()`). The panel is collapsible and does not affect the voice loop. Added expandable local Summary History and LLM prompt debug (prev summary preview + messages).

Additional observability:
- Record `summary_age_at_use_ms`, `included_summary_bytes`, and `prompt_bytes_total` (best-effort) to validate budgets and freshness (UI-side logs/metrics only, no PII).