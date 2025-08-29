# End-to-End Audio Pipeline Performance Checklist

This checklist tracks optimizations and measurements for the complete audio pipeline from **audio detection to audio playback** in the voice interface. The full pipeline includes:

1. **Audio Detection** (MicContext.tsx): Recording start → speech capture → recording stop
2. **Backend Processing**: STT → Chat LLM → TTS audio generation  
3. **Audio Playback**: TTS audio download → playback start → playback complete

Use the e2e audio pipeline benchmark in `benchmarking/examples/audio_pipeline_benchmark.py` and the test in `benchmarking/tests/test_audio_pipeline_e2e.py` to collect timing data. Record results after each change.

---

### Benchmark Results - 2025-08-27 (Local, Deepgram STT via Next.js, Google TTS, OpenRouter OpenAI GPT-5 Mini)

**Date/Change**: 2025-08-27 - Audio pipeline benchmark with Deepgram STT (Next.js proxy), Google TTS, LLM via OpenRouter OpenAI GPT-5 Mini

**Command**:
```
python3 benchmarking/examples/audio_pipeline_benchmark.py \
  --backend-url http://127.0.0.1:3000 \
  --audio-file coach-up-frontend/docs/voice_sample.webm \
  --language-hint en-US \
  --stt-provider deepgram \
  --runs 3
```

**Per-run**:
- Run 01/3: chat_ttft=6204.6 ms, chat_total=6456.0 ms, tts=936.2 ms, backend_processing=20152.6 ms, e2e=27047.4 ms, stt=deepgram/nova-2, detect=None ms, llm=openrouter/openai/gpt-5-mini, tts=google
- Run 02/3: chat_ttft=6109.8 ms, chat_total=6361.2 ms, tts=967.1 ms, backend_processing=18826.1 ms, e2e=25715.0 ms, stt=deepgram/nova-2, detect=None ms, llm=openrouter/openai/gpt-5-mini, tts=google
- Run 03/3: chat_ttft=5379.8 ms, chat_total=5630.1 ms, tts=844.7 ms, backend_processing=8266.8 ms, e2e=15156.1 ms, stt=deepgram/nova-2, detect=None ms, llm=openrouter/openai/gpt-5-mini, tts=google

**SUMMARY (ms)**
- audio_detect_time_ms: min=500.0 max=500.0 p50=500.0 p90=500.0 p95=500.0
- stt_time_ms: min=1792.0 max=12760.3 p50=11497.7 p90=12507.8 p95=12634.1
- chat_ttft_ms: min=5379.8 max=6204.6 p50=6109.8 p90=6185.7 p95=6195.2
- chat_total_ms: min=5630.1 max=6456.0 p50=6361.2 p90=6437.0 p95=6446.5
- tts_time_ms: min=844.7 max=967.1 p50=936.2 p90=961.0 p95=964.1
- backend_processing_time_ms: min=8266.8 max=20152.6 p50=18826.1 p90=19887.3 p95=20020.0
- total_e2e_time_ms: min=15156.1 max=27047.4 p50=25715.0 p90=26780.9 p95=26914.1

Providers/Models (last run)
- STT: deepgram , model: nova-2
- LLM: openrouter , model: openai/gpt-5-mini
- TTS: google , voice: en-US-Neural2-C , format: audio/mpeg

**Observations**:
- Chat latency is higher than both GLM 4.5 Air and Gemini Flash Lite on this setup; TTFT p50 ~6.11s, total ~6.36s.
- Backend p50 is elevated (~18.83s) due to one high-latency run; still, chat alone remains significantly slower than Gemini.
- E2E inflated by playback heuristic and fixed detect placeholder; prefer runs with real `clientDetectMs` and TTS `durationMs`.

#### LLM Comparison: GPT-5 Mini vs GLM 4.5 Air vs Gemini Flash Lite (local, Deepgram STT, Google TTS)
Using p50 values across sections:
- Chat TTFT: GPT-5 Mini ~6110 ms vs GLM 4.5 Air ~5443 ms vs Gemini Flash Lite ~1408 ms → Gemini ~4.3× faster than GPT-5 Mini; GLM ~1.1× faster than GPT-5 Mini.
- Chat total: GPT-5 Mini ~6361 ms vs GLM 4.5 Air ~5694 ms vs Gemini Flash Lite ~2074 ms → Gemini ~3.1× faster than GPT-5 Mini; GLM ~1.12× faster.
- Backend p50: GPT-5 Mini ~18826 ms vs GLM 4.5 Air ~9156 ms vs Gemini Flash Lite ~4383 ms → Gemini ~4.3× faster than GPT-5 Mini; GLM ~2.1× faster.

Takeaway: For low-latency voice, Gemini Flash Lite remains the best of the three; GLM 4.5 Air is a mid option; GPT-5 Mini is slowest in this environment.


## Pipeline Stage Definitions
- **T_audio_detect_start**: `setRecording(true)` in MicContext
- **T_audio_detect_end**: `rec.onstop` → audio blob created
- **T_stt_start**: STT API call begins
- **T_stt_end**: STT transcription received
- **T_chat_start**: SSE `/chat/stream` begins
- **T_chat_end**: Chat response fully received
- **T_tts_start**: TTS API call begins
- **T_tts_end**: TTS audio URL received
- **T_playback_start**: Audio `play()` called
- **T_playback_end**: Audio `ended` event fired

## End-to-End Measurements
- [ ] **Total E2E Time**: T_audio_detect_start → T_playback_end
- [ ] **Detection Time**: T_audio_detect_start → T_audio_detect_end
- [ ] **STT Time**: T_stt_start → T_stt_end
- [ ] **Chat Time**: T_chat_start → T_chat_end (includes TTFT + total stream)
- [ ] **TTS Time**: T_tts_start → T_tts_end
- [ ] **Playback Time**: T_playback_start → T_playback_end
- [ ] **Processing Latency**: T_audio_detect_end → T_playback_start (time from audio capture to response start)

## Baseline & Observability
- [ ] Confirm frontend console logs show timing markers for each pipeline stage
- [ ] Confirm backend logs show `chat_stream_first_token`, `chat_stream_complete`, STT/TTS API timings
- [ ] Start with a baseline: run 10 voice interactions and record p50/p90/p95 for each stage
- [ ] Grafana/Prometheus: verify charts for audio pipeline metrics

