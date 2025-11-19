/**
 * Centralized triage functionality.
 *
 * This module provides a unified interface for triggering triage operations
 * and managing triage-related state and caching.
 */

import { makeApiRequest, withRetry, responses } from './http';

export interface TriageRequest {
  sessionId: string;
  messageIds: string[];
  batchSize?: number;
  cutoffIndex?: number;
}

export interface TriageUpdate {
  messageId: string;
  assessmentType: string;
  groupId?: string;
}

export interface TriageResponse {
  updates: TriageUpdate[];
  provider: string;
  modelId: string;
}

/**
 * Trigger triage for a session with specific message IDs.
 */
export async function triggerTriage(
  sessionId: string,
  messageIds: string[],
  requestId?: string,
  auth?: string
): Promise<TriageResponse> {
  if (!sessionId) {
    throw new Error('Session ID is required');
  }

  if (!messageIds || messageIds.length === 0) {
    throw new Error('Message IDs are required');
  }

  const requestBody: TriageRequest = {
    sessionId,
    messageIds,
  };

  const headers: Record<string, string> = {};

  if (requestId) {
    headers['X-Request-ID'] = requestId;
  }

  if (auth) {
    headers['Authorization'] = auth;
  }

  try {
    const response = await withRetry(
      () => makeApiRequest('/triage/batch', {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      }),
      3, // max retries
      1000 // delay
    );

    if (!response.ok) {
      if (response.status === 400) {
        throw new Error('Invalid triage request');
      } else if (response.status === 401) {
        throw new Error('Unauthorized triage request');
      } else if (response.status === 500) {
        throw new Error('Triage service error');
      } else {
        throw new Error(`Triage request failed: ${response.status}`);
      }
    }

    const data = await response.json();
    return data as TriageResponse;

  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Unknown triage error');
  }
}

/**
 * Trigger triage with automatic message discovery.
 * This will fetch recent messages for the session and triage them.
 */
export async function triggerTriageForSession(
  sessionId: string,
  limit: number = 50,
  requestId?: string,
  auth?: string
): Promise<TriageResponse> {
  // First, get recent messages for the session
  const messages = await getRecentMessages(sessionId, limit);

  if (messages.length === 0) {
    throw new Error('No messages found for session');
  }

  const messageIds = messages.map(msg => msg.messageId);

  return triggerTriage(sessionId, messageIds, requestId, auth);
}

/**
 * Get recent messages for a session (placeholder - will integrate with Convex)
 */
async function getRecentMessages(
  sessionId: string,
  limit: number
): Promise<Array<{ messageId: string; role: string; content: string; ts: number }>> {
  // TODO: Implement Convex query to get recent messages
  // This is a placeholder that will be replaced when we integrate with the actual Convex functions
  return [];
}

/**
 * Cache triage results to avoid redundant requests
 */
class TriageCache {
  private cache = new Map<string, { response: TriageResponse; timestamp: number }>();
  private readonly ttl = 5 * 60 * 1000; // 5 minutes

  private getCacheKey(sessionId: string, messageIds: string[]): string {
    return `${sessionId}:${messageIds.sort().join(',')}`;
  }

  get(sessionId: string, messageIds: string[]): TriageResponse | null {
    const key = this.getCacheKey(sessionId, messageIds);
    const cached = this.cache.get(key);

    if (!cached) {
      return null;
    }

    if (Date.now() - cached.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    return cached.response;
  }

  set(sessionId: string, messageIds: string[], response: TriageResponse): void {
    const key = this.getCacheKey(sessionId, messageIds);
    this.cache.set(key, {
      response,
      timestamp: Date.now(),
    });
  }

  clear(): void {
    this.cache.clear();
  }

  clearForSession(sessionId: string): void {
    for (const [key] of this.cache) {
      if (key.startsWith(`${sessionId}:`)) {
        this.cache.delete(key);
      }
    }
  }
}

// Global triage cache instance
export const triageCache = new TriageCache();

/**
 * Trigger triage with caching
 */
export async function triggerTriageWithCache(
  sessionId: string,
  messageIds: string[],
  requestId?: string,
  auth?: string
): Promise<TriageResponse> {
  // Check cache first
  const cached = triageCache.get(sessionId, messageIds);
  if (cached) {
    return cached;
  }

  // Perform triage
  const response = await triggerTriage(sessionId, messageIds, requestId, auth);

  // Cache the result
  triageCache.set(sessionId, messageIds, response);

  return response;
}

/**
 * Batch triage multiple sessions
 */
export async function batchTriage(
  requests: Array<{
    sessionId: string;
    messageIds: string[];
    requestId?: string;
    auth?: string;
  }>
): Promise<Array<{ sessionId: string; response: TriageResponse }>> {
  const results: Array<{ sessionId: string; response: TriageResponse }> = [];

  // Process requests concurrently but with rate limiting
  const BATCH_SIZE = 3; // Process 3 at a time to avoid overwhelming the API

  for (let i = 0; i < requests.length; i += BATCH_SIZE) {
    const batch = requests.slice(i, i + BATCH_SIZE);

    const batchPromises = batch.map(async ({ sessionId, messageIds, requestId, auth }) => {
      try {
        const response = await triggerTriage(sessionId, messageIds, requestId, auth);
        return { sessionId, response };
      } catch (error) {
        console.error(`Triage failed for session ${sessionId}:`, error);
        return {
          sessionId,
          response: {
            updates: [],
            provider: 'error',
            modelId: 'error',
          } as TriageResponse
        };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    // Small delay between batches to be respectful to the API
    if (i + BATCH_SIZE < requests.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return results;
}

/**
 * Validate triage response
 */
export function validateTriageResponse(response: TriageResponse): boolean {
  if (!response || typeof response !== 'object') {
    return false;
  }

  if (!Array.isArray(response.updates)) {
    return false;
  }

  if (typeof response.provider !== 'string') {
    return false;
  }

  if (typeof response.modelId !== 'string') {
    return false;
  }

  // Validate each update
  for (const update of response.updates) {
    if (!update || typeof update !== 'object') {
      return false;
    }

    if (typeof update.messageId !== 'string') {
      return false;
    }

    if (typeof update.assessmentType !== 'string') {
      return false;
    }

    // groupId is optional
    if (update.groupId !== undefined && typeof update.groupId !== 'string') {
      return false;
    }
  }

  return true;
}

/**
 * Group triage updates by assessment type
 */
export function groupTriageUpdatesByType(updates: TriageUpdate[]): Record<string, TriageUpdate[]> {
  const groups: Record<string, TriageUpdate[]> = {};

  for (const update of updates) {
    const type = update.assessmentType;
    if (!groups[type]) {
      groups[type] = [];
    }
    groups[type].push(update);
  }

  return groups;
}

/**
 * Get triage statistics
 */
export function getTriageStats(updates: TriageUpdate[]): {
  total: number;
  byType: Record<string, number>;
  withGroups: number;
  withoutGroups: number;
} {
  const stats = {
    total: updates.length,
    byType: {} as Record<string, number>,
    withGroups: 0,
    withoutGroups: 0,
  };

  for (const update of updates) {
    // Count by type
    stats.byType[update.assessmentType] = (stats.byType[update.assessmentType] || 0) + 1;

    // Count with/without groups
    if (update.groupId) {
      stats.withGroups++;
    } else {
      stats.withoutGroups++;
    }
  }

  return stats;
}



