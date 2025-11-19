"use client";

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useMinimalVoice } from "./MinimalVoiceContext";
import { useMinimalAudio } from "./MinimalAudioContext";
import { useMinimalConversation } from "./MinimalConversationContext";
import { useMinimalSession } from "./MinimalSessionContext";
import { useVoiceChatEngine } from "../engine/useVoiceChatEngine";
import { devLog } from "../../app/api/lib/observability";

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
  // Manual chat integration
  setTranscript: (text: string) => void;
  setAssistantText: (text: string) => void;
  setStatus: (status: "idle" | "audio" | "stt" | "chat" | "tts" | "playback") => void;
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
  userProfile?: Record<string, unknown>;
  userGoals?: Array<Record<string, unknown>>;
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

  // Wrapped setters with debug logging
  const setTranscriptWithLog = useCallback((text: string) => {
    devLog("debug", "MinimalMicContext: setTranscript called", { textPreview: text?.substring(0, 50) });
    setTranscript(text);
  }, []);

  const setAssistantTextWithLog = useCallback((text: string) => {
    devLog("debug", "MinimalMicContext: setAssistantText called", { textPreview: text?.substring(0, 50) });
    setAssistantText(text);
  }, []);

  const setStatusWithLog = useCallback((newStatus: "idle" | "audio" | "stt" | "chat" | "tts" | "playback") => {
    devLog("debug", "MinimalMicContext: setStatus called", { newStatus });
    setStatus(newStatus);
  }, []);
  const [vadLoop, setVadLoop] = useState(false);
  const [inputSpeaking, setInputSpeaking] = useState(false);
  const mediaRef = useRef<MediaRecorder | null>(null);

  // Voice Chat Engine Dependencies
  const engineDeps = useMemo(() => ({
    sttFromBlob: async (blob: Blob, detectMs?: number) => voice.sttFromBlob(blob, sessionIdRef.current || undefined),
    chatToText: async (promptText: string, opts?: { includeHistory?: boolean }) => {
      devLog("info", "MinimalMicContext: Engine calling chatToText", { promptText: promptText.substring(0, 50) });
      const chatOptions = {
        userProfile: userProfileRef.current,
        userGoals: userGoalsRef.current,
        customSystemPrompt: customSystemPromptRef.current && customSystemPromptRef.current.trim() ? customSystemPromptRef.current.trim() : undefined,
        model: modelRef.current && modelRef.current.trim() ? modelRef.current.trim() : undefined,
        onModelUsed: (model: string, provider: string) => {
          if (model && model !== modelRef.current && onModelChange) {
            devLog("info", "MinimalMic: Model updated", { from: modelRef.current, to: model });
            onModelChange(model, provider);
          }
        }
      };

      const result = await convo.chatToTextStreaming(promptText, (chunk) => {
        // Process TTS chunks as they arrive
        void voice.enqueueTTSChunk?.(chunk);
      }, { ...chatOptions, sessionId: sessionIdRef.current || undefined });

      return result;
    },
    enqueueTTSSegment: voice.enqueueTTSSegment,
    cancelTTS: voice.cancelTTS,
    stopPlaybackAndClear: audio.stop || (() => {}),
    waitForQueueToDrain: async (timeoutMs: number) => {
      return new Promise<void>((resolve) => {
        const timeout = setTimeout(() => resolve(), timeoutMs);
        // Simple implementation - in real usage this would wait for TTS queue to drain
        setTimeout(() => {
          clearTimeout(timeout);
          resolve();
        }, 100);
      });
    },
    pausePlayback: () => {
      // Pause TTS playback if supported
    },
    cancelActiveChatStream: () => {
      // Cancel any ongoing chat streaming
    },
    ingestMessage: async (role: "user" | "assistant", content: string) => {
      // Note: Assistant interactions handled by AI API, no need to persist here
      devLog("info", "MinimalMicContext: Engine ingestMessage", { role, contentLength: content.length });
    },
    pollAssessments: (sessionId: string, onAssessmentComplete: (assessment: any) => void) => {
      // Assessment polling would be implemented here if needed
    },
    stopAssessmentPolling: () => {
      // Stop assessment polling
    },
    getSessionId: () => sessionIdRef.current || null,
    logEvent: (event: string, data?: Record<string, any>) => {
      devLog("info", "MinimalMicContext: Engine event", { event, data });
    }
  }), [voice, convo, audio, sessionId]);

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

  // Voice Chat Engine Configuration
  const engineConfig = useMemo(() => ({
    vadThreshold: calibrationData.voiceProfile.avgEnergy * 0.8,
    vadMaxSilenceMs: 700,
    bargeRmsThreshold: 0.03,
    bargeMinFrames: 200,
    maxUtterMs: 30000,
    minSpeechMs: 80,
    silenceDebounceFrames: 30,
    vadGraceMs: 100,
    voiceLoop: vadLoop,
    alwaysOn: false
  }), [calibrationData.voiceProfile.avgEnergy, vadLoop]);

  // Use the headless voice chat engine
  const engine = useVoiceChatEngine(engineConfig, engineDeps);

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


  const skipSttOnStopRef = useRef<boolean>(false);
  const startingRef = useRef<boolean>(false);
  const bargeInActiveRef = useRef<boolean>(false);

  const lastStopAtRef = useRef<number>(0);
  const stopRecording = useCallback(() => {
    // Stop recording called
    const now = Date.now();
    if (now - lastStopAtRef.current < 300) {
      // debounce duplicate stop calls
      return;
    }
    lastStopAtRef.current = now;

    devLog("info", "MinimalMicContext: Stopping recording");

    // Use engine to stop recording
    try {
      engine.stopRecording?.();
    } catch (error) {
      devLog("error", "MinimalMicContext: Engine stop recording error", { error });
    }

    setRecording(false);
    setInputSpeaking(false);
    bargeInActiveRef.current = false;
  }, [engine]);

  const cancelCurrentCapture = useCallback(() => {
    skipSttOnStopRef.current = true;
    // Cancel current capture
    try { stopRecording(); } catch {}
  }, [stopRecording]);

  // Simplified recording using the engine
  const startRecordingInternal = useCallback(async (forceVad: boolean = false) => {
    if (recording || startingRef.current) return;

    try {
      startingRef.current = true;
      devLog("info", "MinimalMicContext: Starting recording", { forceVad, vadLoop });

      // Ensure session freshness before starting a new capture/turn
      try { await ensureFreshSession(); } catch {}

      // Start recording using the engine
      await engine.startRecording();
      setRecording(true);
      setStatusWithLog("audio");
      devLog("info", "MinimalMicContext: Recording started successfully");
    } catch (error) {
      devLog("error", "MinimalMicContext: Failed to start recording", { error });
      devLog("error", "MinimalMic: Failed to start recording", { error });
    } finally {
      startingRef.current = false;
    }
  }, [recording, engine]);

  const startRecording = useCallback(async () => {
    return startRecordingInternal(false);
  }, [startRecordingInternal]);

  const value = useMemo<MinimalMicContextValue>(() => ({
    recording: engine.recording || recording,
    transcript: engine.transcript || transcript,
    assistantText: engine.assistantText || assistantText,
    startRecording: engine.startRecording || startRecording,
    stopRecording: engine.stopRecording || stopRecording,
    vadLoop: vadLoop,
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
    status: status,
    inputSpeaking: engine.inputSpeaking || inputSpeaking,
    // Advanced VAD features
    triggerVadCalibration,
    resetVadState,
    getVadCalibrationData,
    // Manual chat integration
    setTranscript: setTranscriptWithLog,
    setAssistantText: setAssistantTextWithLog,
    setStatus: setStatusWithLog,
  }), [engine, recording, transcript, assistantText, startRecording, stopRecording, vadLoop, status, inputSpeaking, triggerVadCalibration, resetVadState, getVadCalibrationData, setTranscriptWithLog, setAssistantTextWithLog, setStatusWithLog]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}


