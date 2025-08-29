# Voice Chat Pipeline Audit — Performance & UX Analysis

Based on a comprehensive audit of the voice chat functionality on `/coach` and the underlying pipeline, this document outlines key issues, grounded findings from code, and an actionable plan with progress tracking.

---

## Progress Tracker

- Overall status: [ ] Not started  [x] In progress  [ ] Done

- Milestones:
  - [x] Simplify barge-in logic (baseline interrupt + restart implemented)
  - [x] Clarify processing states in UI (added "Thinking" indicator during chat)
  - [x] Add STT timeout + retry (client-side Abort + single retry)
  - [x] Add metrics histograms
  - [ ] Reduce VAD params / presets
  - [x] Device health checks and UX
  - [ ] Split `MicContext` responsibilities
  - [x] Client telemetry ingestion + Grafana panels (voice VAD/pipeline/tts playback)

---

## Scope and Goals

- Improve reliability and predictability of voice interactions (VAD, barge-in, TTS).
- Reduce perceived latency and eliminate “silent” failures due to autoplay and timeouts.
- Add visibility through consistent state indicators and metrics.
- Keep privacy posture intact while providing performance options.

---

## Critical Performance Issues

1) Complex State Management in `MicContext`
- Issue: The [ui/src/context/MicContext.tsx](cci:7://file:///home/antonio/programming/coach-up/coach-up-frontend/ui/src/context/MicContext.tsx:0:0-0:0) (~1300 lines) owns recording, VAD, barge-in, chat SSE, TTS queueing/playback, and persistence triggers.
- Impact: Race conditions, stale closures, debugging complexity.
- Evidence: Multiple refs guarding state (`voiceLoopRef`, `recordingRef`, `processingRef`, etc.).

- Actions:
  - [ ] Split responsibilities into focused modules/contexts:
    - `AudioContext` (recording, playback)
    - `VoiceContext` (STT, TTS)
    - `ConversationContext` (chat, history)

2) Audio Pipeline Interruption Complexity (Barge-in)
- Issue: Interrupting TTS while capturing a new utterance is complex and brittle.
- Impact: Inconsistent behavior during rapid user barge.
- Evidence: Playback control and barge monitor coordination across multiple refs and timers.
- Actions:
  - [ ] Replace with “interrupt + restart” pattern (stop playback immediately, queue new flow deterministically).

3) VAD Sensitivity/Configuration
- Issue: Many tunables lead to unpredictable start/stop across environments.
- Impact: False starts, clipped utterances.
- Evidence: Multiple tuning values read at runtime (e.g. `MAX_UTTER_MS`, `VAD_THRESHOLD`, `VAD_MAX_SILENCE_MS`, `BARGE_*`, `MIN_SPEECH_MS`).
- Actions:
  - [ ] Reduce to 3 essential settings.
  - [ ] Provide environment presets (Quiet, Normal, Noisy).
  - [ ] Consider auto-tuning heuristics.

4) TTS Queue Management Complexity
- Issue: Multiple queues/cancel pathways for TTS segments and audio URLs.
- Impact: Occasional stutter, overlapping or dropped playback.
- Evidence: TTS text queue + audio queue + cancel generation coordination.
- Actions:
  - [ ] Consolidate queueing and cancellation to a single, observable state machine.
  - [ ] Add telemetry to confirm ordering and gaps.

---

## UX Inconsistencies

1) Autoplay Policy Conflicts
- Issue: Playback is correctly deferred until user gesture, but UX is unclear.
- Impact: “Silent responses” if user hasn’t interacted.
- Evidence: Deferral via `userInteractedRef`/`pendingAudioUrlRef` in [MicContext.tsx](cci:7://file:///home/antonio/programming/coach-up/coach-up-frontend/ui/src/context/MicContext.tsx:0:0-0:0) (playback path around 200–205, 268–281, 389–400).
- Actions:
  - [x] Show a persistent “Enable audio” banner/button until unlocked.

2) Processing State Visibility
- Issue: Multiple busy states (`idle`, `stt`, `chat`, `tts`) not consistently reflected in UI.
- Impact: User uncertainty during chat streaming.
- Evidence: Ring shown between STT and TTS; not shown during chat SSE accumulation.
- Actions:
  - [x] Add distinct “Thinking” indicator while `busy === 'chat'` until first TTS segment enqueues. Implemented by toggling `processingRing` on chat start and clearing on first TTS enqueue in `ui/src/context/MicContext.tsx`.

3) Error Handling Consistency
- Issue: STT/TTS/chat surface errors inconsistently.
- Impact: Some failures appear as “hangs” or quiet drops.
- Actions:
  - [x] Normalize error reporting with explicit, user-friendly copy and retry options per stage (standardized copy in `MicContext.tsx`).

---

## Performance Bottlenecks

