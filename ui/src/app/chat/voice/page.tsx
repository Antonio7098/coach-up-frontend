"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

// Public flags (baked at build time)
const VOICE_ENABLED = (process.env.NEXT_PUBLIC_ENABLE_VOICE || "1") !== "0";
const MAX_UTTER_MS = Number(process.env.NEXT_PUBLIC_VOICE_MAX_UTTERANCE_MS || "15000");

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

  const [blob, setBlob] = useState<Blob | null>(null);
  const [objectKey, setObjectKey] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>("");
  const [assistantText, setAssistantText] = useState<string>("");
  const [ttsUrl, setTtsUrl] = useState<string>("");

  const [busy, setBusy] = useState<"idle" | "presign" | "upload" | "stt" | "chat" | "tts">("idle");
  const [error, setError] = useState<string>("");

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
    const rec = mediaRef.current;
    if (rec && rec.state !== "inactive") {
      try { rec.stop(); } catch {}
    }
    setRecording(false);
  }, []);

  const startRecording = useCallback(async () => {
    setError("");
    setTranscript("");
    setAssistantText("");
    setTtsUrl("");
    setObjectKey(null);
    setBlob(null);
    // reset any prior state

    if (!mediaSupported) {
      setError("MediaRecorder not supported in this browser");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : (MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "");
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      mediaRef.current = rec;

      const localChunks: BlobPart[] = [];
      rec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) localChunks.push(ev.data);
      };
      rec.onstop = () => {
        try {
          const outType = mime && mime.startsWith("audio/webm") ? "audio/webm" : (mime || "audio/webm");
          const b = new Blob(localChunks, { type: outType });
          setBlob(b);
        } catch (e) {
          setError("Failed to finalize recording");
        }
        // Stop tracks
        try { stream.getTracks().forEach((t) => t.stop()); } catch {}
      };

      rec.start(100); // gather data every 100ms
      setRecording(true);
      // Guardrail: auto-stop after max duration
      stopTimerRef.current = setTimeout(() => stopRecording(), Math.max(1000, MAX_UTTER_MS));
    } catch (e: any) {
      setError(e?.message || "Mic permission denied or unavailable");
    }
  }, [mediaSupported, stopRecording]);

  async function presignUpload(b: Blob): Promise<{ objectKey: string; url: string; headers: Record<string, string> }> {
    setBusy("presign");
    const contentTypeRaw = b.type || "audio/webm";
    const contentType = contentTypeRaw.startsWith("audio/webm") ? "audio/webm" : contentTypeRaw;
    const sizeBytes = b.size;
    if (!sizeBytes) throw new Error("Recording is empty (no audio captured)");
    const res = await fetch("/api/v1/storage/audio/presign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentType, sizeBytes, filename: "utterance.webm" }),
    });
    if (!res.ok) throw new Error(`presign failed: ${res.status}`);
    const data = await res.json();
    if (!(data?.url && data?.objectKey && data?.headers)) throw new Error("invalid presign response");
    return { objectKey: data.objectKey, url: data.url, headers: data.headers };
  }

  async function putObject(url: string, headers: Record<string, string>, b: Blob): Promise<void> {
    setBusy("upload");
    const res = await fetch(url, { method: "PUT", headers, body: b });
    if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  }

  async function callSTT(okey: string): Promise<{ text: string | ""; objectKey: string }> {
    setBusy("stt");
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
    return { text: String(data?.text || ""), objectKey: String(data?.objectKey || okey) };
  }

  async function callTTS(text: string): Promise<string> {
    setBusy("tts");
    const body = { text, sessionId: sessionId || undefined, groupId: groupId || undefined };
    const res = await fetch("/api/v1/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `tts failed: ${res.status}`);
    return String(data?.audioUrl || "");
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

  async function chatWithAssistant(promptText: string): Promise<string> {
    setBusy("chat");
    setAssistantText("");
    return new Promise<string>((resolve, reject) => {
      try {
        const qs = `?prompt=${encodeURIComponent(promptText)}`;
        const es = new EventSource(`/api/chat${qs}`, { withCredentials: false });

        const t0 = Date.now();
        let acc = "";

        es.onmessage = (evt) => {
          if (evt.data === "[DONE]") {
            try { es.close(); } catch {}
            // Fire-and-forget: record assistant final message
            void ingestMessage("assistant", acc);
            resolve(acc);
            return;
          }
          acc += evt.data;
          setAssistantText((prev) => prev + evt.data);
        };

        es.onerror = () => {
          try { es.close(); } catch {}
          reject(new Error("chat stream failed"));
        };
      } catch (e: any) {
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
      const { objectKey, url, headers } = await presignUpload(blob);
      await putObject(url, headers, blob);
      setObjectKey(objectKey);
      const { text } = await callSTT(objectKey);
      setTranscript(text);
    } catch (e: any) {
      setError(e?.message || "Transcription failed");
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
    } finally {
      setBusy("idle");
    }
  }, [transcript, ingestMessage]);

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

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={startRecording}
          className="rounded bg-emerald-600 px-3 py-1.5 text-white hover:bg-emerald-700 disabled:opacity-50"
          disabled={!mediaSupported || recording || busy !== "idle"}
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
          disabled={!blob || busy !== "idle"}
        >
          {busy === "presign" ? "Presigning…" : busy === "upload" ? "Uploading…" : busy === "stt" ? "Transcribing…" : "Upload + Transcribe"}
        </button>
        <button
          type="button"
          onClick={runSynthesize}
          className="rounded bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-700 disabled:opacity-50"
          disabled={!transcript || busy !== "idle"}
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
          <audio controls src={ttsUrl} />
          <div className="text-xs text-gray-500 break-all">audioUrl: <a href={ttsUrl} className="text-blue-600 underline">{ttsUrl}</a></div>
        </div>
      )}

      {error && (
        <div className="rounded border p-3 bg-red-50 text-red-800 text-sm">{error}</div>
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
