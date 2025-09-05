"use client";

import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { useUser } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

export type MinimalSessionContextValue = {
  sessionId: string | null;
  isLoading?: boolean;
  startNewSession: () => void;
  ensureFreshSession: () => Promise<void>;
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
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const { user } = useUser();
  
  // Get user ID for session logic
  const userId = user?.id || "anonymous";
  
  // Query latest interaction to determine session strategy
  const latestInteraction = useQuery(
    api.functions.interactions.getLatestInteraction,
    userId !== "anonymous" ? { userId } : "skip"
  );

  useEffect(() => {
    const initializeSession = async () => {
      try {
        // If no user or no latest interaction, start fresh session
        if (!latestInteraction || userId === "anonymous") {
          const newSessionId = safeUUID();
          setSessionId(newSessionId);
          setIsLoading(false);
          return;
        }

        // Check if last interaction was more than 10 minutes ago
        const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
        const shouldStartNew = latestInteraction.ts < tenMinutesAgo;

        if (shouldStartNew) {
          // Start new session
          const newSessionId = safeUUID();
          setSessionId(newSessionId);
          console.log('Starting new session - last interaction was', Math.round((Date.now() - latestInteraction.ts) / 60000), 'minutes ago');
        } else {
          // Continue existing session
          setSessionId(latestInteraction.sessionId);
          console.log('Continuing existing session - last interaction was', Math.round((Date.now() - latestInteraction.ts) / 60000), 'minutes ago');
        }
        
        setIsLoading(false);
      } catch (error) {
        console.warn('Session initialization failed:', error);
        // Fallback to new session
        setSessionId(safeUUID());
        setIsLoading(false);
      }
    };

    // Only initialize when we have the latest interaction data (or confirmed no user)
    if (latestInteraction !== undefined || userId === "anonymous") {
      initializeSession();
    }
  }, [latestInteraction, userId]);

  // Create session record when sessionId is available and we have a real user
  useEffect(() => {
    if (!sessionId || isLoading || userId === "anonymous") return;

    const createSessionIfNeeded = async () => {
      try {
        const response = await fetch(`/api/v1/sessions?sessionId=${encodeURIComponent(sessionId)}`);
        const data = await response.json();

        if (!data.hasSession) {
          // Session doesn't exist, create it
          const createResponse = await fetch('/api/v1/sessions/state', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              userId: userId,
              sessionId: sessionId,
              state: { step: 'init' },
            }),
          });

          if (!createResponse.ok) {
            console.warn('Failed to create session:', createResponse.status);
          } else {
            console.log('Created new session:', sessionId);
          }
        }
      } catch (error) {
        console.warn('Session creation check failed:', error);
      }
    };

    createSessionIfNeeded();
  }, [sessionId, isLoading, userId]);

  const startNewSession = useCallback(() => {
    const newSessionId = safeUUID();
    setSessionId(newSessionId);
    console.log('Started new session:', newSessionId);
  }, []);

  const ensureFreshSession = useCallback(async () => {
    try {
      if (!sessionId) return;
      // Fetch lightweight metrics for current session
      const res = await fetch(`/api/v1/sessions/metrics?sessionId=${encodeURIComponent(sessionId)}`);
      if (!res.ok) return;
      const data = await res.json();
      const last = typeof data?.lastActivityAt === 'number' ? data.lastActivityAt : 0;
      const idleMs = Date.now() - (last || 0);
      const thresholdMs = 10 * 60 * 1000;
      if (idleMs > thresholdMs) {
        const newSessionId = safeUUID();
        setSessionId(newSessionId);
        console.log('Starting new session (idle > 10m):', { prev: sessionId, next: newSessionId, idleMin: Math.round(idleMs / 60000) });
        // Create new session doc for user
        try {
          const resp = await fetch('/api/v1/sessions/state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, sessionId: newSessionId, state: { step: 'init' } }),
          });
          if (!resp.ok) {
            console.warn('Failed to create rotated session:', resp.status);
          }
        } catch {}
      }
    } catch {}
  }, [sessionId, userId]);

  const value = useMemo<MinimalSessionContextValue>(() => ({
    sessionId,
    isLoading,
    startNewSession,
    ensureFreshSession,
  }), [sessionId, isLoading, startNewSession, ensureFreshSession]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}



