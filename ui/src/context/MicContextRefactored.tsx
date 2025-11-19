"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { devLog } from "../app/api/lib/observability";
import { voicePublishState, useVoice } from "./VoiceContext";
import { useAudio } from "./AudioContext";
import { useConversation } from "./ConversationContext";
import { useChat } from "./ChatContext";
import { useSessionSummary } from "../hooks/useSessionSummary";
import { useVoiceChatEngine } from "./engine/useVoiceChatEngine";

// Mic context centralizing voice loop state, recording, STT/TTS, audio queues, and barge-in.
// This mirrors the logic used in `app/coach-min/page.tsx` but is decoupled so it can be reused globally.

export type MicBusyState = "idle" | "stt" | "chat" | "tts";

type AssessmentChip = {
  id: string; // groupId
  status: "queued" | "done" | "error";
  createdAt: number;
  summary?: Record<string, unknown>;
};

type MicContextValue = {
  mediaSupported: boolean;
  recording: boolean;
  busy: MicBusyState;
  voiceError: string;
  voiceLoop: boolean;
  transcript: string;
  assistantText: string;
  // Fire a chat request with a text prompt (UI/debug helper)
  sendPrompt: (prompt: string) => Promise<string>;
  // TTS text enqueue (adapter exposure during migration)
  enqueueTTSSegment: (text: string) => void;
  // STT adapter during migration
  sttFromBlob: (b: Blob, detectMs?: number) => Promise<{ text: string }>;
  // Live input VAD state for UI animations
  inputSpeaking: boolean;
  // Show processing ring precisely between STT send and TTS start
  processingRing: boolean;
  // Interaction classifier state (multi-turn lifecycle)
  interactionState: "active" | "idle";
  interactionGroupId?: string;
  interactionTurnCount: number;
  // Assessment chips (UI surface for in-flight and completed assessments)
  assessmentChips: AssessmentChip[];
  // Live tuning config
  vadThreshold: number;
  vadMaxSilenceMs: number;
  bargeRmsThreshold: number;
  bargeMinFrames: number;
  maxUtterMs: number;
  minSpeechMs: number;
  silenceDebounceFrames: number;
  vadGraceMs: number;
  // Controls
  setVoiceLoop: (v: boolean) => void;
  toggleVoiceLoop: () => void;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  clear: () => void;
  resetTuning: () => void;
  setTuning: (partial: Partial<{
    vadThreshold: number;
    vadMaxSilenceMs: number;
    bargeRmsThreshold: number;
    bargeMinFrames: number;
    maxUtterMs: number;
    minSpeechMs: number;
    silenceDebounceFrames: number;
    vadGraceMs: number;
  }>) => void;
};

const MicContext = createContext<MicContextValue | undefined>(undefined);

export function useMic() {
  const ctx = useContext(MicContext);
  if (!ctx) throw new Error("useMic must be used within MicProvider");
  return ctx;
}