## Audio Detection & Capture
- [ ] Ensure VAD (Voice Activity Detection) is enabled and properly tuned
- [ ] Minimize silence timeout (`VAD_MAX_SILENCE_MS`) to reduce latency
- [ ] Optimize audio chunk size and recording parameters
- [ ] Check for audio level normalization and noise suppression

## STT Processing
- [ ] Verify STT endpoint is geographically close to reduce RTT
- [ ] Check audio format optimization (WebM vs other codecs)
- [ ] Monitor STT API response times and error rates
- [ ] Consider client-side VAD to reduce unnecessary STT calls

## Chat LLM Processing
- [ ] Use low-latency model (e.g., `gpt-4o-mini`) for voice interactions
- [ ] Limit output length via prompt guidance to reduce token generation time
- [ ] Optimize chat history depth (3-5 messages preferred for voice)
- [ ] Warm up chat endpoint once after server start

## TTS Processing
- [ ] Verify TTS endpoint proximity and response times
- [ ] Check audio quality vs latency tradeoffs
- [ ] Monitor TTS queue processing and audio download times
- [ ] Consider streaming TTS for faster first audio chunk

## Audio Playback
- [ ] Optimize audio buffer loading and preloading
- [ ] Check for audio codec compatibility issues
- [ ] Monitor playback start latency after TTS URL received
- [ ] Ensure proper audio queue management for barge-in scenarios

## Network & Environment
- [ ] Verify all endpoints (STT, Chat, TTS) have low RTT
- [ ] Check client-side bandwidth for audio upload/download
- [ ] Monitor browser audio processing performance
- [ ] Ensure consistent audio hardware/driver performance

## Regression Guardrails
- [ ] Add E2E audio pipeline pytest (skipped by default). Enable in CI on demand with thresholds.
- [ ] Track results over time (`benchmarking/results/audio_pipeline/`), commit summaries to repo.
- [ ] Set up alerts for pipeline stage regressions (e.g., E2E > 5s, STT > 2s)

---

## Latency Budget and Optimization Playbook (Checklist)

### 0) Build a latency budget (so you know what to fix)
- [ ] Target round-trip (user finishes → first audio back): ≤ 500–800 ms
- [ ] Mic capture & packetization: 10–40 ms
- [ ] Network uplink (client → ASR/LLM/TTS): ≤ 80 ms RTT to your region
- [ ] ASR first partial ≤ 150 ms from speech start; ASR final ≤ 300 ms after endpoint
- [ ] LLM first token ≤ 150–300 ms; tokens/sec ≥ 40–120 (model/GPU dependent)
- [ ] TTS first audio ≤ 100–200 ms; stream thereafter
- [ ] Instrument and log per-stage: ASR-first-partial, ASR-final, LLM-first-token, TTS-first-audio, jitter/RTT

### 1) Transport & client capture (surprisingly huge wins)
- [ ] Use WebRTC for full-duplex low latency audio (avoid chunked HTTP)
- [ ] Opus codec, 16–24 kbps mono, ptime 20 ms (10 ms if CPU permits)
- [ ] Keep jitter buffer small; enable DTX when acceptable
- [ ] In browser, use AudioWorklet; stream 10–20 ms frames
- [ ] Avoid resampling thrash: capture 48 kHz → encode Opus 48 kHz → single server resample if needed
- [ ] Mic constraints sane: test echoCancellation/noiseSuppression/autoGainControl on vs off; avoid stacking DSPs
- [ ] Keep connections hot: single persistent WebRTC/WS per session
- [ ] Geo-localize inference to user region to minimize RTT

### 2) Endpointing, VAD & turn-taking (controls “dead air”)
- [ ] Client-side VAD to stop streaming ASAP; signal ASR/LLM early
- [ ] Tune VAD aggressiveness + min-silence ≈200–350 ms; pre-roll ≈200 ms
- [ ] Support barge-in: allow interrupting TTS and resume mic immediately
- [ ] Send partial ASR hypotheses continuously; don’t wait for final to begin reasoning

### 3) ASR speed knobs
- [ ] Use streaming ASR that emits token-level partials
- [ ] Frame size 20 ms; hop size aligned to model
- [ ] Small beam for partials; slightly increase only for finalization
- [ ] Aggressive endpointing (short trailing silence)
- [ ] Language lock / phrase boost where possible
- [ ] Post-processing (punctuation/caps) incremental and non-blocking
- [ ] If self-hosting Whisper: faster-whisper/CTranslate2, int8/FP16, GPU pinning, FlashAttention, batch size 1

### 4) LLM decode latency (the usual culprit)
- [ ] Stream responses; start TTS on first tokens
- [ ] Reduce tokens: shrink system/few-shot; summarize history; prefer short max_tokens
- [ ] Grammar/JSON-guided decoding for tool calls
- [ ] Use a smaller/fast model for real-time loop; cascade to larger as needed
- [ ] Enable prompt caching / KV reuse; keep session warm
- [ ] Speculative decoding / draft model if supported
- [ ] Infra: warm workers, FP16/FP8, FlashAttention, tensor-parallel sized for batch=1, pin memory, NUMA-aware placement

### 5) TTS first-audio time
- [ ] Pick streaming TTS with first audio <100–200 ms; consider “fast voices”
- [ ] Start playback on first chunk; don’t buffer full sentences
- [ ] Configure chunk size ≈100–200 ms
- [ ] Preload/warm the voice model at session start
- [ ] Cache lexicon/SSML; precompute phonemes if supported
- [ ] Slightly increase rate (1.05–1.15×) when acceptable

### 6) System design tricks that compound
- [ ] Pipeline the stages: Mic → ASR partials → LLM early tokens → TTS → Speaker (overlap)
- [ ] Early-intent path for quick commands; bypass full LLM
- [ ] Heuristic cutoffs: cut at punctuation or after N tokens; offer “want more?”
- [ ] Canned short confirms within ~150 ms while LLM continues
- [ ] Fast retry strategy for transient ASR/LLM hiccups

### 7) Server & GPU scheduling
- [ ] Co-locate ASR/LLM/TTS within same box/AZ; minimize inter-service hops
- [ ] Prefer gRPC/in-proc calls; avoid cold HTTP lambdas in hot path
- [ ] Priority queues favor short interactive jobs; micro-batch only if no queue delay
- [ ] Keep per-session KV cache resident in GPU memory
- [ ] Monitor: queue wait, prefill time, decode tps, context reuse hit-rate

