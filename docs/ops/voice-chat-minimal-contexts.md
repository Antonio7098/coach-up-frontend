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
- [x] Add barge‑in (serialized lifecycle): detect speech → cancel TTS + stop playback; recording continues
- [ ] Add TTFT/metrics



## Next: VAD hardening to avoid noise-triggered barge-in (least disruptive first)

Phased plan (apply in order; stop when behavior is stable):

1) Hysteresis + debounce (minimal change)
   - Require N consecutive voiced frames before declaring “speech” (e.g., 200 ms when idle; 300–400 ms during playback).
   - Require M consecutive silence frames to end speech (M > N). Add 100–150 ms debounce before cancelling TTS to avoid transient cutouts.

2) Dynamic threshold with rolling noise floor (still minimal)
   - Track RMS exponential moving average (EMA) as noise floor; use threshold = noiseFloor + margin.
   - Keep separate margins for idle vs during playback.

3) Simple spectral features
   - Add zero‑crossing rate (ZCR) and 300–3000 Hz band‑energy ratio checks; reject broadband/impulse spikes.

4) Playback echo guard
   - Measure playback RMS via `createMediaElementSource(audioEl)`.
   - During playback, only barge‑in when mic RMS exceeds playback RMS by +X dB for Y ms and voiced features pass.

5) Recovery on false trigger (safety)
   - If barge‑in triggers but STT returns < 3 chars and no confirm within 500 ms, resume the interrupted TTS from next segment.

6) Optional stronger VAD (if needed)
   - Evaluate a lightweight WASM VAD (e.g., WebRTC‑VAD via `@ricky0123/vad` or `rnnoise-wasm`). Run in a Web Worker; expose boolean/probability.

7) Telemetry for tuning
   - Log mic RMS, playback RMS, ZCR, band energy ratio, and decision states (noise/speech/echo) with reasons. Gate via env flag.

Acceptance checks
- Background noise during playback does not interrupt.
- Speaking at normal volume during playback interrupts within <150 ms.
- No overlapping audio after barge‑in; previous playback fully stopped.
