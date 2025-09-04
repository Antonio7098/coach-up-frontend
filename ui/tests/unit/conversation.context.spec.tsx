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

// Mock Clerk before other imports
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ getToken: vi.fn().mockResolvedValue("test-token") }),
}));

vi.mock("../../src/context/minimal/MinimalMicContext", () => ({
  useMinimalMic: () => ({
    interactionState: "idle",
    interactionGroupId: undefined,
    interactionTurnCount: 0,
    assessmentChips: [],
  }),
}));
vi.mock("../../src/context/minimal/MinimalVoiceContext", () => ({
  useMinimalVoice: () => ({ enqueueTTSSegment: () => {}, sttFromBlob: async () => ({ text: "" }) }),
}));
vi.mock("../../src/context/minimal/MinimalSessionContext", () => ({
  useMinimalSession: () => ({ sessionId: "sess-1" }),
}));
vi.mock("../../src/hooks/useSessionSummary", () => ({
  useSessionSummary: () => ({ summary: { text: "prev summary" }, onTurn: () => {} }),
}));

import { MinimalConversationProvider, useMinimalConversation } from "../../src/context/minimal/MinimalConversationContext";

describe("MinimalConversationContext.getHistoryParam", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function mountAndGet(fn: (val: ReturnType<typeof useMinimalConversation>) => void) {
    const div = document.createElement("div");
    document.body.appendChild(div);
    const App = () => {
      const ctx = useMinimalConversation();
      // Defer to next macrotask so Provider effects (which load history) run first
      useEffect(() => { const t = setTimeout(() => fn(ctx), 0); return () => clearTimeout(t); }, [ctx]);
      return null;
    };
    const root = createRoot(div);
    root.render(React.createElement(MinimalConversationProvider, null, React.createElement(App)));
    return () => root.unmount();
  }

  it("provides immediate history access", async () => {
    // Test the minimal context's getImmediateHistory function
    await new Promise<void>((resolve) => {
      mountAndGet((ctx) => {
        const history = ctx.getImmediateHistory();
        expect(Array.isArray(history)).toBe(true);
        expect(history.length).toBeLessThanOrEqual(2); // Minimal context keeps only last 2 messages
        resolve();
      });
    });
  });
});