1) STT Pipeline — Base64 Data URL (Multipart Path)
- Bottleneck: Encoding uploaded blob to base64 for privacy (no storage).
- Impact: CPU/memory overhead and added latency for large blobs.
- Evidence: [ui/src/app/api/v1/stt/route.ts](cci:7://file:///home/antonio/programming/coach-up/coach-up-frontend/ui/src/app/api/v1/stt/route.ts:0:0-0:0) builds `data:${mime};base64,...` (around 173–180).
- Actions:
  - [x] Gate this path behind an env flag.
  - [x] Prefer JSON path with `objectKey` when privacy policy allows (already supported) when gating is disabled.

2) Chat Streaming Proxy
- Bottleneck: Frontend acts as a simple SSE proxy.
- Impact: Some latency, but necessary for CORS and headers.
- Evidence: [ui/src/app/api/chat/route.ts](cci:7://file:///home/antonio/programming/coach-up/coach-up-frontend/ui/src/app/api/chat/route.ts:0:0-0:0) (pass-through with `X-Accel-Buffering: no`).
- Actions:
  - [ ] Track “first-token” latency to quantify real user impact.

3) Multiple AudioContexts
- Bottleneck: VAD and barge monitor each open contexts/streams.
- Impact: Elevated resource usage on constrained devices.
- Evidence: `audioCtxRef`, `bargeAudioCtxRef` are created/closed in [MicContext.tsx](cci:7://file:///home/antonio/programming/coach-up/coach-up-frontend/ui/src/context/MicContext.tsx:0:0-0:0).
- Actions:
  - [ ] Evaluate a unified `AudioContext` or short-lived passive windows.
  - [ ] Explore reading playback envelope to reduce mic usage during barge monitor.

---

## Findings From Code (Grounded)

- __STT multipart path uses base64 data URL__:
  - Evidence: [ui/src/app/api/v1/stt/route.ts](cci:7://file:///home/antonio/programming/coach-up/coach-up-frontend/ui/src/app/api/v1/stt/route.ts:0:0-0:0) (≈173–180).
  - Trade-off: Privacy vs. CPU/memory cost.

- __Client mic detection timing is instrumented and returned__:
  - Evidence: [MicContext.tsx](cci:7://file:///home/antonio/programming/coach-up/coach-up-frontend/ui/src/context/MicContext.tsx:0:0-0:0) sends `x-detect-ms`; STT reads header and returns `clientDetectMs` in JSON.
  - Action: Add histogram and correlate with STT provider/model.

- __STT payload includes provider and model__:
  - Evidence: [ui/src/app/api/v1/stt/route.ts](cci:7://file:///home/antonio/programming/coach-up/coach-up-frontend/ui/src/app/api/v1/stt/route.ts:0:0-0:0) includes `provider`, `model`.

- __Metrics coverage exists__:
  - Evidence: STT increments `audioBytesIn` (multipart and objectKey paths), TTS increments `audioBytesOut` and `storageBytesUploaded`.

- __Chat proxy passes provider/model headers and disables buffering__:
  - Evidence: [ui/src/app/api/chat/route.ts](cci:7://file:///home/antonio/programming/coach-up/coach-up-frontend/ui/src/app/api/chat/route.ts:0:0-0:0) exposes `X-Chat-Provider`, `X-Chat-Model`, sets `X-Accel-Buffering: no`.

- __Processing ring gaps during chat streaming__:
  - Evidence: Ring set at STT start, stopped at TTS start; no explicit indicator while `busy === 'chat'`.

- __Timeouts and retries__:
  - Evidence: TTS has AbortController timeout + single retry in client; STT multipart call lacks timeout/retry; SSE has basic [onerror](cci:1://file:///home/antonio/programming/coach-up/coach-up-frontend/ui/src/context/MicContext.tsx:709:8-714:10) only.

- __Autoplay handling implemented but UX could be clearer__:
  - Evidence: Deferral until user gesture; missing prominent UI affordance.

---

## Immediate Next Steps (Low-Risk, High-Value)

- [x] Add STT timeout + single retry in `MicContext.callSTTMultipart()` and show specific timeout error copy.
- [x] Show visible “Thinking” state during chat streaming (`busy === 'chat'`) until first TTS segment enqueues.
- [x] Add Prometheus histograms: `stt_latency_ms`, `tts_latency_ms`, `chat_first_token_ms`, `client_detect_ms`.
- [x] Gate multipart base64 path with env (prefer `objectKey` JSON path when allowed) and document behavior.
- [x] Add `navigator.mediaDevices.ondevicechange` listener to detect mic loss/change and prompt the user.

---

## Recommended Improvements

- __Simplify State Management__
  - [ ] Split `MicContext` into focused modules/contexts:
    - `AudioContext` (recording, playback)
    - `VoiceContext` (STT, TTS) - in progress
    - `ConversationContext` (chat, history)

- __Improve Audio Pipeline__
  - [ ] Replace complex barge-in with interrupt + restart pattern.
  - [ ] Apply audio buffering/backpressure to reduce stutter.
  - [ ] Add visual indicators for all pipeline stages.

- __Optimize Performance__
  - [ ] Prefer `objectKey` path for STT where allowed; reserve base64 for strict-privacy flows.
  - [ ] Consider WebRTC for low-latency paths (later milestone).
  - [ ] Connection reuse/pooling where relevant.

- __Enhance UX__
  - [ ] Clear indicators for “Listening”, “Thinking”, “Speaking”.
  - [ ] Progressive disclosure for voice tuning.
  - [ ] Add live input level meter.
  - [ ] Consistent error recovery with retry and clear messages.

- __Configuration Simplification__
  - [ ] Reduce VAD parameters to 3 core knobs.
  - [ ] Provide presets (Quiet, Normal, Noisy).
  - [ ] Optional auto-tune on first-run.

- __Monitoring & Debugging__
  - [ ] Structured logs with request IDs.
  - [ ] Device health checks and graceful fallbacks.
  - [ ] Add redaction where needed to preserve privacy.

## Priority Implementation Order

- High Priority
  - [ ] Simplify barge-in logic (interrupt + restart).
  - [ ] Harmonize error handling and UI states (in progress).
  - [x] STT timeout + retry; "Thinking" indicator.

- Medium Priority
  - [ ] Split `MicContext` responsibilities.
  - [x] Add metrics histograms and dashboards.

- Low Priority
  - [ ] WebRTC exploration.
  - [ ] Advanced performance optimizations and presets auto-tune.

---

## Metrics & Instrumentation Plan

- New histograms (UI API, Prometheus names in parentheses):
  - [x] STT latency ms (`coachup_ui_stt_latency_ms`)
  - [x] TTS latency ms (`coachup_ui_tts_latency_ms`)
  - [x] Chat first token ms (`coachup_ui_chat_first_token_ms`)
  - [x] Client mic detection ms (`coachup_ui_client_detect_ms`)

- Client events:
  - [x] `voice.stt.request_start`, `voice.stt.response_headers`, `voice.stt.done` (in place; now includes timeout+retry logs)
  - [x] `voice.tts.duration` (reported from TTS response JSON)
  - [x] `voice.device.change` (mic added/removed)
  - [x] `voice.vad.state` (init/speaking/silence/stop)
  - [x] `voice.pipeline.state` (idle/listening/processing/speaking/error)
  - [x] UI state transitions (recording, thinking, speaking) — implied via `busy`, `processingRing`, and `recording` transitions
  - [x] `voice.tts.playback_start` / `voice.tts.playback_end` with playback duration
  - [x] Ingestion to Prometheus via `/api/telemetry/voice` with metrics:
    - `coachup_ui_voice_events_total{event,state,outcome,...}`
    - `coachup_ui_voice_tts_playback_ms_bucket{outcome,...}`
  - [x] Grafana panels added to `ui-api-speech.json` to visualize events rate and p95 playback duration

---

## Ownership and Review Cadence

- Tech owner: [assign]
- Design owner: [assign]
- Review cadence: Weekly until all High Priority items are complete, then bi-weekly. Next review: 2025-09-04

---

## References

- [ui/src/context/MicContext.tsx](cci:7://file:///home/antonio/programming/coach-up/coach-up-frontend/ui/src/context/MicContext.tsx:0:0-0:0)
- [ui/src/app/api/v1/stt/route.ts](cci:7://file:///home/antonio/programming/coach-up/coach-up-frontend/ui/src/app/api/v1/stt/route.ts:0:0-0:0)
- [ui/src/app/api/v1/tts/route.ts](cci:7://file:///home/antonio/programming/coach-up/coach-up-frontend/ui/src/app/api/v1/tts/route.ts:0:0-0:0)
- [ui/src/app/api/chat/route.ts](cci:7://file:///home/antonio/programming/coach-up/coach-up-frontend/ui/src/app/api/chat/route.ts:0:0-0:0)
- [ui/src/app/api/telemetry/voice/route.ts](cci:7://file:///home/antonio/programming/coach-up/coach-up-frontend/ui/src/app/api/telemetry/voice/route.ts:0:0-0:0)
- [infra/monitoring/grafana/dashboards/ui-api-speech.json](cci:7://file:///home/antonio/programming/coach-up/infra/monitoring/grafana/dashboards/ui-api-speech.json:0:0-0:0)

---

## Change Log — 28/08/2025

- Implemented client-side STT timeout with single retry in `MicContext.callSTTMultipart()`.
  - New env: `NEXT_PUBLIC_STT_TIMEOUT_MS` (default 12000ms).
  - Logs enriched: `voice.stt.request_start`, `voice.stt.response_headers`, `voice.stt.done`, timeout warnings.
- Added “Thinking” state during chat streaming by setting `processingRing` when `busy === 'chat'` and clearing on first TTS enqueue.
 - Added Prometheus histograms and dashboards:
   - Metrics: `coachup_ui_stt_latency_ms`, `coachup_ui_tts_latency_ms`, `coachup_ui_chat_first_token_ms`, `coachup_ui_client_detect_ms`.
   - Grafana: updated `ui-api-speech.json` to plot STT/TTS latency and client detect; added `ui-api-chat.json` for first-token latency. Prometheus scrape includes `coachup-ui-api` at `/api/metrics`.

## Change Log — 29/08/2025

- Changes applied to `ui/src/context/MicContext.tsx`:
  - Simplified `rec.onstop`: Restored a clean `rec.onstop` handler inside `startRecording()` that:
    - Ends UI recording state and speaking indicator immediately.
    - Skips processing if voice loop is disabled or already processing.
    - Finalizes the blob, calls STT, updates history/assistant response, and restarts the loop if still enabled.
    - Cleans up timers, audio context, and state without any concatenation logic.
  - Removed leftover concatenation/interruption code: Deleted remaining references to `pipelineInterruptedRef` and any concatenation paths in the barge-in flow (`startBargeMonitor()`), resolving the “Cannot find name 'pipelineInterruptedRef'” error.
  - Barge-in behavior now strictly interrupt + restart:
    - On barge trigger: pause playback, clear audio queues, cancel TTS, close chat SSE, set busy to idle, stop the barge monitor, and immediately `startRecording()`.
  - Telemetry additions:
    - Emit `voice.barge.trigger` when barge is detected.
    - Record `bargeTriggerTsRef` timestamp and emit `voice.barge.restart_ms` on the first chunk of the next recording to measure restart latency.
    - All telemetry is fire-and-forget to `/api/telemetry/voice` with `keepalive: true`.
  - Notes on lints:
    - `pipelineInterruptedRef` not found: Fixed by removing its last usages in `startBargeMonitor()`.
    - “)` expected” at line 1588: The file ends earlier now (~1553), so stale IDE lint; re-open the file or re-run TypeScript checks to refresh diagnostics.

- What to test:
  - Barge-in responsiveness: While TTS is playing, speak; playback should pause immediately, chat/TTS stop, and recording restart quickly.
  - Restart latency metric: Confirm `voice.barge.restart_ms` logs appear and values are reasonable.
  - Voice loop flow: After processing a user utterance, the loop should restart only if still enabled and not already recording.
  - UI indicators: Verify `inputSpeaking` pulsates correctly and busy ring states align during chat/TTS.

- Summary: Barge-in pipeline simplified to an interrupt + restart model with clear telemetry and removed concatenation code paths. This should improve responsiveness and reduce race conditions.

## Change Log — 28/08/2025 (later update)

- Device health checks and device change detection implemented in `ui/src/context/MicContext.tsx`:
  - Added `checkMicPermission()` and initial health evaluation on mount.
  - Added `navigator.mediaDevices.devicechange` listener; when mic is lost or permission revoked mid-recording, we stop recording, disable voice loop, and show a friendly error.
  - Logged device change telemetry (`voice.device.change`).
- Autoplay UX clarified:
  - Added `needsAudioUnlock` state and `unlockAudio()` in `MicContext`.
  - Created `ui/src/components/AudioUnlockBanner.tsx` and mounted on `/coach` chat mode to prompt enabling audio.
- Normalized error copy across STT/TTS/chat and recording lifecycle via `ERR` constants in `MicContext.tsx`.

### Telemetry additions — 28/08/2025 (later update)

- `ui/src/context/MicContext.tsx` now emits client telemetry events:
  - `voice.vad.state` on init, speaking/silence changes, and stop.
  - `voice.pipeline.state` on transitions among idle/listening/processing/speaking/error.
  - `voice.tts.duration` on TTS response, and `voice.tts.playback_start` / `voice.tts.playback_end` around the HTMLAudioElement playback with duration.
  - Also logs user-interaction unlock deferrals and playback errors for improved observability.

### Telemetry ingestion & dashboards — 28/08/2025 (final update)

- Implemented client telemetry ingestion endpoint at `/api/telemetry/voice`.
  - Records counters in `coachup_ui_voice_events_total` with labels `event`, `state`, `outcome`.
  - Records playback durations in `coachup_ui_voice_tts_playback_ms` (histogram).
- Updated Grafana dashboard `ui-api-speech.json` with new panels:
  - Voice events/sec by type & state.
  - Voice pipeline state rate by state.
  - P95 client TTS playback duration (ms).
