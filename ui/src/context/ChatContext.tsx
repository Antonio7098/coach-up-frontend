"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

function safeUUID(): string {
  try {
    const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
    return g.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

export type ChatContextValue = {
  sessionId: string;
  setSessionId: (id: string) => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [sessionId, setSessionId] = useState<string>("");

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

  const value = useMemo<ChatContextValue>(() => ({ sessionId, setSessionId }), [sessionId]);

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within a ChatProvider");
  return ctx;
}
