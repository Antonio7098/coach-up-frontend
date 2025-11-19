import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { fetchWithRetry } from '../app/api/lib/retry';
import { devLog } from '../app/api/lib/observability';

export interface Interaction {
  id: string;
  messageId: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  ts: number;
  contentHash?: string;
  audioUrl?: string;
  userId?: string;
  // Triage metadata (optional)
  assessmentType?: string;
  triageStatus?: 'pending' | 'running' | 'processed' | 'skipped' | 'error';
  triageDecision?: 'assess' | 'not_assess';
  triageProcessedAt?: number;
}

export interface InteractionsCache {
  interactions: Interaction[];
  latestId: string | null;
  lastFetched: number;
  etag: string | null;
  isStale: boolean;
}

export interface UseInteractionsOptions {
  sessionId: string;
  staleTime?: number; // How long to consider data fresh (default: 5000ms)
  revalidateOnFocus?: boolean; // Revalidate when window regains focus (default: true)
  debounceMs?: number; // Debounce prefetch triggers (default: 300ms)
}

export function useInteractionsCache(options: UseInteractionsOptions) {
  const { sessionId, staleTime = 5000, revalidateOnFocus = true, debounceMs = 300 } = options;
  const { getToken } = useAuth();
  
  // DEBUG: lifecycle
  devLog('debug', 'useInteractionsCache: init', { sessionId, staleTime, revalidateOnFocus, debounceMs });

  const [cache, setCache] = useState<InteractionsCache>({
    interactions: [],
    latestId: null,
    lastFetched: 0,
    etag: null,
    isStale: true
  });

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastFetchWasIncremental, setLastFetchWasIncremental] = useState<boolean>(false);
  const [lastFetchWas304, setLastFetchWas304] = useState<boolean>(false);

  // Refs for managing async operations and debouncing
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  // Build cache key: sessionId + lastSeenId
  const cacheKey = `${sessionId}:${cache.latestId || ''}`;

  // SSE subscription for triage events (event-driven cache updates)
  useEffect(() => {
    if (!sessionId) return;
    let es: EventSource | null = null;
    try {
      const url = `/api/v1/triage/stream?sessionId=${encodeURIComponent(sessionId)}`;
      es = new EventSource(url, { withCredentials: false });
      const onEvent = (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data || '{}');
          const type = String(data?.type || data?.kind || '');
          if (type === 'event') {
            const payload = data?.payload || {};
            const kind = String(payload?.kind || '');
            // Not all backends include kind at this level; support direct event shape
          }
          // The server sends objects with { type: ..., ... } on 'event' channel.
          const kind = String((data?.kind ?? data?.type) || '');
          if (kind === 'triage_done' || kind === 'triage_persist_ok') {
            const ids: string[] = Array.isArray(data?.payload?.messageIds) ? data.payload.messageIds : (Array.isArray(data?.messageIds) ? data.messageIds : []);
            const decisions = data?.payload?.decisions || data?.decisions || null;
            if (ids.length > 0) {
              setCache(prev => {
                const next = { ...prev, interactions: [...prev.interactions] } as InteractionsCache;
                let touched = 0;
                for (const mid of ids) {
                  const idx = next.interactions.findIndex(i => i.messageId === mid);
                  if (idx >= 0) {
                    const cur = next.interactions[idx];
                    next.interactions[idx] = {
                      ...cur,
                      triageStatus: 'processed',
                      triageDecision: decisions && typeof decisions === 'object' ? (decisions.assess > 0 ? 'assess' : 'not_assess') : (cur.triageDecision || 'not_assess'),
                      triageProcessedAt: Date.now(),
                    } as any;
                    touched++;
                  }
                }
                if (touched > 0) {
                  devLog('debug', 'useInteractionsCache: triage event updated', { touched, ids });
                  return next;
                }
                return prev;
              });
              // Trigger a single incremental refresh to reconcile
              try { void fetchInteractions(cache.latestId || undefined); } catch {}
            }
          }
        } catch (e) {
          devLog('warn', 'useInteractionsCache: SSE parse error', { error: e });
        }
      };
      es.addEventListener('event', onEvent as any);
      // Some servers send messages on 'message'
      es.addEventListener('message', onEvent as any);
      devLog('debug', 'useInteractionsCache: SSE connected', { url });
      return () => {
        try { es?.close(); } catch {}
      };
    } catch (e) {
      devLog('warn', 'useInteractionsCache: SSE setup failed', { error: e });
    }
  }, [sessionId, cache.latestId]);

  const buildAuthHeaders = useCallback(async (base: HeadersInit = {}): Promise<HeadersInit> => {
    try {
      const token = await getToken();
      if (token) return { ...base, Authorization: `Bearer ${token}` };
    } catch {}
    return base;
  }, [getToken]);

