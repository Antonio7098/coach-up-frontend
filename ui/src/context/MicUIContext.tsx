"use client";

import React, { createContext, useContext, useMemo, useState, useCallback } from "react";

export type MicUIContextValue = {
  inCoach: boolean;
  showDashboard: boolean;
  setInCoach: (v: boolean) => void;
  setShowDashboard: (v: boolean) => void;
  onTap?: () => void;
  onLongPress?: () => void;
  setHandlers: (h: { onTap?: () => void; onLongPress?: () => void }) => void;
};

const MicUIContext = createContext<MicUIContextValue | undefined>(undefined);

export function useMicUI(): MicUIContextValue {
  const ctx = useContext(MicUIContext);
  if (!ctx) throw new Error("useMicUI must be used within MicUIProvider");
  return ctx;
}

export function MicUIProvider({ children }: { children: React.ReactNode }) {
  const [inCoach, setInCoach] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [onTap, setOnTap] = useState<(() => void) | undefined>(undefined);
  const [onLongPress, setOnLongPress] = useState<(() => void) | undefined>(undefined);

  const setHandlers = useCallback(({ onTap, onLongPress }: { onTap?: () => void; onLongPress?: () => void }) => {
    setOnTap(() => onTap);
    setOnLongPress(() => onLongPress);
  }, []);

  const value = useMemo<MicUIContextValue>(() => ({
    inCoach,
    showDashboard,
    setInCoach,
    setShowDashboard,
    onTap,
    onLongPress,
    setHandlers,
  }), [inCoach, onLongPress, onTap, showDashboard, setHandlers]);

  return <MicUIContext.Provider value={value}>{children}</MicUIContext.Provider>;
}
