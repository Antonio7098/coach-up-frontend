"use client";

import React, { createContext, useCallback, useContext, useMemo, useRef } from "react";

export type MinimalConversationContextValue = {
  chatToText: (prompt: string) => Promise<string>;
};

const Ctx = createContext<MinimalConversationContextValue | undefined>(undefined);

export function useMinimalConversation() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useMinimalConversation must be used within MinimalConversationProvider");
  return ctx;
}

export function MinimalConversationProvider({ children }: { children: React.ReactNode }) {
  // Minimal in-memory history of last 2 messages (role: user|assistant)
  const historyRef = useRef<Array<{ role: "user" | "assistant"; content: string }>>([]);

  function toBase64Url(s: string): string {
    try {
      const bytes = new TextEncoder().encode(s);
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const b64 = btoa(bin);
      return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    } catch {
      try {
        const b64 = btoa(unescape(encodeURIComponent(s)));
        return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
      } catch {
        return "";
      }
    }
  }

  const chatToText = useCallback(async (prompt: string): Promise<string> => {
    if (!prompt || !prompt.trim()) return "";
    // Build minimal history param from the last 2 messages (excluding this prompt)
    const last2 = historyRef.current.slice(-2).map((m) => ({ role: m.role, content: (m.content || "").slice(0, 240) }));
    const histParam = last2.length ? `&history=${encodeURIComponent(toBase64Url(JSON.stringify(last2)))}` : "";

    const startOnce = (): Promise<string | null> => new Promise((resolve, reject) => {
      try {
        let es: EventSource | null = null;
        try { es = new EventSource(`/api/chat?prompt=${encodeURIComponent(prompt)}${histParam}`, { withCredentials: false }); } catch {}
        if (!es) { reject(new Error("stream failed")); return; }
        let acc = "";
        es.onmessage = (evt) => {
          if (evt.data === "[DONE]") { try { es?.close(); } catch {}; resolve(acc); }
          else { acc += evt.data; }
        };
        es.onerror = () => {
          try { es?.close(); } catch {}
          if (acc) resolve(acc); else resolve(null);
        };
      } catch (e: any) {
        reject(new Error(e?.message || "stream failed"));
      }
    });
    const first = await startOnce();
    if (typeof first === "string") return first;
    const second = await startOnce();
    if (typeof second === "string") return second;
    throw new Error("stream failed");
  }, []);

  // Push user/assistant messages into minimal history when chatToText resolves
  const chatToTextWithHistory = useCallback(async (prompt: string): Promise<string> => {
    const reply = await chatToText(prompt);
    try {
      historyRef.current.push({ role: "user", content: prompt });
      historyRef.current.push({ role: "assistant", content: reply });
      // Keep only last 2
      if (historyRef.current.length > 2) historyRef.current = historyRef.current.slice(-2);
    } catch {}
    return reply;
  }, [chatToText]);

  const value = useMemo<MinimalConversationContextValue>(() => ({ chatToText: chatToTextWithHistory }), [chatToTextWithHistory]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}


