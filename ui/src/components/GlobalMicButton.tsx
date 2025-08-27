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

  // Long-press handling for the small global button (outside coach)
  const smallPressTimerRef = useRef<number | null>(null);
  const smallPressLongRef = useRef(false);

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
      aria-label={showDashboard ? "Dashboard mic (tap to go to chat, hold to stop)" : (isActive ? "Pause voice mode" : "Resume voice mode")}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerLeave={onLeave}
      className={[
        "fixed z-50 left-1/2 top-1/2 w-32 h-32 rounded-full flex items-center justify-center transform-gpu will-change-transform transition-transform duration-[1200ms] ease-in-out",
        "border",
        isActive ? "cu-accent-bg cu-accent-border text-white shadow-lg hover:shadow-xl" : "cu-surface text-foreground cu-border-surface shadow-md hover:shadow-lg",
      ].join(" ")}
      style={{
        transform: showDashboard
          ? "translate(-50%, clamp(18vh, 24vh, calc(50vh - 8rem - env(safe-area-inset-bottom)))) scale(0.5)"
          : "translate(-50%, -50%) scale(1)",
      }}
    >
      {isActive && <span className="absolute inline-flex h-full w-full rounded-full cu-accent-bg-20 animate-ping" />}
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
    if (inCoach) return; // only for non-coach pages
    smallPressLongRef.current = false;
    if (smallPressTimerRef.current) { window.clearTimeout(smallPressTimerRef.current); }
    smallPressTimerRef.current = window.setTimeout(() => {
      smallPressLongRef.current = true;
      try { stopRecording(); } catch {}
    }, LONG_PRESS_MS);
  };
  const onSmallUp = () => {
    if (inCoach) return;
    if (smallPressTimerRef.current) { window.clearTimeout(smallPressTimerRef.current); smallPressTimerRef.current = null; }
    if (smallPressLongRef.current) return; // consume long-press
    // short click: existing behavior (often navigates back to chat externally); keep toggle for safety
  };

  const globalButton = (
    <button
      type="button"
      aria-label={isActive ? "Pause voice" : "Start voice"}
      title={isActive ? "Pause voice" : "Start voice"}
      onPointerDown={onSmallDown}
      onPointerUp={onSmallUp}
      onClick={() => {
        // In non-coach pages, clicks typically navigate back to chat. Do not toggle here.
        // Long-press is used to pause/stop. No-op on short click.
        return;
      }}
      className="fixed z-[1000] right-5 bottom-[calc(env(safe-area-inset-bottom,0)+20px)] h-14 w-14 rounded-full shadow-lg flex items-center justify-center cu-accent-bg text-white select-none"
      style={{
        boxShadow: isActive ? "0 0 0 8px rgba(0,0,0,0.08)" : undefined,
        transition: "transform 200ms ease, box-shadow 200ms ease, background 200ms ease",
        transform: isActive ? "scale(1.05)" : "scale(1.0)",
      }}
    >
      <div className="relative">
        {isActive && <span className="absolute -inset-3 rounded-full border-2 border-white/60 animate-ping" aria-hidden />}
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
