"use client";

import { useEffect, useMemo, useRef, useState, useLayoutEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useChat } from "../../context/ChatContext";

// Mock data for dashboard (mirrors tracked skills shape from API)
type Skill = {
  id: string;
  title: string;
  category?: string;
  description?: string;
};

type TrackedSkill = {
  userId: string;
  skillId: string;
  currentLevel: number; // 0..10
  order: number; // 1..2
  createdAt: number;
  updatedAt: number;
  skill?: Skill | null;
};

// Recent assessments (mock) — roughly aligned with `convex/schema.ts` assessments table
type AssessmentScore = {
  category: string; // e.g., "clarity", "conciseness"
  level: number; // 0..10 derived from provider score (0..1)
  feedback?: string[]; // optional feedback items for expand view
};

type AssessmentLogItem = {
  id: string;
  title: string; // scenario / group label
  createdAt: number;
  scores: AssessmentScore[];
};

// Skeleton loader component
const SkeletonLoader = ({ className = "" }: { className?: string }) => (
  <div className={`animate-pulse bg-neutral-200 rounded ${className}`} />
);

// Data is loaded from /api/v1/skills/tracked with MOCK_CONVEX=1 in dev

export default function CoachPage() {
  const router = useRouter();
  const { sessionId } = useChat();
  const [showDashboard, setShowDashboard] = useState(false);
  const [dashboardMounted, setDashboardMounted] = useState(false);
  const [tracked, setTracked] = useState<TrackedSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<AssessmentLogItem[]>([]);
  const [dashAnim, setDashAnim] = useState(false);
  const dashUnmountTimer = useRef<number | null>(null);
  const dashContainerRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [leaving, setLeaving] = useState(false);
  const [leavingDir, setLeavingDir] = useState<"left" | "right">("left");
  const [enterDir, setEnterDir] = useState<"left" | "right" | null>(null);

  // Lightweight voice chat state for dashboard mic
  const [mediaSupported, setMediaSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState<"idle" | "stt" | "chat" | "tts">("idle");
  const [voiceError, setVoiceError] = useState<string>("");
  const mediaRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const chatEsRef = useRef<EventSource | null>(null);
  const [voiceLoop, setVoiceLoop] = useState(true);
  const [transcript, setTranscript] = useState<string>("");
  const [assistantText, setAssistantText] = useState<string>("");
  const [blob, setBlob] = useState<Blob | null>(null);

  // Audio playback and TTS streaming helpers (queue-based)
  const audioQueueRef = useRef<string[]>([]);
  const audioPlayingRef = useRef<boolean>(false);
  const ttsTextQueueRef = useRef<string[]>([]);
  const ttsProcessingRef = useRef<boolean>(false);
  // Barge-in control: arm on mic start; trigger only on sustained speech
  const bargeArmedRef = useRef<boolean>(false);
  const speechFramesRef = useRef<number>(0);
  // Send tracked-skill context once per session to prime the LLM
  const sentContextRef = useRef<boolean>(false);

  // Build a concise preamble describing the coach role and user-tracked skills
  const coachPreamble = useMemo(() => {
    try {
      const skills = (tracked || [])
        .slice()
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((t) => (t?.skill?.title ? `${t.skill.title}${Number.isFinite(t.currentLevel) ? ` (Lv ${t.currentLevel}/10)` : ""}` : null))
        .filter(Boolean) as string[];
      const skillsLine = skills.length > 0 ? `Focus on helping the user improve in: ${skills.join(", ")}.` : "Focus on helping the user improve speaking and communication skills.";
      return [
        "SYSTEM INSTRUCTIONS:",
        "You are CoachUp AI, a supportive voice speaking coach.",
        skillsLine,
        "Keep replies concise (1–2 sentences), actionable, spoken-friendly, and ask brief follow-ups when helpful.",
      ].join(" \n");
    } catch {
      return "SYSTEM INSTRUCTIONS: You are CoachUp AI, a supportive voice speaking coach. Keep replies concise and spoken-friendly.";
    }
  }, [tracked]);

  // Reset preamble-sent flag on session change to ensure a new session gets context
  useEffect(() => {
    sentContextRef.current = false;
  }, [sessionId]);

  // Debug panel & logs
  const [debugOpen, setDebugOpen] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const log = (msg: string) => {
    try {
      const ts = new Date().toLocaleTimeString();
      setLogs((prev) => [...prev.slice(-99), `[${ts}] ${msg}`]);
    } catch {
      // noop
    }
  };

  // Debug: log preamble when it changes
  useEffect(() => {
    const preview = (coachPreamble || "").slice(0, 240).replace(/\n/g, " \\n ");
    log(`ctx: preamble len=${(coachPreamble || "").length} preview="${preview}"`);
  }, [coachPreamble]);

  // Long-press detection
  const pressTimerRef = useRef<number | null>(null);
  const pressLongRef = useRef(false);
  const LONG_PRESS_MS = 500;
  const MAX_UTTER_MS = Number(process.env.NEXT_PUBLIC_VOICE_MAX_UTTERANCE_MS ?? 0) || 15000;
  // Simple VAD config: stop when silence persists beyond threshold
  const VAD_THRESHOLD = Number(process.env.NEXT_PUBLIC_VOICE_VAD_THRESHOLD ?? 0) || 0.02; // RMS
  const VAD_MAX_SILENCE_MS = Number(process.env.NEXT_PUBLIC_VOICE_VAD_MAX_SILENCE_MS ?? 0) || 900;
  // Barge-in sensitivity: require louder and sustained speech
  const BARGE_RMS_THRESHOLD = Math.max(Number(process.env.NEXT_PUBLIC_BARGE_RMS_THRESHOLD ?? 0) || VAD_THRESHOLD * 2.5, 0.05);
  const BARGE_MIN_FRAMES = Number(process.env.NEXT_PUBLIC_BARGE_MIN_FRAMES ?? 0) || 5; // ~500ms at 100ms interval
  const audioCtxRef = useRef<AudioContext | null>(null);
  const vadIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const res = await fetch("/api/v1/skills/tracked", { headers: { accept: "application/json" } });
        if (!res.ok) throw new Error(`Failed to load tracked skills (${res.status})`);
        const data: any = await res.json();
        const list: TrackedSkill[] = Array.isArray(data)
          ? data
          : Array.isArray(data?.tracked)
          ? data.tracked
          : [];
        if (!cancelled) {
          setTracked(list);
          log(`skills: loaded ${list.length}`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e ?? "Unknown error");
        if (!cancelled) setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }

      // Mock recent assessments (replace with real fetch when backend is wired)
      // Based on schema: assessments by group/scenario with per-category scores
      const now = Date.now();
      const mock: AssessmentLogItem[] = [
        {
          id: "grp_1",
          title: "Sales Scenario",
          createdAt: now - 1000 * 60 * 12,
          scores: [
            { category: "clarity", level: 8, feedback: ["Clear structure throughout", "Good use of summaries"] },
            { category: "conciseness", level: 5, feedback: ["Some repetition detected", "Tighten examples"] },
          ],
        },
        {
          id: "grp_2",
          title: "Practicing Pencil Pitch",
          createdAt: now - 1000 * 60 * 45,
          scores: [
            { category: "clarity", level: 7, feedback: ["Good signposting of key points"] },
            { category: "conciseness", level: 6, feedback: ["Trim filler phrases like 'basically'"] },
          ],
        },
      ];
      if (!cancelled) setRecent(mock);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  // Dev/HMR safety: Fast Refresh can preserve state; ensure we don't stay off-screen if `leaving` was true
  useEffect(() => {
    if (leaving) {
      log("nav: reset leaving=false on mount (HMR safety)");
      setLeaving(false);
    }
    // Always ensure enterDir settles
    const id = requestAnimationFrame(() => setEnterDir(null));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-reset leaving after a short window in case navigation didn't complete (e.g., during HMR)
  useEffect(() => {
    if (!leaving) return;
    log("nav: leaving=true -> auto-reset timer started");
    const t = window.setTimeout(() => {
      log("nav: auto-reset leaving=false (timeout)");
      setLeaving(false);
    }, 1600);
    return () => window.clearTimeout(t);
  }, [leaving]);

  // Proactively prefetch Skills route to avoid RSC fetch hiccups during animated navigation
  useEffect(() => {
    try {
      router.prefetch("/skills");
    } catch {}
  }, [router]);

  // Hydration-safe entry transition: read navDir on mount and animate new content in
  useLayoutEffect(() => {
    try {
      const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const d = window.sessionStorage.getItem("navDir");
      window.sessionStorage.removeItem("navDir");
      if (!reduce && (d === "back" || d === "forward")) {
        // forward -> enter from left; back -> enter from right
        setEnterDir(d === "forward" ? "left" : "right");
        const id = requestAnimationFrame(() => setEnterDir(null));
        return () => cancelAnimationFrame(id);
      }
    } catch {}
  }, []);

  // Chat session id is provided by ChatProvider

  // Detect media support
  useEffect(() => {
    const ok = typeof window !== "undefined" && !!navigator?.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== "undefined";
    setMediaSupported(ok);
  }, []);

  // --- Voice helpers ---
  async function playAudio(url: string): Promise<void> {
    try {
      let el = audioRef.current;
      if (!el) {
        el = new Audio();
        audioRef.current = el;
      }
      el.autoplay = true;
      el.src = url;
      try { el.load(); } catch {}
      log(`audio: playing url (${url.length} chars)`);
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
  }

  // Playback queue controls
  function stopPlaybackAndClear() {
    try {
      const el = audioRef.current; if (el) { el.pause(); el.currentTime = 0; }
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
      if (audioQueueRef.current.length > 0) void ensureAudioWorker();
    }
  }

  function enqueueAudio(url: string) {
    if (!url) return;
    audioQueueRef.current.push(url);
    void ensureAudioWorker();
  }

  // TTS helpers
  async function callTTSChunk(text: string): Promise<string> {
    try {
      const res = await fetch("/api/v1/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, sessionId: sessionId || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `tts failed: ${res.status}`);
      return String(data?.audioUrl || "");
    } catch (e: any) {
      log(`tts: segment error ${e?.message || e}`);
      return "";
    }
  }

  async function ensureTTSWorker() {
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

  async function callSTTMultipart(b: Blob): Promise<{ text: string }> {
    setBusy("stt");
    log(`stt: sending blob size=${b.size} type=${b.type || "(unknown)"}`);
    const form = new FormData();
    form.set("audio", b, "utterance.webm");
    if (sessionId) form.set("sessionId", sessionId);
    const res = await fetch("/api/v1/stt", { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `stt failed: ${res.status}`);
    log(`stt: text='${String(data?.text || "").slice(0, 120)}'`);
    return { text: String(data?.text || "") };
  }

  async function chatToText(promptText: string): Promise<string> {
    setBusy("chat");
    log(`chat: sse start (prompt ${promptText.length} chars)`);
    return new Promise<string>((resolve, reject) => {
      try {
        // On the first turn, prepend a system-like preamble with tracked skills context
        const includeCtx = !sentContextRef.current;
        const pre = (coachPreamble || "").trim();
        const finalPrompt = includeCtx && pre ? `${pre}\n\nUser: ${promptText}` : promptText;
        const prev = finalPrompt.slice(0, 200).replace(/\n/g, " \\n ");
        log(`chat: includeCtx=${includeCtx} promptLen=${finalPrompt.length} preview="${prev}"`);
        if (includeCtx) sentContextRef.current = true;
        const qs = `?prompt=${encodeURIComponent(finalPrompt)}`;
        const es = new EventSource(`/api/chat${qs}`, { withCredentials: false });
        // keep handle to allow cancellation
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
          if (segment.length === 0) return;
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
            log(`chat: sse done (${acc.length} chars)`);
            if (idleTimer) { try { clearTimeout(idleTimer); } catch {}; idleTimer = null; }
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
          log("chat: sse error");
          reject(new Error("chat stream failed"));
        };
      } catch (e: any) {
        log(`chat: error ${e?.message || e}`);
        reject(new Error(e?.message || "chat failed"));
      }
    });
  }

  async function callTTS(text: string): Promise<string> {
    setBusy("tts");
    log(`tts: synth (text ${text.length} chars)`);
    const res = await fetch("/api/v1/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, sessionId: sessionId || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `tts failed: ${res.status}`);
    log(`tts: got url (${String(data?.audioUrl || "").length} chars)`);
    return String(data?.audioUrl || "");
  }

  // Ingest message (best-effort)
  const ingestMessage = async (role: "user" | "assistant", content: string) => {
    try {
      if (!sessionId || !content) return;
      const payload = { sessionId, messageId: Math.random().toString(36).slice(2), role, content, ts: Date.now() } as const;
      await fetch("/api/messages/ingest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    } catch {}
  };

  function stopRecording() {
    const rec = mediaRef.current;
    if (rec && rec.state !== "inactive") {
      try { rec.stop(); } catch {}
    }
    setRecording(false);
    if (stopTimerRef.current) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    if (vadIntervalRef.current) { window.clearInterval(vadIntervalRef.current); vadIntervalRef.current = null; }
    try { audioCtxRef.current?.close(); audioCtxRef.current = null; } catch {}
    try { speechFramesRef.current = 0; bargeArmedRef.current = false; } catch {}
    log("mic: stopRecording");
  }

  async function startRecording() {
    setVoiceError("");
    // Arm barge-in; only trigger when VAD detects sustained speech
    try { bargeArmedRef.current = true; speechFramesRef.current = 0; } catch {}
    if (busy !== "idle") return;
    log("mic: startRecording");
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
            // In voice loop mode, hand off to loop processor
            if (voiceLoop) {
              setBlob(b);
              log(`rec: finalized blob (loop) size=${b.size}`);
            } else {
              try {
                log(`rec: finalized blob size=${b.size}`);
                const { text } = await callSTTMultipart(b);
                if (text && text.trim()) {
                  setTranscript(text);
                  void ingestMessage("user", text);
                  const reply = await chatToText(text);
                  setAssistantText(reply);
                  void ingestMessage("assistant", reply);
                  const url = await callTTS(reply || "");
                  if (url) await playAudio(url);
                } else {
                  setVoiceError("No speech detected. Please try again.");
                  log("stt: empty transcript");
                }
              } catch (e: any) {
                setVoiceError(e?.message || "Voice chat failed");
                log(`voice: pipeline error ${e?.message || e}`);
              } finally {
                setBusy("idle");
              }
            }
          } else {
            setVoiceError("No audio captured");
            log("rec: no audio captured");
          }
        } catch {
          setVoiceError("Failed to finalize recording");
          log("rec: finalize error");
        }
      };
      rec.start(100);
      setRecording(true);
      // auto-stop after max utterance
      if (stopTimerRef.current) { window.clearTimeout(stopTimerRef.current); }
      stopTimerRef.current = window.setTimeout(() => {
        try { rec.stop(); } catch {}
      }, MAX_UTTER_MS);

      // Simple VAD: monitor RMS and stop when silence lasts long enough
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
                // Count consecutive speech frames
                if (rms > BARGE_RMS_THRESHOLD) {
                  speechFramesRef.current = Math.min(speechFramesRef.current + 1, 1000);
                } else {
                  // soft speech resets slowly to avoid jitter; keep small decay
                  speechFramesRef.current = Math.max(0, speechFramesRef.current - 1);
                }
                // VAD-triggered barge-in: require sustained, louder speech
                if (bargeArmedRef.current && ttsActive && speechFramesRef.current >= BARGE_MIN_FRAMES) {
                  log(`barge-in: sustained speech -> interrupt TTS (rms=${rms.toFixed(3)} frames=${speechFramesRef.current})`);
                  try { stopPlaybackAndClear(); } catch {}
                  try { ttsTextQueueRef.current = []; ttsProcessingRef.current = false; } catch {}
                  try { chatEsRef.current?.close(); chatEsRef.current = null; } catch {}
                  bargeArmedRef.current = false;
                }
              } else {
                speechFramesRef.current = 0;
              }
              // Only auto-stop for silence when TTS is NOT active; while TTS is active, keep listening for barge-in
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
      log(`mic: getUserMedia error ${e?.message || e}`);
    }
  }

  // Mic button interactions: tap vs long-press
  function onMicDown() {
    pressLongRef.current = false;
    if (pressTimerRef.current) { window.clearTimeout(pressTimerRef.current); }
    pressTimerRef.current = window.setTimeout(() => {
      pressLongRef.current = true;
      log("mic: long-press");
      if (showDashboard) {
        // long-press on dashboard turns mic off
        stopRecording();
      }
    }, LONG_PRESS_MS);
  }

  function onMicUp() {
    if (pressTimerRef.current) { window.clearTimeout(pressTimerRef.current); pressTimerRef.current = null; }
    if (pressLongRef.current) return; // handled by long-press branch

    if (showDashboard) {
      // tap on dashboard returns to chat mode
      setShowDashboard(false);
      log("mic: tap -> chat mode");
      return;
    }

    // chat mode: tap toggles voice loop
    if (voiceLoop) {
      setVoiceLoop(false);
      log("mic: tap -> pause voice");
      try { stopRecording(); } catch {}
      try { chatEsRef.current?.close(); chatEsRef.current = null; } catch {}
      try { stopPlaybackAndClear(); } catch {}
      try { ttsTextQueueRef.current = []; ttsProcessingRef.current = false; } catch {}
    } else {
      setVoiceLoop(true);
      log("mic: tap -> resume voice");
      if (!recording) void startRecording();
    }
  }

  function onMicLeave() {
    if (pressTimerRef.current) { window.clearTimeout(pressTimerRef.current); pressTimerRef.current = null; }
  }

  // (No viewport tracking needed; use CSS vh for off-screen state)

  // Mount/unmount with animation. On open: mount then animate in. On close: animate out then unmount.
  useLayoutEffect(() => {
    const EXIT_MS = 1600; // longest child duration + delays buffer
    if (showDashboard) {
      // Cancel pending unmount if any
      if (dashUnmountTimer.current) {
        window.clearTimeout(dashUnmountTimer.current);
        dashUnmountTimer.current = null;
      }
      setDashboardMounted(true);
      setDashAnim(false);
      // Two RAFs + forced reflow to ensure initial styles are applied before transitioning
      requestAnimationFrame(() => {
        // force layout
        void dashContainerRef.current?.getBoundingClientRect();
        requestAnimationFrame(() => setDashAnim(true));
      });
    } else {
      setDashAnim(false); // triggers slide-up
      // Unmount after exit animation completes
      if (dashUnmountTimer.current) window.clearTimeout(dashUnmountTimer.current);
      dashUnmountTimer.current = window.setTimeout(() => {
        setDashboardMounted(false);
        dashUnmountTimer.current = null;
      }, EXIT_MS);
    }
  }, [showDashboard]);

  // Forward navigation with animated exit (left)
  function navigateForward(url: string) {
    try { window.sessionStorage.setItem("navDir", "forward"); } catch {}
    // Best-effort prefetch before we start the exit animation
    try { router.prefetch(url); } catch {}
    setLeavingDir("left");
    setLeaving(true);
    setTimeout(() => router.push(url), 650);
  }

  // Auto-start mic when entering chat mode with voice loop active
  useEffect(() => {
    if (!showDashboard && mediaSupported && voiceLoop && !recording && busy === "idle") {
      log("auto: voice loop active -> start mic");
      void startRecording();
    }
  }, [showDashboard, mediaSupported, voiceLoop, recording, busy]);

  // Voice loop processing: when a blob is ready, run STT -> chat (streaming) -> queue TTS, then restart recording
  useEffect(() => {
    if (!voiceLoop) return;
    if (!blob) return;
    let cancelled = false;
    (async () => {
      try {
        setAssistantText("");
        setTranscript("");
        const { text } = await callSTTMultipart(blob);
        if (text && text.trim()) {
          setTranscript(text);
          void ingestMessage("user", text);
          const reply = await chatToText(text);
          setAssistantText(reply);
          void ingestMessage("assistant", reply);
        } else {
          log("loop: empty transcript; restarting");
        }
      } catch (e: any) {
        setVoiceError(e?.message || "Voice loop failed");
        log(`loop: error ${e?.message || e}`);
      } finally {
        setBusy("idle");
        setBlob(null);
        if (!cancelled && voiceLoop) {
          await startRecording();
        }
      }
    })();
    return () => { cancelled = true; };
  }, [voiceLoop, blob]);

  // Component-level cleanup on unmount: stop media, close SSE, clear timers/queues
  useEffect(() => {
    return () => {
      try { chatEsRef.current?.close(); chatEsRef.current = null; } catch {}
      try { stopRecording(); } catch {}
      try { stopPlaybackAndClear(); } catch {}
      try { ttsTextQueueRef.current = []; ttsProcessingRef.current = false; } catch {}
      try { if (pressTimerRef.current) { window.clearTimeout(pressTimerRef.current); pressTimerRef.current = null; } } catch {}
      try { if (stopTimerRef.current) { window.clearTimeout(stopTimerRef.current); stopTimerRef.current = null; } } catch {}
    };
  }, []);

  const overallLevel = useMemo(() => {
    if (!tracked.length) return 0;
    const sum = tracked.reduce((sum, t) => sum + (Number(t.currentLevel) || 0), 0);
    return Math.round((sum / tracked.length) * 10) / 10; // average to 1 decimal
  }, [tracked]);

  const levelStats = useMemo(() => {
    const currentLevelInt = Math.floor(overallLevel);
    const nextLevelInt = currentLevelInt + 1;
    const progressPercent = Math.max(0, Math.min(100, (overallLevel - currentLevelInt) * 100));
    const pointsLeft = Math.max(0, Math.ceil((nextLevelInt - overallLevel) * 10));
    return { currentLevelInt, nextLevelInt, progressPercent, pointsLeft };
  }, [overallLevel]);

  return (
    <div
      className="min-h-screen bg-neutral-50 text-neutral-800 font-sans relative overflow-x-hidden transform-gpu will-change-transform transition-transform duration-700 ease-in-out"
      style={{
        transform: leaving
          ? (leavingDir === "left" ? "translateX(-120vw)" : "translateX(120vw)")
          : enterDir === "left"
          ? "translateX(-120vw)"
          : enterDir === "right"
          ? "translateX(120vw)"
          : "translateX(0)",
      }}
    >
      {/* Dashboard button in top left */}
      {!showDashboard && (
        <button
          aria-label="Open dashboard"
          className="fixed top-4 left-4 p-3 rounded-full text-neutral-800 bg-white border border-neutral-200 hover:bg-neutral-100 active:scale-95 transition-all duration-200 shadow-sm z-40"
          onClick={() => setShowDashboard(true)}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 11.5L12 4l9 7.5" />
            <path d="M5 10.5V20h14v-9.5" />
          </svg>
        </button>
      )}

      {/* Overall Level and Skills - remain mounted during exit for animation */}
      {dashboardMounted && (
        <header className="px-4 pt-10 pb-64">
          <div ref={dashContainerRef} className="max-w-md mx-auto">
            {/* Level block (slides in first) */}
            <div
              className={["transform-gpu will-change-transform transition-all duration-[600ms] ease-out", dashAnim ? "opacity-100" : "opacity-0"].join(" ")}
              style={{ transform: dashAnim ? "translateY(0)" : "translateY(-120vh)" }}
            >
              {/* Level header row */}
              <div className="mb-3">
                <div className="flex items-end justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-neutral-500">Overall Level</div>
                    <div className="text-3xl font-semibold text-neutral-900">{overallLevel}</div>
                  </div>
                </div>
                <div className="text-xs text-neutral-600">
                  {levelStats.pointsLeft} pts to Lv {levelStats.nextLevelInt}
                </div>
              </div>
              <div className="mt-2 h-2 bg-neutral-200 rounded-full overflow-hidden">
                <div className="h-full bg-neutral-800" style={{ width: `${levelStats.progressPercent}%` }} />
              </div>
            </div>
            {/* Tracked skills */}
            <section
              aria-labelledby="skills-label"
              className="mt-6 mb-6 transform-gpu will-change-transform transition-all duration-[700ms] ease-out"
              style={{ opacity: dashAnim ? 1 : 0, transform: dashAnim ? "translateY(0)" : "translateY(-120vh)", transitionDelay: dashAnim ? "120ms" : "0ms" }}
            >
              <div className="flex items-center justify-between mb-2">
                <button
                  type="button"
                  onClick={() => navigateForward("/skills")}
                  onMouseEnter={() => { try { router.prefetch("/skills"); } catch {} }}
                  onFocus={() => { try { router.prefetch("/skills"); } catch {} }}
                  aria-label="Go to skills overview"
                  className="block"
                >
                  <h2 id="skills-label" className="text-sm font-semibold uppercase tracking-wide text-neutral-700 hover:text-neutral-900 hover:underline">
                    Skills
                  </h2>
                </button>
              </div>
              {loading ? (
                <div className="grid grid-cols-2 gap-3">
                  <SkeletonLoader className="h-20 rounded-2xl" />
                  <SkeletonLoader className="h-20 rounded-2xl" />
                </div>
              ) : error ? (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                  {error}
                </div>
              ) : tracked && tracked.length > 0 ? (
                <ul className="grid grid-cols-2 gap-3">
                  {[...tracked]
                    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                    .map((t) => (
                      <li key={t.skillId} className="border border-neutral-200 rounded-2xl bg-white shadow-sm">
                        <button
                          type="button"
                          onClick={() => navigateForward(`/skills/${t.skillId}`)}
                          className="w-full text-left p-4"
                          aria-label={`Open ${t.skill?.title || "skill"}`}
                        >
                          <div className="text-sm font-medium text-neutral-900 line-clamp-2">
                            {t.skill?.title || "Untitled skill"}
                          </div>
                          <div className="mt-2 h-1.5 bg-neutral-200 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-neutral-800"
                              style={{ width: `${Math.max(0, Math.min(10, Number(t.currentLevel) || 0)) * 10}%` }}
                            />
                          </div>
                          <div className="mt-1 text-xs text-neutral-600">Lv {t.currentLevel}/10</div>
                        </button>
                      </li>
                    ))}
                </ul>
              ) : (
                <div className="border border-dashed border-neutral-300 rounded-2xl p-4 text-center text-sm text-neutral-600">
                  No tracked skills yet.
                </div>
              )}
            </section>
            <section
              aria-labelledby="recent-label"
              className="space-y-3 transform-gpu will-change-transform transition-all duration-[700ms] ease-out"
              style={{ opacity: dashAnim ? 1 : 0, transform: dashAnim ? "translateY(0)" : "translateY(-120vh)", transitionDelay: dashAnim ? "240ms" : "0ms" }}
            >
              <div className="flex items-center justify-between">
                <h2 id="recent-label" className="text-sm font-semibold uppercase tracking-wide text-neutral-700">Log</h2>
              </div>
              <ul className="space-y-3">
                {[...recent].sort((a, b) => b.createdAt - a.createdAt).map((item) => (
                  <li key={item.id} className="border border-neutral-200 rounded-2xl p-4 bg-white shadow-sm">
                    <button
                      type="button"
                      onClick={() => setExpanded((m) => ({ ...m, [item.id]: !m[item.id] }))}
                      aria-expanded={!!expanded[item.id]}
                      aria-controls={`log-${item.id}-panel`}
                      className="w-full flex items-center gap-3"
                    >
                      <div className="text-sm text-neutral-800 mr-2 flex-1 text-left">{item.title}</div>
                      {!expanded[item.id] && (
                        <div className="hidden sm:flex items-center gap-3 flex-wrap text-xs text-neutral-600 mr-1">
                          {item.scores.map((s) => (
                            <span key={s.category} className="whitespace-nowrap">
                              <span className="capitalize">{s.category}</span>
                              <span className="mx-1 text-neutral-400">·</span>
                              <span className="font-semibold text-neutral-800">{s.level}</span>
                            </span>
                          ))}
                        </div>
                      )}
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        className={["ml-auto w-4 h-4 text-neutral-400 transition-transform", expanded[item.id] ? "rotate-180" : "rotate-0"].join(" ")}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </button>

                    <div
                      id={`log-${item.id}-panel`}
                      className={[
                        "transition-all duration-300",
                        expanded[item.id]
                          ? "mt-3 pt-3 border-t border-neutral-200 opacity-100 translate-y-0 max-h-[600px]"
                          : "opacity-0 -translate-y-1 max-h-0 overflow-hidden"
                      ].join(" ")}
                    >
                      {/* Skills moved into expanded area */}
                      <div className="flex items-center gap-3 flex-wrap text-sm text-neutral-700 mb-2">
                        {item.scores.map((s) => (
                          <span key={s.category} className="whitespace-nowrap">
                            <span className="capitalize">{s.category}</span>
                            <span className="mx-1 text-neutral-400">·</span>
                            <span className="font-semibold text-neutral-800">{s.level}</span>
                          </span>
                        ))}
                      </div>

                      {/* Feedback */}
                      {item.scores.map((s) => (
                        <div key={s.category} className="mb-3">
                          {Array.isArray(s.feedback) && s.feedback.length > 0 ? (
                            <>
                              <div className="text-xs uppercase tracking-wide text-neutral-500 mb-1">{s.category}</div>
                              <ul className="list-disc pl-5 text-sm text-neutral-700 space-y-1">
                                {s.feedback.map((f, i) => (
                                  <li key={i}>{f}</li>
                                ))}
                              </ul>
                            </>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </li>
                ))}
                </ul>
              </section>
          </div>
        </header>
      )}

      {/* Voice Chat Icon (large center -> small bottom when dashboard is shown) */}
      <button
        aria-label={showDashboard ? "Dashboard mic (tap to go to chat, hold to stop)" : (voiceLoop ? "Pause voice mode" : "Resume voice mode")}
        onPointerDown={onMicDown}
        onPointerUp={onMicUp}
        onPointerLeave={onMicLeave}
        className={[
          "fixed z-30 left-1/2 top-1/2 w-32 h-32 rounded-full flex items-center justify-center transform-gpu will-change-transform transition-transform duration-[1200ms] ease-in-out",
          "border",
          recording ? "bg-red-600 text-white border-red-700 shadow-lg hover:shadow-xl" : "bg-white text-neutral-800 border-neutral-200 shadow-md hover:shadow-lg",
        ].join(" ")}
        style={{
          transform: showDashboard
            ? "translate(-50%, clamp(18vh, 32vh, calc(50vh - 8rem - env(safe-area-inset-bottom)))) scale(0.5)"
            : "translate(-50%, -50%) scale(1)",
        }}
      >
        {/* Pulsing ring (subtle animation) */}
        {!recording && <span className="absolute inline-flex h-full w-full rounded-full bg-neutral-500/20 animate-ping" />}
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="relative w-16 h-16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 14a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v4a3 3 0 0 0 3 3z" />
          <path d="M19 11v1a7 7 0 0 1-14 0v-1" />
          <path d="M12 19v4" />
        </svg>
      </button>

      {/* Voice Mode toggle removed: mic icon now controls pause/resume */}

      {/* Main content area */}
      {!showDashboard && (
        <main className="px-6 pt-10 pb-32 text-center">
          {/* Clean, minimal chat mode */}
        </main>
      )}

      {/* Debug toggle button */}
      <button
        type="button"
        onClick={() => setDebugOpen((v) => !v)}
        className="fixed bottom-4 right-4 z-40 px-3 py-1.5 text-xs rounded-md bg-neutral-800 text-white shadow"
      >
        {debugOpen ? "Hide Logs" : "Show Logs"}
      </button>

      {/* Debug panel */}
      {debugOpen && (
        <div className="fixed bottom-16 left-4 right-4 z-40 max-h-56 overflow-auto rounded-lg bg-black/80 text-green-200 text-xs p-3 shadow-lg">
          <div className="mb-2 text-[10px] text-neutral-300">
            sessionId={sessionId} · mediaSupported={String(mediaSupported)} · recording={String(recording)} · busy={busy}
          </div>
          <pre className="whitespace-pre-wrap break-words leading-4">{logs.join("\n")}</pre>
        </div>
      )}

      {/* Inline mic error toast */}
      {voiceError && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 px-3 py-2 rounded bg-red-600 text-white text-sm shadow">
          {voiceError}
        </div>
      )}
    </div>
  )
}