### 8) Frontend UX that hides the remaining milliseconds
- [ ] Instant affordances: brief “listening” tone; animate waves on capture
- [ ] Show partial ASR text as it arrives; confidence shading
- [ ] Start playback at first chunk; progress bar moves
- [ ] Barge-in UI: visible mic state + clear interrupt gesture
- [ ] Keep turns short by design: one ask at a time; confirm small pieces

### 9) Quick wins checklist (copy/paste)
- [ ] Switch mic capture to AudioWorklet; stream 10–20 ms frames
- [ ] Use WebRTC + Opus (ptime=20 ms) end-to-end; persistent connection
- [ ] Client-side VAD + short min-silence; send "user_stopped_talking" signal
- [ ] Streaming ASR with partials; aggressive endpointing; language/phrase boost
- [ ] Stream LLM; shrink prompts; lower max_tokens; enable KV reuse/prompt cache
- [ ] Consider a small, fast LLM for the hot path (cascade if needed)
- [ ] Streaming TTS; first audio <200 ms; small chunks; prewarmed voice
- [ ] Barge-in enabled; pause TTS instantly on mic start
- [ ] Co-locate services; avoid cold starts; gRPC between ASR/LLM/TTS
- [ ] Region near users; measure RTT; keep jitter buffers tight
- [ ] Log per-stage timestamps; track p95: ASR-first, ASR-final, LLM-first, TTS-first

### 10) Debug like a pro (what to print in logs)
- [ ] For every turn, capture and plot:
  - [ ] t_mic_start, t_first_packet_sent, rtt_mean/p95, t_asr_first_partial, t_asr_final
  - [ ] t_llm_first_token, tokens_per_sec, output_tokens
  - [ ] t_tts_first_audio, tts_chunk_ms, t_play_start, t_play_end
- [ ] Watch where p95 blows up; fix that stage first

---

## Immediate Remediation Checklist

### Quick fixes to try (low effort)
- [ ] Tighten endpointing thresholds:
  - [ ] Reduce trailing silence/min-silence to ~200–350 ms.
  - [ ] Increase VAD aggressiveness one notch.
  - [ ] Add a “max utterance duration” cap (e.g., 4–6 s) with auto-finalize.
  - [ ] Add a “force finalize” UI action (pressing mic again) to stop immediately.
- [ ] Decrease browser buffering:
  - [ ] Reduce MediaRecorder timeslice to 100–200 ms so chunks flush sooner.
  - [ ] Prefer AudioWorklet for 10–20 ms frames if available (lower latency).
- [ ] Start STT sooner:
  - [ ] Begin the STT request once you have the first chunk(s), not after full stop.
  - [ ] If you must send a single-shot request, stop early—don’t record long tails.

### Structural fixes (bigger wins)
- [ ] Stream STT with partials: use WebSocket/WebRTC, send 10–20 ms frames; display partial ASR immediately.
- [ ] Start LLM on partials (don’t wait for ASR “final”).
- [ ] Avoid proxy buffering in `ui/src/app/api/v1/stt/route.ts`:
  - [ ] Set headers to disable body buffering.
  - [ ] Pipe the request body to the provider as it arrives; avoid reading the full body first.
- [ ] Codec and capture:
  - [ ] Use Opus at 48 kHz and avoid resampling loops.
  - [ ] Test browser DSP flags (echoCancellation, noiseSuppression, autoGainControl) on/off for VAD stability and faster endpointing.

### Sanity checks
- [ ] If `clientDetectMs` is large in STT JSON, endpointing/VAD is likely slow — tune thresholds.
- [ ] If `clientDetectMs` is small but `t_stt_req_start` is late, upload starts too late (blob assembly/UI delay).
- [ ] If `t_stt_req_start` is early but `t_stt_first_partial` is late, provider side is slow — try streaming provider, closer region, or different model.

### Concrete next steps
- [ ] Instrument now: add timestamp logs in `ui/src/context/MicContext.tsx` and `ui/src/app/api/v1/stt/route.ts` (request start/first byte/first partial/final).
- [ ] Tune VAD: set min-silence ~250 ms; add max-duration cap; reduce `timeslice` to 100–200 ms.
- [ ] Verify streaming path: confirm STT request starts while speaking; if not, stream audio or start HTTP request sooner.
- [ ] Optionally: try Deepgram streaming STT (via `ui/src/app/api/lib/speech/stt.ts`) and show partials to eliminate “dead air.”

---

## Notes & Results Log

### Baseline Results - 2025-08-27

**Date/Change**: 2025-08-27 - Baseline measurement  
**Settings**: History depth: 3, Audio: test_audio.wav, Runs: 5  
**Environment**: Local development, no optimizations applied

**Total E2E Time**: p50=5100.0 ms, p95=5900.0 ms  
**Backend Processing**: p50=4500.0 ms, p95=5300.0 ms  
**STT Time**: p50=1020.0 ms, p95=1220.0 ms  
**Chat Time**: p50=2650.0 ms, p95=3050.0 ms  
**TTS Time**: p50=820.0 ms, p95=960.0 ms  
**Audio Playback**: p50=2100.0 ms, p95=2350.0 ms  

**Observations**: 
- Total E2E time ~5.1s (p50) is too slow for conversational AI
- Chat processing dominates at ~2.7s, indicating LLM latency is the bottleneck
- STT at ~1s and TTS at ~0.8s are reasonable but could be optimized
- Audio playback simulation shows ~2.1s which may be inflated
- High variance in p95 results suggests inconsistent performance

**Priority Optimizations**:
1. **Chat LLM**: Switch to faster model (gpt-4o-mini vs gpt-4), reduce output length
2. **History Depth**: Reduce from 3 to 2 messages to trim token processing
3. **Audio Detection**: Implement client-side VAD to reduce unnecessary STT calls
4. **TTS**: Optimize audio format and consider streaming TTS

---

### Benchmark Results - 2025-08-27 (Local, Stub TTS)

**Date/Change**: 2025-08-27 - Audio pipeline benchmark run with stub TTS
**Settings**: History depth: 3, Audio: test_audio.webm, Runs: 3
**Environment**: Local backend at `http://127.0.0.1:8000`, `AI_CHAT_ENABLED=1`, `AI_CHAT_MODEL=z-ai/glm-4.5-air:free`

