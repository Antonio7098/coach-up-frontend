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

  // Keep live refs to avoid stale closures inside MediaRecorder callbacks
  const voiceLoopRef = useRef<boolean>(voiceLoop);
  const recordingRef = useRef<boolean>(recording);
  useEffect(() => { voiceLoopRef.current = voiceLoop; }, [voiceLoop]);
  useEffect(() => { recordingRef.current = recording; }, [recording]);

  // Chat history for context (last 10 messages)
  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);

  const MAX_HISTORY_FOR_VOICE = 2; // Reduced from 3 for faster LLM processing

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
        await el.play();
        console.log('MicContext: Audio play() succeeded');
      } catch (playError) {
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
          console.error('MicContext: Audio error event:', event);
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
    try { const el = audioRef.current; if (el) { el.pause(); el.currentTime = 0; } } catch {}
    audioQueueRef.current = [];
    audioPlayingRef.current = false;
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
    try {
      await playAudio(next);
      console.log("MicContext: Audio playback finished");
    } finally {
      audioPlayingRef.current = false;
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

  // --- TTS helpers ---
  const callTTSChunk = useCallback(async (text: string): Promise<string> => {
    try {
      console.log("MicContext: Calling TTS for text:", text);
      
      // Add timeout to TTS request
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      
      const res = await fetch("/api/v1/tts", {
        method: "POST",
        headers: { 
          "content-type": "application/json",
          "x-request-id": Math.random().toString(36).slice(2)
        },
        body: JSON.stringify({ text, sessionId: sessionId || undefined }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
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
      if (e instanceof Error && e.name === 'AbortError') {
        console.error("MicContext: TTS request timed out after 5 seconds");
      } else {
        console.error("MicContext: TTS error:", e);
      }
      return "";
    }
  }, [sessionId]);

  const ensureTTSWorker = useCallback(async () => {
    if (ttsProcessingRef.current) return;
    console.log("MicContext: Starting TTS worker, queue length:", ttsTextQueueRef.current.length);
    ttsProcessingRef.current = true;
    try {
      while (ttsTextQueueRef.current.length > 0) {
        const text = ttsTextQueueRef.current.shift()!;
        console.log("MicContext: Processing TTS for:", text);
        const url = await callTTSChunk(text);
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
    console.log("MicContext: Enqueueing TTS segment:", text.trim());
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
  const callSTTMultipart = useCallback(async (b: Blob): Promise<{ text: string }> => {
    setBusy("stt");
    const sttStart = Date.now();
    const form = new FormData();
    form.set("audio", b, "utterance.webm");
    if (sessionId) form.set("sessionId", sessionId);
    const res = await fetch("/api/v1/stt", { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `stt failed: ${res.status}`);
    try { console.log(JSON.stringify({ type: 'voice.stt.done', latencyMs: Date.now() - sttStart })); } catch {}
    return { text: String(data?.text || "") };
  }, [sessionId]);

  const chatToText = useCallback(async (promptText: string): Promise<string> => {
    setBusy("chat");
    return new Promise<string>((resolve, reject) => {
      try {
        const hist = buildHistoryParam();
        const qs = `?prompt=${encodeURIComponent(promptText)}${sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : ""}${hist ? `&history=${encodeURIComponent(hist)}` : ""}`;
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
  const streamRef = useRef<MediaStream | null>(null);
  
  const stopRecording = useCallback(() => {
    console.log("MicContext: stopRecording called");
    
    // Clear recording state immediately
    setRecording(false);
    
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
              const { text } = await callSTTMultipart(b);
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
                console.log("MicContext: No speech detected");
                setVoiceError("No speech detected. Please try again.");
              }
            } catch (e: any) {
              console.error("MicContext: Voice chat failed:", e);
              setVoiceError(e?.message || "Voice chat failed");
            } finally {
              setBusy("idle");
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
              const { text } = await callSTTMultipart(b);
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
                console.log("MicContext: No speech detected");
                setVoiceError("No speech detected. Please try again.");
              }
            } catch (e: any) {
              console.error("MicContext: Voice chat failed:", e);
              setVoiceError(e?.message || "Voice chat failed");
            } finally {
              setBusy("idle");
            }
          } else {
            console.log("MicContext: No audio captured or voiceLoop disabled, skipping processing");
            setBusy("idle");
          }
        } catch (e) {
          console.error("MicContext: Failed to finalize recording:", e);
          setVoiceError("Failed to finalize recording");
          setBusy("idle");
        }
      };

      rec.start(100);
      console.log("MicContext: Recording started");
      setRecording(true);

      if (stopTimerRef.current) { window.clearTimeout(stopTimerRef.current); }
      stopTimerRef.current = window.setTimeout(() => {
        console.log("MicContext: Auto-stop timer triggered");
        try { rec.stop(); } catch {}
      }, MAX_UTTER_MS);

      // Simple VAD - disabled for debugging
      console.log("MicContext: VAD disabled for debugging");

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

  const value = useMemo<MicContextValue>(() => ({
    mediaSupported,
    recording,
    busy,
    voiceError,
    voiceLoop,
    transcript,
    assistantText,
    setVoiceLoop: setVoiceLoopState,
    toggleVoiceLoop,
    startRecording,
    stopRecording,
    clear,
  }), [assistantText, busy, clear, mediaSupported, recording, startRecording, stopRecording, transcript, voiceError, voiceLoop, toggleVoiceLoop, setVoiceLoopState]);

  return (
    <MicContext.Provider value={value}>{children}</MicContext.Provider>
  );
}
