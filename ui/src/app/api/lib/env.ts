/**
 * Typed environment variable access for frontend.
 *
 * This module provides type-safe access to environment variables with
 * sensible defaults and validation. All environment access should go
 * through these functions.
 */

// Server-side environment variables (available at build time)
const serverEnv = {
  // Next.js configuration
  NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL,
  NEXT_PUBLIC_AI_API_BASE_URL: process.env.NEXT_PUBLIC_AI_API_BASE_URL,
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,

  // Clerk configuration
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  CLERK_PROTECT_ALL: process.env.CLERK_PROTECT_ALL,

  // Mock mode
  MOCK_CONVEX: process.env.MOCK_CONVEX,

  // API configuration
  AI_API_BASE_URL: process.env.AI_API_BASE_URL,
  CONVEX_URL: process.env.CONVEX_URL,

  // Assessment configuration
  PERSIST_ASSESSMENTS_SECRET: process.env.PERSIST_ASSESSMENTS_SECRET,

  // Feature flags
  SKIP_AI_CONTRACTS: process.env.SKIP_AI_CONTRACTS,
};

// Client-side environment variables (runtime)
const clientEnv = {
  // Clerk
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: typeof window !== 'undefined'
    ? (window as any).ENV?.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    : process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,

  // Convex
  NEXT_PUBLIC_CONVEX_URL: typeof window !== 'undefined'
    ? (window as any).ENV?.NEXT_PUBLIC_CONVEX_URL
    : process.env.NEXT_PUBLIC_CONVEX_URL,

  // AI API
  NEXT_PUBLIC_AI_API_BASE_URL: typeof window !== 'undefined'
    ? (window as any).ENV?.NEXT_PUBLIC_AI_API_BASE_URL
    : process.env.NEXT_PUBLIC_AI_API_BASE_URL,

  // Feature flags
  MOCK_CONVEX: typeof window !== 'undefined'
    ? (window as any).ENV?.MOCK_CONVEX
    : process.env.MOCK_CONVEX,
};

/**
 * Get string value from environment
 */
export function getEnvString(key: string, defaultValue: string = ''): string {
  const value = (serverEnv as any)[key] || (clientEnv as any)[key] || defaultValue;
  return value;
}

/**
 * Get boolean value from environment
 */
export function getEnvBool(key: string, defaultValue: boolean = false): boolean {
  const value = (serverEnv as any)[key] || (clientEnv as any)[key];

  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value === 'string') {
    return value.toLowerCase() === 'true' || value === '1';
  }

  return Boolean(value);
}

/**
 * Get number value from environment
 */
export function getEnvNumber(key: string, defaultValue: number = 0): number {
  const value = (serverEnv as any)[key] || (clientEnv as any)[key];

  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  return Number(value) || defaultValue;
}

/**
 * Get URL from environment with validation
 */
export function getEnvUrl(key: keyof typeof serverEnv, defaultValue: string = ''): string {
  const value = getEnvString(key, defaultValue);

  if (!value) {
    return defaultValue;
  }

  try {
    new URL(value);
    return value;
  } catch {
    console.warn(`Invalid URL in environment variable ${key}: ${value}`);
    return defaultValue;
  }
}

/**
 * Check if we're in development mode
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development';
}

/**
 * Check if we're in production mode
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Check if mock mode is enabled
 */
export function isMockMode(): boolean {
  return getEnvBool('MOCK_CONVEX', false);
}

/**
 * Check if Clerk auth is enabled
 */
export function isClerkEnabled(): boolean {
  return Boolean(getEnvString('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', ''));
}

/**
 * Check if all routes should be protected by Clerk
 */
export function isClerkProtectAll(): boolean {
  return getEnvBool('CLERK_PROTECT_ALL', false);
}

/**
 * Get Convex URL
 */
export function getConvexUrl(): string {
  return getEnvUrl('NEXT_PUBLIC_CONVEX_URL', 'http://localhost:3210');
}

/**
 * Get AI API base URL
 */