**Total E2E Time**: p50=88135.3 ms, p95=93361.4 ms  
**Backend Processing**: p50=16604.4 ms, p95=27736.8 ms  
**STT Time**: p50=100.0 ms, p95=100.0 ms  
**Chat Time**: p50=16500.7 ms, p95=27633.9 ms  
**TTS Time**: p50=2.9 ms, p95=3.5 ms  
**Audio Playback**: p50=67875.2 ms, p95=75939.2 ms  

**Observations**:
- __Chat latency dominates__: TTFT 10.6–22.7s; total chat 14.1–28.9s.
- __Playback inflated by heuristic__: Benchmark estimates playback from file size; stub WAV leads to exaggerated playback time. Real playback will be far lower.
- __TTS stub is very fast__: ~3 ms server time; download ~2.3 ms.

**Follow-ups**:
1. Use TTS `durationMs` in benchmark playback calculation (instead of byte-size heuristic).
2. Switch to a faster chat model tier; shorten system prompt and reduce history depth when benchmarking.
3. Re-run with `--history-depth 0..1` and log TTFT and totals.

---

### Benchmark Results - 2025-08-27 (Local, Google TTS)

**Date/Change**: 2025-08-27 - Audio pipeline benchmark with real Google TTS
**Settings**: History depth: 3, Audio: test_audio.webm, Runs: 3  
**Environment**: Local backend at `http://127.0.0.1:8000`, `AI_CHAT_ENABLED=1`, `AI_CHAT_MODEL=openrouter/openai/gpt-oss-20b`

**Total E2E Time**: p50=184883.4 ms, p95=262896.9 ms  
**Backend Processing**: p50=4966.5 ms, p95=5434.6 ms  
**STT Time**: p50=100.0 ms, p95=100.0 ms  
**Chat Time**: p50=3280.5 ms, p95=4005.3 ms  
**TTFT**: p50=2961.0 ms, p95=3244.0 ms  
**TTS Time**: p50=1300.7 ms, p95=1557.5 ms  
**Audio Playback**: p50=179404.8 ms, p95=256957.4 ms  

Providers/Models (last run):  
- STT: skipped  
- LLM: openrouter / openai/gpt-oss-20b  
- TTS: google / voice=en-US-Neural2-C / format=audio/mpeg

**Observations**:
- __E2E inflated by playback heuristic__: Playback dominates due to size-based estimate. Real playback will be much lower (seconds).  
- __Backend latency acceptable but improvable__: ~5.0–5.4s p50–p95, dominated by Chat; TTFT ~3.0–3.2s.  
- TTS generation time looks reasonable (~1.3–1.6s); download time is small.

**Follow-ups**:
1. Return/use TTS `durationMs` for playback time. Options:
   - Backend `/api/v1/tts` to include `durationMs` from provider if available, or estimate via text-to-duration mapping.
   - Benchmark: support reading `durationMs` from TTS response or optionally decode audio duration client-side.
2. Reduce chat latency:
   - Use faster model (e.g., `gpt-4o-mini`, `claude-3-haiku`, or other low-latency model on OpenRouter with quota).
   - Shorten system prompt and set history depth to 0–1 for benchmarking voice.
3. Isolate backend vs playback:
   - Re-run with `--skip-tts --simulate-playback-ms 3000` to measure backend-only latency.
4. Warm-up and caching:
   - Hit `/chat/stream` once on startup; consider caching system prompt.
5. Streaming TTS:
   - Evaluate streaming TTS path via frontend proxy (`TTS_PROXY_URL`) to reduce perceived latency.

---

### Benchmark Results - 2025-08-27 (Local, Google STT/TTS, OpenRouter Gemini Flash Lite)

**Date/Change**: 2025-08-27 - Audio pipeline benchmark with real Google STT and TTS; LLM via OpenRouter Gemini Flash Lite
**Settings**: History depth: default, Audio: `docs/voice_sample.webm`, Runs: 3  
**Environment**: Backend `http://127.0.0.1:8000`, STT URL `http://127.0.0.1:3000/api/v1/stt` (`--stt-provider google`), TTS provider Google (voice `en-US-Neural2-C`, format `audio/mpeg`), LLM `openrouter/google/gemini-2.0-flash-lite-001`

**Total E2E Time**: p50=22402.3 ms, p95=30971.0 ms  
**Backend Processing**: p50=9808.8 ms, p95=18396.6 ms  
**STT Time**: p50=4550.8 ms, p95=11153.5 ms  
**Chat Time**: p50=3497.0 ms, p95=4220.6 ms  
**TTFT**: p50=2270.0 ms, p95=3272.0 ms  
**TTS Time**: p50=3160.1 ms, p95=4039.7 ms  
**Audio Download**: p50=72.3 ms, p95=91.4 ms  
**Audio Playback**: p50=1392.0 ms, p90=2640.0 ms, p95=2640.0 ms (from TTS `durationMs`)  
**Audio Detection**: capture from frontend logs. In `MicContext.tsx`, record events:
  - `voice.record.start` (t0)
  - `voice.record.first_chunk` (tFirst, deltaMs)
  - `voice.record.finalize` (tStop, elapsedMs)
Use `elapsedMs` as detection time for each utterance and compute p50/p90/p95.

Providers/Models (last run):  
- STT: real / model: unknown (Google via Next.js route)  
- LLM: openrouter / google/gemini-2.0-flash-lite-001  
- TTS: google / voice=en-US-Neural2-C / format=audio/mpeg

**Observations**:
- __E2E dominated by placeholders__: 12s playback and 0.5s detection are hard-coded in the benchmark, inflating totals. Backend p50 ~9.8s is the actionable piece.
- __STT latency/variance high__: 2.5s–11.9s range suggests either provider variance or proxy overhead through Next.js route.
- __Chat latency acceptable__: Gemini Flash Lite total ~3.1–4.3s, TTFT ~1.6–3.4s. This is a good low-latency option.
- __TTS generation moderate__: ~1.6–4.1s. Download is negligible.

**Follow-ups**:
1. __Replace benchmark placeholders__:
   - Instrument real detection timing in `ui/src/context/MicContext.tsx` and surface to logs.
   - Plumb `durationMs` from `/api/v1/tts` through to the benchmark to compute playback, or parse audio duration client-side.
2. __Reduce STT latency/variance__:
   - Ensure region proximity; test direct provider call vs Next.js proxy; evaluate streaming STT where possible.
   - Verify audio format and size (WebM/Opus vs WAV) and consider trimming leading/trailing silence.