const fetchInteractions = useCallback(async (sinceId?: string, force = false) => {
    // If we don't have a sessionId yet, ensure we don't get stuck in loading state
    if (!sessionId) {
      devLog('debug', 'useInteractionsCache: skip fetch', { reason: 'no-session', sessionId });
      setIsLoading(false);
      return;
    }
    if (!force && !cache.isStale && Date.now() - cache.lastFetched < staleTime) {
      devLog('debug', 'useInteractionsCache: skip fetch', { reason: 'fresh', sessionId, force, isStale: cache.isStale, ageMs: Date.now() - cache.lastFetched, staleTime });
      return;
    }
    devLog('debug', 'useInteractionsCache: fetch start', { sessionId, sinceId, force, lastFetched: cache.lastFetched, etag: cache.etag, latestId: cache.latestId });

    // Cancel any ongoing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();

    try {
      setIsLoading(true);
      setError(null);

      // Prefer incremental fetch when we have a latestId and caller didn't override
      const effectiveSinceId = sinceId ?? (cache.latestId && !force ? cache.latestId : undefined);

      const headers = await buildAuthHeaders({
        'content-type': 'application/json',
        'x-request-id': Math.random().toString(36).slice(2),
        // Send ETag for 304 handling only on non-forced fetches
        ...(cache.etag && !force ? { 'if-none-match': cache.etag } : {}),
      });

      let url = `/api/v1/interactions?sessionId=${encodeURIComponent(sessionId)}&limit=50`;
      if (effectiveSinceId) {
        url += `&sinceId=${encodeURIComponent(effectiveSinceId)}`;
      }

      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: abortControllerRef.current?.signal,
        cache: 'no-store',
      });

// Handle 304 Not Modified
      if (response.status === 304) {
        devLog('debug', 'useInteractionsCache: fetch 304', { sessionId, effectiveSinceId, hadCache: (cache.interactions?.length || 0) > 0 });
        if (!isMountedRef.current) return;
        setCache(prevCache => ({ ...prevCache, lastFetched: Date.now(), isStale: false }));
        setLastFetchWas304(true);
        setLastFetchWasIncremental(!!effectiveSinceId);
        // Fallback: if cache is empty but server returned 304 (likely browser cache), refetch without ETag
        if ((cache.interactions?.length || 0) === 0) {
          devLog('warn', 'useInteractionsCache: 304 with empty cache -> refetching without ETag');
          try {
            await fetchInteractions(undefined, true);
          } catch (e) {
            devLog('error', 'useInteractionsCache: fallback refetch failed', { error: e });
          }
        }
        return;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

const data = await response.json();
      const newEtag = response.headers.get('etag');
      const latestId = response.headers.get('x-latest-id') || data.latestId;
      devLog('debug', 'useInteractionsCache: fetch ok', {
        sessionId,
        count: (data?.interactions || []).length,
          incremental: !!effectiveSinceId,
          newEtag,
          latestId
        });

      if (!isMountedRef.current) return;

setCache(prevCache => {
        // If we fetched incrementally, append to existing interactions
        const usedSince = effectiveSinceId;
        let newInteractions = data.interactions || [];
        if (usedSince && prevCache.interactions.length > 0) {
          newInteractions = [...prevCache.interactions, ...newInteractions];
        }

        const next = {
          interactions: newInteractions,
          latestId: latestId || prevCache.latestId,
          lastFetched: Date.now(),
          etag: newEtag || prevCache.etag,
          isStale: false
        } as InteractionsCache;
        devLog('debug', 'useInteractionsCache: state updated', {
          size: next.interactions.length,
          latestId: next.latestId,
            etag: next.etag,
            incremental: !!usedSince
          });
        return next;
      });

      setLastFetchWas304(false);
      setLastFetchWasIncremental(!!effectiveSinceId);

    } catch (err) {
      if (!isMountedRef.current) return;

      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err);
        devLog('error', 'useInteractionsCache: Failed to fetch interactions', { error: err });
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
      abortControllerRef.current = null;
    }
  }, [sessionId, cache.isStale, cache.lastFetched, staleTime, buildAuthHeaders]);

  // Debounced prefetch function
  const prefetch = useCallback((sinceId?: string) => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    debounceTimeoutRef.current = setTimeout(() => {
      void fetchInteractions(sinceId);
    }, debounceMs);
  }, [fetchInteractions, debounceMs]);

