/**
 * Centralized HTTP utilities for API routes.
 *
 * This module provides common HTTP patterns used across all API routes:
 * - JSON parsing and response handling
 * - Error handling (bad request, unauthorized, etc.)
 * - Abort controller integration
 * - Timeout handling
 * - ETag support
 * - Server base URL configuration
 */

import { NextRequest, NextResponse } from 'next/server';

// Server base URL configuration
export const serverBaseUrl = process.env.NEXT_PUBLIC_AI_API_BASE_URL || 'http://localhost:8000';

/**
 * Parse JSON body from request
 */
export async function json<T = any>(request: Request): Promise<T> {
  try {
    return await request.json();
  } catch (error) {
    throw new Error('Invalid JSON body');
  }
}

/**
 * Create bad request response
 */
export function badRequest(message: string = 'Bad Request'): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Create unauthorized response
 */
export function unauthorized(message: string = 'Unauthorized'): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Create internal server error response
 */
export function internalServerError(message: string = 'Internal Server Error'): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 500,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Create success response
 */
export function success(data: any, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Add AbortController support to fetch requests
 */
export function withAbort<T extends RequestInit>(init?: T): T {
  if (!init) {
    return {} as T;
  }

  const result = { ...init } as T;
  // Only add signal if it's not null/undefined
  if (init.signal != null) {
    (result as any).signal = init.signal;
  }
  return result;
}

/**
 * Add timeout to fetch requests
 */
export function withTimeout<T extends RequestInit>(
  init?: T,
  timeoutMs: number = 30000
): T {
  const controller = new AbortController();

  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  const originalSignal = init?.signal;

  // Create a new signal that aborts when either the original signal aborts or timeout occurs
  const signal = controller.signal;

  if (originalSignal) {
    originalSignal.addEventListener('abort', () => controller.abort());
  }

  const result = { ...init } as T;
  (result as any).signal = signal;
  return result;
}

/**
 * Generate ETag for response
 */
export function etagFor(data: any): string {
  const content = typeof data === 'string' ? data : JSON.stringify(data);
  let hash = 0;

  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  return `"${Math.abs(hash).toString(36)}"`;
}

/**
 * Check if request has matching ETag
 */
export function hasMatchingEtag(request: Request, etag: string): boolean {
  const ifNoneMatch = request.headers.get('if-none-match');
  return ifNoneMatch === etag;
}

/**
 * Create response with ETag
 */
export function withEtag(data: any, status: number = 200): Response {
  const etag = etagFor(data);
  const response = success(data, status);

  return new Response(response.body, {
    ...response,
    headers: {
      ...response.headers,
      'ETag': etag,
    },
  });
}

/**
 * Handle request with ETag caching
 */
export async function withEtagCache<T>(
  request: Request,
  fetchData: () => Promise<T>
): Promise<Response> {
  try {
    const data = await fetchData();
    const etag = etagFor(data);

    // Check if client has current version
    if (hasMatchingEtag(request, etag)) {
      return new Response(null, { status: 304 });
    }

    return withEtag(data);
  } catch (error) {
    return internalServerError(error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Get authentication headers from request
 */
export function getAuthHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};

  // Add common headers
  const authHeader = request.headers.get('authorization');
  if (authHeader) {
    headers['Authorization'] = authHeader;
  }

  const requestId = request.headers.get('x-request-id');
  if (requestId) {
    headers['X-Request-ID'] = requestId;
  }

  return headers;
}

/**
 * Make request to AI API with common patterns
 */
export async function makeApiRequest(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = `${serverBaseUrl}${endpoint}`;

  const headers = new Headers(options.headers);

  // Add common headers
  headers.set('Content-Type', 'application/json');

  // Add auth headers if available
  if (typeof window === 'undefined') {
    // Server-side: get from headers
    // Note: In server routes, headers are passed via the request object
    // This is handled by the calling route
  } else {
    // Client-side: get from localStorage or other client storage
    const token = localStorage.getItem('auth_token');
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  return fetch(url, {
    ...options,
    headers,
  });
}

/**
 * Retry mechanism for API requests
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error = new Error('Unknown error');

  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');

      if (i === maxRetries) {
        break;
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delayMs * Math.pow(2, i)));
    }
  }

  throw lastError;
}

/**
 * Common response patterns
 */
export const responses = {
  ok: (data: any) => success(data),
  badRequest: (message: string) => badRequest(message),
  unauthorized: (message: string = 'Unauthorized') => unauthorized(message),
  notFound: (message: string = 'Not Found') => new Response(
    JSON.stringify({ error: message }),
    {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    }
  ),
  methodNotAllowed: (message: string = 'Method Not Allowed') => new Response(
    JSON.stringify({ error: message }),
    {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    }
  ),
};



