import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { fetchWithRetry } from '../app/api/lib/retry';

export interface Interaction {
  id: string;
  messageId: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  ts: number;
  contentHash?: string;
  audioUrl?: string;
  userId?: string;
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

  const [cache, setCache] = useState<InteractionsCache>({
    interactions: [],
    latestId: null,
    lastFetched: 0,
    etag: null,
    isStale: true
  });

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

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

  const buildAuthHeaders = useCallback(async (base: HeadersInit = {}): Promise<HeadersInit> => {
    try {
      const token = await getToken();
      if (token) return { ...base, Authorization: `Bearer ${token}` };
    } catch {}
    return base;
  }, [getToken]);

  const fetchInteractions = useCallback(async (sinceId?: string, force = false) => {
    if (!sessionId || (!force && !cache.isStale && Date.now() - cache.lastFetched < staleTime)) {
      return;
    }

    // Cancel any ongoing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();

    try {
      setIsLoading(true);
      setError(null);

      const headers = await buildAuthHeaders({
        'content-type': 'application/json',
        'x-request-id': Math.random().toString(36).slice(2)
      });

      let url = `/api/v1/interactions?sessionId=${encodeURIComponent(sessionId)}&limit=50`;
      if (sinceId) {
        url += `&sinceId=${encodeURIComponent(sinceId)}`;
      }

      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const newEtag = response.headers.get('etag');
      const latestId = response.headers.get('x-latest-id') || data.latestId;

      if (!isMountedRef.current) return;

      setCache(prevCache => {
        // If we got new data via sinceId, append to existing interactions
        let newInteractions = data.interactions || [];
        if (sinceId && prevCache.interactions.length > 0) {
          newInteractions = [...prevCache.interactions, ...newInteractions];
        }

        return {
          interactions: newInteractions,
          latestId: latestId || prevCache.latestId,
          lastFetched: Date.now(),
          etag: newEtag || prevCache.etag,
          isStale: false
        };
      });

    } catch (err) {
      if (!isMountedRef.current) return;

      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err);
        console.error('Failed to fetch interactions:', err);
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

  // Initial fetch when sessionId changes
  useEffect(() => {
    if (sessionId) {
      void fetchInteractions(undefined, true);
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
    return fetchInteractions(undefined, true);
  }, [fetchInteractions]);

  // Get latest interactions since a specific ID
  const getInteractionsSince = useCallback((sinceId: string) => {
    const sinceIndex = cache.interactions.findIndex(interaction =>
      interaction.messageId === sinceId
    );

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
    cacheKey
  };
}
