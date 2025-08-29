"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMic } from "../context/MicContext";
import { useAudio } from "../context/AudioContext";
import { useVoice } from "../context/VoiceContext";
import { useMicUI } from "../context/MicUIContext";

// Persistent floating mic button. When not in coach, renders a small bottom-right button.
// When in coach, renders the large center mic with chat<->dashboard transform, driven by MicUIContext.
export default function GlobalMicButton() {
  const [mounted, setMounted] = useState(false);
  const { voiceLoop, toggleVoiceLoop, recording, startRecording, stopRecording, inputSpeaking, setVoiceLoop } = useMic();
  const { busy, processingRing } = useVoice();
  const { inCoach, showDashboard, setShowDashboard, onTap, onLongPress } = useMicUI();
  const audio = useAudio();
  // Only show speaking pulse when the mic is actively recording
  const speakingPulse = recording && inputSpeaking;

  // Long-press support (coach mode) - moved to top level to fix hooks order
  const pressTimerRef = useRef<number | null>(null);
  const pressLongRef = useRef(false);

  // Long-press handling for the small global button (outside coach)
  const smallPressTimerRef = useRef<number | null>(null);
  const smallPressLongRef = useRef(false);

  useEffect(() => { setMounted(true); return () => setMounted(false); }, []);

  if (!mounted) return null;

  const isActive = recording || (voiceLoop && busy !== "idle");
  const LONG_PRESS_MS = 500;
  const onDown = () => {
    // Ensure first gesture unlocks audio autoplay in browsers
    try { audio.unlockAudio(); } catch {}
    if (!inCoach) return; // only relevant for coach mic UI
    pressLongRef.current = false;
    if (pressTimerRef.current) { window.clearTimeout(pressTimerRef.current); }
    pressTimerRef.current = window.setTimeout(() => {
      pressLongRef.current = true;
      if (onLongPress) onLongPress();
      else {
        // default: while on dashboard, long-press mutes then stops
        if (showDashboard) {
          try { setVoiceLoop(false); } catch {}
          try { stopRecording(); } catch {}
        }
      }
    }, LONG_PRESS_MS);
  };
  const onUp = () => {
    // Redundant unlock on pointer up in case pointerdown wasn't captured
    try { audio.unlockAudio(); } catch {}
    if (!inCoach) return; // small button has its own click handler
    if (pressTimerRef.current) { window.clearTimeout(pressTimerRef.current); pressTimerRef.current = null; }
    if (pressLongRef.current) return;
    if (onTap) onTap();
    else {
      if (showDashboard) {
        setShowDashboard(false);
      } else {
        toggleVoiceLoop();
      }
    }
  };
  const onLeave = () => {
    if (!inCoach) return;
    if (pressTimerRef.current) { window.clearTimeout(pressTimerRef.current); pressTimerRef.current = null; }
  };

  const isProcessing = processingRing; // precise STT->pre-TTS window

  const coachButton = (
    <button
      aria-label={showDashboard ? "Dashboard mic (tap to go to chat, hold to stop)" : (isActive ? "Pause voice mode" : "Resume voice mode")}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerLeave={onLeave}
      className={[
        "fixed z-50 left-1/2 top-1/2 w-32 h-32 rounded-full flex items-center justify-center transform-gpu will-change-transform transition-all duration-[400ms] ease-in-out",
        "border-2",
        isActive
          ? "cu-accent-border text-white shadow-lg hover:shadow-xl"
          : "cu-surface text-foreground cu-border-surface shadow-md hover:shadow-lg",
      ].join(" ")}
      style={{
        transform: showDashboard
          ? "translate(-50%, clamp(18vh, 24vh, calc(50vh - 8rem - env(safe-area-inset-bottom)))) scale(0.5)"
          : `translate(-50%, -50%) scale(${speakingPulse ? 1.06 : 1})`,
      }}
    >
      {/* Processing rotating ring */}
      {isProcessing && (
        <span
          aria-hidden
          className="absolute -inset-2 rounded-full pointer-events-none animate-spin"
          style={{
            background: "conic-gradient(from 0deg, rgba(99,102,241,0.0), rgba(99,102,241,0.35), rgba(16,185,129,0.35), rgba(99,102,241,0.0))",
            WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
            WebkitMaskComposite: "xor",
            maskComposite: "exclude",
            padding: "6px",
          } as React.CSSProperties}
        />
      )}
      {/* Base gradient background (subtle) */}
      <span
        aria-hidden
        className="absolute inset-0 rounded-full pointer-events-none opacity-70"
        style={{
          background: isActive
            ? "linear-gradient(135deg, rgba(99,102,241,0.35), rgba(16,185,129,0.35))"
            : "linear-gradient(135deg, rgba(99,102,241,0.08), rgba(16,185,129,0.08))",
        }}
      />
      {/* Radial center glow */}
      <span
        aria-hidden
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{
          background: "radial-gradient(circle at 50% 45%, rgba(255,255,255,0.18), rgba(255,255,255,0) 58%)",
        }}
      />
      {/* Glossy top highlight */}
      <span
        aria-hidden
        className="absolute inset-x-6 top-2 h-10 rounded-full bg-white/15 blur-[2px] pointer-events-none"
      />
      {/* Subtle pulsate only while recording and detecting speech */}
      {speakingPulse && <span className="absolute inline-flex h-full w-full rounded-full cu-accent-bg-20 animate-ping" aria-hidden />}
      {isActive ? (
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
      ) : (
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
          <path d="M2 2l20 20" />
          <path d="M12 14a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v1" />
          <path d="M19 11v1a7 7 0 0 1-14 0v-1" />
          <path d="M12 19v4" />
        </svg>
      )}
    </button>
  );

  const onSmallDown = () => {
    // Ensure first gesture unlocks audio on non-coach pages
    try { audio.unlockAudio(); } catch {}
    if (inCoach) return; // only for non-coach pages
    smallPressLongRef.current = false;
    if (smallPressTimerRef.current) { window.clearTimeout(smallPressTimerRef.current); }
    smallPressTimerRef.current = window.setTimeout(() => {
      smallPressLongRef.current = true;
      try { setVoiceLoop(false); } catch {}
      try { stopRecording(); } catch {}
    }, LONG_PRESS_MS);
  };
  const onSmallUp = () => {
    // Redundant unlock on pointer up
    try { audio.unlockAudio(); } catch {}
    if (inCoach) return;
    if (smallPressTimerRef.current) { window.clearTimeout(smallPressTimerRef.current); smallPressTimerRef.current = null; }
    if (smallPressLongRef.current) return; // consume long-press
    // Short click: toggle mute/unmute (voiceLoop)
    try { toggleVoiceLoop(); } catch {}
  };

  const globalButton = (
    <button
      type="button"
      aria-label={isActive ? "Pause voice (click) or hold to stop" : "Resume voice (click)"}
      title={isActive ? "Pause voice (click) or hold to stop" : "Resume voice (click)"}
      onPointerDown={onSmallDown}
      onPointerUp={onSmallUp}
      onClick={() => { /* handled by onPointerUp for consistent long-press detection */ return; }}
      className="fixed z-[1000] right-5 bottom-[calc(env(safe-area-inset-bottom,0)+20px)] h-14 w-14 rounded-full shadow-lg flex items-center justify-center text-white select-none border-2 cu-accent-border"
      style={{
        boxShadow: isActive ? "0 0 0 8px rgba(0,0,0,0.08)" : undefined,
        transition: "transform 220ms ease, box-shadow 220ms ease, background 220ms ease",
        transform: `scale(${speakingPulse ? 1.08 : (isActive ? 1.07 : 1.0)})`,
      }}
    >
      {/* Processing rotating ring */}
      {isProcessing && (
        <span
          aria-hidden
          className="absolute -inset-1.5 rounded-full pointer-events-none animate-spin"
          style={{
            background: "conic-gradient(from 0deg, rgba(99,102,241,0.0), rgba(99,102,241,0.5), rgba(16,185,129,0.5), rgba(99,102,241,0.0))",
            WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
            WebkitMaskComposite: "xor",
            maskComposite: "exclude",
            padding: "4px",
          } as React.CSSProperties}
        />
      )}
      {/* Base gradient background */}
      <span
        aria-hidden
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{
          background: isActive
            ? "linear-gradient(135deg, rgba(99,102,241,0.6), rgba(16,185,129,0.6))"
            : "linear-gradient(135deg, rgba(99,102,241,0.45), rgba(16,185,129,0.45))",
        }}
      />
      {/* Inner glow */}
      <span
        aria-hidden
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle at 50% 45%, rgba(255,255,255,0.22), rgba(255,255,255,0) 60%)" }}
      />
      {/* Gloss highlight */}
      <span aria-hidden className="absolute inset-x-3 top-1.5 h-6 rounded-full bg-white/20 blur-[1.5px] pointer-events-none" />
      <div className="relative">
        {speakingPulse && <span className="absolute -inset-3 rounded-full border-2 border-white/60 animate-ping" aria-hidden />}
        {isActive ? (
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="relative w-7 h-7"
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
        ) : (
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="relative w-7 h-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 2l20 20" />
            <path d="M12 14a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v1" />
            <path d="M19 11v1a7 7 0 0 1-14 0v-1" />
            <path d="M12 19v4" />
          </svg>
        )}
      </div>
    </button>
  );

  return createPortal(inCoach ? coachButton : globalButton, document.body);
}