export function MicProvider({ children }: { children: React.ReactNode }) {
  const { sessionId } = useChat();
  const { enqueueTTSSegment, sttFromBlob, cancelTTS } = useVoice();

  devLog("debug", "MicContextRefactored: initializing refactored mic provider", {
    sessionId,
    timestamp: new Date().toISOString()
  });
  const { sendPrompt: convoSendPrompt, chatToTextWithTTS, cancelActiveChatStream } = useConversation();
  const audio = useAudio();

  // Message ingestion helper
  const ingestMessage = useCallback(async (role: "user" | "assistant", content: string) => {
    try {
      if (!sessionId || !content) return;
      const payload = { sessionId, messageId: Math.random().toString(36).slice(2), role, content, ts: Date.now() };
      const res = await fetch("/api/messages/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data: { state?: string; groupId?: string; turnCount?: number; enqueued?: boolean } = await res.json().catch(() => ({}));
      // Update multi-turn state
      const st = String(data?.state || "").toLowerCase();
      setInteractionState(st === "active" ? "active" : "idle");
      if (typeof data?.groupId === "string" && data.groupId) setInteractionGroupId(data.groupId);
      setInteractionTurnCount(Number(data?.turnCount || 0) || 0);
      // Enqueued assessment -> add chip and start polling
      if (data?.enqueued && typeof data?.groupId === "string" && data.groupId) {
        const gid = data.groupId as string;
        setAssessmentChips((prev) => {
          if (prev.some((c) => c.id === gid)) return prev;
          const next: AssessmentChip[] = [{ id: gid, status: "queued" as const, createdAt: Date.now() }, ...prev].slice(0, 12);
          return next;
        });
        // TODO: kick off polling
      }
    } catch {}
  }, [sessionId]);

  // Local state for React context interface
  const [mediaSupported] = useState(() =>
    typeof window !== "undefined" && !!navigator?.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== "undefined"
  );
  const [voiceLoop, setVoiceLoop] = useState(true);
  const [interactionState, setInteractionState] = useState<"active" | "idle">("idle");
  const [interactionGroupId, setInteractionGroupId] = useState<string | undefined>(undefined);
  const [interactionTurnCount, setInteractionTurnCount] = useState<number>(0);
  const [assessmentChips, setAssessmentChips] = useState<AssessmentChip[]>([]);

  // Runtime-configurable tuning (persisted to localStorage)
  const tuningKey = "cu.voice.tuning";
  const [tuning, setTuningState] = useState({
    vadThreshold: 0.02,
    vadMaxSilenceMs: 900,
    bargeRmsThreshold: 0.05,
    bargeMinFrames: 5,
    maxUtterMs: 6000,
    minSpeechMs: 400,
    silenceDebounceFrames: 3,
    vadGraceMs: 500,
  });

  // Initialize tuning from env + localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(tuningKey);
      const saved = raw ? JSON.parse(raw) : {};
      const envDefaults = {
        envVad: Number(process.env.NEXT_PUBLIC_VOICE_VAD_THRESHOLD ?? 0) || 0.02,
        envSilence: Number(process.env.NEXT_PUBLIC_VOICE_VAD_MAX_SILENCE_MS ?? 0) || 900,
        envBargeRms: Math.max(Number(process.env.NEXT_PUBLIC_BARGE_RMS_THRESHOLD ?? 0) || 0.05, 0.05),
        envBargeFrames: Number(process.env.NEXT_PUBLIC_BARGE_MIN_FRAMES ?? 0) || 5,
        envMaxUtter: Number(process.env.NEXT_PUBLIC_VOICE_MAX_UTTERANCE_MS ?? 0) || 6000,
        envMinSpeech: Number(process.env.NEXT_PUBLIC_VOICE_MIN_SPEECH_MS ?? 0) || 400,
        envSilenceDebounce: Number(process.env.NEXT_PUBLIC_VOICE_SILENCE_DEBOUNCE_FRAMES ?? 0) || 3,
        envVadGrace: Number(process.env.NEXT_PUBLIC_VOICE_VAD_GRACE_MS ?? 0) || 500,
      };
      setTuningState((cur) => ({
        vadThreshold: Number(saved?.vadThreshold ?? envDefaults.envVad) || envDefaults.envVad,
        vadMaxSilenceMs: Number(saved?.vadMaxSilenceMs ?? envDefaults.envSilence) || envDefaults.envSilence,
        bargeRmsThreshold: Number(saved?.bargeRmsThreshold ?? envDefaults.envBargeRms) || envDefaults.envBargeRms,
        bargeMinFrames: Number(saved?.bargeMinFrames ?? envDefaults.envBargeFrames) || envDefaults.envBargeFrames,
        maxUtterMs: Number(saved?.maxUtterMs ?? envDefaults.envMaxUtter) || envDefaults.envMaxUtter,
        minSpeechMs: Number(saved?.minSpeechMs ?? envDefaults.envMinSpeech) || envDefaults.envMinSpeech,
        silenceDebounceFrames: Number(saved?.silenceDebounceFrames ?? envDefaults.envSilenceDebounce) || envDefaults.envSilenceDebounce,
        vadGraceMs: Number(saved?.vadGraceMs ?? envDefaults.envVadGrace) || envDefaults.envVadGrace,
      }));
    } catch {}
  }, []);

  // Dependencies for the voice engine
  const engineDeps = useMemo(() => ({
    sttFromBlob,
    chatToText: chatToTextWithTTS,
    enqueueTTSSegment,
    cancelTTS,
    stopPlaybackAndClear: audio.stopPlaybackAndClear.bind(audio),
    waitForQueueToDrain: audio.waitForQueueToDrain.bind(audio),
    pausePlayback: audio.pausePlayback.bind(audio),
    cancelActiveChatStream,
    ingestMessage,
    pollAssessments: (sessionId: string, onAssessmentComplete: (assessment: AssessmentChip) => void) => {
      // TODO: Implement assessment polling
    },
    stopAssessmentPolling: () => {
      // TODO: Implement stopping assessment polling
    },
    getSessionId: () => sessionId || null,
    logEvent: (event: string, data?: Record<string, any>) => {
      devLog("info", `MicContextRefactored: VoiceEngine ${event}`, data);
    },
  }), [sttFromBlob, chatToTextWithTTS, enqueueTTSSegment, cancelTTS, audio, cancelActiveChatStream, ingestMessage, sessionId]);

  // Voice engine configuration
  const engineConfig = useMemo(() => ({
    vadThreshold: tuning.vadThreshold,
    vadMaxSilenceMs: tuning.vadMaxSilenceMs,
    bargeRmsThreshold: tuning.bargeRmsThreshold,
    bargeMinFrames: tuning.bargeMinFrames,
    maxUtterMs: tuning.maxUtterMs,
    minSpeechMs: tuning.minSpeechMs,
    silenceDebounceFrames: tuning.silenceDebounceFrames,
    vadGraceMs: tuning.vadGraceMs,
    voiceLoop: true,
    alwaysOn: String(process.env.NEXT_PUBLIC_VOICE_ALWAYS_ON || "").toLowerCase() === "true" ||
             String(process.env.NEXT_PUBLIC_VOICE_ALWAYS_ON || "") === "1",
  }), [tuning]);

  // Voice Chat Engine
  const engine = useVoiceChatEngine(engineConfig, engineDeps);

  // Publish voice surface to VoiceContext for standalone consumption
  useEffect(() => {
    voicePublishState({
      busy: engine.state === "recording" ? "stt" : engine.state === "processing" ? "chat" : "idle",
      processingRing: engine.state === "processing",
      transcript: engine.transcript,
      assistantText: engine.assistantText,
      voiceError: engine.voiceError
    });
  }, [engine.state, engine.transcript, engine.assistantText, engine.voiceError]);

  // Tuning controls
  const setTuning = useCallback((partial: Partial<typeof tuning>) => {
    setTuningState((prev) => {
      const next = { ...prev, ...partial };
      try { localStorage.setItem(tuningKey, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const resetTuning = useCallback(() => {
    const envDefaults = {
      envVad: Number(process.env.NEXT_PUBLIC_VOICE_VAD_THRESHOLD ?? 0) || 0.02,
      envSilence: Number(process.env.NEXT_PUBLIC_VOICE_VAD_MAX_SILENCE_MS ?? 0) || 900,
      envBargeRms: Math.max(Number(process.env.NEXT_PUBLIC_BARGE_RMS_THRESHOLD ?? 0) || 0.05, 0.05),
      envBargeFrames: Number(process.env.NEXT_PUBLIC_BARGE_MIN_FRAMES ?? 0) || 5,
      envMaxUtter: Number(process.env.NEXT_PUBLIC_VOICE_MAX_UTTERANCE_MS ?? 0) || 6000,
      envMinSpeech: Number(process.env.NEXT_PUBLIC_VOICE_MIN_SPEECH_MS ?? 0) || 400,
      envSilenceDebounce: Number(process.env.NEXT_PUBLIC_VOICE_SILENCE_DEBOUNCE_FRAMES ?? 0) || 3,
      envVadGrace: Number(process.env.NEXT_PUBLIC_VOICE_VAD_GRACE_MS ?? 0) || 500,
    };
    const next = {
      vadThreshold: envDefaults.envVad,
      vadMaxSilenceMs: envDefaults.envSilence,
      bargeRmsThreshold: envDefaults.envBargeRms,
      bargeMinFrames: envDefaults.envBargeFrames,
      maxUtterMs: envDefaults.envMaxUtter,
      minSpeechMs: envDefaults.envMinSpeech,
      silenceDebounceFrames: envDefaults.envSilenceDebounce,
      vadGraceMs: envDefaults.envVadGrace,
    };
    setTuningState(next);
    try { localStorage.setItem(tuningKey, JSON.stringify(next)); } catch {}
  }, []);

  // Public API
  const sendPrompt = useCallback(async (prompt: string): Promise<string> => {
    return engine.sendPrompt(prompt);
  }, [engine]);

  const startRecording = useCallback(async () => {
    await engine.startRecording();
  }, [engine]);

  const stopRecording = useCallback(() => {
    engine.stopRecording();
  }, [engine]);

  const toggleVoiceLoop = useCallback(() => {
    engine.setVoiceLoop(!voiceLoop);
    setVoiceLoop(!voiceLoop);
  }, [engine, voiceLoop]);

  const setVoiceLoopState = useCallback((v: boolean) => {
    engine.setVoiceLoop(v);
    setVoiceLoop(v);
  }, [engine]);

  const clear = useCallback(() => {
    engine.clear();
  }, [engine]);

  // Context value
  const value = useMemo<MicContextValue>(() => ({
    mediaSupported,
    recording: engine.recording,
    busy: engine.state === "recording" ? "stt" : engine.state === "processing" ? "chat" : "idle",
    voiceError: engine.voiceError,
    voiceLoop,
    transcript: engine.transcript,
    assistantText: engine.assistantText,
    sendPrompt,
    enqueueTTSSegment,
    sttFromBlob,
    inputSpeaking: engine.inputSpeaking,
    processingRing: engine.state === "processing",
    interactionState: engine.interactionState,
    interactionGroupId: engine.interactionGroupId,
    interactionTurnCount: engine.interactionTurnCount,
    assessmentChips: engine.assessmentChips,
    setVoiceLoop: setVoiceLoopState,
    toggleVoiceLoop,
    startRecording,
    stopRecording,
    clear,
    resetTuning,
    vadThreshold: tuning.vadThreshold,
    vadMaxSilenceMs: tuning.vadMaxSilenceMs,
    bargeRmsThreshold: tuning.bargeRmsThreshold,
    bargeMinFrames: tuning.bargeMinFrames,
    maxUtterMs: tuning.maxUtterMs,
    minSpeechMs: tuning.minSpeechMs,
    silenceDebounceFrames: tuning.silenceDebounceFrames,
    vadGraceMs: tuning.vadGraceMs,
    setTuning,
  }), [
    mediaSupported, engine, voiceLoop, sendPrompt, enqueueTTSSegment, sttFromBlob,
    toggleVoiceLoop, setVoiceLoopState, startRecording, stopRecording, clear,
    resetTuning, tuning, setTuning
  ]);

  return (
    <MicContext.Provider value={value}>{children}</MicContext.Provider>
  );
}
