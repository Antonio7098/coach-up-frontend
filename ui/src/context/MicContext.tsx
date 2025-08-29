"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { voicePublishState, useVoice } from "./VoiceContext";
import { useAudio } from "./AudioContext";
import { useConversation } from "./ConversationContext";
import { useChat } from "./ChatContext";
import { useSessionSummary } from "../hooks/useSessionSummary";

// Mic context centralizing voice loop state, recording, STT/TTS, audio queues, and barge-in.
// This mirrors the logic used in `app/coach/page.tsx` but is decoupled so it can be reused globally.

export type MicBusyState = "idle" | "stt" | "chat" | "tts";

type AssessmentChip = {
  id: string; // groupId
  status: "queued" | "done" | "error";
  createdAt: number;
  summary?: any;
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
  const { getHistoryParam, sendPrompt: convoSendPrompt, chatToTextWithTTS, cancelActiveChatStream } = useConversation();
  const audio = useAudio();
  // Session summary (cached, periodic refresh)
  const { summary: sessionSummary, onTurn: sessionSummaryOnTurn } = useSessionSummary(sessionId);

  const [mediaSupported, setMediaSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState<MicBusyState>("idle");
  const [voiceError, setVoiceError] = useState("");
  const [voiceLoop, setVoiceLoop] = useState(true);
  const [transcript, setTranscript] = useState("");
  const [assistantText, setAssistantText] = useState("");
  // Standardized error copy
  const ERR = {
    micUnavailable: 'Microphone unavailable. Please check your device settings.',
    micUnsupported: 'Microphone not supported in this browser',
    noSpeech: 'No speech detected. Please try again.',
    finalizeFail: 'Failed to finalize recording',
    permissionDenied: 'Mic permission denied or unavailable',
    chatFailed: 'Chat failed',
    voiceChatFailed: 'Voice chat failed',
  } as const;
  // Device health (mic presence + permission)
  const [deviceStatus, setDeviceStatus] = useState<{ hasMic: boolean; permission: PermissionState | null }>({ hasMic: false, permission: null });
  // Multi-turn interaction and assessments state
  const [interactionState, setInteractionState] = useState<"active" | "idle">("idle");
  const [interactionGroupId, setInteractionGroupId] = useState<string | undefined>(undefined);
  const [interactionTurnCount, setInteractionTurnCount] = useState<number>(0);
  const [assessmentChips, setAssessmentChips] = useState<AssessmentChip[]>([]);
  const chipsRef = useRef<AssessmentChip[]>([]);
  useEffect(() => { chipsRef.current = assessmentChips; }, [assessmentChips]);
  // Nudge session summary refresh on each new turn
  useEffect(() => {
    if (interactionTurnCount > 0) {
      try { sessionSummaryOnTurn(); } catch {}
    }
  }, [interactionTurnCount, sessionSummaryOnTurn]);
  const assessPollRef = useRef<boolean>(false);
  // VAD flag for UI (true when incoming audio exceeds threshold)
  const [inputSpeaking, setInputSpeaking] = useState(false);
  // Precise flag for rotating ring animation
  const [processingRing, setProcessingRing] = useState(false);
  // Runtime-configurable tuning (persisted to localStorage)
  const tuningKey = "cu.voice.tuning";
  const envDefaults = useMemo(() => {
    const envVad = Number(process.env.NEXT_PUBLIC_VOICE_VAD_THRESHOLD ?? 0) || 0.02;
    const envSilence = Number(process.env.NEXT_PUBLIC_VOICE_VAD_MAX_SILENCE_MS ?? 0) || 900;
    const envBargeRms = Math.max(Number(process.env.NEXT_PUBLIC_BARGE_RMS_THRESHOLD ?? 0) || envVad * 2.5, 0.05);
    const envBargeFrames = Number(process.env.NEXT_PUBLIC_BARGE_MIN_FRAMES ?? 0) || 5;
    const envMaxUtter = Number(process.env.NEXT_PUBLIC_VOICE_MAX_UTTERANCE_MS ?? 0) || 6000;
    const envMinSpeech = Number(process.env.NEXT_PUBLIC_VOICE_MIN_SPEECH_MS ?? 0) || 400;
    const envSilenceDebounce = Number(process.env.NEXT_PUBLIC_VOICE_SILENCE_DEBOUNCE_FRAMES ?? 0) || 3;
    const envVadGrace = Number(process.env.NEXT_PUBLIC_VOICE_VAD_GRACE_MS ?? 0) || 500;
    return { envVad, envSilence, envBargeRms, envBargeFrames, envMaxUtter, envMinSpeech, envSilenceDebounce, envVadGrace };
  }, []);

  // Publish voice surface to VoiceContext for standalone consumption
  useEffect(() => {
    voicePublishState({ busy, processingRing, transcript, assistantText, voiceError });
  }, [busy, processingRing, transcript, assistantText, voiceError]);
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
  // Initialize from env + localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(tuningKey);
      const saved = raw ? JSON.parse(raw) : {};
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setTuning = useCallback((partial: Partial<typeof tuning>) => {
    setTuningState((prev) => {
      const next = { ...prev, ...partial };
      try { localStorage.setItem(tuningKey, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const resetTuning = useCallback(() => {
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
  }, [envDefaults]);

  // Keep live refs to avoid stale closures inside MediaRecorder callbacks
  const voiceLoopRef = useRef<boolean>(voiceLoop);
  const recordingRef = useRef<boolean>(recording);
  const processingRef = useRef<boolean>(false); // Prevent concurrent processing
  const trackMutedRef = useRef<boolean>(false); // Track brief hardware/browser mutes
  useEffect(() => { voiceLoopRef.current = voiceLoop; }, [voiceLoop]);
  useEffect(() => { recordingRef.current = recording; }, [recording]);

  // Chat history now owned by ConversationContext. MicContext no longer stores it locally.

  const mediaRef = useRef<MediaRecorder | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  // Removed local chat EventSource tracking; handled by ConversationContext
  // Expose stopRecording via ref for early effects
  const stopRecordingFnRef = useRef<() => void>(() => {});
  const stopReasonRef = useRef<'user' | 'vad' | 'timeout' | null>(null);

  // Timing refs for detection/recording instrumentation
  const recStartTsRef = useRef<number | null>(null);
  const recFirstChunkTsRef = useRef<number | null>(null);

  // Audio playback is fully owned by AudioContext
  // Telemetry helpers
  const prevInputSpeakingRef = useRef<boolean>(false);
  const lastPipelineStateRef = useRef<string>("idle");
  const bargeTriggerTsRef = useRef<number | null>(null);

  // Autoplay gating handled by AudioContext

  // Barge-in helpers
  const bargeArmedRef = useRef<boolean>(false);
  const speechFramesRef = useRef<number>(0);

  // VAD helpers
  const audioCtxRef = useRef<AudioContext | null>(null);
  const vadIntervalRef = useRef<number | null>(null);
  // VAD debug helper
  const vadDebugRef = useRef<{ lastSilenceLogFrame: number; loggedFirstSpeech: boolean }>({ lastSilenceLogFrame: 0, loggedFirstSpeech: false });

  // Barge-in monitor (passive mic while assistant is speaking)
  const bargeAudioCtxRef = useRef<AudioContext | null>(null);
  const bargeIntervalRef = useRef<number | null>(null);
  const bargeStreamRef = useRef<MediaStream | null>(null);

  // Config (runtime)
  const LONG_PRESS_MS = 500; // exported for consistency with coach page
  const MAX_UTTER_MS = tuning.maxUtterMs;
  const VAD_THRESHOLD = tuning.vadThreshold; // RMS
  const VAD_MAX_SILENCE_MS = tuning.vadMaxSilenceMs;
  const BARGE_RMS_THRESHOLD = tuning.bargeRmsThreshold;
  const BARGE_MIN_FRAMES = tuning.bargeMinFrames; // ~500ms at 100ms interval
  const MIN_SPEECH_MS = tuning.minSpeechMs;
  const SILENCE_DEBOUNCE_FRAMES = Math.max(0, Math.floor(tuning.silenceDebounceFrames));
  const VAD_GRACE_MS = Math.max(0, tuning.vadGraceMs);
  const TTS_TIMEOUT_MS = (Number(process.env.NEXT_PUBLIC_TTS_TIMEOUT_MS ?? 0) || 15000);
  const ALWAYS_ON = String(process.env.NEXT_PUBLIC_VOICE_ALWAYS_ON || "").toLowerCase() === "true" || String(process.env.NEXT_PUBLIC_VOICE_ALWAYS_ON || "") === "1";

  useEffect(() => {
    const ok = typeof window !== "undefined" && !!navigator?.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== "undefined";
    setMediaSupported(ok);
  }, []);

  // Check microphone permission + presence and cache to deviceStatus
  const checkMicPermission = useCallback(async (): Promise<{ hasMic: boolean; permission: PermissionState } | { hasMic: false; permission: 'denied' } > => {
    try {
      const perm = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      const devices = await navigator.mediaDevices.enumerateDevices();
      const hasMic = devices.some((d) => d && d.kind === 'audioinput');
      const permission = perm.state as PermissionState;
      setDeviceStatus({ hasMic, permission });
      return { hasMic, permission };
    } catch (e) {
      // On any error, assume no mic/denied
      setDeviceStatus({ hasMic: false, permission: 'denied' });
      return { hasMic: false, permission: 'denied' } as const;
    }
  }, []);

  // Initial device health evaluation
  useEffect(() => { void checkMicPermission(); }, [checkMicPermission]);

  // React to device changes (mic added/removed) and permission changes
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.addEventListener) return;
    let mounted = true;
    const onChange = async () => {
      const prev = deviceStatus;
      const next = await checkMicPermission();
      try { console.log(JSON.stringify({ type: 'voice.device.change', prev, next })); } catch {}
      if (!mounted) return;
      const hasMic = (next as any)?.hasMic === true;
      const permission = (next as any)?.permission;
      if ((!hasMic || permission !== 'granted') && (recordingRef.current || recording)) {
        try { setVoiceError(ERR.micUnavailable); } catch {}
        try { setVoiceLoop(false); } catch {}
        try { stopRecordingFnRef.current?.(); } catch {}
      }
    };
    navigator.mediaDevices.addEventListener('devicechange', onChange);
    return () => {
      mounted = false;
      try { navigator.mediaDevices.removeEventListener('devicechange', onChange as any); } catch {}
    };
  }, [checkMicPermission, deviceStatus, recording]);

  

  // TTS handled by VoiceContext via useVoice().

  // --- Assessments polling worker ---
  const ensureAssessmentPolling = useCallback(async () => {
    if (assessPollRef.current) return;
    assessPollRef.current = true;
    try {
      while (true) {
        // Stop when no pending chips
        const hasPending = chipsRef.current.some((c) => c.status !== "done" && c.status !== "error");
        if (!hasPending || !sessionId) break;
        try {
          const res = await fetch(`/api/assessments/${encodeURIComponent(sessionId)}`, { headers: { accept: "application/json" } });
          const data: any = await res.json().catch(() => ({}));
          const latestGid = data?.latestGroupId || data?.latest_group_id;
          if (latestGid) {
            setAssessmentChips((prev) => {
              const idx = prev.findIndex((c) => c.id === latestGid);
              if (idx >= 0 && prev[idx].status !== "done") {
                const next = prev.slice();
                next[idx] = { ...next[idx], status: "done", summary: data?.summary ?? next[idx]?.summary };
                return next;
              }
              return prev;
            });
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 1200));
      }
    } finally {
      assessPollRef.current = false;
    }
  }, [sessionId]);


  // --- History helpers removed: handled by ConversationContext ---

  // --- STT and Chat helpers ---
  const callSTT = useCallback(async (b: Blob, detectMs?: number): Promise<{ text: string }> => {
    setBusy("stt");
    try { setProcessingRing(true); } catch {}
    try {
      const res = await sttFromBlob(b, detectMs);
      return { text: res?.text || "" };
    } finally {
      // state transitions handled by caller
    }
  }, [sttFromBlob]);

  // Adapters now provided by VoiceContext. No registration needed here.

  const chatToText = useCallback(async (promptText: string, opts?: { includeHistory?: boolean }): Promise<string> => {
    setBusy("chat");
    try { setProcessingRing(true); } catch {}
    try { setAssistantText(""); } catch {}
    try {
      const reply = await chatToTextWithTTS(promptText, opts);
      // Accumulate assistantText for UI
      try { setAssistantText(reply); } catch {}
      return reply;
    } catch (e: any) {
      setVoiceError(e?.message || ERR.chatFailed);
      throw e;
    } finally {
      if (busy === "chat") setBusy("idle");
      try { setProcessingRing(false); } catch {}
    }
  }, [chatToTextWithTTS, busy]);

  // Public helper to trigger a chat from UI without voice
  const sendPrompt = useCallback(async (prompt: string): Promise<string> => {
    if (!prompt || !prompt.trim()) return "";
    try {
      setBusy("chat");
      setProcessingRing(true);
      setAssistantText("");
      const reply = await convoSendPrompt(prompt);
      return reply;
    } catch (e: any) {
      setVoiceError(e?.message || ERR.chatFailed);
      throw e;
    } finally {
      if (busy === "chat") setBusy("idle");
      setProcessingRing(false);
    }
  }, [convoSendPrompt, busy]);

  const ingestMessage = useCallback(async (role: "user" | "assistant", content: string) => {
    try {
      if (!sessionId || !content) return;
      const payload = { sessionId, messageId: Math.random().toString(36).slice(2), role, content, ts: Date.now() } as const;
      const res = await fetch("/api/messages/ingest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const data: any = await res.json().catch(() => ({}));
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
        // kick off polling
        void ensureAssessmentPolling();
      }
    } catch {}
  }, [sessionId, ensureAssessmentPolling]);

  // --- Recording controls ---
  const streamRef = useRef<MediaStream | null>(null);
  
  const stopRecording = useCallback(() => {
    console.log("MicContext: stopRecording called");
    // Mark manual stop to skip STT and ensure we don't auto-restart
    stopReasonRef.current = 'user';
    voiceLoopRef.current = false;

    // Clear recording state immediately
    setRecording(false);
    // Clear speaking indicator
    try { setInputSpeaking(false); } catch {}

    // Clear timers and VAD immediately to avoid repeated stop signals
    try {
      if (stopTimerRef.current) { window.clearTimeout(stopTimerRef.current); stopTimerRef.current = null; }
      if (vadIntervalRef.current) { window.clearInterval(vadIntervalRef.current); vadIntervalRef.current = null; }
      if (audioCtxRef.current) { audioCtxRef.current.close().catch?.(() => {}); audioCtxRef.current = null; }
    } catch {}

    // Stop MediaRecorder and clear reference
    const rec = mediaRef.current;
    if (rec) {
      console.log("MicContext: Stopping MediaRecorder, state:", rec.state);
      try { 
        if (rec.state === "recording") {
          rec.stop(); 
        }
      } catch (e) {
        console.log("MicContext: Error stopping recorder:", e);
      }
      // Clear the reference to prevent further events
      mediaRef.current = null;
    }
    
    // Stop all media stream tracks
    const stream = streamRef.current;
    if (stream) {
      console.log("MicContext: Stopping media stream tracks");
      try { 
        stream.getTracks().forEach((track) => {
          console.log("MicContext: Stopping track:", track.kind, track.readyState);
          track.stop();
        }); 
        streamRef.current = null;
      } catch (e) {
        console.log("MicContext: Error stopping stream:", e);
      }
    }
  }, []);

  // Expose the latest stopRecording function to early effects
  useEffect(() => { stopRecordingFnRef.current = stopRecording; }, [stopRecording]);

  const startRecording = useCallback(async () => {
    setVoiceError("");
    try { bargeArmedRef.current = true; speechFramesRef.current = 0; } catch {}
    // Reset stop reason at the start of a fresh recording
    stopReasonRef.current = null;

    // Check if already recording
    if (recording) {
      console.log("MicContext: Already recording, ignoring start request");
      return;
    }

    // Check if busy with other operations or processing
    if (busy !== "idle" || processingRef.current) {
      console.log("MicContext: Busy with", busy, "or processing, ignoring start request");
      return;
    }

    if (!mediaSupported) {
      const error = ERR.micUnsupported;
      console.error("MicContext:", error);
      setVoiceError(error);
      return;
    }

    try {
      console.log("MicContext: Requesting microphone permission...");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      console.log("MicContext: Microphone permission granted");

      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : (MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "");
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      mediaRef.current = rec;
      const chunks: BlobPart[] = [];
      let chunkBytes = 0;
      recStartTsRef.current = Date.now();
      recFirstChunkTsRef.current = null;
      try { console.log(JSON.stringify({ type: 'voice.record.start', t0: recStartTsRef.current })); } catch {}
      rec.ondataavailable = (ev) => {
        // Check if recording is still active before processing chunks
        if (!recordingRef.current || !mediaRef.current) {
          console.log("MicContext: Ignoring data chunk - recording stopped");
          return;
        }
        console.log("MicContext: Received audio data chunk, size:", ev.data?.size);
        if (ev.data && ev.data.size > 0) {
          chunks.push(ev.data);
          chunkBytes += ev.data.size;
          if (chunks.length % 10 === 0) {
            console.log("MicContext: chunks total bytes so far:", chunkBytes);
          }
          if (!recFirstChunkTsRef.current) {
            recFirstChunkTsRef.current = Date.now();
            const t0 = recStartTsRef.current || recFirstChunkTsRef.current;
            try { console.log(JSON.stringify({ type: 'voice.record.first_chunk', t0, tFirst: recFirstChunkTsRef.current, deltaMs: recFirstChunkTsRef.current - t0 })); } catch {}
            // If this recording was started due to a barge-in, emit restart latency
            if (bargeTriggerTsRef.current) {
              const restartMs = recFirstChunkTsRef.current - bargeTriggerTsRef.current;
              try { console.log(JSON.stringify({ type: 'voice.barge.restart_ms', restartMs })); } catch {}
              try {
                void fetch('/api/telemetry/voice', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ type: 'voice.barge.restart_ms', restartMs }),
                  keepalive: true,
                }).catch(() => {});
              } catch {}
              bargeTriggerTsRef.current = null;
            }
          }
        }
      };

      rec.onstop = async () => {
        console.log("MicContext: Recording stopped, processing", chunks.length, "chunks");
        console.log("MicContext: voiceLoopRef.current =", voiceLoopRef.current);
        console.log("MicContext: recordingRef.current =", recordingRef.current);

        const reason = stopReasonRef.current;
        stopReasonRef.current = null;
        console.log("MicContext: onstop reason:", reason);

        // Ensure UI state reflects that we are no longer recording.
        // This is critical so the barge monitor can start while assistant is responding.
        try { setRecording(false); } catch {}
        try { setInputSpeaking(false); } catch {}

        // Clean up stream and timers (always)
        try { stream.getTracks().forEach((t) => t.stop()); } catch {}
        if (stopTimerRef.current) { window.clearTimeout(stopTimerRef.current); stopTimerRef.current = null; }
        if (vadIntervalRef.current) { window.clearInterval(vadIntervalRef.current); vadIntervalRef.current = null; }
        try { audioCtxRef.current?.close(); audioCtxRef.current = null; } catch {}
        try { speechFramesRef.current = 0; bargeArmedRef.current = false; } catch {}

        // Skip STT unless stopped by VAD or timeout, and ensure not already processing
        if (!voiceLoopRef.current || (reason !== 'vad' && reason !== 'timeout')) {
          console.log("MicContext: Skipping STT due to reason or voiceLoop off", { reason });
          setBusy("idle");
          try { setProcessingRing(false); } catch {}
          return;
        }
        if (processingRef.current) {
          console.log("MicContext: Already processing previous input, skipping");
          setBusy("idle");
          try { setProcessingRing(false); } catch {}
          return;
        }
        processingRef.current = true;

        try {
          const outType = mime && mime.startsWith("audio/webm") ? "audio/webm" : (mime || "audio/webm");
          const b = new Blob(chunks, { type: outType });
          console.log("MicContext: Created audio blob, size:", b.size, "type:", outType);
          try {
            const t0 = recStartTsRef.current || 0;
            const tFirst = recFirstChunkTsRef.current || 0;
            const tStop = Date.now();
            console.log(JSON.stringify({ type: 'voice.record.finalize', t0, tFirst, tStop, elapsedMs: tStop - t0, firstDeltaMs: tFirst && t0 ? tFirst - t0 : undefined, bytes: b.size }));
          } catch {}

          if (b.size > 0 && voiceLoopRef.current) {
            console.log("MicContext: Processing voice loop (voiceLoop is true)");
            // Voice loop: process then restart
            try {
              console.log("MicContext: Processing voice loop...");
              const t0 = recStartTsRef.current || 0;
              const tFirst = recFirstChunkTsRef.current || 0;
              const detectMs = tFirst && t0 ? (tFirst - t0) : undefined;
              const { text } = await callSTT(b, detectMs);
              if (text && text.trim()) {
                console.log("MicContext: STT result:", text);
                setTranscript(text);
                // History persistence handled by ConversationContext
                void ingestMessage("user", text);
                const reply = await chatToText(text, { includeHistory: true });
                console.log("MicContext: Chat response:", reply);
                setAssistantText(reply);
                void ingestMessage("assistant", reply);
              } else {
                console.log("MicContext: No speech detected");
                setVoiceError(ERR.noSpeech);
                try { setProcessingRing(false); } catch {}
              }
            } catch (e: any) {
              console.error("MicContext: Voice chat failed:", e);
              setVoiceError(e?.message || ERR.voiceChatFailed);
            } finally {
              processingRef.current = false;
              setBusy("idle");
              try { setProcessingRing(false); } catch {}
              // restart loop only if still enabled and not already recording
              if (voiceLoopRef.current && !recordingRef.current) {
                console.log("MicContext: Restarting voice loop after processing");
                try { await audio.waitForQueueToDrain(6000); } catch {}
                // Clear any remaining audio state before restarting
                try {
                  if (!audio.needsAudioUnlock) {
                    audio.stopPlaybackAndClear();
                  } else {
                    console.log("MicContext: Skipping audio.clear due to autoplay lock; preserving queued TTS");
                  }
                } catch {}
                try { await startRecording(); } catch {}
              } else {
                console.log("MicContext: Voice loop disabled or already recording, not restarting");
              }
            }
          } else if (b.size > 0) {
            console.log("MicContext: Processing one-shot (voiceLoop is false)");
            // One-shot mode
            try {
              console.log("MicContext: Processing one-shot...");
              const t0 = recStartTsRef.current || 0;
              const tFirst = recFirstChunkTsRef.current || 0;
              const detectMs = tFirst && t0 ? (tFirst - t0) : undefined;
              const { text } = await callSTT(b, detectMs);
              if (text && text.trim()) {
                console.log("MicContext: STT result (one-shot):", text);
                setTranscript(text);
                // History persistence handled by ConversationContext
                void ingestMessage("user", text);
                const reply = await chatToText(text);
                console.log("MicContext: Chat response:", reply);
                setAssistantText(reply);
                void ingestMessage("assistant", reply);
              } else {
                console.log("MicContext: No speech detected (one-shot)");
                setVoiceError(ERR.noSpeech);
                try { setProcessingRing(false); } catch {}
              }
            } catch (e: any) {
              console.error("MicContext: One-shot voice chat failed:", e);
              setVoiceError(e?.message || ERR.voiceChatFailed);
            } finally {
              processingRef.current = false;
              setBusy("idle");
              try { setProcessingRing(false); } catch {}
            }
          } else {
            console.log("MicContext: No audio captured");
            setBusy("idle");
            try { setProcessingRing(false); } catch {}
          }
        } catch (e) {
          console.error("MicContext: Failed to finalize recording:", e);
          setVoiceError(ERR.finalizeFail);
          processingRef.current = false;
          setBusy("idle");
          try { setProcessingRing(false); } catch {}
        }
      };

      rec.start(100);
      console.log("MicContext: Recording started");
      setRecording(true);
      // Reset speaking indicator on start
      try { setInputSpeaking(false); } catch {}

      if (!ALWAYS_ON) {
        if (stopTimerRef.current) { window.clearTimeout(stopTimerRef.current); }
        stopTimerRef.current = window.setTimeout(() => {
          console.log("MicContext: Auto-stop timer triggered");
          stopReasonRef.current = 'timeout';
          if (vadIntervalRef.current) { window.clearInterval(vadIntervalRef.current); vadIntervalRef.current = null; }
          try { if (rec.state === "recording") rec.stop(); } catch {}
        }, MAX_UTTER_MS);
      } else {
        // In always-on mode, disable the max utterance auto-stop timer
        if (stopTimerRef.current) { window.clearTimeout(stopTimerRef.current); stopTimerRef.current = null; }
        console.log("MicContext: Always-on mode - max utterance auto-stop disabled");
      }

      // Simple VAD - enable trailing-silence based auto-stop
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioCtxRef.current = audioCtx;
        try {
          audioCtx.onstatechange = () => {
            try { console.log("MicContext: AudioContext state:", audioCtx.state); } catch {}
            if (audioCtx.state === "suspended") {
              // Some browsers may suspend on focus/tab switches; try to resume.
              audioCtx.resume().catch(() => {});
            }
          };
        } catch {}
        const src = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        src.connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        let lastSpeechTs = Date.now();
        let firstSpeechTs: number | null = null;
        let silenceFrames = 0;
        try { console.log(JSON.stringify({ type: 'voice.vad.state', state: 'init', VAD_THRESHOLD, VAD_MAX_SILENCE_MS, MIN_SPEECH_MS, SILENCE_DEBOUNCE_FRAMES, VAD_GRACE_MS })); } catch {}
        try {
          void fetch('/api/telemetry/voice', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'voice.vad.state', state: 'init' }),
            keepalive: true,
          }).catch(() => {});
        } catch {}
        // Attach mute/unmute listeners on the primary audio track
        try {
          const t = stream.getAudioTracks?.()[0];
          if (t) {
            t.onmute = () => { trackMutedRef.current = true; try { console.log("MicContext: MediaStreamTrack muted"); } catch {} };
            t.onunmute = () => { trackMutedRef.current = false; try { console.log("MicContext: MediaStreamTrack unmuted"); } catch {} };
          }
        } catch {}
        vadIntervalRef.current = window.setInterval(() => {
          try {
            analyser.getFloatTimeDomainData(buf);
            // Downsampled RMS for efficiency
            let sum = 0;
            let count = 0;
            for (let i = 0; i < buf.length; i += 32) { // sample every 32nd sample
              const v = buf[i];
              sum += v * v;
              count++;
            }
            const rms = Math.sqrt(sum / Math.max(1, count));
            // If track is muted, do not treat it as silence: extend lastSpeechTs and skip stop logic
            if (trackMutedRef.current) {
              lastSpeechTs = Date.now();
              silenceFrames = 0;
              // Keep speaking indicator off while muted
              try { setInputSpeaking(false); } catch {}
            } else if (rms >= VAD_THRESHOLD) {
              speechFramesRef.current += 1;
              lastSpeechTs = Date.now();
              silenceFrames = 0;
              if (!firstSpeechTs) {
                firstSpeechTs = lastSpeechTs;
                try { console.log("MicContext: VAD firstSpeech", { rms, threshold: VAD_THRESHOLD }); } catch {}
              }
              // Periodic speaking tick
              try {
                if (speechFramesRef.current % 5 === 0) {
                  console.log("MicContext: VAD speaking tick", { rms, frames: speechFramesRef.current, threshold: VAD_THRESHOLD });
                }
              } catch {}
              // Mark speaking when over threshold
              try { setInputSpeaking(true); } catch {}
            } else {
              // Accumulate silence frames with debounce
              silenceFrames += 1;
              const now = Date.now();
              const hadSpeech = firstSpeechTs != null;
              const graceOk = (firstSpeechTs ? (now - firstSpeechTs) : (now - (recStartTsRef.current || now))) >= VAD_GRACE_MS;
              const minSpeechOk = firstSpeechTs ? (now - firstSpeechTs) >= MIN_SPEECH_MS : false;
              const sustainedSilence = (now - lastSpeechTs) > VAD_MAX_SILENCE_MS && silenceFrames >= SILENCE_DEBOUNCE_FRAMES;
              // Decay speaking indicator when under threshold
              try { setInputSpeaking(false); } catch {}
              // VAD-based segmentation should occur in both normal and ALWAYS_ON modes.
              // ALWAYS_ON only disables the max-utterance timeout, not VAD stops.
              // Periodic debug while silent
              try {
                if (silenceFrames % Math.max(1, SILENCE_DEBOUNCE_FRAMES) === 0) {
                  console.log("MicContext: VAD silence tick", {
                    rms, hadSpeech, graceOk, minSpeechOk,
                    silenceMs: now - lastSpeechTs, silenceFrames,
                    VAD_THRESHOLD, MIN_SPEECH_MS, VAD_MAX_SILENCE_MS, SILENCE_DEBOUNCE_FRAMES, VAD_GRACE_MS,
                  });
                }
              } catch {}
              if (hadSpeech && graceOk && minSpeechOk && sustainedSilence) {
                console.log("MicContext: VAD auto-stop triggered", { rms, VAD_THRESHOLD, silenceMs: now - lastSpeechTs, silenceFrames, SILENCE_DEBOUNCE_FRAMES, MIN_SPEECH_MS, VAD_GRACE_MS });
                stopReasonRef.current = 'vad';
                if (vadIntervalRef.current) { window.clearInterval(vadIntervalRef.current); vadIntervalRef.current = null; }
                try { if (rec.state === "recording") rec.stop(); } catch {}
              }
            }
          } catch (e) {
            console.log("MicContext: VAD interval error:", e);
          }
        }, 100);
        console.log("MicContext: VAD enabled", { VAD_THRESHOLD, VAD_MAX_SILENCE_MS, MIN_SPEECH_MS, SILENCE_DEBOUNCE_FRAMES, VAD_GRACE_MS, ALWAYS_ON });
      } catch (e) {
        console.log("MicContext: Failed to initialize VAD:", e);
      }

    } catch (e: any) {
      console.error("MicContext: Mic permission denied:", e);
      setVoiceError(e?.message || ERR.permissionDenied);
    }
  }, [BARGE_MIN_FRAMES, BARGE_RMS_THRESHOLD, MAX_UTTER_MS, VAD_MAX_SILENCE_MS, VAD_THRESHOLD, busy, callSTT, chatToText, mediaSupported, recording, audio.stopPlaybackAndClear, audio.waitForQueueToDrain, voiceLoopRef, ingestMessage]);

  // Telemetry: VAD speaking/silence transitions
  useEffect(() => {
    if (!recording) return; // only emit during recording session
    const prev = prevInputSpeakingRef.current;
    if (prev !== inputSpeaking) {
      prevInputSpeakingRef.current = inputSpeaking;
      try { console.log(JSON.stringify({ type: 'voice.vad.state', state: inputSpeaking ? 'speaking' : 'silence' })); } catch {}
      try {
        void fetch('/api/telemetry/voice', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'voice.vad.state', state: inputSpeaking ? 'speaking' : 'silence' }),
          keepalive: true,
        }).catch(() => {});
      } catch {}
    }
  }, [inputSpeaking, recording]);

  // Telemetry: pipeline state transitions
  useEffect(() => {
    // Derive pipeline state from recording/busy
    let state: 'idle' | 'listening' | 'processing' | 'speaking' | 'error' = 'idle';
    if (voiceError) state = 'error';
    else if (recording) state = 'listening';
    else if (busy === 'stt' || busy === 'chat') state = 'processing';
    else if (busy === 'tts') state = 'speaking';
    const prev = lastPipelineStateRef.current;
    if (prev !== state) {
      lastPipelineStateRef.current = state;
      try { console.log(JSON.stringify({ type: 'voice.pipeline.state', state, busy, recording })); } catch {}
      try {
        void fetch('/api/telemetry/voice', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'voice.pipeline.state', state }),
          keepalive: true,
        }).catch(() => {});
      } catch {}
    }
  }, [busy, recording, voiceError]);

  const toggleVoiceLoop = useCallback(() => {
    console.log("MicContext: toggleVoiceLoop called, current state:", { voiceLoop, recording, busy });

    if (voiceLoop) {
      console.log("MicContext: Stopping voice loop");
      setVoiceLoop(false);
      voiceLoopRef.current = false; // sync immediately to avoid STT/restart on user mute
      try { stopRecording(); } catch (e) { console.error("MicContext: Error stopping recording:", e); }
      try { cancelActiveChatStream(); } catch (e) { console.error("MicContext: Error canceling chat stream:", e); }
      try { cancelTTS(); } catch (e) { console.error("MicContext: Error canceling TTS:", e); }
      try { audio.stopPlaybackAndClear(); } catch (e) { console.error("MicContext: Error clearing playback:", e); }
      // Also clear any residual timers if not already cleared by stopRecording
      try {
        if (stopTimerRef.current) { window.clearTimeout(stopTimerRef.current); stopTimerRef.current = null; }
        if (vadIntervalRef.current) { window.clearInterval(vadIntervalRef.current); vadIntervalRef.current = null; }
        if (audioCtxRef.current) { audioCtxRef.current.close().catch?.(() => {}); audioCtxRef.current = null; }
      } catch {}
    } else {
      console.log("MicContext: Starting voice loop");
      setVoiceLoop(true);
      voiceLoopRef.current = true; // sync for immediate checks in callbacks
      if (!recording) {
        console.log("MicContext: Not recording, starting recording...");
        void startRecording();
      } else {
        console.log("MicContext: Already recording, not starting again");
      }
    }
  }, [recording, startRecording, stopRecording, audio.stopPlaybackAndClear, voiceLoop, cancelActiveChatStream, cancelTTS]);

  const setVoiceLoopState = useCallback((v: boolean) => {
    console.log("MicContext: setVoiceLoop called with:", v);
    setVoiceLoop(v);
  }, []);

  const clear = useCallback(() => {
    setTranscript("");
    setAssistantText("");
    setVoiceError("");
    // Clear all audio queues and state via AudioContext
    try { audio.stopPlaybackAndClear(); } catch {}
  }, []);

  // --- Simplified Barge-in monitor (interrupt + restart pattern) ---
  const stopBargeMonitor = useCallback(() => {
    try { if (bargeIntervalRef.current) { window.clearInterval(bargeIntervalRef.current); bargeIntervalRef.current = null; } } catch {}
    try { bargeAudioCtxRef.current?.close(); } catch {}
    bargeAudioCtxRef.current = null;
    const s = bargeStreamRef.current;
    if (s) {
      try { s.getTracks().forEach((t) => t.stop()); } catch {}
      bargeStreamRef.current = null;
    }
    speechFramesRef.current = 0;
    bargeArmedRef.current = false;
  }, []);

  const startBargeMonitor = useCallback(async () => {
    if (bargeIntervalRef.current || bargeAudioCtxRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      bargeStreamRef.current = stream;
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      bargeAudioCtxRef.current = audioCtx;
      const src = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      src.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      bargeArmedRef.current = true;
      speechFramesRef.current = 0;
      bargeIntervalRef.current = window.setInterval(() => {
        try {
          analyser.getFloatTimeDomainData(buf);
          let sum = 0, count = 0;
          for (let i = 0; i < buf.length; i += 32) { const v = buf[i]; sum += v * v; count++; }
          const rms = Math.sqrt(sum / Math.max(1, count));
          // Immediate barge-in: trigger on the first frame above threshold
          if (bargeArmedRef.current && rms >= BARGE_RMS_THRESHOLD) {
            console.log("MicContext: BARGE-IN TRIGGERED (immediate)", { rms, BARGE_RMS_THRESHOLD });
            bargeArmedRef.current = false;
            // Telemetry: barge trigger
            bargeTriggerTsRef.current = Date.now();
            try { console.log(JSON.stringify({ type: 'voice.barge.trigger' })); } catch {}
            try {
              void fetch('/api/telemetry/voice', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ type: 'voice.barge.trigger' }),
                keepalive: true,
              }).catch(() => {});
            } catch {}

            // Interrupt playback and chat immediately
            try { audio.pausePlayback(); } catch {}
            // Clear any queued audio so nothing resumes after interrupt
            try { audio.stopPlaybackAndClear(); } catch {}
            try { cancelActiveChatStream(); } catch {}
            try { cancelTTS(); } catch {}
            try { setBusy("idle"); } catch {}
            // Stop monitor before starting recording
            stopBargeMonitor();
            // Start recording immediately
            void startRecording();
          } else {
            // decay frames to reduce false positives
            speechFramesRef.current = Math.max(0, speechFramesRef.current - 1);
          }
        } catch (e) {
          console.log("MicContext: barge monitor error", e);
        }
      }, 50);
      console.log("MicContext: Barge monitor started", { BARGE_RMS_THRESHOLD, intervalMs: 50 });
    } catch (e) {
      console.log("MicContext: Failed to start barge monitor", e);
      stopBargeMonitor();
    }
  }, [BARGE_MIN_FRAMES, BARGE_RMS_THRESHOLD, startRecording, stopBargeMonitor, cancelActiveChatStream, cancelTTS]);

  // Start/stop barge monitor when assistant is speaking OR streaming text.
  // We now also monitor during text streaming (busy === 'chat') so the user can barge-in before TTS starts.
  useEffect(() => {
    const shouldMonitor = voiceLoop && !recording && (busy === 'chat');
    try { console.log("MicContext: Barge monitor check", { voiceLoop, recording, busy, shouldMonitor }); } catch {}
    if (shouldMonitor) {
      void startBargeMonitor();
    } else {
      stopBargeMonitor();
    }
    return () => { stopBargeMonitor(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceLoop, recording, busy]);

  const value = useMemo<MicContextValue>(() => ({
    mediaSupported,
    recording,
    busy,
    voiceError,
    voiceLoop,
    transcript,
    assistantText,
    sendPrompt,
    enqueueTTSSegment,
    sttFromBlob: callSTT,
    inputSpeaking,
    processingRing,
    interactionState,
    interactionGroupId,
    interactionTurnCount,
    assessmentChips,
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
  }), [assistantText, busy, clear, mediaSupported, recording, startRecording, stopRecording, transcript, voiceError, voiceLoop, toggleVoiceLoop, setVoiceLoopState, tuning, setTuning, resetTuning, inputSpeaking, processingRing, interactionState, interactionGroupId, interactionTurnCount, assessmentChips]);

  return (
    <MicContext.Provider value={value}>{children}</MicContext.Provider>
  );
}
