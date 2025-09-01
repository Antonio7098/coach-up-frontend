"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMinimalMic } from "../context/minimal/MinimalMicContext";
import { useMinimalAudio } from "../context/minimal/MinimalAudioContext";

interface MicMinButtonProps {
  showDashboard?: boolean;
  onDashboardClick?: () => void;
}

export default function MicMinButton({ showDashboard = false, onDashboardClick }: MicMinButtonProps) {
  const [mounted, setMounted] = useState(false);
  const { vadLoop, toggleVadLoop, recording, startRecording, stopRecording, status, transcript, inputSpeaking } = useMinimalMic();
  const audio = useMinimalAudio();

  // All hooks must be called before any early returns
  useEffect(() => { setMounted(true); return () => setMounted(false); }, []);

  if (!mounted) return null;

  // Consider active if VAD loop is on or currently recording
  const isActive = vadLoop || recording;

  // Speech detection: grow when VAD detects speech (same as GlobalMicButton)
  const isSpeaking = recording && inputSpeaking;

  // Processing states: show loading ring for stt, chat, tts
  const isProcessing = status === "stt" || status === "chat" || status === "tts";

  const handleClick = () => {
    // Ensure audio is unlocked on first interaction
    try { audio.unlockAudio(); } catch {}

    // Toggle VAD loop
    toggleVadLoop();
  };

  // Only render the portal if we're in the browser
  const buttonElement = (
    <button
      type="button"
      aria-label={showDashboard ? "Return to chat" : isActive ? "Stop voice mode" : "Start voice mode"}
      onClick={showDashboard ? (onDashboardClick || (() => {})) : handleClick}
      className={`
        fixed z-50 w-32 h-32 rounded-full
        flex items-center justify-center shadow-lg hover:shadow-xl
        transition-all duration-700 ease-in-out border-2
        ${isActive
          ? "bg-blue-500 border-blue-400 text-white"
          : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
        }
      `}
      style={{
        left: '50%',
        top: '50%',
        transform: showDashboard
          ? "translate(-50%, clamp(18vh, 24vh, calc(50vh - 8rem - env(safe-area-inset-bottom)))) scale(0.5)"
          : `translate(-50%, -50%) ${isSpeaking ? "scale(1.06)" : "scale(1)"}`,
      }}
    >
      {/* Processing rotating ring */}
      {isProcessing && (
        <span
          aria-hidden
          className="absolute -inset-2 rounded-full pointer-events-none animate-spin"
          style={{
            background: "conic-gradient(from 0deg, rgba(59,130,246,0.0), rgba(59,130,246,0.4), rgba(16,185,129,0.4), rgba(59,130,246,0.0))",
            WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
            WebkitMaskComposite: "xor",
            maskComposite: "exclude",
            padding: "6px",
          } as React.CSSProperties}
        />
      )}
      {/* Mic icon */}
      {isActive ? (
        <svg
          viewBox="0 0 24 24"
          className="w-10 h-10"
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
          viewBox="0 0 24 24"
          className="w-10 h-10"
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

  // Use createPortal to render at document body level
  if (typeof window === 'undefined') return null;

  return createPortal(buttonElement, document.body);
}
