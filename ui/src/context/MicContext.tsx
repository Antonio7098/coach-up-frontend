"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "./ChatContext";

// Mic context centralizing voice loop state, recording, STT/TTS, audio queues, and barge-in.
// This mirrors the logic used in `app/coach/page.tsx` but is decoupled so it can be reused globally.

export type MicBusyState = "idle" | "stt" | "chat" | "tts";

type MicContextValue = {
  mediaSupported: boolean;
  recording: boolean;
  busy: MicBusyState;
  voiceError: string;
  voiceLoop: boolean;
  transcript: string;
  assistantText: string;
  // Controls
  setVoiceLoop: (v: boolean) => void;
  toggleVoiceLoop: () => void;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  clear: () => void;
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

  const mediaRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const chatEsRef = useRef<EventSource | null>(null);

  // Playback/tts queues
  const audioQueueRef = useRef<string[]>([]);
  const audioPlayingRef = useRef<boolean>(false);
  const ttsTextQueueRef = useRef<string[]>([]);
  const ttsProcessingRef = useRef<boolean>(false);

  // Barge-in helpers
  const bargeArmedRef = useRef<boolean>(false);
  const speechFramesRef = useRef<number>(0);

  // VAD helpers
  const audioCtxRef = useRef<AudioContext | null>(null);
  const vadIntervalRef = useRef<number | null>(null);

  // Config
  const LONG_PRESS_MS = 500; // exported for consistency with coach page
  const MAX_UTTER_MS = Number(process.env.NEXT_PUBLIC_VOICE_MAX_UTTERANCE_MS ?? 0) || 15000;
  const VAD_THRESHOLD = Number(process.env.NEXT_PUBLIC_VOICE_VAD_THRESHOLD ?? 0) || 0.02; // RMS
  const VAD_MAX_SILENCE_MS = Number(process.env.NEXT_PUBLIC_VOICE_VAD_MAX_SILENCE_MS ?? 0) || 900;
  const BARGE_RMS_THRESHOLD = Math.max(Number(process.env.NEXT_PUBLIC_BARGE_RMS_THRESHOLD ?? 0) || VAD_THRESHOLD * 2.5, 0.05);
  const BARGE_MIN_FRAMES = Number(process.env.NEXT_PUBLIC_BARGE_MIN_FRAMES ?? 0) || 5; // ~500ms at 100ms interval

  useEffect(() => {
    const ok = typeof window !== "undefined" && !!navigator?.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== "undefined";
    setMediaSupported(ok);
  }, []);

  // --- Audio playback helpers ---
  const playAudio = useCallback(async (url: string) => {
    try {
      let el = audioRef.current;
      if (!el) {
        el = new Audio();
        audioRef.current = el;
      }
      el.autoplay = true;
      el.src = url;
      try { el.load(); } catch {}
      await el.play().catch(() => {});
      await new Promise<void>((resolve) => {
        const cleanup = () => {
          el!.removeEventListener("ended", onEnded);
          el!.removeEventListener("error", onErr);
          el!.removeEventListener("pause", onPause);
        };
        const onEnded = () => { cleanup(); resolve(); };
        const onErr = () => { cleanup(); resolve(); };
        const onPause = () => { cleanup(); resolve(); };
        el!.addEventListener("ended", onEnded, { once: true });
        el!.addEventListener("error", onErr, { once: true });
        el!.addEventListener("pause", onPause, { once: true });
      });
    } catch {}
  }, []);

  const stopPlaybackAndClear = useCallback(() => {
    try { const el = audioRef.current; if (el) { el.pause(); el.currentTime = 0; } } catch {}
    audioQueueRef.current = [];
    audioPlayingRef.current = false;
  }, []);

  const ensureAudioWorker = useCallback(async () => {
    if (audioPlayingRef.current) return;
    const next = audioQueueRef.current.shift();
    if (!next) return;
    audioPlayingRef.current = true;
    try {
      await playAudio(next);
    } finally {
      audioPlayingRef.current = false;
      if (audioQueueRef.current.length > 0) void ensureAudioWorker();
    }
  }, [playAudio]);

  const enqueueAudio = useCallback((url: string) => {
    if (!url) return;
    audioQueueRef.current.push(url);
    void ensureAudioWorker();
  }, [ensureAudioWorker]);

  // --- TTS helpers ---
  const callTTSChunk = useCallback(async (text: string): Promise<string> => {
    try {
      const res = await fetch("/api/v1/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, sessionId: sessionId || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `tts failed: ${res.status}`);
      return String(data?.audioUrl || "");
    } catch {
      return "";
    }
  }, [sessionId]);

  const ensureTTSWorker = useCallback(async () => {
    if (ttsProcessingRef.current) return;
    ttsProcessingRef.current = true;
    try {
      while (ttsTextQueueRef.current.length > 0) {
        const text = ttsTextQueueRef.current.shift()!;
        const url = await callTTSChunk(text);
        if (url) enqueueAudio(url);
      }
    } finally {
      ttsProcessingRef.current = false;
    }
  }, [callTTSChunk, enqueueAudio]);

  const enqueueTTSSegment = useCallback((text: string) => {
    if (!text || !text.trim()) return;
    ttsTextQueueRef.current.push(text.trim());
    void ensureTTSWorker();
  }, [ensureTTSWorker]);

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

  // --- STT and Chat helpers ---
  const callSTTMultipart = useCallback(async (b: Blob): Promise<{ text: string }> => {
    setBusy("stt");
    const form = new FormData();
    form.set("audio", b, "utterance.webm");
    if (sessionId) form.set("sessionId", sessionId);
    const res = await fetch("/api/v1/stt", { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `stt failed: ${res.status}`);
    return { text: String(data?.text || "") };
  }, [sessionId]);

  const chatToText = useCallback(async (promptText: string): Promise<string> => {
    setBusy("chat");
    return new Promise<string>((resolve, reject) => {
      try {
        const qs = `?prompt=${encodeURIComponent(promptText)}`;
        const es = new EventSource(`/api/chat${qs}`, { withCredentials: false });
        try { chatEsRef.current?.close(); } catch {}
        chatEsRef.current = es;
        let acc = "";
        let lastFlushed = 0;
        const minFlushChars = 12;
        let idleTimer: ReturnType<typeof setTimeout> | null = null;
        const maybeFlush = (force = false) => {
          const pending = acc.slice(lastFlushed);
          if (!force && pending.length < minFlushChars) return;
          const segment = pending.trim();
          if (!segment) return;
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
              lastFlushed = cut;
              enqueueTTSSegment(seg);
            }
          }
        };
        es.onmessage = (evt) => {
          if (evt.data === "[DONE]") {
            try { es.close(); } catch {}
            try { if (chatEsRef.current === es) chatEsRef.current = null; } catch {}
            const tail = acc.slice(lastFlushed).trim();
            if (tail.length > 0) enqueueTTSSegment(tail);
            resolve(acc);
            return;
          }
          acc += evt.data;
          setAssistantText((prev) => prev + evt.data);
          flushOnPunctuation();
          if (idleTimer) { try { clearTimeout(idleTimer); } catch {} }
          idleTimer = setTimeout(() => { maybeFlush(true); }, 200);
        };
        es.onerror = () => {
          try { es.close(); } catch {}
          try { if (chatEsRef.current === es) chatEsRef.current = null; } catch {}
          reject(new Error("chat stream failed"));
        };
      } catch (e: any) {
        reject(new Error(e?.message || "chat failed"));
      }
    });
  }, [enqueueTTSSegment]);

  const ingestMessage = useCallback(async (role: "user" | "assistant", content: string) => {
    try {
      if (!sessionId || !content) return;
      const payload = { sessionId, messageId: Math.random().toString(36).slice(2), role, content, ts: Date.now() } as const;
      await fetch("/api/messages/ingest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    } catch {}
  }, [sessionId]);

  // --- Recording controls ---
  const stopRecording = useCallback(() => {
    const rec = mediaRef.current;
    if (rec && rec.state !== "inactive") {
      try { rec.stop(); } catch {}
    }
    setRecording(false);
    if (stopTimerRef.current) { window.clearTimeout(stopTimerRef.current); stopTimerRef.current = null; }
    if (vadIntervalRef.current) { window.clearInterval(vadIntervalRef.current); vadIntervalRef.current = null; }
    try { audioCtxRef.current?.close(); audioCtxRef.current = null; } catch {}
    try { speechFramesRef.current = 0; bargeArmedRef.current = false; } catch {}
  }, []);

  const startRecording = useCallback(async () => {
    setVoiceError("");
    try { bargeArmedRef.current = true; speechFramesRef.current = 0; } catch {}
    if (busy !== "idle") return;
    if (!mediaSupported) {
      setVoiceError("Microphone not supported in this browser");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : (MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "");
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      mediaRef.current = rec;
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) chunks.push(ev.data); };
      rec.onstop = async () => {
        try { stream.getTracks().forEach((t) => t.stop()); } catch {}
        if (stopTimerRef.current) { window.clearTimeout(stopTimerRef.current); stopTimerRef.current = null; }
        if (vadIntervalRef.current) { window.clearInterval(vadIntervalRef.current); vadIntervalRef.current = null; }
        try { audioCtxRef.current?.close(); audioCtxRef.current = null; } catch {}
        try {
          const outType = mime && mime.startsWith("audio/webm") ? "audio/webm" : (mime || "audio/webm");
          const b = new Blob(chunks, { type: outType });
          if (b.size > 0) {
            if (voiceLoop) {
              // Voice loop: process then restart
              try {
                const { text } = await callSTTMultipart(b);
                if (text && text.trim()) {
                  setTranscript(text);
                  void ingestMessage("user", text);
                  const reply = await chatToText(text);
                  setAssistantText(reply);
                  void ingestMessage("assistant", reply);
                } else {
                  setVoiceError("No speech detected. Please try again.");
                }
              } catch (e: any) {
                setVoiceError(e?.message || "Voice chat failed");
              } finally {
                setBusy("idle");
                // restart loop
                if (voiceLoop) {
                  try { await waitForQueueToDrain(6000); } catch {}
                  try { await startRecording(); } catch {}
                }
              }
            } else {
              // One-shot mode
              try {
                const { text } = await callSTTMultipart(b);
                if (text && text.trim()) {
                  setTranscript(text);
                  void ingestMessage("user", text);
                  const reply = await chatToText(text);
                  setAssistantText(reply);
                  void ingestMessage("assistant", reply);
                } else {
                  setVoiceError("No speech detected. Please try again.");
                }
              } catch (e: any) {
                setVoiceError(e?.message || "Voice chat failed");
              } finally {
                setBusy("idle");
              }
            }
          } else {
            setVoiceError("No audio captured");
          }
        } catch {
          setVoiceError("Failed to finalize recording");
        }
      };
      rec.start(100);
      setRecording(true);
      if (stopTimerRef.current) { window.clearTimeout(stopTimerRef.current); }
      stopTimerRef.current = window.setTimeout(() => {
        try { rec.stop(); } catch {}
      }, MAX_UTTER_MS);

      // Simple VAD
      try {
        const Ctor: any = (window as any).AudioContext || (window as any).webkitAudioContext;
        const ctx: AudioContext | null = Ctor ? new Ctor() : null;
        if (ctx) {
          audioCtxRef.current = ctx;
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 2048;
          source.connect(analyser);
          const data = new Float32Array(analyser.fftSize);
          let lastSpeech = Date.now();
          if (vadIntervalRef.current) { window.clearInterval(vadIntervalRef.current); vadIntervalRef.current = null; }
          vadIntervalRef.current = window.setInterval(() => {
            try {
              analyser.getFloatTimeDomainData(data);
              let sum = 0;
              for (let i = 0; i < data.length; i++) { const v = data[i]; sum += v * v; }
              const rms = Math.sqrt(sum / data.length);
              const ttsActive = audioPlayingRef.current || audioQueueRef.current.length > 0;
              if (rms > VAD_THRESHOLD) {
                lastSpeech = Date.now();
                if (rms > BARGE_RMS_THRESHOLD) {
                  speechFramesRef.current = Math.min(speechFramesRef.current + 1, 1000);
                } else {
                  speechFramesRef.current = Math.max(0, speechFramesRef.current - 1);
                }
                if (bargeArmedRef.current && ttsActive && speechFramesRef.current >= BARGE_MIN_FRAMES) {
                  try { stopPlaybackAndClear(); } catch {}
                  try { ttsTextQueueRef.current = []; ttsProcessingRef.current = false; } catch {}
                  try { chatEsRef.current?.close(); chatEsRef.current = null; } catch {}
                  bargeArmedRef.current = false;
                }
              } else {
                speechFramesRef.current = 0;
              }
              if (!ttsActive && Date.now() - lastSpeech > VAD_MAX_SILENCE_MS) {
                const id = vadIntervalRef.current; if (id) { window.clearInterval(id); vadIntervalRef.current = null; }
                try { rec.stop(); } catch {}
              }
            } catch {}
          }, 100);
        }
      } catch {}
    } catch (e: any) {
      setVoiceError(e?.message || "Mic permission denied or unavailable");
    }
  }, [BARGE_MIN_FRAMES, BARGE_RMS_THRESHOLD, MAX_UTTER_MS, VAD_MAX_SILENCE_MS, VAD_THRESHOLD, busy, callSTTMultipart, chatToText, mediaSupported, stopPlaybackAndClear, waitForQueueToDrain, voiceLoop, ingestMessage]);

  const toggleVoiceLoop = useCallback(() => {
    if (voiceLoop) {
      setVoiceLoop(false);
      try { stopRecording(); } catch {}
      try { chatEsRef.current?.close(); chatEsRef.current = null; } catch {}
      try { stopPlaybackAndClear(); } catch {}
      try { ttsTextQueueRef.current = []; ttsProcessingRef.current = false; } catch {}
    } else {
      setVoiceLoop(true);
      if (!recording) void startRecording();
    }
  }, [recording, startRecording, stopPlaybackAndClear, stopRecording, voiceLoop]);

  const clear = useCallback(() => {
    setTranscript("");
    setAssistantText("");
    setVoiceError("");
  }, []);

  const value = useMemo<MicContextValue>(() => ({
    mediaSupported,
    recording,
    busy,
    voiceError,
    voiceLoop,
    transcript,
    assistantText,
    setVoiceLoop,
    toggleVoiceLoop,
    startRecording,
    stopRecording,
    clear,
  }), [assistantText, busy, clear, mediaSupported, recording, startRecording, stopRecording, transcript, voiceError, voiceLoop, toggleVoiceLoop]);

  return (
    <MicContext.Provider value={value}>{children}</MicContext.Provider>
  );
}
