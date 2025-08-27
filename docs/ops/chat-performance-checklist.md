# End-to-End Audio Pipeline Performance Checklist

This checklist tracks optimizations and measurements for the complete audio pipeline from **audio detection to audio playback** in the voice interface. The full pipeline includes:

1. **Audio Detection** (MicContext.tsx): Recording start → speech capture → recording stop
2. **Backend Processing**: STT → Chat LLM → TTS audio generation  
3. **Audio Playback**: TTS audio download → playback start → playback complete

Use the e2e audio pipeline benchmark in `benchmarking/examples/audio_pipeline_benchmark.py` and the test in `benchmarking/tests/test_audio_pipeline_e2e.py` to collect timing data. Record results after each change.

---

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

## How to Measure
1. Backend running locally at `http://127.0.0.1:8000` with `AI_CHAT_ENABLED=1`.
2. Install benchmarking deps (see `benchmarking/requirements.txt`).
3. Run benchmark (5–10 iterations):
   - `python benchmarking/examples/audio_pipeline_benchmark.py --runs 5 --audio-file test_audio.wav`
4. Capture outputs:
   - TTFT p50/p95, Total p50/p95 printed and saved to `benchmarking/results/audio_pipeline/`.
5. Re-run after each optimization and append notes below.

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