3. __Reduce TTS latency__:
   - Compare voices (e.g., Standard vs Neural2) and formats; cache frequent phrases if applicable.
4. __Chat tuning__:
   - Keep Gemini Flash Lite; also test `openai/gpt-4o-mini` on OpenRouter/quota. Reduce history depth to 0–1 for voice.
5. __Isolate backend-only__:
   - Re-run with `--skip-tts --simulate-playback-ms 0` to focus on STT + Chat + TTS generation.
6. __Tracking__:
   - Commit JSON results from `benchmarking/results/audio_pipeline/` and add trend lines to Grafana.

---

### Benchmark Results - 2025-08-27 (Local, Deepgram STT via Next.js, Google TTS, OpenRouter Gemini Flash Lite)

**Date/Change**: 2025-08-27 - Audio pipeline benchmark with Deepgram STT wired through Next.js; fixed chat header forwarding so benchmark reports LLM provider/model

**Command**:
```
python3 benchmarking/examples/audio_pipeline_benchmark.py \
  --backend-url http://127.0.0.1:3000 \
  --audio-file coach-up-frontend/docs/voice_sample.webm \
  --language-hint en-US \
  --stt-provider deepgram \
  --runs 3
```

**Settings**: History depth: default, Audio: `docs/voice_sample.webm`, Runs: 3  
**Environment**: Frontend proxy at `http://127.0.0.1:3000`; Backend `http://127.0.0.1:8000` with `AI_CHAT_ENABLED=1`, `AI_CHAT_MODEL=openrouter/google/gemini-2.0-flash-lite-001`. Next.js `ui/src/app/api/chat/route.ts` updated to forward `X-Chat-Provider` and `X-Chat-Model` and expose via CORS.

**Total E2E Time**: p50=16262.4 ms, p95=18327.6 ms  
**Backend Processing**: p50=4383.3 ms, p95=8379.0 ms  
**STT Time**: p50=1649.2 ms, p95=2232.5 ms  
**Chat Time**: p50=2074.3 ms, p95=4629.6 ms  
**TTFT**: p50=1407.9 ms, p95=4006.3 ms  
**TTS Time**: p50=1050.2 ms, p95=1556.0 ms  
**Audio Download**: p50=3.2 ms, p95=16.5 ms  
**Audio Playback**: p50=9216.0 ms, p90=10944.0 ms, p95=11160.0 ms (benchmark heuristic)

Providers/Models (last run):  
- STT: real / model: unknown (Deepgram via Next.js route)  
- LLM: openrouter / google/gemini-2.0-flash-lite-001  
- TTS: google / voice=en-US-Neural2-C / format=audio/mpeg

**Observations**:
- __Header forwarding fixed__: Next.js `api/chat` now forwards `X-Chat-Provider` and `X-Chat-Model`, so benchmark shows `llm=openrouter/google/gemini-2.0-flash-lite-001` instead of `unknown`.
- __Backend latency improved vs earlier run__: p50 backend ~4.38s with TTFT ~1.41s; still variance up to ~8.38s p95 due to chat/STT variance.
- __Playback heuristic inflates E2E__: E2E dominated by fixed 0.5s detection and size-based playback estimate (~9.2s p50). Replace with real detection timing and TTS `durationMs` when available.

  397→**Follow-ups**:
  398→1. Plumb TTS `durationMs` through frontend route to benchmark to replace heuristic playback time.
  399→2. Capture real detection time from `MicContext.tsx` logs and feed into benchmark summary.
  400→3. Experiment with `--history-depth 0..1` and shorter system prompt to reduce chat latency tails.
  401→4. Compare Deepgram vs Google STT latency side-by-side; test direct provider calls vs Next.js proxy to isolate overhead.
  402→
  403→---
  
  ### Benchmark Results - 2025-08-27 (Local, Deepgram STT via Next.js, Google TTS, OpenRouter GLM 4.5 Air)
  
  **Date/Change**: 2025-08-27 - Audio pipeline benchmark with Deepgram STT (Next.js proxy), Google TTS, LLM via OpenRouter GLM 4.5 Air
  
  **Command**:
  ```
  python3 benchmarking/examples/audio_pipeline_benchmark.py \
    --backend-url http://127.0.0.1:3000 \
    --audio-file coach-up-frontend/docs/voice_sample.webm \
    --language-hint en-US \
    --stt-provider deepgram \
    --runs 3
  ```
  
  **Settings**: History depth: default, Audio: `docs/voice_sample.webm`, Runs: 3  
  **Environment**: Frontend proxy at `http://127.0.0.1:3000`; Backend `http://127.0.0.1:8000` with `AI_CHAT_ENABLED=1`, `AI_CHAT_MODEL=openrouter/z-ai/glm-4.5-air:free`.
  
  **Per-run**:
  - Run 01/3: chat_ttft=6144.9 ms, chat_total=6402.3 ms, tts=1335.8 ms, backend_processing=11625.7 ms, e2e=18523.2 ms, stt=deepgram/nova-2, detect=None ms, llm=openrouter/z-ai/glm-4.5-air:free, tts=google
  - Run 02/3: chat_ttft=5442.9 ms, chat_total=5693.9 ms, tts=1168.6 ms, backend_processing=8289.0 ms, e2e=15176.5 ms, stt=deepgram/nova-2, detect=None ms, llm=openrouter/z-ai/glm-4.5-air:free, tts=google
  - Run 03/3: chat_ttft=3998.6 ms, chat_total=5040.0 ms, tts=1428.4 ms, backend_processing=9155.6 ms, e2e=26507.2 ms, stt=deepgram/nova-2, detect=None ms, llm=openrouter/z-ai/glm-4.5-air:free, tts=google
  
  **SUMMARY (ms)**
  - audio_detect_time_ms: min=500.0 max=500.0 p50=500.0 p90=500.0 p95=500.0
  - stt_time_ms: min=1426.5 max=3887.5 p50=2687.0 p90=3647.4 p95=3767.5
  - chat_ttft_ms: min=3998.6 max=6144.9 p50=5442.9 p90=6004.5 p95=6074.7
  - chat_total_ms: min=5040.0 max=6402.3 p50=5693.9 p90=6260.6 p95=6331.5
  - tts_time_ms: min=1168.6 max=1428.4 p50=1335.8 p90=1409.9 p95=1419.2
  - backend_processing_time_ms: min=8289.0 max=11625.7 p50=9155.6 p90=11131.7 p95=11378.7
  - total_e2e_time_ms: min=15176.5 max=26507.2 p50=18523.2 p90=24910.4 p95=25708.8
  
  Providers/Models (last run)
  - STT: deepgram , model: nova-2
  - LLM: openrouter , model: z-ai/glm-4.5-air:free
  - TTS: google , voice: en-US-Neural2-C , format: audio/mpeg
  
  **Observations**:
  - Chat latency notably higher than Gemini Flash Lite (see comparison below); TTFT p50 ~5.44s, total ~5.69s.
  - STT and TTS roughly consistent with other Deepgram/Google runs.
  - E2E inflated by playback heuristic and fixed detect placeholder; prefer runs with real `clientDetectMs` and TTS `durationMs`.
  
  #### LLM Comparison: GLM 4.5 Air vs Gemini Flash Lite (local, Deepgram STT, Google TTS)
  Using the Gemini section above (Deepgram+Gemini; p50 values):
  - Chat TTFT: GLM 4.5 Air ~5443 ms vs Gemini Flash Lite ~1408 ms → Gemini ~3.9× faster TTFT.
  - Chat total: GLM 4.5 Air ~5694 ms vs Gemini Flash Lite ~2074 ms → Gemini ~2.7× faster total chat.
  - Backend p50: GLM 4.5 Air ~9156 ms vs Gemini Flash Lite ~4383 ms → Gemini ~2.1× faster backend.
  
  Takeaway: For conversational latency, Gemini Flash Lite significantly outperforms GLM 4.5 Air on this setup. Keep Gemini for low-latency voice; consider GLM only if quality/availability requirements outweigh latency.
  
  ### Benchmark Results - 2025-08-27 (Local, Google STT via Next.js proxy, TTS skipped)

