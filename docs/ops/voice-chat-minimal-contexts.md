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
- [ ] History v1 (immediate only): include last N=4 turns (user/assistant) in `MinimalConversationContext` history param (currently N=2). Keep simple char-bounded trimming.
- [ ] History v2 (summary fetch): wire `useSessionSummary(sessionId)`; fetch `/api/v1/session-summary`; expose `summary?.text` to `MinimalConversationContext`.
- [ ] History v3 (composed prompt): prepend summarized history + last N immediate messages to chat prompt; respect token/char budget; fall back gracefully when summary 404/rate-limited.
- [ ] UI: add History panel on `/coach-min` showing: last N turns, current summarized history (with refresh), and when it last updated; collapsible.
- [ ] UI polish: highlight current turn, provide manual refresh + auto-refresh on new turns (via `onTurn()`); show loading/empty states.
- [ ] Observability: log prompt components lengths; add counters for summary 404/429; ensure no PII in logs.