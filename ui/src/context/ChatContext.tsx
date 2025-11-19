"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { devLog } from "../app/api/lib/observability";

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

  devLog("debug", "ChatContext: initializing chat provider", {
    timestamp: new Date().toISOString()
  });

  useEffect(() => {
    try {
      const key = "chatSessionId";
      const existing = typeof window !== "undefined" ? window.sessionStorage.getItem(key) : null;
      if (existing && existing.length > 0) {
        devLog("info", "ChatContext: restored existing session", { sessionId: existing });
        setSessionId(existing);
      } else {
        const id = safeUUID();
        devLog("info", "ChatContext: created new session", { sessionId: id });
        setSessionId(id);
        if (typeof window !== "undefined") window.sessionStorage.setItem(key, id);
      }
    } catch (error) {
      const id = safeUUID();
      devLog("warn", "ChatContext: sessionStorage access failed, using fallback", { sessionId: id, error });
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