**Date/Change**: 2025-08-27 - Google STT through Next.js route; TTS disabled to isolate STT+Chat

**Command**:
```
{{ ... }}
python3 benchmarking/examples/audio_pipeline_benchmark.py \
  --backend-url http://127.0.0.1:3000 \
  --audio-file coach-up-frontend/docs/voice_sample.webm \
  --language-hint en-US \
  --stt-provider google \
  --skip-tts \
  --simulate-playback-ms 0 \
  --runs 5
```

**Settings**: History depth: default, Audio: `docs/voice_sample.webm`, Runs: 5  
**Environment**: Frontend proxy at `http://127.0.0.1:3000`; Backend `http://127.0.0.1:8000` with `AI_CHAT_ENABLED=1`; LLM `openrouter/google/gemini-2.0-flash-lite-001`. TTS skipped.

**Total E2E Time**: p50=5104.5 ms, p95=5515.9 ms  
**Backend Processing**: p50=4604.5 ms, p95=5015.9 ms  
**STT Time**: p50=2430.6 ms, p95=2688.2 ms  
**Chat Time**: p50=2303.3 ms, p95=2504.4 ms  
**TTFT**: p50=1466.2 ms, p95=1549.5 ms  
**TTS Time**: p50=0.0 ms, p95=0.0 ms (skipped)  
**Audio Detection**: placeholder 500.0 ms (replace with real MicContext timing)  
**Audio Playback**: 0 ms (skipped)

Providers/Models (last run):  
- STT: real / model: unknown (Google via Next.js route)  
- LLM: openrouter / google/gemini-2.0-flash-lite-001  
- TTS: skipped

**Observations**:
- __STT slower than Deepgram via proxy__: Deepgram p50 ~1649 ms vs Google p50 ~2431 ms on the same sample; chat latency similar across runs.  
- __E2E now reflects backend-only__: With TTS/playback skipped, E2E ≈ detection placeholder (0.5s) + backend (~4.6–5.0s p50–p95).  
- Variance is modest for chat; STT variance narrower than earlier Google STT/TTS run but still material.

**Follow-ups**:
1. __Proxy overhead isolation__: Re-run both providers with direct STT URL `--stt-url http://127.0.0.1:8000/api/v1/stt` and compare p50/p95 vs proxy.
2. __History depth tuning__: Re-run with `--history-depth 0..1` to reduce chat latency further for voice.
3. __Audio format experiment__: Compare input `webm/opus` vs `wav (16 kHz mono)` for provider sensitivity.
4. __Replace detection placeholder__: Instrument `MicContext.tsx` and plumb real detection timing into the benchmark summary.

---

### Benchmark Results - 2025-08-27 (Local, Deepgram vs Google STT via Next.js proxy, TTS skipped)

**Date/Change**: 2025-08-27 - Fresh side-by-side runs via Next.js proxy; TTS disabled

**Commands**:
```
# Deepgram
python3 benchmarking/examples/audio_pipeline_benchmark.py \
  --backend-url http://127.0.0.1:3000 \
  --audio-file coach-up-frontend/docs/voice_sample.webm \
  --language-hint en-US \
  --stt-provider deepgram \
  --skip-tts \
  --simulate-playback-ms 0 \
  --runs 5

# Google
python3 benchmarking/examples/audio_pipeline_benchmark.py \
  --backend-url http://127.0.0.1:3000 \
  --audio-file coach-up-frontend/docs/voice_sample.webm \
  --language-hint en-US \
  --stt-provider google \
  --skip-tts \
  --simulate-playback-ms 0 \
  --runs 5
```

**Settings**: History depth: default, Audio: `docs/voice_sample.webm`, Runs: 5 each  
**Environment**: Frontend proxy at `http://127.0.0.1:3000`; Backend `http://127.0.0.1:8000` with `AI_CHAT_ENABLED=1`; LLM `openrouter/google/gemini-2.0-flash-lite-001`. TTS skipped.

__Deepgram (p50/p95, ms)__
- **STT**: 1845.5 / 2091.4
- **Chat total**: 3068.9 / 3098.3
- **Chat TTFT**: 2147.3 / 2394.4
- **Backend processing**: 4914.3 / 5085.2
- **E2E**: 5414.3 / 5585.2

__Google (p50/p95, ms)__
- **STT**: 2870.6 / 3336.6
- **Chat total**: 2076.9 / 2320.2
- **Chat TTFT**: 1350.9 / 1483.4
- **Backend processing**: 4915.3 / 5464.6
- **E2E**: 5415.3 / 5964.6

