/**
 * Frontend observability helpers - development logging and performance marking.
 *
 * These utilities are gated by environment to avoid console noise in production.
 */

import { getEnvBool, getEnvString } from "./env";
import { createLogger } from "@/lib/logger";

/**
 * Server-side logging utility with namespace filtering.
 * Respects LOG_LEVEL, LOG_INCLUDE, and LOG_EXCLUDE environment variables.
 */
export function devLog(level: "info" | "warn" | "error" | "debug", message: string, data?: Record<string, any>) {
  // Only log in development or when explicitly enabled
  const isDev = getEnvString("NODE_ENV") === "development";
  const forceDevLogs = getEnvBool("FORCE_DEV_LOGS", false);

  if (!isDev && !forceDevLogs) {
    return;
  }

  // Check log level (server-side uses LOG_LEVEL, not NEXT_PUBLIC_LOG_LEVEL)
  const configLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
  const levelPrecedence = { debug: 0, info: 1, warn: 2, error: 3 };
  if (levelPrecedence[level] < levelPrecedence[configLevel as keyof typeof levelPrecedence]) {
    return;
  }

  // Check namespace filters (server-side uses LOG_INCLUDE/LOG_EXCLUDE)
  const namespace = 'ui:api:observability';
  if (!shouldLogNamespace(namespace)) {
    return;
  }

  // Format and output
  const timestamp = new Date().toISOString();
  const logData = data ? { ...data } : {};
  console.log(JSON.stringify({
    timestamp,
    level,
    namespace,
    message,
    ...logData
  }));
}

/**
 * Check if a namespace should be logged based on LOG_INCLUDE/LOG_EXCLUDE filters
 */
function shouldLogNamespace(namespace: string): boolean {
  const include = process.env.LOG_INCLUDE || '';
  const exclude = process.env.LOG_EXCLUDE || '';

  // Parse patterns
  const includePatterns = include ? include.split(',').map(p => p.trim()).filter(Boolean) : [];
  const excludePatterns = exclude ? exclude.split(',').map(p => p.trim()).filter(Boolean) : [];

  // If no include patterns, include everything (unless excluded)
  if (includePatterns.length === 0) {
    return !excludePatterns.some(pattern => matchesPattern(namespace, pattern));
  }

  // Check include patterns
  const included = includePatterns.some(pattern => matchesPattern(namespace, pattern));
  if (!included) {
    return false;
  }

  // Check exclude patterns (higher priority)
  return !excludePatterns.some(pattern => matchesPattern(namespace, pattern));
}

/**
 * Simple glob pattern matching
 */
function matchesPattern(namespace: string, pattern: string): boolean {
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
  return regex.test(namespace);
}

/**
 * Performance marking utility - creates performance marks and measures.
 * Only enabled in development mode.
 */
export function perfMark(label: string, measureFrom?: string) {
  // Only create marks in development or when explicitly enabled
  const isDev = getEnvString("NODE_ENV") === "development";
  const forcePerfMarks = getEnvBool("FORCE_PERF_MARKS", false);

  if (!isDev && !forcePerfMarks) {
    return;
  }

  if (typeof performance === "undefined") {
    return;
  }

  if (measureFrom) {
    // Create a measure from the previous mark
    try {
      performance.measure(`${label}_duration`, measureFrom, label);
      devLog("debug", `Performance measure created: ${label}`, {
        from: measureFrom,
        to: label
      });
    } catch (error) {
      devLog("warn", `Failed to create performance measure: ${label}`, { error });
    }
  } else {
    // Just create a mark
    performance.mark(label);
    devLog("debug", `Performance mark created: ${label}`);
  }
}

/**
 * Get performance entries for a specific label.
 * Useful for debugging performance issues.
 */
export function getPerfEntries(label: string): PerformanceEntry[] {
  if (typeof performance === "undefined") {
    return [];
  }

  return performance.getEntriesByName(label);
}

/**
 * Log performance measures for debugging.
 */
export function logPerfMeasures() {
  const isDev = getEnvString("NODE_ENV") === "development";
  const forcePerfMarks = getEnvBool("FORCE_PERF_MARKS", false);

  if (!isDev && !forcePerfMarks) {
    return;
  }

  if (typeof performance === "undefined") {
    return;
  }

  const measures = performance.getEntriesByType("measure");
  if (measures.length > 0) {
    devLog("info", "Performance measures", {
      measures: measures.map(m => ({
        name: m.name,
        duration: m.duration,
        startTime: m.startTime,
      }))
    });
  }
}

/**
 * Clear performance marks and measures.
 * Useful for cleaning up after tests or long-running sessions.
 */
export function clearPerfMarks() {
  if (typeof performance === "undefined") {
    return;
  }

  performance.clearMarks();
  performance.clearMeasures();
  devLog("debug", "Performance marks and measures cleared");
}

/**
 * Context manager for performance measurement.
 * Usage:
 * ```typescript
 * using _ = perfMeasure("some_operation");
 * // do work
 * // measure will be logged automatically
 * ```
 */
export function perfMeasure(label: string) {
  const startMark = `${label}_start`;
  const endMark = `${label}_end`;

  // Create start mark
  perfMark(startMark);

  // Return context manager
  return {
    [Symbol.dispose]() {
      perfMark(endMark, startMark);
    }
  };
}

