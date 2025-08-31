"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

export type MinimalSessionContextValue = {
  sessionId: string | null;
};

const Ctx = createContext<MinimalSessionContextValue | undefined>(undefined);

export function useMinimalSession() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useMinimalSession must be used within MinimalSessionProvider");
  return ctx;
}

function safeUUID(): string {
  try {
    const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
    return g.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

export function MinimalSessionProvider({ children }: { children: React.ReactNode }) {
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    try {
      // Prefer sessionId from URL, else from localStorage, else generate a stable one
      const url = new URL(window.location.href);
      const fromUrl = url.searchParams.get("sessionId");
      const storageKey = "coach-min:sessionId";
      const fromStorage = localStorage.getItem(storageKey);
      const sid = (fromUrl && fromUrl.trim()) ? fromUrl : (fromStorage && fromStorage.trim()) ? fromStorage : safeUUID();
      if (!fromStorage || fromStorage !== sid) {
        try { localStorage.setItem(storageKey, sid); } catch {}
      }
      setSessionId(sid);
    } catch {
      setSessionId(safeUUID());
    }
  }, []);

  const value = useMemo<MinimalSessionContextValue>(() => ({ sessionId }), [sessionId]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}


