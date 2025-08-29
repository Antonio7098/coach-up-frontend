/** @vitest-environment jsdom */
import * as React from "react";
import { useEffect } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";

// Minimal localStorage mock for Node test env
if (!(globalThis as any).localStorage) {
  const store: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  } as Storage;
}

vi.mock("../../src/context/MicContext", () => ({
  useMic: () => ({
    interactionState: "idle",
    interactionGroupId: undefined,
    interactionTurnCount: 0,
    assessmentChips: [],
  }),
}));
vi.mock("../../src/context/VoiceContext", () => ({
  useVoice: () => ({ enqueueTTSSegment: () => {}, sttFromBlob: async () => ({ text: "" }) }),
}));
vi.mock("../../src/context/ChatContext", () => ({
  useChat: () => ({ sessionId: "sess-1" }),
}));
vi.mock("../../src/hooks/useSessionSummary", () => ({
  useSessionSummary: () => ({ summary: { text: "prev summary" }, onTurn: () => {} }),
}));

import { ConversationProvider, useConversation } from "../../src/context/ConversationContext";

describe("ConversationContext.getHistoryParam", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function mountAndGet(fn: (val: ReturnType<typeof useConversation>) => void) {
    const div = document.createElement("div");
    document.body.appendChild(div);
    const App = () => {
      const ctx = useConversation();
      // Defer to next macrotask so Provider effects (which load history) run first
      useEffect(() => { const t = setTimeout(() => fn(ctx), 0); return () => clearTimeout(t); }, [ctx]);
      return null;
    };
    const root = createRoot(div);
    root.render(React.createElement(ConversationProvider, null, React.createElement(App)));
    return () => root.unmount();
  }

  it("encodes last 10 messages plus summary when present", async () => {
    // Preload localStorage with >10 messages for sess-1
    const key = `chatHistory:sess-1`;
    const many = Array.from({ length: 12 }).map((_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: `m${i}` }));
    localStorage.setItem(key, JSON.stringify(many));

    await new Promise<void>((resolve) => {
      mountAndGet((ctx) => {
        const p = ctx.getHistoryParam();
        expect(p).toBeTypeOf("string");
        const b64 = p.replace(/-/g, "+").replace(/_/g, "/");
        const pad = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
        const json = Buffer.from(pad, "base64").toString("utf8");
        const decoded = JSON.parse(json) as Array<{ role: string; content: string }>;
        expect(Array.isArray(decoded)).toBe(true);
        // Should start with system summary
        expect(decoded[0].role).toBe("system");
        expect(decoded[0].content).toContain("prev summary");
        // Then last N (default 2) messages from history
        const turns = decoded.slice(1);
        expect(turns.length).toBe(2);
        // historyRef holds last 10: m2..m11; we then take last 2 => m10, m11
        expect(turns[0].content).toBe("m10");
        resolve();
      });
    });
  });
});
