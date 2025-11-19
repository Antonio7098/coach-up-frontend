"use client";

import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { devLog } from "../../app/api/lib/observability";
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

  devLog("debug", "MinimalSessionContext: initializing minimal session provider", {
    userId: user?.id || "anonymous",
    timestamp: new Date().toISOString()
  });
  
  // Get user ID for session logic
  const userId = user?.id || "anonymous";
  
  // Query latest interaction to determine session strategy
  const latestInteraction = useQuery(
    api.functions.interactions.getLatestInteraction,
    userId !== "anonymous" ? { userId } : "skip"
  );

  // 1) Try to restore sessionId from URL or localStorage on mount
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const fromUrl = url.searchParams.get('sessionId');
      if (fromUrl && fromUrl.trim()) {
        setSessionId(fromUrl.trim());
        setIsLoading(false);
        // Persist for future reloads
        try { localStorage.setItem('cu.sessionId', fromUrl.trim()); } catch {}
        return;
      }
    } catch {}
    try {
      const stored = localStorage.getItem('cu.sessionId');
      if (stored && stored.trim()) {
        setSessionId(stored.trim());
        setIsLoading(false);
        return;
      }
    } catch {}
    // If nothing persisted, let the later effect decide based on interactions
  }, []);

  // 2) Derive sessionId from latest interaction if not already set from persistence
  useEffect(() => {
    if (sessionId !== null) return; // already set from URL/localStorage
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
          devLog("info", "MinimalSessionContext: starting new session", {
            lastInteractionMinutesAgo: Math.round((Date.now() - latestInteraction.ts) / 60000),
            latestInteractionTs: latestInteraction.ts
          });
        } else {
          // Continue existing session
          setSessionId(latestInteraction.sessionId);
          devLog("info", "MinimalSessionContext: continuing existing session", {
            sessionId: latestInteraction.sessionId,
            lastInteractionMinutesAgo: Math.round((Date.now() - latestInteraction.ts) / 60000),
            latestInteractionTs: latestInteraction.ts
          });
        }
        
        setIsLoading(false);
      } catch (error) {
        devLog("warn", "MinimalSessionContext: session initialization failed", { error });
        // Fallback to new session
        setSessionId(safeUUID());
        setIsLoading(false);
      }
    };

    // Only initialize when we have the latest interaction data (or confirmed no user)
    if (latestInteraction !== undefined || userId === "anonymous") {
      initializeSession();
    }
  }, [latestInteraction, userId, sessionId]);

  // 3) Persist sessionId changes to localStorage
  useEffect(() => {
    if (!sessionId) return;
    try { localStorage.setItem('cu.sessionId', sessionId); } catch {}
  }, [sessionId]);

  // 4) Reflect sessionId in the URL query (?sessionId=...) without reloading
  useEffect(() => {
    try {
      // Only run in browser
      if (typeof window === 'undefined') return;
      const url = new URL(window.location.href);
      const current = url.searchParams.get('sessionId') || '';
      const next = sessionId || '';
      if (next && current !== next) {
        url.searchParams.set('sessionId', next);
        window.history.replaceState({}, '', url.toString());
      } else if (!next && current) {
        url.searchParams.delete('sessionId');
        window.history.replaceState({}, '', url.toString());
      }
    } catch {}
  }, [sessionId]);

  // Create session record when sessionId is available and we have a real user
  useEffect(() => {
    if (!sessionId || isLoading || userId === "anonymous") return;

  const createSessionIfNeeded = async () => {
    try {
      // Enhanced logging for session validation
      devLog("info", "MinimalSessionContext: checking session creation", {
        sessionId,
        userId,
        sessionIdFormat: sessionId.startsWith('sess_') ? 'convex_generated' : (sessionId.includes('-') ? 'uuid_format' : 'other')
      });
      
      const response = await fetch(`/api/v1/sessions?sessionId=${encodeURIComponent(sessionId)}`);
      const data = await response.json();

      if (!data.hasSession) {
        // Session doesn't exist, create it
        devLog("info", "MinimalSessionContext: creating new session", {
          sessionId,
          userId,
          reason: 'session_not_found'
        });
        
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
          devLog("warn", "MinimalSessionContext: failed to create session", {
            sessionId,
            userId,
            status: createResponse.status
          });
        } else {
          const createData = await createResponse.json().catch(() => ({}));
          devLog("info", "MinimalSessionContext: session created successfully", {
            originalSessionId: sessionId,
            effectiveSessionId: createData?.effectiveSessionId || sessionId,
            rotated: createData?.rotated || false,
            userId
          });
          
          // Update local session ID if server rotated it
          if (createData?.effectiveSessionId && createData.effectiveSessionId !== sessionId) {
            devLog("warn", "MinimalSessionContext: session rotated by server", {
              originalSessionId: sessionId,
              newSessionId: createData.effectiveSessionId,
              userId
            });
            setSessionId(createData.effectiveSessionId);
            try { localStorage.setItem('cu.sessionId', createData.effectiveSessionId); } catch {}
          }
        }
      } else {
        devLog("info", "MinimalSessionContext: session already exists", {
          sessionId,
          userId,
          sessionBelongsToUser: data.session?.userId === userId
        });
        
        // Warn if session belongs to different user
        if (data.session?.userId && data.session.userId !== userId) {
          devLog("warn", "MinimalSessionContext: session belongs to different user", {
            sessionId,
            currentUserId: userId,
            sessionUserId: data.session.userId,
            message: 'Session belongs to different user - may need to create new session'
          });
        }
      }
    } catch (error) {
      devLog("warn", "MinimalSessionContext: session creation check failed", {
        sessionId,
        userId,
        error: String(error)
      });
    }
  };

    createSessionIfNeeded();
  }, [sessionId, isLoading, userId]);

  const startNewSession = useCallback(() => {
    const newSessionId = safeUUID();
    setSessionId(newSessionId);
    try { localStorage.setItem('cu.sessionId', newSessionId); } catch {}
    devLog("info", "MinimalSessionContext: started new session", {
      newSessionId,
      reason: 'manual_start'
    });
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
        try { localStorage.setItem('cu.sessionId', newSessionId); } catch {}
        devLog("info", "MinimalSessionContext: starting new session due to idle timeout", {
          prevSessionId: sessionId,
          newSessionId,
          idleMinutes: Math.round(idleMs / 60000)
        });
        // Create new session doc for user
        try {
          const resp = await fetch('/api/v1/sessions/state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, sessionId: newSessionId, state: { step: 'init' } }),
          });
          if (!resp.ok) {
            devLog("warn", "MinimalSessionContext: failed to create rotated session", {
              status: resp.status,
              sessionId: newSessionId
            });
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



