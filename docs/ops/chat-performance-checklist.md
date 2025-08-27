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
