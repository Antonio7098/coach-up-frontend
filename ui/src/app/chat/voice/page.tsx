"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

// Public flags (baked at build time)
const VOICE_ENABLED = (process.env.NEXT_PUBLIC_ENABLE_VOICE || "1") !== "0";
const MAX_UTTER_MS = Number(process.env.NEXT_PUBLIC_VOICE_MAX_UTTERANCE_MS || "15000");
// Tunable VAD / barge-in thresholds (defaults mirror coach page behavior)
const VAD_THRESHOLD = Number(process.env.NEXT_PUBLIC_VOICE_VAD_THRESHOLD || "0.02");
const BARGE_RMS_THRESHOLD = Number(
  process.env.NEXT_PUBLIC_BARGE_RMS_THRESHOLD || String(Math.max(2.5 * VAD_THRESHOLD, 0.05))
);
const BARGE_MIN_FRAMES = Number(process.env.NEXT_PUBLIC_BARGE_MIN_FRAMES || "5"); // ~500ms at 100ms hops
const VAD_MAX_SILENCE_MS = Number(process.env.NEXT_PUBLIC_VOICE_VAD_MAX_SILENCE_MS || "900");

function safeUUID(): string {
  try {
    const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
    return g.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

export default function VoiceChatPage() {
  const [sessionId, setSessionId] = useState<string>("");
  const [groupId, setGroupId] = useState<string>("");
  const [languageHint, setLanguageHint] = useState<string>("");

  const [recording, setRecording] = useState(false);
  const [mediaSupported, setMediaSupported] = useState(false);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceMonRef = useRef<{ ctx: AudioContext; src: MediaStreamAudioSourceNode; analyser: AnalyserNode; raf: number | null; started: number; lastSpoke: number } | null>(null);
  // Hidden player used by the playback queue (always mounted)
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // UI-visible player for manual inspection (not used by the queue)
  const uiAudioRef = useRef<HTMLAudioElement | null>(null);
  const chatEsRef = useRef<EventSource | null>(null);
  const [voiceLoop, setVoiceLoop] = useState(false);

  const [blob, setBlob] = useState<Blob | null>(null);
  const [objectKey, setObjectKey] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>("");
  const [assistantText, setAssistantText] = useState<string>("");
  const [ttsUrl, setTtsUrl] = useState<string>("");

  // Audio playback and TTS streaming helpers
  const audioQueueRef = useRef<string[]>([]);
  const audioPlayingRef = useRef<boolean>(false);
  const ttsTextQueueRef = useRef<string[]>([]); // queued text segments awaiting TTS
  const ttsProcessingRef = useRef<boolean>(false);
  // Barge-in state: arm on mic start; trigger only after sustained louder speech
  const bargeArmedRef = useRef<boolean>(false);
  const bargeFramesRef = useRef<number>(0);
  const bargeTriggeredRef = useRef<boolean>(false);

  const [busy, setBusy] = useState<"idle" | "presign" | "upload" | "stt" | "chat" | "tts">("idle");
  const [error, setError] = useState<string>("");

  // Debug + status log
  type LogLevel = "info" | "error";
  const [logs, setLogs] = useState<Array<{ ts: number; level: LogLevel; message: string }>>([]);
  const [showDebug, setShowDebug] = useState(false);
  const [lastPresignInfo, setLastPresignInfo] = useState<{ urlHost?: string; headerKeys?: string[] } | null>(null);

  const log = useCallback((level: LogLevel, message: string) => {
    setLogs((prev) => [...prev.slice(-199), { ts: Date.now(), level, message }]);
  }, []);

  // Direct multipart STT: uploads audio and transcribes in a single request
  async function callSTTMultipart(b: Blob): Promise<{ text: string; objectKey?: string; audioUrl?: string }> {
    setBusy("stt");
    log("info", "Transcribing audio (multipart)…");
    const form = new FormData();
    form.set("audio", b, "utterance.webm");
    if (sessionId) form.set("sessionId", sessionId);
    if (groupId) form.set("groupId", groupId);
    if (languageHint) form.set("languageHint", languageHint);
    const res = await fetch("/api/v1/stt", { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `stt failed: ${res.status}`);
    const text = String(data?.text || "");
    log("info", `STT done (chars=${text.length})`);
    return { text, objectKey: data?.objectKey || undefined, audioUrl: data?.audioUrl || undefined };
  }

  // Init sessionId from sessionStorage
  useEffect(() => {
    try {
      const key = "chatSessionId";
      const existing = typeof window !== "undefined" ? window.sessionStorage.getItem(key) : null;
      if (existing && existing.length > 0) {
        setSessionId(existing);
      } else {
        const id = safeUUID();
        setSessionId(id);
        if (typeof window !== "undefined") window.sessionStorage.setItem(key, id);
      }
    } catch {
      const id = safeUUID();
      setSessionId(id);
    }
  }, []);

  // Detect media support
  useEffect(() => {
    const ok = typeof window !== "undefined" && !!navigator?.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== "undefined";
    setMediaSupported(ok);
  }, []);

  const stopRecording = useCallback(() => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    // Stop silence monitor
    try {
      const m = silenceMonRef.current;
      if (m) {
        if (m.raf) cancelAnimationFrame(m.raf);
        try { m.ctx.close(); } catch {}
      }
      silenceMonRef.current = null;
    } catch {}
    const rec = mediaRef.current;
    if (rec && rec.state !== "inactive") {
      try { rec.stop(); } catch {}
    }
    setRecording(false);
    log("info", "Recording stopped");
  }, []);

  const startRecording = useCallback(async () => {
    setError("");
    setTranscript("");
    setAssistantText("");
    setTtsUrl("");
    setObjectKey(null);
    setBlob(null);
    // reset any prior state
    // Arm barge-in but do not immediately stop playback to avoid false triggers
    try { ttsTextQueueRef.current = []; ttsProcessingRef.current = false; } catch {}
    // Ensure no ongoing chat stream continues to enqueue segments
    try { chatEsRef.current?.close(); chatEsRef.current = null; } catch {}
    bargeArmedRef.current = true;
    bargeFramesRef.current = 0;
    bargeTriggeredRef.current = false;

    if (!mediaSupported) {
      setError("MediaRecorder not supported in this browser");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : (MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "");
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      mediaRef.current = rec;
      log("info", `Recording started (mime=${mime || "default"})`);

      const localChunks: BlobPart[] = [];
      rec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) localChunks.push(ev.data);
      };
      rec.onstop = () => {
        try {
          const outType = mime && mime.startsWith("audio/webm") ? "audio/webm" : (mime || "audio/webm");
          const b = new Blob(localChunks, { type: outType });
          setBlob(b);
          log("info", `Recording finalized: ${(b.size / 1024).toFixed(1)} KB, type=${outType}`);
        } catch (e) {
          setError("Failed to finalize recording");
          log("error", "Failed to finalize recording");
        }
        // Stop tracks
        try { stream.getTracks().forEach((t) => t.stop()); } catch {}
        // Stop silence monitor
        try {
          const m = silenceMonRef.current;
          if (m) {
            if (m.raf) cancelAnimationFrame(m.raf);
            try { m.ctx.close(); } catch {}
          }
          silenceMonRef.current = null;
        } catch {}
      };

      rec.start(100); // gather data every 100ms
      setRecording(true);
      // Guardrail: auto-stop after max duration
      stopTimerRef.current = setTimeout(() => stopRecording(), Math.max(1000, MAX_UTTER_MS));

      // Start lightweight VAD: auto-stop after silence and trigger barge-in on sustained louder speech
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        src.connect(analyser);
        const buffer = new Uint8Array(analyser.fftSize);
        const started = Date.now();
        let lastSpoke = Date.now();
        const MIN_SPEECH_MS = 300; // ignore early noise before considering silence
        const tick = () => {
          analyser.getByteTimeDomainData(buffer);
          // compute RMS deviation from midpoint 128
          let sum = 0;
          for (let i = 0; i < buffer.length; i++) {
            const v = (buffer[i] - 128) / 128; // -1..1
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buffer.length);
          const now = Date.now();
          // Speech detection for silence tracking
          if (rms > VAD_THRESHOLD) {
            lastSpoke = now;
          }
          // Barge-in detection: require sustained louder speech
          if (bargeArmedRef.current && !bargeTriggeredRef.current) {
            if (rms > BARGE_RMS_THRESHOLD) {
              bargeFramesRef.current += 1;
              if (bargeFramesRef.current >= BARGE_MIN_FRAMES) {
                // Trigger barge-in: stop ongoing playback and clear queues
                try { stopPlaybackAndClear(); } catch {}
                // Stop any active chat stream to prevent further TTS segments
                try { chatEsRef.current?.close(); chatEsRef.current = null; } catch {}
                // Clear pending TTS text segments and halt processing
                try { ttsTextQueueRef.current = []; ttsProcessingRef.current = false; } catch {}
                bargeTriggeredRef.current = true;
                bargeArmedRef.current = false;
              }
            } else {
              bargeFramesRef.current = 0;
            }
          }
          const spokeFor = lastSpoke - started;
          const silentFor = now - lastSpoke;
          // Do not auto-stop on silence if TTS playback is active or queued
          const ttsActive = audioPlayingRef.current || audioQueueRef.current.length > 0 || ttsProcessingRef.current;
          if (!ttsActive && spokeFor > MIN_SPEECH_MS && silentFor > VAD_MAX_SILENCE_MS) {
            log("info", `Auto-stop on silence (silent ${silentFor} ms)`);
            stopRecording();
            return;
          }
          const mon = silenceMonRef.current;
          if (mon) mon.raf = requestAnimationFrame(tick);
        };
        silenceMonRef.current = { ctx, src, analyser, raf: requestAnimationFrame(tick), started, lastSpoke };
      } catch {
        // ignore; VAD is best-effort
      }
    } catch (e: any) {
      setError(e?.message || "Mic permission denied or unavailable");
      log("error", `Microphone error: ${e?.message || "permission denied"}`);
    }
  }, [mediaSupported, stopRecording]);

  async function presignUpload(b: Blob): Promise<{ objectKey: string; url: string; headers: Record<string, string> }> {
    setBusy("presign");
    const contentTypeRaw = b.type || "audio/webm";
    const contentType = contentTypeRaw.startsWith("audio/webm") ? "audio/webm" : contentTypeRaw;
    const sizeBytes = b.size;
    if (!sizeBytes) throw new Error("Recording is empty (no audio captured)");
    log("info", "Requesting presigned URL…");
    const res = await fetch("/api/v1/storage/audio/presign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentType, sizeBytes, filename: "utterance.webm" }),
    });
    if (!res.ok) throw new Error(`presign failed: ${res.status}`);
    const data = await res.json();
    if (!(data?.url && data?.objectKey && data?.headers)) throw new Error("invalid presign response");
    try {
      const u = new URL(String(data.url));
      setLastPresignInfo({ urlHost: `${u.protocol}//${u.host}`, headerKeys: Object.keys(data.headers || {}) });
      log("info", `Presigned URL acquired for objectKey=${data.objectKey} (host=${u.host})`);
    } catch {
      setLastPresignInfo({ urlHost: undefined, headerKeys: Object.keys(data.headers || {}) });
      log("info", `Presigned URL acquired for objectKey=${data.objectKey}`);
    }
    return { objectKey: data.objectKey, url: data.url, headers: data.headers };
  }

  async function putObject(url: string, headers: Record<string, string>, b: Blob): Promise<void> {
    setBusy("upload");
    log("info", `Uploading audio to storage… (${(b.size / 1024).toFixed(1)} KB)`);
    let res: Response;
    try {
      res = await fetch(url, { method: "PUT", headers, body: b });
    } catch (e: any) {
      log("error", `Upload request failed (network/CORS). Note: this PUT goes directly to storage (e.g., LocalStack) so it won't appear in Next.js logs.`);
      throw e;
    }
    if (!res.ok) {
      log("error", `Upload failed: HTTP ${res.status}. Note: this is a browser → storage request; check bucket CORS on LocalStack and that the endpoint is reachable.`);
      throw new Error(`upload failed: ${res.status}`);
    }
    log("info", "Upload succeeded");
  }

  async function callSTT(okey: string): Promise<{ text: string | ""; objectKey: string }> {
    setBusy("stt");
    log("info", "Transcribing audio…");
    const body = {
      objectKey: okey,
      sessionId: sessionId || undefined,
      groupId: groupId || undefined,
      languageHint: languageHint || undefined,
    };
    const res = await fetch("/api/v1/stt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `stt failed: ${res.status}`);
    const text = String(data?.text || "");
    log("info", `STT done (chars=${text.length})`);
    return { text, objectKey: String(data?.objectKey || okey) };
  }

  async function callTTS(text: string): Promise<string> {
    setBusy("tts");
    log("info", "Synthesizing audio reply…");
    const body = { text, sessionId: sessionId || undefined, groupId: groupId || undefined };
    const res = await fetch("/api/v1/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `tts failed: ${res.status}`);
    log("info", "TTS done (audio ready)");
    return String(data?.audioUrl || "");
  }

  // Variant used for small streaming segments: do not switch global busy state repeatedly
  async function callTTSChunk(text: string): Promise<string> {
    try {
      const body = { text, sessionId: sessionId || undefined, groupId: groupId || undefined } as const;
      const res = await fetch("/api/v1/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `tts failed: ${res.status}`);
      return String(data?.audioUrl || "");
    } catch (e: any) {
      log("error", e?.message || "TTS segment failed");
      return "";
    }
  }

  const ingestMessage = React.useCallback(async (role: "user" | "assistant", content: string) => {
    try {
      if (!sessionId || !content) return;
      const payload = {
        sessionId,
        messageId: safeUUID(),
        role,
        content,
        ts: Date.now(),
      } as const;
      await fetch("/api/messages/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      // best-effort only
    }
  }, [sessionId]);

  async function chatWithAssistant(promptText: string, opts?: { streamTTS?: boolean }): Promise<string> {
    setBusy("chat");
    setAssistantText("");
    return new Promise<string>((resolve, reject) => {
      try {
        const qs = `?prompt=${encodeURIComponent(promptText)}`;
        const es = new EventSource(`/api/chat${qs}`, { withCredentials: false });
        // Keep a handle so we can cancel if voiceLoop is turned off
        try { chatEsRef.current?.close(); } catch {}
        chatEsRef.current = es;

        const t0 = Date.now();
        let acc = "";
        let lastFlushed = 0; // index within acc
        const minFlushChars = 24; // avoid ultra-short segments
        let idleTimer: ReturnType<typeof setTimeout> | null = null;

        const maybeFlush = (force = false) => {
          if (!opts?.streamTTS) return; // no-op when not streaming TTS
          const pending = acc.slice(lastFlushed);
          if (!force) {
            if (pending.length < minFlushChars) return;
          }
          const segment = pending.trim();
          if (segment.length === 0) return;
          lastFlushed = acc.length;
          // enqueue this text segment for synthesis
          enqueueTTSSegment(segment);
        };

        const flushOnPunctuation = () => {
          if (!opts?.streamTTS) return;
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
            // Fire-and-forget: record assistant final message
            void ingestMessage("assistant", acc);
            log("info", `Chat complete (${acc.length} chars, ${(Date.now() - t0)} ms)`);
            // final flush of any tail text
            if (opts?.streamTTS) {
              if (idleTimer) { try { clearTimeout(idleTimer); } catch {}; idleTimer = null; }
              const tail = acc.slice(lastFlushed).trim();
              if (tail.length > 0) enqueueTTSSegment(tail);
            }
            resolve(acc);
            return;
          }
          acc += evt.data;
          setAssistantText((prev) => prev + evt.data);
          // segmentation
          flushOnPunctuation();
          if (idleTimer) { try { clearTimeout(idleTimer); } catch {} }
          idleTimer = setTimeout(() => {
            maybeFlush(true); // idle flush whatever we have
          }, 400);
        };

        es.onerror = () => {
          try { es.close(); } catch {}
          try { if (chatEsRef.current === es) chatEsRef.current = null; } catch {}
          log("error", "Chat stream failed");
          reject(new Error("chat stream failed"));
        };
      } catch (e: any) {
        log("error", `Chat failed: ${e?.message || "unknown error"}`);
        reject(new Error(e?.message || "chat failed"));
      }
    });
  }

  const runTranscribe = useCallback(async () => {
    setError("");
    setTranscript("");
    setAssistantText("");
    setTtsUrl("");
    try {
      if (!blob) throw new Error("No recording available");
      log("info", "Starting STT (multipart)");
      const { text, objectKey: okey } = await callSTTMultipart(blob);
      if (okey) setObjectKey(okey);
      if (!text || text.trim().length === 0) {
        // Do not block the UI: surface a clear message and leave transcript empty
        setError("No speech detected in the recording. Please speak and try again.");
        log("error", "No speech detected in the recording");
      } else {
        setTranscript(text);
      }
    } catch (e: any) {
      setError(e?.message || "Transcription failed");
      log("error", e?.message || "Transcription failed");
    } finally {
      setBusy("idle");
    }
  }, [blob]);

  const runSynthesize = useCallback(async () => {
    setError("");
    try {
      if (!transcript) throw new Error("No transcript available");
      // Record user transcript message (best-effort)
      void ingestMessage("user", transcript);
      // Get assistant reply via chat stream, then synthesize
      const reply = await chatWithAssistant(transcript);
      setAssistantText(reply);
      const url = await callTTS(reply);
      setTtsUrl(url);
    } catch (e: any) {
      setError(e?.message || "TTS failed");
      log("error", e?.message || "TTS failed");
    } finally {
      setBusy("idle");
    }
  }, [transcript, ingestMessage]);

  // Helper: play a single audio URL and await completion (best-effort; resolves if autoplay is blocked)
  async function playAudio(url: string): Promise<void> {
    try {
      let el = audioRef.current;
      if (!el) {
        // Create an off-DOM audio element if one isn't rendered yet
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
    } catch {
      // ignore playback errors in loop mode
    }
  }

  // Playback queue controls
  function stopPlaybackAndClear() {
    try {
      const el = audioRef.current; if (el) { el.pause(); el.currentTime = 0; }
      const ui = uiAudioRef.current; if (ui) { ui.pause(); ui.currentTime = 0; }
    } catch {}
    audioQueueRef.current = [];
    audioPlayingRef.current = false;
  }

  async function ensureAudioWorker() {
    if (audioPlayingRef.current) return;
    const next = audioQueueRef.current.shift();
    if (!next) return;
    audioPlayingRef.current = true;
    try {
      await playAudio(next);
    } finally {
      audioPlayingRef.current = false;
      // continue if more queued
      if (audioQueueRef.current.length > 0) void ensureAudioWorker();
    }
  }

  function enqueueAudio(url: string) {
    if (!url) return;
    // If barge-in was triggered, do not enqueue audio during this utterance
    if (bargeTriggeredRef.current) return;
    audioQueueRef.current.push(url);
    void ensureAudioWorker();
  }

  // TTS text queue controls
  async function ensureTTSWorker() {
    if (ttsProcessingRef.current) return;
    ttsProcessingRef.current = true;
    try {
      while (ttsTextQueueRef.current.length > 0) {
        if (bargeTriggeredRef.current) {
          // Drop remaining segments once barge-in has occurred
          ttsTextQueueRef.current = [];
          break;
        }
        const text = ttsTextQueueRef.current.shift()!;
        const url = await callTTSChunk(text);
        if (url) {
          log("info", `Enqueue audio segment (${text.length} chars)`);
          enqueueAudio(url);
        }
      }
    } finally {
      ttsProcessingRef.current = false;
    }
  }

  function enqueueTTSSegment(text: string) {
    if (!text || !text.trim()) return;
    ttsTextQueueRef.current.push(text.trim());
    void ensureTTSWorker();
  }

  async function waitForQueueToDrain(timeoutMs = 15000): Promise<void> {
    const start = Date.now();
    return new Promise<void>((resolve) => {
      const tick = () => {
        const empty = audioQueueRef.current.length === 0 && !audioPlayingRef.current && !ttsProcessingRef.current && ttsTextQueueRef.current.length === 0;
        if (empty || Date.now() - start > timeoutMs) return resolve();
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  // Auto-play when a final TTS URL is produced (single-shot path).
  // Guard: only enqueue if nothing is currently queued/playing, to avoid
  // interfering with streaming segment playback which already enqueues audio.
  useEffect(() => {
    if (!ttsUrl) return;
    if (audioPlayingRef.current) return;
    if (audioQueueRef.current.length > 0) return;
    // Enqueue and start playback
    enqueueAudio(ttsUrl);
  }, [ttsUrl]);

  // Voice loop: process a single utterance end-to-end
  const processOnce = useCallback(async (b: Blob) => {
    setError("");
    try {
      log("info", "Loop: STT starting (multipart)");
      const { text, objectKey: okey } = await callSTTMultipart(b);
      if (okey) setObjectKey(okey);
      if (!text || text.trim().length === 0) {
        log("info", "Loop: no speech detected; restarting recording");
        return;
      }
      setTranscript(text);
      // Record user message (best-effort)
      void ingestMessage("user", text);
      // Get assistant reply and stream TTS segments progressively
      const reply = await chatWithAssistant(text, { streamTTS: true });
      setAssistantText(reply);
      log("info", "Loop: waiting for audio queue to drain");
      await waitForQueueToDrain();
    } catch (e: any) {
      setError(e?.message || "Voice loop failed");
      log("error", e?.message || "Voice loop failed");
    } finally {
      setBusy("idle");
      // Clear consumed blob so the effect doesn't retrigger
      setBlob(null);
    }
  }, [ingestMessage]);

  // When recording finalizes and voiceLoop is ON, process and then restart recording
  useEffect(() => {
    if (!voiceLoop) return;
    if (!blob) return;
    let cancelled = false;
    (async () => {
      await processOnce(blob);
      if (!cancelled && voiceLoop) {
        // Restart capture for the next utterance
        await startRecording();
      }
    })();
    return () => { cancelled = true; };
  }, [voiceLoop, blob, processOnce, startRecording]);

  if (!VOICE_ENABLED) {
    return (
      <div className="mx-auto max-w-2xl p-6 space-y-4">
        <h1 className="text-2xl font-semibold">Chat Voice Mode</h1>
        <div className="rounded border p-3 bg-yellow-50 text-yellow-800 text-sm">
          Voice Mode is disabled. Set NEXT_PUBLIC_ENABLE_VOICE=1 in .env.local to enable.
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Chat Voice Mode</h1>

      <div className="text-sm text-gray-600">
        Session: <code className="font-mono">{sessionId || "(initializing…)"}</code>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="block text-gray-600 mb-1">Group ID (optional)</span>
          <input className="w-full rounded border px-3 py-1.5" value={groupId} onChange={(e) => setGroupId(e.target.value)} placeholder="group-123" />
        </label>
        <label className="text-sm">
          <span className="block text-gray-600 mb-1">Language Hint (optional)</span>
          <input className="w-full rounded border px-3 py-1.5" value={languageHint} onChange={(e) => setLanguageHint(e.target.value)} placeholder="en" />
        </label>
      </div>

      {/* Stepper / Status */}
      <div className="rounded border p-3 bg-slate-50">
        <div className="text-sm font-medium mb-2">Status</div>
        <ul className="text-sm space-y-1">
          <li className={`${busy === "presign" ? "text-blue-700" : "text-slate-700"}`}>• Presign {busy === "presign" ? "(in progress)" : ""}</li>
          <li className={`${busy === "upload" ? "text-blue-700" : "text-slate-700"}`}>• Upload to storage {busy === "upload" ? "(in progress)" : ""}</li>
          <li className={`${busy === "stt" ? "text-blue-700" : "text-slate-700"}`}>• Transcribe (STT) {busy === "stt" ? "(in progress)" : ""}</li>
          <li className={`${busy === "chat" ? "text-blue-700" : "text-slate-700"}`}>• Chat {busy === "chat" ? "(in progress)" : ""}</li>
          <li className={`${busy === "tts" ? "text-blue-700" : "text-slate-700"}`}>• Synthesize (TTS) {busy === "tts" ? "(in progress)" : ""}</li>
          <li className="text-slate-700">• Idle when no step is running</li>
        </ul>
        {lastPresignInfo?.urlHost && (
          <div className="mt-2 text-xs text-gray-600">
            Note: Upload PUT goes directly to <code className="font-mono">{lastPresignInfo.urlHost}</code> (e.g., LocalStack). It will not appear in Next.js server logs.
          </div>
        )}
        <div className="mt-2 text-xs text-gray-600 flex items-center gap-2">
          <label className="inline-flex items-center gap-1">
            <input type="checkbox" checked={showDebug} onChange={(e) => setShowDebug(e.target.checked)} />
            Debug
          </label>
          {showDebug && lastPresignInfo && (
            <span>headers: [{(lastPresignInfo.headerKeys || []).join(", ")}]</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={startRecording}
          className="rounded bg-emerald-600 px-3 py-1.5 text-white hover:bg-emerald-700 disabled:opacity-50"
          disabled={!mediaSupported || recording || busy !== "idle" || voiceLoop}
        >
          {recording ? "Recording…" : "Start Recording"}
        </button>
        <button
          type="button"
          onClick={stopRecording}
          className="rounded bg-gray-200 px-3 py-1.5 hover:bg-gray-300 disabled:opacity-50"
          disabled={!recording}
        >
          Stop
        </button>
        <button
          type="button"
          onClick={() => {
            if (!voiceLoop) {
              setError("");
              setVoiceLoop(true);
              log("info", "Voice Mode: ON");
              // Start first capture immediately
              void startRecording();
            } else {
              setVoiceLoop(false);
              log("info", "Voice Mode: OFF");
              // Stop all activities
              try { stopRecording(); } catch {}
              try { chatEsRef.current?.close(); chatEsRef.current = null; } catch {}
              try {
                const el = audioRef.current; if (el) { el.pause(); el.currentTime = 0; }
              } catch {}
              // Clear queues so no leftover segments keep playing or synthesizing
              try { stopPlaybackAndClear(); } catch {}
              try { ttsTextQueueRef.current = []; ttsProcessingRef.current = false; } catch {}
            }
          }}
          className={`rounded px-3 py-1.5 text-white disabled:opacity-50 ${voiceLoop ? "bg-red-600 hover:bg-red-700" : "bg-purple-600 hover:bg-purple-700"}`}
          disabled={!voiceLoop && (!mediaSupported || busy !== "idle")}
        >
          {voiceLoop ? "Stop Voice Mode" : "Start Voice Mode"}
        </button>
        <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs ${recording ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-700"}`}>
          {recording ? "recording" : "idle"}
        </span>
      </div>

      {blob && (
        <div className="text-sm text-gray-700">
          Recorded: {(blob.size / 1024).toFixed(1)} KB, type: {blob.type || "(n/a)"}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={runTranscribe}
          className="rounded bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700 disabled:opacity-50"
          disabled={!blob || busy !== "idle" || voiceLoop}
        >
          {busy === "presign" ? "Presigning…" : busy === "upload" ? "Uploading…" : busy === "stt" ? "Transcribing…" : "Upload + Transcribe"}
        </button>
        <button
          type="button"
          onClick={runSynthesize}
          className="rounded bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-700 disabled:opacity-50"
          disabled={!transcript || busy !== "idle" || voiceLoop}
        >
          {busy === "chat" ? "Chatting…" : busy === "tts" ? "Synthesizing…" : "Chat + TTS"}
        </button>
      </div>

      {transcript && (
        <div className="rounded border p-3 text-sm">
          <div className="font-medium mb-1">Transcript</div>
          <div className="whitespace-pre-wrap">{transcript}</div>
          {objectKey && (
            <div className="text-xs text-gray-500 mt-2">objectKey: <code className="font-mono">{objectKey}</code></div>
          )}
        </div>
      )}

      {assistantText && (
        <div className="rounded border p-3 text-sm">
          <div className="font-medium mb-1">Assistant</div>
          <div className="whitespace-pre-wrap">{assistantText}</div>
        </div>
      )}

      {ttsUrl && (
        <div className="rounded border p-3 text-sm space-y-2">
          <div className="font-medium">Playback</div>
          {/* UI-only audio element; playback queue uses a hidden dedicated element */}
          <audio controls src={ttsUrl} ref={uiAudioRef} />
          <div className="text-xs text-gray-500 break-all">audioUrl: <a href={ttsUrl} className="text-blue-600 underline">{ttsUrl}</a></div>
        </div>
      )}

      {/* Hidden dedicated audio element for queue playback (always mounted) */}
      <audio ref={audioRef} preload="auto" className="hidden" />

      {error && (
        <div className="rounded border p-3 bg-red-50 text-red-800 text-sm">{error}</div>
      )}

      {/* Log panel */}
      {logs.length > 0 && (
        <div className="rounded border p-3 bg-white text-sm">
          <div className="font-medium mb-1">Activity Log</div>
          <div className="max-h-40 overflow-auto space-y-0.5">
            {logs.slice().reverse().map((l, i) => (
              <div key={i} className={`${l.level === 'error' ? 'text-red-700' : 'text-gray-700'}`}>
                <span className="text-xs text-gray-500 mr-2">{new Date(l.ts).toLocaleTimeString()}</span>
                {l.message}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="text-xs text-gray-500">
        Guardrails: max utterance {MAX_UTTER_MS} ms; single active recording session.
      </div>

      <div className="text-xs text-gray-400">
        Notes: uses MediaRecorder to capture Opus-in-WebM; uploads via presigned PUT; calls STT with objectKey and TTS on resulting text.
      </div>
    </div>
  );
}