// Reset cache and initial fetch when sessionId changes
  useEffect(() => {
    // If session changed, clear cache to avoid mixing sessions
    setCache({ interactions: [], latestId: null, lastFetched: 0, etag: null, isStale: true });
    if (abortControllerRef.current) {
      try { abortControllerRef.current.abort(); } catch {}
      abortControllerRef.current = null;
    }
    if (debounceTimeoutRef.current) {
      try { clearTimeout(debounceTimeoutRef.current); } catch {}
      debounceTimeoutRef.current = null as any;
    }

    if (sessionId) {
      devLog('debug', 'useInteractionsCache: sessionId changed -> reset + initial fetch', { sessionId });
      void fetchInteractions(undefined, true);
    } else {
      // No session yet: make sure loading isn't stuck
      setIsLoading(false);
    }
  }, [sessionId]);

  // Revalidate on focus if enabled
  useEffect(() => {
    if (!revalidateOnFocus) return;

    const handleFocus = () => {
      if (cache.isStale || Date.now() - cache.lastFetched > staleTime) {
        void fetchInteractions();
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [revalidateOnFocus, cache.isStale, cache.lastFetched, staleTime, fetchInteractions]);

// Manual refresh function
  const refresh = useCallback(() => {
    devLog('debug', 'useInteractionsCache: manual refresh');
    return fetchInteractions(undefined, true);
  }, [fetchInteractions]);

// Get interactions since a specific ID
  const getInteractionsSince = useCallback((sinceId: string) => {
    const sinceIndex = cache.interactions.findIndex(interaction =>
      interaction.messageId === sinceId
    );
    devLog('debug', 'useInteractionsCache: getSince', { sinceId, found: sinceIndex >= 0, cacheSize: cache.interactions.length });

    if (sinceIndex >= 0) {
      return cache.interactions.slice(sinceIndex + 1);
    }

    // If sinceId not found in cache, trigger a fetch
    prefetch(sinceId);
    return [];
  }, [cache.interactions, prefetch]);

  // Get recent interactions (last N)
  const getRecentInteractions = useCallback((limit = 10) => {
    return cache.interactions.slice(-limit);
  }, [cache.interactions]);

  return {
    interactions: cache.interactions,
    latestId: cache.latestId,
    isLoading,
    error,
    isStale: cache.isStale,
    refresh,
    prefetch,
    getInteractionsSince,
    getRecentInteractions,
    cacheKey,
    // Debug/telemetry helpers
    sinceModeActive: !!cache.latestId,
    lastFetchWasIncremental,
    lastFetchWas304,
    lastEtag: cache.etag,
  };
}