Providers/Models (both):  
- STT: real via Next.js route (model reported unknown)  
- LLM: openrouter / google/gemini-2.0-flash-lite-001  
- TTS: skipped

**Observations**:
- __Deepgram faster on STT__: ~1.85s vs ~2.87s p50; ~1.0s advantage.  
- __Google faster on chat__: ~2.08s vs ~3.07s p50; however backend p50 similar (~4.91s) because stages trade off.  
- __E2E close__: ~5.41s Deepgram vs ~5.42s Google p50 with TTS skipped; E2E includes 0.5s detection placeholder.

**Follow-ups**:
1. Consider provider selection by context: Deepgram for faster transcription; keep Gemini Flash Lite for low chat latency.  
2. Capture real detection timing in `ui/src/context/MicContext.tsx` to replace the 500 ms placeholder.  
3. Add model names to STT metrics/logs in Next.js route to surface provider model versions.  
4. Repeat with `--history-depth 0..1` to see if chat p50 converges further.

---

### Benchmark Results - 2025-08-27 (Local, Deepgram STT via Next.js proxy, TTS skipped, detect-ms=120, runs=15)

**Command**:
```
python benchmarking/examples/audio_pipeline_benchmark.py \
  --backend-url http://localhost:3000 \
  --audio-file coach-up-frontend/docs/voice_sample.webm \
  --runs 15 \
  --skip-tts \
  --detect-ms 120
```

**Settings**: History depth: default, Audio: `docs/voice_sample.webm`, Runs: 15  
**Environment**: Frontend proxy at `http://localhost:3000`; Backend `http://127.0.0.1:8000` with `AI_CHAT_ENABLED=1`, `AI_CHAT_MODEL=openrouter/google/gemini-2.0-flash-lite-001`.

**Total E2E Time**: p50=13907.0 ms, p90=20091.1 ms, p95=20521.4 ms  
**Backend Processing**: p50=5787.0 ms, p90=11971.1 ms, p95=12401.4 ms  
**STT Time**: p50=2349.0 ms, p90=8552.5 ms, p95=8850.4 ms  
**Chat Time**: p50=3075.6 ms, p90=3988.5 ms, p95=4882.3 ms  
**TTFT**: p50=2274.5 ms, p90=3322.9 ms, p95=4033.1 ms  
**TTS Time**: p50=0.0 ms, p95=0.0 ms (skipped)  
**Audio Detection**: fixed 120.0 ms (from `--detect-ms`)  
**Audio Playback**: fixed 8000.0 ms (benchmark heuristic)

Providers/Models (last run):  
- STT: deepgram / model: nova-2  
- LLM: openrouter / google/gemini-2.0-flash-lite-001  
- TTS: skipped

**Observations**:
- **One 500 during run 14**: `GET /api/v1/stt` returned 500 once; consider capturing provider error details in Next.js route logs for diagnosis.
- **Backend variance tails**: p90/p95 driven by STT spikes; chat remains moderate.
- **E2E dominated by playback heuristic** when TTS is skipped; use real detection + playback where available.

---

### Benchmark Results - 2025-08-27 (Local, Deepgram STT via Next.js proxy, Google TTS, detect-ms=120, runs=5)

**Command**:
```
python benchmarking/examples/audio_pipeline_benchmark.py \
  --backend-url http://localhost:3000 \
  --audio-file coach-up-frontend/docs/voice_sample.webm \
  --runs 5 \
  --detect-ms 120
```

**Settings**: History depth: default, Audio: `docs/voice_sample.webm`, Runs: 5  
**Environment**: Frontend proxy at `http://localhost:3000`; Backend `http://127.0.0.1:8000`; TTS=Google (voice `en-US-Neural2-C`, format `audio/mpeg`); LLM `openrouter/google/gemini-2.0-flash-lite-001`.

**Total E2E Time**: p50=19805.0 ms, p90=23891.0 ms, p95=24619.6 ms  
**Backend Processing**: p50=6690.3 ms, p90=14261.5 ms, p95=15725.1 ms  
**STT Time**: p50=2459.4 ms, p90=7707.0 ms, p95=8678.4 ms  
**Chat Time**: p50=2805.4 ms, p90=3670.0 ms, p95=3677.5 ms  
**TTFT**: p50=1572.5 ms, p90=2850.8 ms, p95=2960.9 ms  
**TTS Time**: p50=1864.2 ms, p90=3072.0 ms, p95=3462.9 ms  
**Audio Download**: p50=3.3 ms, p90=11.0 ms, p95=11.3 ms  
**Audio Playback**: p50=9804.0 ms, p90=13941.6 ms, p95=14416.8 ms (benchmark heuristic)

Providers/Models (last run):  
- STT: deepgram / model: nova-2  
- LLM: openrouter / google/gemini-2.0-flash-lite-001  
- TTS: google / voice=en-US-Neural2-C / format=audio/mpeg

**Observations**:
- **Playback dominates E2E** with heuristic; backend p50 ~6.7s, tails driven by STT and TTS.
- **Download negligible**; focus on reducing STT/TTS variance and chat tails.

---

### Benchmark Results - 2025-08-27 (Local, Deepgram STT via Next.js proxy, Google TTS, detect-ms=120, language-hint en-US, runs=5)

**Command**:
```
python benchmarking/examples/audio_pipeline_benchmark.py \
  --backend-url http://localhost:3000 \
  --audio-file coach-up-frontend/docs/voice_sample.webm \
  --runs 5 \
  --detect-ms 120 --language-hint en-US
```

**Settings**: History depth: default, Audio: `docs/voice_sample.webm`, Runs: 5  
**Environment**: Frontend proxy at `http://localhost:3000`; Backend `http://127.0.0.1:8000`; TTS=Google; LLM `openrouter/google/gemini-2.0-flash-lite-001`.

**Total E2E Time**: p50=13489.6 ms, p90=20246.6 ms, p95=21605.1 ms  
**Backend Processing**: p50=4994.2 ms, p90=8204.8 ms, p95=8580.8 ms  
**STT Time**: p50=2145.2 ms, p90=3627.1 ms, p95=3630.5 ms  
**Chat Time**: p50=2304.1 ms, p90=2982.3 ms, p95=3179.8 ms  
**TTFT**: p50=1650.6 ms, p90=2235.2 ms, p95=2347.7 ms  
**TTS Time**: p50=1053.4 ms, p90=1631.7 ms, p95=1797.0 ms  
**Audio Download**: p50=3.9 ms, p90=7.7 ms, p95=8.8 ms  
**Audio Playback**: p50=7560.0 ms, p90=13010.4 ms, p95=13447.2 ms (benchmark heuristic)

