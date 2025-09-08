import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { fetchWithRetry } from '../app/api/lib/retry';

export interface SummaryStatus {
  sessionId: string;
  due: boolean;
  lastSummary: {
    version: number;
    cutoffIndex?: number;
    updatedAt: number;
    preview: string;
  } | null;
  reservation: {
    inProgress: boolean;
    lastJobAt?: number;
  };
  turnsSince: number;
}

export interface SummaryStatusCache {
  status: SummaryStatus | null;
  lastFetched: number;
  etag: string | null;
  isStale: boolean;
}

export interface UseSummaryStatusOptions {
  sessionId: string;
  staleTime?: number; // How long to consider data fresh (default: 3000ms)
  revalidateOnFocus?: boolean; // Revalidate when window regains focus (default: true)
  useLiteEndpoint?: boolean; // Use lite endpoint for smaller payloads (default: true)
}

export function useSummaryStatusCache(options: UseSummaryStatusOptions) {
  const { sessionId, staleTime = 3000, revalidateOnFocus = true, useLiteEndpoint = true } = options;
  const { getToken } = useAuth();

  const [cache, setCache] = useState<SummaryStatusCache>({
    status: null,
    lastFetched: 0,
    etag: null,
    isStale: true
  });

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Refs for managing async operations
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const buildAuthHeaders = useCallback(async (base: HeadersInit = {}): Promise<HeadersInit> => {
    try {
      const token = await getToken();
      if (token) return { ...base, Authorization: `Bearer ${token}` };
    } catch {}
    return base;
  }, [getToken]);

  const fetchSummaryStatus = useCallback(async (force = false) => {
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

      // Use lite endpoint for smaller payloads and better performance
      const endpoint = useLiteEndpoint ? '/api/v1/session-summary/lite' : '/api/v1/session-summary';
      const url = `${endpoint}?sessionId=${encodeURIComponent(sessionId)}`;

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

      if (!isMountedRef.current) return;

      setCache(prevCache => ({
        status: data as SummaryStatus,
        lastFetched: Date.now(),
        etag: newEtag || prevCache.etag,
        isStale: false
      }));

    } catch (err) {
      if (!isMountedRef.current) return;

      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err);
        console.error('Failed to fetch summary status:', err);
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
      abortControllerRef.current = null;
    }
  }, [sessionId, cache.isStale, cache.lastFetched, staleTime, buildAuthHeaders, useLiteEndpoint]);

  // Initial fetch when sessionId changes
  useEffect(() => {
    if (sessionId) {
      void fetchSummaryStatus(true);
    }
  }, [sessionId]);

  // Revalidate on focus if enabled
  useEffect(() => {
    if (!revalidateOnFocus) return;

    const handleFocus = () => {
      if (cache.isStale || Date.now() - cache.lastFetched > staleTime) {
        void fetchSummaryStatus();
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [revalidateOnFocus, cache.isStale, cache.lastFetched, staleTime, fetchSummaryStatus]);

  // Manual refresh function
  const refresh = useCallback(() => {
    return fetchSummaryStatus(true);
  }, [fetchSummaryStatus]);

  // Get specific status fields with defaults
  const getStatusField = useCallback(<K extends keyof SummaryStatus>(
    field: K,
    defaultValue?: SummaryStatus[K]
  ): SummaryStatus[K] | undefined => {
    return cache.status?.[field] ?? defaultValue;
  }, [cache.status]);

  return {
    status: cache.status,
    isLoading,
    error,
    isStale: cache.isStale,
    refresh,
    getStatusField,
    lastFetched: cache.lastFetched,
    // Convenience getters
    isDue: cache.status?.due ?? false,
    isInProgress: cache.status?.reservation?.inProgress ?? false,
    turnsSince: cache.status?.turnsSince ?? 0,
    lastSummaryVersion: cache.status?.lastSummary?.version ?? 0
  };
}