export function getAiApiBaseUrl(): string {
  return getEnvUrl('NEXT_PUBLIC_AI_API_BASE_URL', 'http://localhost:8000');
}

/**
 * Get server-side Convex URL (for API routes)
 */
export function getServerConvexUrl(): string {
  return getEnvUrl('CONVEX_URL', getConvexUrl());
}

/**
 * Get server-side AI API base URL (for API routes)
 */
export function getServerAiApiBaseUrl(): string {
  return getEnvUrl('AI_API_BASE_URL', getAiApiBaseUrl());
}

/**
 * Check if we should skip AI contract tests
 */
export function shouldSkipAiContracts(): boolean {
  return getEnvBool('SKIP_AI_CONTRACTS', false);
}

/**
 * Get assessment persistence secret (for server-side API routes)
 */
export function getPersistAssessmentsSecret(): string {
  return getEnvString('PERSIST_ASSESSMENTS_SECRET', '');
}

/**
 * Validate required environment variables
 */
export function validateEnvironment(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check for required variables in production
  if (isProduction()) {
    if (!getEnvString('NEXT_PUBLIC_CONVEX_URL')) {
      errors.push('NEXT_PUBLIC_CONVEX_URL is required in production');
    }

    if (!getEnvString('NEXT_PUBLIC_AI_API_BASE_URL')) {
      errors.push('NEXT_PUBLIC_AI_API_BASE_URL is required in production');
    }

    if (!getEnvString('CONVEX_URL')) {
      errors.push('CONVEX_URL is required in production');
    }

    if (!getEnvString('AI_API_BASE_URL')) {
      errors.push('AI_API_BASE_URL is required in production');
    }

    if (!getEnvString('CLERK_SECRET_KEY')) {
      errors.push('CLERK_SECRET_KEY is required in production');
    }

    if (!getEnvString('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY')) {
      errors.push('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is required in production');
    }
  }

  // Validate URLs if they exist
  if (getEnvString('NEXT_PUBLIC_CONVEX_URL')) {
    try {
      new URL(getEnvString('NEXT_PUBLIC_CONVEX_URL'));
    } catch {
      errors.push('NEXT_PUBLIC_CONVEX_URL is not a valid URL');
    }
  }

  if (getEnvString('NEXT_PUBLIC_AI_API_BASE_URL')) {
    try {
      new URL(getEnvString('NEXT_PUBLIC_AI_API_BASE_URL'));
    } catch {
      errors.push('NEXT_PUBLIC_AI_API_BASE_URL is not a valid URL');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Log environment configuration (for debugging)
 */
export function logEnvironmentConfig(): void {
  if (isDevelopment()) {
    console.group('Environment Configuration');
    console.log('Mode:', process.env.NODE_ENV);
    console.log('Mock Mode:', isMockMode());
    console.log('Clerk Enabled:', isClerkEnabled());
    console.log('Clerk Protect All:', isClerkProtectAll());
    console.log('Skip AI Contracts:', shouldSkipAiContracts());
    console.log('Convex URL:', getConvexUrl());
    console.log('AI API Base URL:', getAiApiBaseUrl());
    console.groupEnd();
  }
}

/**
 * Environment configuration object
 */
export const env = {
  // Computed values
  isDevelopment,
  isProduction,
  isMockMode,
  isClerkEnabled,
  isClerkProtectAll,
  shouldSkipAiContracts,

  // URLs
  getConvexUrl,
  getAiApiBaseUrl,
  getServerConvexUrl,
  getServerAiApiBaseUrl,

  // Validation
  validateEnvironment,
  logEnvironmentConfig,

  // Raw values (for backward compatibility)
  NEXT_PUBLIC_CONVEX_URL: getEnvString('NEXT_PUBLIC_CONVEX_URL'),
  NEXT_PUBLIC_AI_API_BASE_URL: getEnvString('NEXT_PUBLIC_AI_API_BASE_URL'),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: getEnvString('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'),
  CLERK_SECRET_KEY: getEnvString('CLERK_SECRET_KEY'),
  MOCK_CONVEX: getEnvString('MOCK_CONVEX'),
};



