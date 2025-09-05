"use client";

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useMinimalVoice } from "./MinimalVoiceContext";
import { useMinimalAudio } from "./MinimalAudioContext";
import { useMinimalConversation } from "./MinimalConversationContext";
import { useMinimalSession } from "./MinimalSessionContext";
import { fetchWithRetry } from "../../app/api/lib/retry";

export type MinimalMicContextValue = {
  recording: boolean;
  transcript: string;
  assistantText: string;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  status: "idle" | "audio" | "stt" | "chat" | "tts" | "playback";
  vadLoop: boolean;
  toggleVadLoop: () => void;
  inputSpeaking: boolean;
  // Advanced VAD features
  triggerVadCalibration: () => void;
  resetVadState: () => void;
  getVadCalibrationData: () => any;
};

const Ctx = createContext<MinimalMicContextValue | undefined>(undefined);

export function useMinimalMic() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useMinimalMic must be used within MinimalMicProvider");
  return ctx;
}

export function MinimalMicProvider({
  children,
  userProfile,
  userGoals,
  customSystemPrompt,
  model,
  onModelChange
}: {
  children: React.ReactNode;
  userProfile?: any;
  userGoals?: any[];
  customSystemPrompt?: string;
  model?: string;
  onModelChange?: (model: string, provider: string) => void;
}) {

  const voice = useMinimalVoice();
  const audio = useMinimalAudio();
  const convo = useMinimalConversation();
  const { sessionId, ensureFreshSession } = useMinimalSession();


  const sessionIdRef = useRef<string | null>(null);
  React.useEffect(() => { sessionIdRef.current = sessionId || null; }, [sessionId]);

  // Refs to track current profile/goals for use in async callbacks
  const userProfileRef = useRef<any>(null);
  const userGoalsRef = useRef<any[]>([]);
  const customSystemPromptRef = useRef<string>("");
  const modelRef = useRef<string>("");

  // Update refs when props change
  React.useEffect(() => {
    userProfileRef.current = userProfile;
    userGoalsRef.current = userGoals || [];
    customSystemPromptRef.current = customSystemPrompt || "";
    modelRef.current = model || "";
  }, [userProfile, userGoals, customSystemPrompt, model]);
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [assistantText, setAssistantText] = useState("");
  const [status, setStatus] = useState<"idle" | "audio" | "stt" | "chat" | "tts" | "playback">("idle");
  const [vadLoop, setVadLoop] = useState(false);
  const [inputSpeaking, setInputSpeaking] = useState(false);
  const mediaRef = useRef<MediaRecorder | null>(null);

  // Advanced VAD Calibration System (component-level state)
  const [calibrationData, setCalibrationData] = useState({
    voiceProfile: {
      avgEnergy: 0.02,
      peakEnergy: 0.08,
      noiseFloor: 0.005,
      samples: 0
    },
    environmentProfile: {
      backgroundNoise: 0.01,
      echoLevel: 0,
      lastCalibration: 0
    },
    performance: {
      falsePositives: 0,
      falseNegatives: 0,
      totalDetections: 0,
      accuracy: 1.0
    }
  });

  // Load calibration data from localStorage
  React.useEffect(() => {
    try {
      const savedCalibration = localStorage.getItem('cu.vad.calibration');
      if (savedCalibration) {
        setCalibrationData(JSON.parse(savedCalibration));
      }
    } catch {}
  }, []);

  // Calibration management functions
  const saveCalibrationData = React.useCallback(() => {
    try {
      localStorage.setItem('cu.vad.calibration', JSON.stringify({
        ...calibrationData,
        timestamp: Date.now()
      }));
    } catch {}
  }, [calibrationData]);

  const updateCalibrationData = React.useCallback((updates: Partial<typeof calibrationData>) => {
    setCalibrationData(prev => ({ ...prev, ...updates }));
  }, []);

  const triggerVadCalibration = React.useCallback(() => {
    // Manual VAD calibration triggered
    // Reset calibration data to force recalibration
    setCalibrationData({
      voiceProfile: {
        avgEnergy: 0.02,
        peakEnergy: 0.08,
        noiseFloor: 0.005,
        samples: 0
      },
      environmentProfile: {
        backgroundNoise: 0.01,
        echoLevel: 0,
        lastCalibration: Date.now()
      },
      performance: {
        falsePositives: 0,
        falseNegatives: 0,
        totalDetections: 0,
        accuracy: 1.0
      }
    });
    try {
      localStorage.setItem('cu.vad.force_calibration', 'true');
    } catch {}
  }, []);

  const resetVadState = React.useCallback(() => {
    // VAD state reset triggered
    // Reset calibration data
    try {
      localStorage.removeItem('cu.vad.calibration');
      localStorage.removeItem('cu.vad.force_calibration');
    } catch {}
    setCalibrationData({
      voiceProfile: {
        avgEnergy: 0.02,
        peakEnergy: 0.08,
        noiseFloor: 0.005,
        samples: 0
      },
      environmentProfile: {
        backgroundNoise: 0.01,
        echoLevel: 0,
        lastCalibration: 0
      },
      performance: {
        falsePositives: 0,
        falseNegatives: 0,
        totalDetections: 0,
        accuracy: 1.0
      }
    });
  }, []);

  const getVadCalibrationData = React.useCallback(() => {
    return calibrationData;
  }, [calibrationData]);


  const streamRef = useRef<MediaStream | null>(null);
  const vadLoopRef = useRef<boolean>(false);
  React.useEffect(() => { vadLoopRef.current = vadLoop; }, [vadLoop]);
  const vadNodesRef = useRef<{ ac: AudioContext | null; src: MediaStreamAudioSourceNode | null; analyser: AnalyserNode | null } | null>(null);
  const skipSttOnStopRef = useRef<boolean>(false);
  const startingRef = useRef<boolean>(false);
  const playbackActiveRef = useRef<boolean>(false);
  React.useEffect(() => { playbackActiveRef.current = audio.isPlaybackActive; }, [audio.isPlaybackActive]);
  const pendingPlaybackRef = useRef<boolean>(false);
  React.useEffect(() => {
    if (audio.isPlaybackActive) {
      pendingPlaybackRef.current = false;
      if (status === "tts") setStatus("playback");
    } else {
      // When playback ends naturally, if we're looping/recording, return to audio
      if (status === "playback" && (recording || vadLoopRef.current)) setStatus("audio");
    }
  }, [audio.isPlaybackActive, status, recording]);
  const ttsActiveRef = useRef<boolean>(false);
  React.useEffect(() => {
    ttsActiveRef.current = (status === "tts" || status === "playback");
    // Check TTS/playback state
  }, [status]);
  const bargeInActiveRef = useRef<boolean>(false);
  const resumeAfterBargeInRef = useRef<boolean>(false);

  const stopRecording = useCallback(() => {
    // Stop recording called
    setRecording(false);
    setInputSpeaking(false);
    try {
      const rec = mediaRef.current;
      if (rec && rec.state === "recording") rec.stop();
      mediaRef.current = null;
    } catch {}
    try {
      const s = streamRef.current;
      s?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    } catch {}
    try {
      const n = vadNodesRef.current;
      if (n?.src) { try { n.src.disconnect(); } catch {} }
      if (n?.analyser) { try { n.analyser.disconnect(); } catch {} }
      if (n?.ac) { try { n.ac.close(); } catch {} }
      vadNodesRef.current = null;
    } catch {}
    bargeInActiveRef.current = false;
  }, []);

  const cancelCurrentCapture = useCallback(() => {
    skipSttOnStopRef.current = true;
    // Cancel current capture
    try { stopRecording(); } catch {}
  }, [stopRecording]);

  const startRecordingInternal = useCallback(async (forceVad: boolean = false) => {
    if (recording || startingRef.current) return;
    try {
      startingRef.current = true;
      // Ensure session freshness before starting a new capture/turn
      try { await ensureFreshSession(); } catch {}
      // Start recording
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      mediaRef.current = rec;
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) chunks.push(ev.data); };
      rec.onstop = async () => {
        try {
          // Onstop fired
          // Reflect capture ended immediately
          setRecording(false);
          // Ensure the media stream is torn down between turns
          try {
            const s = streamRef.current;
            s?.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
          } catch {}
          const shouldSkip = skipSttOnStopRef.current;
          const blob = new Blob(chunks, { type: "audio/webm" });
          if (blob.size === 0) { return; }
          if (!shouldSkip) {
            setStatus("stt");
            const { text } = await voice.sttFromBlob(blob, sessionIdRef.current || undefined);
            setTranscript(text);
            if (!text || text.trim().length === 0) {
              try { console.warn("MinimalMic: STT returned empty text"); } catch {}
            }
            setStatus("chat");

            const chatOptions = {
              userProfile: userProfileRef.current,
              userGoals: userGoalsRef.current,
              customSystemPrompt: customSystemPromptRef.current && customSystemPromptRef.current.trim() ? customSystemPromptRef.current.trim() : undefined,
              model: modelRef.current && modelRef.current.trim() ? modelRef.current.trim() : undefined,
              onModelUsed: (model: string, provider: string) => {
                // Update the model if it differs from current selection
                if (model && model !== modelRef.current && onModelChange) {
                  console.log(`[MinimalMic] Model updated from ${modelRef.current} to ${model}`);
                  onModelChange(model, provider);
                }
              }
            };


            // REMOVED: Non-streaming call that was causing race condition
            // const reply = await convo.chatToText(text, chatOptions);
            // Chat processing complete
            // Note: User interactions are now handled by STT route, assistant interactions by AI API
            // No need to persist interactions here to avoid duplicates
            setStatus("tts");
            try { voice.cancelTTS?.(); } catch {}

            // Use streaming TTS instead of waiting for full response
            let accumulatedText = "";
            let chunkCount = 0;
            const onChunk = (chunk: string) => {
              accumulatedText += chunk;
              chunkCount++;
              // Process chunk for TTS immediately (sentence-based)
              void voice.enqueueTTSChunk?.(chunk);
            };

            // Get streaming response
            const streamingOptions = {
              userProfile: userProfileRef.current,
              userGoals: userGoalsRef.current,
              customSystemPrompt: customSystemPromptRef.current && customSystemPromptRef.current.trim() ? customSystemPromptRef.current.trim() : undefined,
              model: modelRef.current && modelRef.current.trim() ? modelRef.current.trim() : undefined,
              onModelUsed: (model: string, provider: string) => {
                // Update the model if it differs from current selection
                if (model && model !== modelRef.current && onModelChange) {
                  console.log(`[MinimalMic] Model updated from ${modelRef.current} to ${model}`);
                  onModelChange(model, provider);
                }
              }
            };

            // Starting streaming chat with history

            // Use chatToTextStreaming to avoid duplicate user interactions (STT route handles user interactions)
            console.log("MinimalMic: Calling chatToTextStreaming", { text: text.substring(0, 50), sessionId: sessionIdRef.current });
            const streamingReply = await convo.chatToTextStreaming(text, onChunk, { ...streamingOptions, sessionId: sessionIdRef.current || undefined });
            console.log("MinimalMic: chatToTextStreaming completed", { reply: streamingReply?.substring(0, 50) });

            // Manually update conversation history since we're not using the "WithHistory" version
            try {
              const history = convo.getImmediateHistory();
              history.push({ role: "user", content: text });
              history.push({ role: "assistant", content: streamingReply });
              // Keep only last 2 messages
              if (history.length > 2) {
                history.splice(0, history.length - 2);
              }
            } catch {}

            // Streaming chat completed

            // Final TTS for any remaining text (in case streaming missed some)
            if (accumulatedText && accumulatedText !== streamingReply) {
              try { void voice.enqueueTTSChunk?.(streamingReply.slice(accumulatedText.length)); } catch {}
            }

            setAssistantText(streamingReply);

            // Note: Assistant interactions are now handled by AI API service
            // No need to persist interactions here to avoid duplicates

            // Ensure concurrent capture during playback for barge-in
            if (vadLoopRef.current && !recording) { try { void startRecordingInternal(true); } catch {} }
          }
        } catch {}
        finally {
          if (!vadLoopRef.current) setStatus("idle");
          skipSttOnStopRef.current = false;
          bargeInActiveRef.current = false;
          if (resumeAfterBargeInRef.current && vadLoopRef.current && !recording) {
            resumeAfterBargeInRef.current = false;
            // Restart capture after barge-in
            try { void startRecordingInternal(true); } catch {}
          }
        }
      };
      rec.start(100);
      setRecording(true);
      // If playback is ongoing or pending, do not flip to audio; otherwise show audio
      if (!audio.isPlaybackActive && !pendingPlaybackRef.current) { setStatus("audio"); }
      // Recording started
      startingRef.current = false;
      const useVad = forceVad || vadLoopRef.current;
      if (useVad) {
        try {
          const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
          const src = ac.createMediaStreamSource(stream);
          const analyser = ac.createAnalyser();
          analyser.fftSize = 2048;
          src.connect(analyser);
          vadNodesRef.current = { ac, src, analyser };
          const data = new Uint8Array(analyser.fftSize);
          let silenceMs = 0;
          let hasSpeech = false;
          let speechMs = 0;
          let noiseFloor = calibrationData.voiceProfile.noiseFloor;
          let sampleCount = 0; // Track samples for noise floor adaptation

          // Calibration update function (uses component-level state)
          const updateCalibration = (energy: number, wasSpeech: boolean) => {
            setCalibrationData(prevData => {
              const newSamples = prevData.voiceProfile.samples + 1;
              const alpha = 1.0 / Math.min(newSamples, 100); // Adaptive learning rate

              const newData = { ...prevData };
              newData.voiceProfile.samples = newSamples;

              if (wasSpeech) {
                // Update voice profile for successful speech detection
                newData.voiceProfile.avgEnergy =
                  prevData.voiceProfile.avgEnergy * (1 - alpha) + energy * alpha;
                newData.voiceProfile.peakEnergy =
                  Math.max(prevData.voiceProfile.peakEnergy, energy);
                newData.performance.totalDetections = prevData.performance.totalDetections + 1;
              } else if (energy > prevData.voiceProfile.avgEnergy * 0.5) {
                // Update background noise profile
                newData.environmentProfile.backgroundNoise =
                  prevData.environmentProfile.backgroundNoise * (1 - alpha * 0.1) + energy * (alpha * 0.1);
              }

              return newData;
            });
          };


          const baseSpeechThreshold = 0.025; // Lower base threshold for better sensitivity
          const playbackSpeechThreshold = 0.03; // lower to recognize speech over playback
          const silenceThreshold = 0.012; // end-of-speech threshold
          const minSpeechMsBase = 80;   // ≥80ms voiced frames when idle (support short words)
          const minSpeechMsPlayback = 200; // ≥200ms voiced frames during playback
          const debounceMs = 30; // extra debounce before barge-in
          const endSilenceMs = 700; // stop after ~0.7s silence following speech
          // VAD loop started
          const tick = () => {
            // Use recorder state and vadLoopRef to avoid stale React state in closure
            if (rec.state !== "recording" || !vadLoopRef.current) return;

            try {
              analyser.getByteTimeDomainData(data);

            // Optimized RMS calculation: focus on speech frequencies with efficient downsampling
            let sum = 0;
            let maxAmplitude = 0;
            const speechBandEnd = Math.floor(data.length * 0.3); // Focus on lower 30% of spectrum (speech frequencies)
            const stepSize = Math.max(1, Math.floor(speechBandEnd / 256)); // Adaptive step size for efficiency

            for (let i = 0; i < speechBandEnd; i += stepSize) {
              const v = (data[i] - 128) / 128;
              const absV = Math.abs(v);
              sum += v * v;
              if (absV > maxAmplitude) maxAmplitude = absV;
            }

            // Use combination of RMS and peak amplitude for better speech detection
            const rmsSampleCount = Math.ceil(speechBandEnd / stepSize);
            const rms = Math.sqrt(sum / rmsSampleCount);
            const combinedEnergy = Math.max(rms, maxAmplitude * 0.7); // Weight peak amplitude

            // Adaptive noise floor: update slowly over first 20 samples
            sampleCount++;
            if (sampleCount <= 20) {
              noiseFloor = noiseFloor * 0.95 + combinedEnergy * 0.05; // Slower adaptation for first samples
            } else {
              // Gradual adaptation to changing noise levels
              noiseFloor = noiseFloor * 0.995 + combinedEnergy * 0.005;
            }
            const isPlayback = ttsActiveRef.current || playbackActiveRef.current || pendingPlaybackRef.current;
            const speechThreshold = isPlayback ? playbackSpeechThreshold : baseSpeechThreshold;

            // Advanced adaptive threshold with calibration data
            let adaptiveThreshold;
            if (sampleCount <= 5) {
              // For first 5 samples, use base threshold (don't let noise floor inflate threshold yet)
              adaptiveThreshold = speechThreshold;
            } else {
              // Use calibrated thresholds when available
              const calibratedThreshold = calibrationData.voiceProfile.avgEnergy * 0.8; // 80% of average voice energy
              const noiseAdjustedThreshold = Math.max(
                calibrationData.environmentProfile.backgroundNoise * 3.0, // 3x background noise
                0.012 // Absolute minimum
              );

              adaptiveThreshold = Math.max(
                speechThreshold,
                Math.min(
                  Math.max(calibratedThreshold, noiseAdjustedThreshold),
                  speechThreshold * 1.5 // Cap at 1.5x base threshold
                ),
                0.015 // Absolute minimum threshold
              );
            }

            // Barge-in specific thresholds (more sensitive during playback)
            let bargeInThreshold, bargeInImmediateThreshold;
            if (isPlayback) {
              bargeInThreshold = speechThreshold * 0.8; // Lower threshold for barge-in (more sensitive)
              bargeInImmediateThreshold = speechThreshold * 1.8; // Lower immediate threshold for barge-in
            } else {
              bargeInThreshold = speechThreshold;
              bargeInImmediateThreshold = speechThreshold * 2.5;
            }

            // Immediate detection for very high energy spikes (likely speech starts)
            const isImmediateSpeech = combinedEnergy > bargeInImmediateThreshold;

            const minSpeechMs = isPlayback ? minSpeechMsPlayback : minSpeechMsBase;
            const incMs = 100;
            const decMs = isPlayback ? 30 : 30; // slower decay so intermittent speech accumulates

            // Use barge-in optimized thresholds during playback
            const effectiveThreshold = isPlayback ? Math.min(adaptiveThreshold, bargeInThreshold) : adaptiveThreshold;

            // VAD sample processing (debug logs removed for cleaner output)

            if (!hasSpeech) {
              const before = speechMs;

              // Immediate speech detection for very high energy spikes (fast first-word detection)
              if (isImmediateSpeech) {
                speechMs += incMs * 2; // Double increment for immediate detection
                // Immediate speech detected
              } else if (combinedEnergy > effectiveThreshold) {
                speechMs += incMs;
                          } else {
              speechMs = Math.max(0, speechMs - decMs);

              // Update calibration for non-speech samples (background noise learning)
              if (sampleCount > 10 && combinedEnergy < adaptiveThreshold * 0.5) {
                updateCalibration(combinedEnergy, false);
              }
            }

            // Periodic calibration save (every 1000 samples)
            if (sampleCount > 0 && sampleCount % 1000 === 0) {
              saveCalibrationData();
            }

            // removed noisy VAD accumulator log
            const requiredMs = isImmediateSpeech ? 20 : minSpeechMs + debounceMs; // Very fast (20ms) for immediate detection
              if (speechMs >= requiredMs) {
                hasSpeech = true; silenceMs = 0;

                // Update calibration with successful speech detection
                updateCalibration(combinedEnergy, true);

                // Barge-in path
                if (isPlayback) {
                  bargeInActiveRef.current = true;
                  skipSttOnStopRef.current = true;
                  resumeAfterBargeInRef.current = true;
                  try { voice.cancelTTS?.(); } catch {}
                  // Stop audio for barge-in
                  try { audio.stop?.(); } catch {}
                  // Barge-in speech start detected
                  // Switch to audio immediately for barge-in and clear pending playback marker
                  try { pendingPlaybackRef.current = false; } catch {}
                  try { setStatus("audio"); } catch {}
                  // Stop current recorder to flush and then restart fresh capture in onstop
                  try { if (rec.state === "recording") rec.stop(); } catch {}
                  return;
                } else {
                  // Speech start detected (no playback)
                }
                try { setInputSpeaking(true); } catch {}
              }
            }
            // Optimized silence detection with adaptive hysteresis
            const speechHysteresis = isPlayback ? 0.003 : 0.005; // Tighter hysteresis during playback
            const clearSpeechThreshold = (isPlayback ? Math.min(adaptiveThreshold, bargeInThreshold) : adaptiveThreshold) + speechHysteresis;

            if (hasSpeech && combinedEnergy < silenceThreshold) {
              silenceMs += 100;
              if (silenceMs === 300) {
                // Accumulating silence
              }
            } else if (hasSpeech && combinedEnergy >= clearSpeechThreshold) {
              // Only reset silence counter if speech clearly exceeds threshold (hysteresis)
              silenceMs = 0;
            }
            const endSil = bargeInActiveRef.current ? 400 : endSilenceMs;
            if (hasSpeech && silenceMs >= endSil) {
              // End of speech detected
              try { setInputSpeaking(false); } catch {}
              try { if (rec.state === "recording") { try { rec.requestData?.(); } catch {} rec.stop(); } } catch {}
              return;
            }
              window.setTimeout(tick, 100);
            } catch (error) {
              // Error recovery mechanism
              try { console.warn("MinimalMic: VAD error", error); } catch {}
              window.setTimeout(tick, 100);
            }
          };
          window.setTimeout(tick, 100);
        } catch (error) {
          console.error("MinimalMic: Failed to start recording", error);
        }
      }

      // Save calibration data when VAD stops
      try {
        saveCalibrationData();
        // VAD stopped, calibration saved
      } catch {}
    } catch (error) {
      console.error("MinimalMic: Failed to start recording", error);
    }
    finally {
      // If we failed before rec.start, clear starting state
      startingRef.current = false;
    }
  }, [recording, voice, convo]);

  const startRecording = useCallback(async () => {
    return startRecordingInternal(false);
  }, [startRecordingInternal]);

  const value = useMemo<MinimalMicContextValue>(() => ({
    recording,
    transcript,
    assistantText,
    startRecording,
    stopRecording,
    vadLoop,
    toggleVadLoop: () => {
      // Toggle VAD loop
      const next = !vadLoop;
      setVadLoop(next);
      // VAD loop state changed
      if (next) {
        if (!recording && !startingRef.current) { try { void startRecordingInternal(true); } catch {} }
      } else {
        if (recording) { try { cancelCurrentCapture(); } catch {} }
      }
    },
    status,
    inputSpeaking,
    // Advanced VAD features
    triggerVadCalibration,
    resetVadState,
    getVadCalibrationData,
  }), [recording, transcript, assistantText, startRecording, stopRecording, vadLoop, status, inputSpeaking, triggerVadCalibration, resetVadState, getVadCalibrationData]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}


