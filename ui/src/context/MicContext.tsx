"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "./ChatContext";

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

  const [mediaSupported, setMediaSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState<MicBusyState>("idle");
  const [voiceError, setVoiceError] = useState("");
  const [voiceLoop, setVoiceLoop] = useState(true);
  const [transcript, setTranscript] = useState("");
  const [assistantText, setAssistantText] = useState("");
  // Multi-turn interaction and assessments state
  const [interactionState, setInteractionState] = useState<"active" | "idle">("idle");
  const [interactionGroupId, setInteractionGroupId] = useState<string | undefined>(undefined);
  const [interactionTurnCount, setInteractionTurnCount] = useState<number>(0);
  const [assessmentChips, setAssessmentChips] = useState<AssessmentChip[]>([]);
  const chipsRef = useRef<AssessmentChip[]>([]);
  useEffect(() => { chipsRef.current = assessmentChips; }, [assessmentChips]);
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
  useEffect(() => { voiceLoopRef.current = voiceLoop; }, [voiceLoop]);
  useEffect(() => { recordingRef.current = recording; }, [recording]);

  // Chat history for context (last 10 messages)
  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);

  // How many recent messages to send to the backend as client-passed history.
  // Configurable via NEXT_PUBLIC_MESSAGE_CONTEXT_LENGTH and clamped to [1, 10]
  // since we only persist the last 10 locally.
  const MAX_HISTORY_FOR_VOICE = (() => {
    const envN = Number(process.env.NEXT_PUBLIC_MESSAGE_CONTEXT_LENGTH ?? 0) || 2;
    const n = Math.max(1, Math.min(10, Math.floor(envN)));
    return n;
  })();

  const mediaRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const chatEsRef = useRef<EventSource | null>(null);

  // Timing refs for detection/recording instrumentation
  const recStartTsRef = useRef<number | null>(null);
  const recFirstChunkTsRef = useRef<number | null>(null);

  // Playback/tts queues
  const audioQueueRef = useRef<string[]>([]);
  const audioPlayingRef = useRef<boolean>(false);
  const ttsTextQueueRef = useRef<string[]>([]);
  const ttsProcessingRef = useRef(false);
  const ttsCancelRef = useRef(0); // increment to cancel/abort current TTS worker loop

  // User interaction + autoplay gating
  const userInteractedRef = useRef<boolean>(false);
  const pendingAudioUrlRef = useRef<string | null>(null);

  // Barge-in helpers
  const bargeArmedRef = useRef<boolean>(false);
  const speechFramesRef = useRef<number>(0);

  // VAD helpers
  const audioCtxRef = useRef<AudioContext | null>(null);
  const vadIntervalRef = useRef<number | null>(null);

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

  useEffect(() => {
    const ok = typeof window !== "undefined" && !!navigator?.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== "undefined";
    setMediaSupported(ok);
  }, []);

  

  // --- Audio playback helpers ---
  const playAudio = useCallback(async (url: string) => {
    try {
      console.log('MicContext: playAudio starting for URL:', url);
      let el = audioRef.current;
      if (!el) {
        el = new Audio();
        audioRef.current = el;
        console.log('MicContext: Created new Audio element');
      }
      
      // Avoid preflight/HEAD checks — many providers disallow HEAD or CORS; data/blob URLs cannot be fetched.
      // Let the <audio> element surface load/play errors instead.
      // If the URL is an unsupported scheme (e.g., s3://), bail out early.
      if (!/^https?:|^data:|^blob:/i.test(url)) {
        console.error('MicContext: Unsupported audio URL scheme:', url);
        return;
      }
      
      el.autoplay = true;
      el.volume = 1.0;
      el.src = url;
      console.log('MicContext: Audio element configured, loading...');
      
      try { 
        el.load(); 
        console.log('MicContext: Audio loaded successfully');
      } catch (loadError) {
        console.error('MicContext: Audio load failed:', loadError);
      }
      
      try {
        if (!userInteractedRef.current) {
          // Defer playback until a user gesture occurs
          console.warn('MicContext: Deferring audio playback until user interaction due to autoplay policy');
          pendingAudioUrlRef.current = url;
          return;
        }
        await el.play();
        console.log('MicContext: Audio play() succeeded');
      } catch (playError) {
        if ((playError as any)?.name === 'NotAllowedError') {
          console.warn('MicContext: Audio play blocked by autoplay policy; will retry on next user interaction');
          pendingAudioUrlRef.current = url;
          return;
        }
        console.error('MicContext: Audio play() failed:', playError);
        return;
      }
      
      await new Promise<void>((resolve) => {
        const cleanup = () => {
          el!.removeEventListener("ended", onEnded);
          el!.removeEventListener("error", onErr);
          el!.removeEventListener("pause", onPause);
        };
        const onEnded = () => { 
          console.log('MicContext: Audio ended normally');
          cleanup(); 
          resolve(); 
        };
        const onErr = (event: any) => { 
          console.error('MicContext: Audio error event:', {
            type: event?.type,
            target: event?.target?.tagName,
            src: event?.target?.src,
            error: event?.target?.error,
            networkState: event?.target?.networkState,
            readyState: event?.target?.readyState
          });
          cleanup(); 
          resolve(); 
        };
        const onPause = () => { 
          console.log('MicContext: Audio paused');
          cleanup(); 
          resolve(); 
        };
        el!.addEventListener("ended", onEnded, { once: true });
        el!.addEventListener("error", onErr, { once: true });
        el!.addEventListener("pause", onPause, { once: true });
      });
    } catch {}
  }, []);

  const stopPlaybackAndClear = useCallback(() => {
    try {
      const el = audioRef.current;
      if (el) {
        el.pause();
        el.currentTime = 0;
        try { el.src = ""; } catch {}
      }
    } catch {}
    pendingAudioUrlRef.current = null;
    audioQueueRef.current = [];
    audioPlayingRef.current = false;
    try { setProcessingRing(false); } catch {}
  }, []);

  // Pause audio playback immediately without clearing the current source or queue.
  // Useful for interrupts (barge-in) where we want to halt sound right away.
  const pausePlayback = useCallback(() => {
    try {
      const el = audioRef.current;
      if (el) {
        el.pause();
      }
    } catch {}
    audioPlayingRef.current = false;
    try { setProcessingRing(false); } catch {}
  }, []);

  const ensureAudioWorker = useCallback(async () => {
    if (audioPlayingRef.current) {
      console.log("MicContext: Audio already playing, skipping");
      return;
    }
    const next = audioQueueRef.current.shift();
    if (!next) {
      console.log("MicContext: No audio in queue");
      return;
    }
    console.log("MicContext: Starting audio playback:", next);
    audioPlayingRef.current = true;
    try { setBusy("tts"); } catch {}
    // TTS is starting – stop the ring
    try { setProcessingRing(false); } catch {}
    try {
      await playAudio(next);
      console.log("MicContext: Audio playback finished");
    } finally {
      audioPlayingRef.current = false;
      try { if (busy === "tts") setBusy("idle"); } catch {}
      if (audioQueueRef.current.length > 0) {
        console.log("MicContext: More audio in queue, continuing...");
        void ensureAudioWorker();
      }
    }
  }, [playAudio]);

  const enqueueAudio = useCallback((url: string) => {
    if (!url) return;
    console.log("MicContext: Enqueueing audio URL:", url, "Queue length:", audioQueueRef.current.length);
    audioQueueRef.current.push(url);
    void ensureAudioWorker();
  }, [ensureAudioWorker]);

  // Mark first user interaction and, if needed, retry any pending audio play
  useEffect(() => {
    const markInteracted = () => {
      if (!userInteractedRef.current) {
        userInteractedRef.current = true;
        console.log("MicContext: User interaction detected; audio playback unlocked");
        const url = pendingAudioUrlRef.current;
        if (url) {
          pendingAudioUrlRef.current = null;
          try { enqueueAudio(url); } catch {}
        }
      }
    };
    window.addEventListener("pointerdown", markInteracted, { once: false, passive: true });
    window.addEventListener("keydown", markInteracted, { once: false, passive: true });
    window.addEventListener("touchstart", markInteracted, { once: false, passive: true });
    return () => {
      window.removeEventListener("pointerdown", markInteracted as any);
      window.removeEventListener("keydown", markInteracted as any);
      window.removeEventListener("touchstart", markInteracted as any);
    };
  }, [enqueueAudio]);

  // --- TTS helpers ---
  const callTTSChunk = useCallback(async (text: string): Promise<string> => {
    try {
      console.log("MicContext: Calling TTS for text:", text);
      
      // Helper to perform one TTS request with timeout
      const doOnce = async (): Promise<Response> => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);
        try {
          const res = await fetch("/api/v1/tts", {
            method: "POST",
            headers: { 
              "content-type": "application/json",
              "x-request-id": Math.random().toString(36).slice(2)
            },
            body: JSON.stringify({ text, sessionId: sessionId || undefined }),
            signal: controller.signal,
          });
          return res;
        } finally {
          clearTimeout(timeoutId);
        }
      };

      // Try once, and retry one time on timeout
      let res: Response | null = null;
      let timedOut = false;
      try {
        res = await doOnce();
      } catch (e: any) {
        if (e?.name === 'AbortError') timedOut = true; else throw e;
      }
      if (!res && timedOut) {
        console.warn(`MicContext: TTS timed out after ${TTS_TIMEOUT_MS}ms; retrying once`);
        try { res = await doOnce(); } catch (e) { if ((e as any)?.name === 'AbortError') console.error(`MicContext: TTS timed out again after ${TTS_TIMEOUT_MS}ms`); }
      }
      if (!res) return "";

      console.log("MicContext: TTS response status:", res.status);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error("MicContext: TTS failed:", res.status, data?.error);
        throw new Error(data?.error || `tts failed: ${res.status}`);
      }
      const audioUrl = String(data?.audioUrl || "");
      const ttsDurationMs = Number(data?.durationMs || 0) || undefined;
      if (typeof ttsDurationMs === 'number') {
        try { console.log(JSON.stringify({ type: 'voice.tts.duration', durationMs: ttsDurationMs })); } catch {}
      }
      console.log("MicContext: TTS returned audioUrl:", audioUrl);
      return audioUrl;
    } catch (e) {
      if (e instanceof Error && (e.name === 'AbortError')) {
        console.error(`MicContext: TTS request timed out after ${TTS_TIMEOUT_MS}ms`);
      } else {
        console.error("MicContext: TTS error:", e);
      }
      return "";
    }
  }, [sessionId, TTS_TIMEOUT_MS]);

  const ensureTTSWorker = useCallback(async () => {
    if (ttsProcessingRef.current) return;
    console.log("MicContext: Starting TTS worker, queue length:", ttsTextQueueRef.current.length);
    ttsProcessingRef.current = true;
    const myGen = ttsCancelRef.current;
    try {
      while (ttsTextQueueRef.current.length > 0) {
        if (ttsCancelRef.current !== myGen) {
          console.log("MicContext: TTS worker cancelled");
          break;
        }
        const text = ttsTextQueueRef.current.shift()!;
        console.log("MicContext: Processing TTS for:", text);
        const url = await callTTSChunk(text);
        if (ttsCancelRef.current !== myGen) {
          console.log("MicContext: TTS worker cancelled after TTS call");
          break;
        }
        if (url) {
          console.log("MicContext: Enqueueing audio URL:", url);
          enqueueAudio(url);
        } else {
          console.log("MicContext: No audio URL returned for text:", text);
        }
      }
    } finally {
      ttsProcessingRef.current = false;
      console.log("MicContext: TTS worker finished");
    }
  }, [callTTSChunk, enqueueAudio]);

  const enqueueTTSSegment = useCallback((text: string) => {
    if (!text || !text.trim()) return;
    console.log("MicContext: TTS enqueueTTSSegment", { text, queueLen: ttsTextQueueRef.current.length });
    ttsTextQueueRef.current.push(text.trim());
    void ensureTTSWorker();
  }, [ensureTTSWorker]);

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

  const waitForQueueToDrain = useCallback(async (timeoutMs = 15000): Promise<void> => {
    const start = Date.now();
    return new Promise<void>((resolve) => {
      const tick = () => {
        const empty = audioQueueRef.current.length === 0 && !audioPlayingRef.current && !ttsProcessingRef.current && ttsTextQueueRef.current.length === 0;
        if (empty || Date.now() - start > timeoutMs) return resolve();
        setTimeout(tick, 100);
      };
      tick();
    });
  }, []);

  // --- History helpers ---
  function historyStorageKey(sid: string) {
    return `chatHistory:${sid}`;
  }

  function saveHistory() {
    try {
      if (!sessionId) return;
      const items = historyRef.current.slice(-10);
      localStorage.setItem(historyStorageKey(sessionId), JSON.stringify(items));
    } catch {}
  }

  useEffect(() => {
    if (!sessionId) return;
    try {
      const raw = localStorage.getItem(historyStorageKey(sessionId));
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          historyRef.current = arr
            .filter((x: any) => x && typeof x.content === "string" && (x.role === "user" || x.role === "assistant"))
            .slice(-10);
        }
      }
    } catch {}
  }, [sessionId]);

  function toBase64Url(s: string): string {
    try {
      const bytes = new TextEncoder().encode(s);
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const b64 = btoa(bin);
      return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    } catch {
      try {
        const b64 = btoa(unescape(encodeURIComponent(s)));
        return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
      } catch {
        return "";
      }
    }
  }

  function buildHistoryParam(): string {
    const maxN = MAX_HISTORY_FOR_VOICE; // Use optimized depth for voice interactions
    const items = historyRef.current.slice(-maxN).map((m) => ({
      role: m.role,
      content: (m.content || "").slice(0, 240),
    }));
    try {
      const json = JSON.stringify(items);
      return toBase64Url(json);
    } catch {
      return "";
    }
  }

  // --- STT and Chat helpers ---
  const callSTTMultipart = useCallback(async (b: Blob, detectMs?: number): Promise<{ text: string }> => {
    setBusy("stt");
    try { setProcessingRing(true); } catch {}
    const sttStart = Date.now();
    const form = new FormData();
    form.set("audio", b, "utterance.webm");
    if (sessionId) form.set("sessionId", sessionId);
    const headers: Record<string, string> = {};
    if (typeof detectMs === 'number' && isFinite(detectMs) && detectMs >= 0) {
      headers["x-detect-ms"] = String(Math.round(detectMs));
    }
    // Log STT request start
    try { console.log(JSON.stringify({ type: 'voice.stt.request_start', t0: sttStart, bytes: b.size, detectMs })); } catch {}
    const res = await fetch("/api/v1/stt", { method: "POST", body: form, headers });
    // Log when response headers arrive
    try { console.log(JSON.stringify({ type: 'voice.stt.response_headers', dtMs: Date.now() - sttStart, status: res.status })); } catch {}
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `stt failed: ${res.status}`);
    try { console.log(JSON.stringify({ type: 'voice.stt.done', latencyMs: Date.now() - sttStart })); } catch {}
    return { text: String(data?.text || "") };
  }, [sessionId]);

  const chatToText = useCallback(async (promptText: string, opts?: { includeHistory?: boolean }): Promise<string> => {
    setBusy("chat");
    // Clear assistant text for a fresh streaming response
    try { setAssistantText(""); } catch {}
    return new Promise<string>((resolve, reject) => {
      try {
        const includeHistory = opts?.includeHistory !== false;
        const hist = includeHistory ? buildHistoryParam() : "";
        const qs = `?prompt=${encodeURIComponent(promptText)}${sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : ""}${hist ? `&history=${encodeURIComponent(hist)}` : ""}`;
        // Ensure any previous stream is closed before starting a new one
        try { if (chatEsRef.current) { chatEsRef.current.close(); chatEsRef.current = null; } } catch {}
        const es = new EventSource(`/api/chat${qs}`, { withCredentials: false });
        chatEsRef.current = es;
        try { console.log("MicContext: chatToText: EventSource opened", { url: `/api/chat${qs}`, includeHistory }); } catch {}
        let acc = "";
        let lastFlushed = 0;
        const minFlushChars = 12;

        es.onopen = () => {
          try { console.log("MicContext: chatToText: onopen"); } catch {}
        };
        let idleTimer: ReturnType<typeof setTimeout> | null = null;
        const maybeFlush = (force = false) => {
          const pending = acc.slice(lastFlushed);
          if (!force && pending.length < minFlushChars) return;
          const segment = pending.trim();
          if (!segment) return;
          console.log("MicContext: TTS maybeFlush", { force, pendingLen: pending.length, segment });
          lastFlushed = acc.length;
          enqueueTTSSegment(segment);
        };
        const flushOnPunctuation = () => {
          const tail = acc.slice(lastFlushed);
          const idx = Math.max(tail.lastIndexOf("."), tail.lastIndexOf("!"), tail.lastIndexOf("?"), tail.lastIndexOf("\n"));
          if (idx >= 0) {
            const cut = lastFlushed + idx + 1;
            const seg = acc.slice(lastFlushed, cut).trim();
            if (seg.length >= 1) {
              console.log("MicContext: TTS flushOnPunctuation", { seg, lastFlushed, idx, cut });
              lastFlushed = cut;
              enqueueTTSSegment(seg);
            }
          }
        };
        es.onmessage = (evt) => {
          if (evt.data === "[DONE]") {
            try { console.log("MicContext: chatToText: DONE received", { accLen: acc.length }); } catch {}
            try { es.close(); } catch {}
            try { if (chatEsRef.current === es) chatEsRef.current = null; } catch {}
            const tail = acc.slice(lastFlushed).trim();
            if (tail.length > 0) enqueueTTSSegment(tail);
            // Update history with assistant response
            if (acc && acc.length > 0) {
              historyRef.current.push({ role: "assistant", content: acc });
              if (historyRef.current.length > 10) historyRef.current = historyRef.current.slice(-10);
              saveHistory();
            }
            resolve(acc);
            return;
          }
          acc += evt.data;
          setAssistantText((prev) => prev + evt.data);
          flushOnPunctuation();
          if (idleTimer) { try { clearTimeout(idleTimer); } catch {} }
          idleTimer = setTimeout(() => { maybeFlush(true); }, 200);
        };
        es.onerror = (e) => {
          try { console.error("MicContext: chatToText: onerror", e); } catch {}
          try { es.close(); } catch {}
          try { if (chatEsRef.current === es) chatEsRef.current = null; } catch {}
          reject(new Error("chat stream failed"));
        };
      } catch (e: any) {
        reject(new Error(e?.message || "chat failed"));
      }
    });
  }, [enqueueTTSSegment]);

  // Public helper to trigger a chat from UI without voice
  const sendPrompt = useCallback(async (prompt: string): Promise<string> => {
    if (!prompt || !prompt.trim()) return "";
    try {
      // Also add to history as a user message for context continuity
      historyRef.current.push({ role: "user", content: prompt });
      if (historyRef.current.length > 10) historyRef.current = historyRef.current.slice(-10);
      saveHistory();
      const reply = await chatToText(prompt, { includeHistory: true });
      return reply;
    } catch (e: any) {
      setVoiceError(e?.message || "chat failed");
      throw e;
    } finally {
      if (busy === "chat") setBusy("idle");
    }
  }, [chatToText, busy]);

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
    
    // Clear recording state immediately
    setRecording(false);
    // Clear speaking indicator
    try { setInputSpeaking(false); } catch {}
    
    // Stop MediaRecorder and clear reference
    const rec = mediaRef.current;
    if (rec) {
      console.log("MicContext: Stopping MediaRecorder, state:", rec.state);
      try { 
        if (rec.state !== "inactive") {
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
    
    // Clear timers and intervals
    if (stopTimerRef.current) { 
      window.clearTimeout(stopTimerRef.current); 
      stopTimerRef.current = null; 
    }
    if (vadIntervalRef.current) { 
      window.clearInterval(vadIntervalRef.current); 
      vadIntervalRef.current = null; 
    }
    
    // Clean up audio context and other refs
    try { audioCtxRef.current?.close(); audioCtxRef.current = null; } catch {}
    try { speechFramesRef.current = 0; bargeArmedRef.current = false; } catch {}
  }, []);

  const startRecording = useCallback(async () => {
    setVoiceError("");
    try { bargeArmedRef.current = true; speechFramesRef.current = 0; } catch {}

    // Check if already recording
    if (recording) {
      console.log("MicContext: Already recording, ignoring start request");
      return;
    }

    // Check if busy with other operations
    if (busy !== "idle") {
      console.log("MicContext: Busy with", busy, "ignoring start request");
      return;
    }

    if (!mediaSupported) {
      const error = "Microphone not supported in this browser";
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
          if (!recFirstChunkTsRef.current) {
            recFirstChunkTsRef.current = Date.now();
            const t0 = recStartTsRef.current || recFirstChunkTsRef.current;
            try { console.log(JSON.stringify({ type: 'voice.record.first_chunk', t0, tFirst: recFirstChunkTsRef.current, deltaMs: recFirstChunkTsRef.current - t0 })); } catch {}
          }
        }
      };

      rec.onstop = async () => {
        console.log("MicContext: Recording stopped, processing", chunks.length, "chunks");
        console.log("MicContext: voiceLoopRef.current =", voiceLoopRef.current);
        console.log("MicContext: recordingRef.current =", recordingRef.current);
        // Ensure UI state reflects that we are no longer recording.
        // This is critical so the barge monitor can start while assistant is responding.
        try { setRecording(false); } catch {}
        
        // Only skip processing if voice loop is disabled (paused)
        if (!voiceLoopRef.current) {
          console.log("MicContext: Voice loop disabled, skipping processing");
          setBusy("idle");
          return;
        }
        
        // Clean up stream tracks (already done in stopRecording, but ensure here too)
        try { stream.getTracks().forEach((t) => t.stop()); } catch {}
        if (stopTimerRef.current) { window.clearTimeout(stopTimerRef.current); stopTimerRef.current = null; }
        if (vadIntervalRef.current) { window.clearInterval(vadIntervalRef.current); vadIntervalRef.current = null; }
        try { audioCtxRef.current?.close(); audioCtxRef.current = null; } catch {}
        try { speechFramesRef.current = 0; bargeArmedRef.current = false; } catch {}

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
              const { text } = await callSTTMultipart(b, detectMs);
              if (text && text.trim()) {
                console.log("MicContext: STT result:", text);
                setTranscript(text);
                // Update history with user message
                historyRef.current.push({ role: "user", content: text });
                if (historyRef.current.length > 10) historyRef.current = historyRef.current.slice(-10);
                saveHistory();
                void ingestMessage("user", text);
                const reply = await chatToText(text, { includeHistory: true });
                console.log("MicContext: Chat response:", reply);
                setAssistantText(reply);
                void ingestMessage("assistant", reply);
              } else {
                console.log("MicContext: No speech detected");
                setVoiceError("No speech detected. Please try again.");
                try { setProcessingRing(false); } catch {}
              }
            } catch (e: any) {
              console.error("MicContext: Voice chat failed:", e);
              setVoiceError(e?.message || "Voice chat failed");
            } finally {
              setBusy("idle");
              try { setProcessingRing(false); } catch {}
              // restart loop only if still enabled
              if (voiceLoopRef.current) {
                console.log("MicContext: Restarting voice loop after processing");
                try { await waitForQueueToDrain(6000); } catch {}
                try { await startRecording(); } catch {}
              } else {
                console.log("MicContext: Voice loop disabled, not restarting");
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
              const { text } = await callSTTMultipart(b, detectMs);
              setProcessingRing(true);
              if (text && text.trim()) {
                console.log("MicContext: STT result:", text);
                setTranscript(text);
                // Update history with user message
                historyRef.current.push({ role: "user", content: text });
                if (historyRef.current.length > 10) historyRef.current = historyRef.current.slice(-10);
                saveHistory();
                void ingestMessage("user", text);
                const reply = await chatToText(text);
                console.log("MicContext: Chat response:", reply);
                setAssistantText(reply);
                void ingestMessage("assistant", reply);
              } else {
                console.log("MicContext: No speech detected (one-shot)");
                setVoiceError("No speech detected. Please try again.");
                try { setProcessingRing(false); } catch {}
              }
            } catch (e: any) {
              console.error("MicContext: One-shot voice chat failed:", e);
              setVoiceError(e?.message || "Voice chat failed");
            } finally {
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
          setVoiceError("Failed to finalize recording");
          setBusy("idle");
          try { setProcessingRing(false); } catch {}
        }
      };

      rec.start(100);
      console.log("MicContext: Recording started");
      setRecording(true);
      // Reset speaking indicator on start
      try { setInputSpeaking(false); } catch {}

      if (stopTimerRef.current) { window.clearTimeout(stopTimerRef.current); }
      stopTimerRef.current = window.setTimeout(() => {
        console.log("MicContext: Auto-stop timer triggered");
        try { rec.stop(); } catch {}
      }, MAX_UTTER_MS);

      // Simple VAD - enable trailing-silence based auto-stop
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioCtxRef.current = audioCtx;
        const src = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        src.connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        let lastSpeechTs = Date.now();
        let firstSpeechTs: number | null = null;
        let silenceFrames = 0;
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
            if (rms >= VAD_THRESHOLD) {
              speechFramesRef.current += 1;
              lastSpeechTs = Date.now();
              silenceFrames = 0;
              if (!firstSpeechTs) firstSpeechTs = lastSpeechTs;
              // Mark speaking when over threshold
              try { setInputSpeaking(true); } catch {}
            } else {
              // Accumulate silence frames with debounce
              silenceFrames += 1;
              const now = Date.now();
              const hadSpeech = speechFramesRef.current > 0;
              const graceOk = (firstSpeechTs ? (now - firstSpeechTs) : (now - (recStartTsRef.current || now))) >= VAD_GRACE_MS;
              const minSpeechOk = firstSpeechTs ? (now - firstSpeechTs) >= MIN_SPEECH_MS : false;
              const sustainedSilence = (now - lastSpeechTs) > VAD_MAX_SILENCE_MS && silenceFrames >= SILENCE_DEBOUNCE_FRAMES;
              // Decay speaking indicator when under threshold
              try { setInputSpeaking(false); } catch {}
              if (hadSpeech && graceOk && minSpeechOk && sustainedSilence) {
                console.log("MicContext: VAD auto-stop triggered", { rms, VAD_THRESHOLD, silenceMs: now - lastSpeechTs, silenceFrames, SILENCE_DEBOUNCE_FRAMES, MIN_SPEECH_MS, VAD_GRACE_MS });
                try { rec.stop(); } catch {}
              }
            }
          } catch (e) {
            console.log("MicContext: VAD interval error:", e);
          }
        }, 100);
        console.log("MicContext: VAD enabled", { VAD_THRESHOLD, VAD_MAX_SILENCE_MS, MIN_SPEECH_MS, SILENCE_DEBOUNCE_FRAMES, VAD_GRACE_MS });
      } catch (e) {
        console.log("MicContext: Failed to initialize VAD:", e);
      }

    } catch (e: any) {
      console.error("MicContext: Mic permission denied:", e);
      setVoiceError(e?.message || "Mic permission denied or unavailable");
    }
  }, [BARGE_MIN_FRAMES, BARGE_RMS_THRESHOLD, MAX_UTTER_MS, VAD_MAX_SILENCE_MS, VAD_THRESHOLD, busy, callSTTMultipart, chatToText, mediaSupported, recording, stopPlaybackAndClear, waitForQueueToDrain, voiceLoopRef, ingestMessage]);

  const toggleVoiceLoop = useCallback(() => {
    console.log("MicContext: toggleVoiceLoop called, current state:", { voiceLoop, recording, busy });

    if (voiceLoop) {
      console.log("MicContext: Stopping voice loop");
      setVoiceLoop(false);
      try { stopRecording(); } catch (e) { console.error("MicContext: Error stopping recording:", e); }
      try { chatEsRef.current?.close(); chatEsRef.current = null; } catch (e) { console.error("MicContext: Error closing chat:", e); }
      try { stopPlaybackAndClear(); } catch (e) { console.error("MicContext: Error stopping playback:", e); }
      try { ttsTextQueueRef.current = []; ttsProcessingRef.current = false; } catch (e) { console.error("MicContext: Error clearing TTS queue:", e); }
    } else {
      console.log("MicContext: Starting voice loop");
      setVoiceLoop(true);
      if (!recording) {
        console.log("MicContext: Not recording, starting recording...");
        void startRecording();
      } else {
        console.log("MicContext: Already recording, not starting again");
      }
    }
  }, [recording, startRecording, stopRecording, stopPlaybackAndClear, voiceLoop]);

  const setVoiceLoopState = useCallback((v: boolean) => {
    console.log("MicContext: setVoiceLoop called with:", v);
    setVoiceLoop(v);
  }, []);

  const clear = useCallback(() => {
    setTranscript("");
    setAssistantText("");
    setVoiceError("");
  }, []);

  // --- Barge-in monitor (placed after startRecording to avoid forward refs) ---
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
            // Interrupt playback and chat immediately
            try { pausePlayback(); } catch {}
            // Clear any queued audio so nothing resumes after interrupt
            try { audioQueueRef.current = []; } catch {}
            // Cancel any in-flight or queued TTS
            ttsCancelRef.current += 1;
            ttsTextQueueRef.current = [];
            pendingAudioUrlRef.current = null;
            try { chatEsRef.current?.close(); chatEsRef.current = null; } catch {}
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
  }, [BARGE_MIN_FRAMES, BARGE_RMS_THRESHOLD, startRecording, stopBargeMonitor]);

  // Start/stop barge monitor only when assistant audio is playing.
  // Avoid monitoring during text streaming (busy === 'chat') to prevent premature interrupts.
  useEffect(() => {
    const shouldMonitor = voiceLoop && !recording && audioPlayingRef.current;
    try { console.log("MicContext: Barge monitor check", { voiceLoop, recording, audioPlaying: audioPlayingRef.current, busy }); } catch {}
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
