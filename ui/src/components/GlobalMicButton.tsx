"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMic } from "../context/MicContext";
import { useMicUI } from "../context/MicUIContext";

// Persistent floating mic button. When not in coach, renders a small bottom-right button.
// When in coach, renders the large center mic with chat<->dashboard transform, driven by MicUIContext.
export default function GlobalMicButton() {
  const [mounted, setMounted] = useState(false);
  const { voiceLoop, recording, busy, toggleVoiceLoop, startRecording, stopRecording } = useMic();
  const { inCoach, showDashboard, setShowDashboard, onTap, onLongPress } = useMicUI();

  // Long-press support (coach mode) - moved to top level to fix hooks order
  const pressTimerRef = useRef<number | null>(null);
  const pressLongRef = useRef(false);

  useEffect(() => { setMounted(true); return () => setMounted(false); }, []);

  if (!mounted) return null;

  const isActive = recording || (voiceLoop && busy !== "idle");
  const LONG_PRESS_MS = 500;
  const onDown = () => {
    if (!inCoach) return; // only relevant for coach mic UI
    pressLongRef.current = false;
    if (pressTimerRef.current) { window.clearTimeout(pressTimerRef.current); }
    pressTimerRef.current = window.setTimeout(() => {
      pressLongRef.current = true;
      if (onLongPress) onLongPress();
      else {
        // default: while on dashboard, long-press stops recording
        if (showDashboard) {
          try { stopRecording(); } catch {}
        }
      }
    }, LONG_PRESS_MS);
  };
  const onUp = () => {
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

  const coachButton = (
    <button
      aria-label={showDashboard ? "Dashboard mic (tap to go to chat, hold to stop)" : (voiceLoop ? "Pause voice mode" : "Resume voice mode")}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerLeave={onLeave}
      className={[
        "fixed z-50 left-1/2 top-1/2 w-32 h-32 rounded-full flex items-center justify-center transform-gpu will-change-transform transition-transform duration-[400ms] ease-in-out",
        "border",
        recording ? "cu-error-bg cu-error-border shadow-lg hover:shadow-xl" : "cu-surface text-foreground cu-border-surface shadow-md hover:shadow-lg",
      ].join(" ")}
      style={{
        transform: showDashboard
          ? "translate(-50%, clamp(18vh, 24vh, calc(50vh - 8rem - env(safe-area-inset-bottom)))) scale(0.5)"
          : "translate(-50%, -50%) scale(1)",
      }}
    >
      {!recording && <span className="absolute inline-flex h-full w-full rounded-full cu-accent-bg-20 animate-ping" />}
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
  );

  const globalButton = (
    <button
      type="button"
      aria-label={isActive ? "Stop voice" : "Start voice"}
      title={isActive ? "Stop voice" : "Start voice"}
      onClick={() => {
        if (!voiceLoop && !recording) {
          toggleVoiceLoop();
        } else {
          toggleVoiceLoop();
        }
      }}
      className="fixed z-[1000] right-5 bottom-[calc(env(safe-area-inset-bottom,0)+20px)] h-14 w-14 rounded-full shadow-lg flex items-center justify-center cu-accent-bg text-white select-none"
      style={{
        boxShadow: isActive ? "0 0 0 8px rgba(0,0,0,0.08)" : undefined,
        transition: "transform 200ms ease, box-shadow 200ms ease, background 200ms ease",
        transform: isActive ? "scale(1.05)" : "scale(1.0)",
      }}
    >
      <div className="relative">
        <div className="w-5 h-8 bg-white/95 rounded-full" />
        <div className="w-8 h-[3px] bg-white/95 rounded-full mt-1 mx-auto" />
        {isActive && (
          <span className="absolute -inset-3 rounded-full border-2 border-white/60 animate-ping" aria-hidden />
        )}
      </div>
    </button>
  );

  return createPortal(inCoach ? coachButton : globalButton, document.body);
}