Providers/Models (last run):  
- STT: deepgram / model: nova-2  
- LLM: openrouter / google/gemini-2.0-flash-lite-001  
- TTS: google / voice=en-US-Neural2-C / format=audio/mpeg

**Observations**:
- **Language hint seems beneficial** vs previous 5-run set: lower STT and backend p50s in this sample; re-run with larger N to confirm.

---

## Interpreting New Timing Fields (STT/TTS)

- **clientDetectMs (STT)**
  - Source: `/api/v1/stt` response field `clientDetectMs` (forwarded from frontend header `x-detect-ms`).
  - Meaning: Real user-side voice detection time captured in `ui/src/context/MicContext.tsx` between first recorder start and first audio chunk timestamp.
  - Use in benchmarks: The script `benchmarking/examples/audio_pipeline_benchmark.py` sends `--detect-ms` to forward this value and records it as `audio_detect_time_ms`. Prefer real values from the browser when validating E2E.

- **durationMs (TTS)**
  - Source: `/api/v1/tts` response field `durationMs` provided by the TTS provider.
  - Meaning: Exact playback duration of the generated audio in milliseconds.
  - Use in benchmarks: The script reads `durationMs` and uses it directly as `playback_time_ms` when available. If absent, it falls back to a capped heuristic estimate; prefer runs where `durationMs` is present for accurate E2E.

- **Guidance**
  - When comparing E2E metrics across runs, ensure both `audio_detect_time_ms` and `playback_time_ms` come from real values (`clientDetectMs`, `durationMs`) to avoid inflation from heuristics.
  - Include provider/model identifiers returned by STT (`provider`, `model`) and TTS (`provider`, `voiceId`, `format`) in result notes to attribute latency changes.

---

### Benchmark Results - 2025-08-27 (Local, Deepgram STT via Next.js proxy, Google TTS, detect-ms=120, language-hint en-US, runs=10)

**Command**:
```
python benchmarking/examples/audio_pipeline_benchmark.py \
  --backend-url http://localhost:3000 \
  --audio-file coach-up-frontend/docs/voice_sample.webm \
  --runs 10 \
  --detect-ms 120 \
  --language-hint en-US
```

**Settings**: History depth: default, Audio: `docs/voice_sample.webm`, Runs: 10  
**Environment**: Frontend proxy at `http://localhost:3000`; Backend `http://127.0.0.1:8000`; TTS=Google (voice `en-US-Neural2-C`, format `audio/mpeg`); LLM `openrouter/google/gemini-2.0-flash-lite-001`.

**Total E2E Time**: p50=13419.8 ms, p90=21133.9 ms, p95=22693.5 ms  
**Backend Processing**: p50=5116.5 ms, p90=13841.8 ms, p95=13978.5 ms  
**STT Time**: p50=1502.1 ms, p90=9484.2 ms, p95=9618.0 ms  
**Chat Time**: p50=2413.1 ms, p90=2764.8 ms, p95=2766.9 ms  
**TTFT**: p50=1401.5 ms, p90=2125.8 ms, p95=2136.5 ms  
**TTS Time**: p50=1294.4 ms, p90=1925.8 ms, p95=2005.0 ms  
**Audio Download**: p50=3.4 ms, p90=9.5 ms, p95=9.7 ms  
**Audio Detection**: fixed 120.0 ms (from `--detect-ms`)  
**Audio Playback**: p50=7500.0 ms, p90=9975.6 ms, p95=9991.8 ms (heuristic)

Providers/Models (last run):  
- STT: deepgram / model: nova-2  
- LLM: openrouter / google/gemini-2.0-flash-lite-001  
- TTS: google / voice=en-US-Neural2-C / format=audio/mpeg

**Observations**:
- **Playback heuristic dominates E2E**: `durationMs` was not consumed; playback relied on heuristic, inflating E2E.
- **STT long-tail outliers**: p90/p95 show intermittent spikes; consider additional STT logging and model/config checks.
- **Chat remains moderate**: TTFT and total chat times are consistent with prior runs.

---

### Benchmark Results - 2025-08-27 (Local, Deepgram STT via Next.js proxy, TTS skipped, simulate-playback=3000 ms, detect-ms=120, language-hint en-US, runs=10)

**Command**:
```
python benchmarking/examples/audio_pipeline_benchmark.py \
  --backend-url http://localhost:3000 \
  --audio-file coach-up-frontend/docs/voice_sample.webm \
  --runs 10 \
  --skip-tts \
  --simulate-playback-ms 3000 \
  --detect-ms 120 \
  --language-hint en-US
```

**Settings**: History depth: default, Audio: `docs/voice_sample.webm`, Runs: 10  
**Environment**: Frontend proxy at `http://localhost:3000`; Backend `http://127.0.0.1:8000`; TTS skipped; LLM `openrouter/google/gemini-2.0-flash-lite-001`.

**Total E2E Time**: p50=7830.9 ms, p90=8530.8 ms, p95=8907.4 ms  
**Backend Processing**: p50=4710.9 ms, p90=5410.8 ms, p95=5787.4 ms  
**STT Time**: p50=2100.5 ms, p90=2427.0 ms, p95=2606.1 ms  
**Chat Time**: p50=2687.5 ms, p90=3193.6 ms, p95=3286.2 ms  
**TTFT**: p50=1884.2 ms, p90=2468.4 ms, p95=2513.0 ms  
**TTS Time**: p50=0.0 ms, p90=0.0 ms, p95=0.0 ms (skipped)  
**Audio Download**: p50=0.0 ms, p90=0.0 ms, p95=0.0 ms  
**Audio Detection**: fixed 120.0 ms (from `--detect-ms`)  
**Audio Playback**: fixed 3000.0 ms (simulate-playback)

Providers/Models (last run):  
- STT: deepgram / model: nova-2  
- LLM: openrouter / google/gemini-2.0-flash-lite-001  
- TTS: skipped

**Observations**:
- **Backend performance isolated**: p50 ~4.7s; tails reasonable.
- **STT tails controlled**: No extreme outliers this run; language hint may help stability.
- **Useful baseline**: Good for comparing chat/LLM latencies independent of TTS variance.

---