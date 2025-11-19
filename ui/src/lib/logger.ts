/**
 * Frontend logger utility for granular, runtime-tunable logging.
 *
 * Supports namespace-based logging with include/exclude filters,
 * environment-based configuration, and runtime overrides via localStorage/URL params.
 */

interface LogConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  include: string;
  exclude: string;
  format: 'pretty' | 'json';
}

interface LogEntry {
  timestamp: string;
  level: string;
  namespace: string;
  message: string;
  [key: string]: any;
}

class LoggerStore {
  private config: LogConfig;
  private listeners: Set<(config: LogConfig) => void> = new Set();

  constructor() {
    this.config = this.loadInitialConfig();
    this.setupURLParamListener();
  }

  private loadInitialConfig(): LogConfig {
    // Load from environment variables first
    const envLevel = (process.env.NEXT_PUBLIC_LOG_LEVEL || 'warn') as LogConfig['level'];
    const envInclude = process.env.NEXT_PUBLIC_LOG_INCLUDE || '';
    const envExclude = process.env.NEXT_PUBLIC_LOG_EXCLUDE || '';
    const envFormat = (process.env.NEXT_PUBLIC_LOG_FORMAT || 'pretty') as LogConfig['format'];

    // Override with localStorage if available
    if (typeof window !== 'undefined') {
      const storedLevel = localStorage.getItem('cu.log.level') as LogConfig['level'] | null;
      const storedInclude = localStorage.getItem('cu.log.include') || '';
      const storedExclude = localStorage.getItem('cu.log.exclude') || '';
      const storedFormat = localStorage.getItem('cu.log.format') as LogConfig['format'] | null;

      return {
        level: storedLevel || envLevel,
        include: storedInclude || envInclude,
        exclude: storedExclude || envExclude,
        format: storedFormat || envFormat,
      };
    }

    return {
      level: envLevel,
      include: envInclude,
      exclude: envExclude,
      format: envFormat,
    };
  }

  private setupURLParamListener(): void {
    if (typeof window === 'undefined') return;

    // Check for URL params on load
    const urlParams = new URLSearchParams(window.location.search);
    const debugParam = urlParams.get('debug');

    if (debugParam) {
      // Update localStorage with URL param
      localStorage.setItem('cu.log.include', debugParam);
      this.config.include = debugParam;
      this.notifyListeners();
    }

    // Listen for localStorage changes
    window.addEventListener('storage', (e) => {
      if (e.key?.startsWith('cu.log.')) {
        this.reloadConfig();
      }
    });
  }

  private reloadConfig(): void {
    if (typeof window === 'undefined') return;

    const newConfig: LogConfig = {
      level: (localStorage.getItem('cu.log.level') || this.config.level) as LogConfig['level'],
      include: localStorage.getItem('cu.log.include') || this.config.include,
      exclude: localStorage.getItem('cu.log.exclude') || this.config.exclude,
      format: (localStorage.getItem('cu.log.format') || this.config.format) as LogConfig['format'],
    };

    this.config = newConfig;
    this.notifyListeners();
  }

  getConfig(): LogConfig {
    return { ...this.config };
  }

  setConfig(updates: Partial<LogConfig>): void {
    if (typeof window !== 'undefined') {
      if (updates.level) localStorage.setItem('cu.log.level', updates.level);
      if (updates.include !== undefined) localStorage.setItem('cu.log.include', updates.include);
      if (updates.exclude !== undefined) localStorage.setItem('cu.log.exclude', updates.exclude);
      if (updates.format) localStorage.setItem('cu.log.format', updates.format);
    }

    this.config = { ...this.config, ...updates };
    this.notifyListeners();
  }

  subscribe(listener: (config: LogConfig) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.getConfig()));
  }
}

// Global logger store instance
const loggerStore = new LoggerStore();

// Level precedence: debug < info < warn < error
const LEVEL_PRECEDENCE = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class NamespaceLogger {
  constructor(private namespace: string) {}

  private shouldLog(level: keyof typeof LEVEL_PRECEDENCE): boolean {
    const config = loggerStore.getConfig();
    const requiredLevel = LEVEL_PRECEDENCE[level];

    // Check level
    if (requiredLevel < LEVEL_PRECEDENCE[config.level]) {
      return false;
    }

    // Check filters
    return this.matchesFilters(config);
  }

  private matchesFilters(config: LogConfig): boolean {
    const { include, exclude } = config;

    // Parse patterns
    const includePatterns = include ? include.split(',').map(p => p.trim()).filter(Boolean) : [];
    const excludePatterns = exclude ? exclude.split(',').map(p => p.trim()).filter(Boolean) : [];

    // If no include patterns, include everything (unless excluded)
    if (includePatterns.length === 0) {
      // Check exclude patterns
      return !excludePatterns.some(pattern => this.matchesPattern(pattern));
    }

    // Check include patterns
    const included = includePatterns.some(pattern => this.matchesPattern(pattern));

    if (!included) {
      return false;
    }

    // Check exclude patterns (higher priority)
    return !excludePatterns.some(pattern => this.matchesPattern(pattern));
  }

  private matchesPattern(pattern: string): boolean {
    // Simple glob matching (could use minimatch for more complex patterns)
    const regex = pattern
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${regex}$`).test(this.namespace);
  }

  private formatMessage(level: string, message: string, extra: Record<string, any> = {}): void {
    const config = loggerStore.getConfig();
    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      namespace: this.namespace,
      message,
      ...extra,
    };

    if (config.format === 'json') {
      console.log(JSON.stringify(logEntry, null, 2));
    } else {
      // Pretty format for development
      const levelEmoji = {
        debug: '🐛',
        info: 'ℹ️',
        warn: '⚠️',
        error: '❌',
      }[level] || '📝';

      const contextStr = Object.keys(extra).length > 0
        ? ` ${JSON.stringify(extra)}`
        : '';

      console.log(`${levelEmoji} [${this.namespace}] ${message}${contextStr}`);
    }
  }

  debug(message: string, extra: Record<string, any> = {}): void {
    if (this.shouldLog('debug')) {
      this.formatMessage('debug', message, extra);
    }
  }

  info(message: string, extra: Record<string, any> = {}): void {
    if (this.shouldLog('info')) {
      this.formatMessage('info', message, extra);
    }
  }

  warn(message: string, extra: Record<string, any> = {}): void {
    if (this.shouldLog('warn')) {
      this.formatMessage('warn', message, extra);
    }
  }

  error(message: string, extra: Record<string, any> = {}): void {
    if (this.shouldLog('error')) {
      this.formatMessage('error', message, extra);
    }
  }
}

// Cache for logger instances
const loggerCache = new Map<string, NamespaceLogger>();

export function createLogger(namespace: string): NamespaceLogger {
  if (loggerCache.has(namespace)) {
    return loggerCache.get(namespace)!;
  }

  const logger = new NamespaceLogger(namespace);
  loggerCache.set(namespace, logger);
  return logger;
}

// Global logger controls
export class CU_LOG {
  static getConfig(): LogConfig {
    return loggerStore.getConfig();
  }

  static setConfig(updates: Partial<LogConfig>): void {
    loggerStore.setConfig(updates);
  }

  static enable(namespace: string): void {
    const config = loggerStore.getConfig();
    const includePatterns = config.include
      ? config.include.split(',').map(p => p.trim()).filter(Boolean)
      : [];

    if (!includePatterns.includes(namespace)) {
      includePatterns.push(namespace);
      loggerStore.setConfig({
        include: includePatterns.filter(Boolean).join(',')
      });
    }
  }

  static disable(namespace: string): void {
    const config = loggerStore.getConfig();
    const includePatterns = config.include
      ? config.include.split(',').map(p => p.trim()).filter(Boolean)
      : [];

    const filtered = includePatterns.filter(p => p !== namespace);
    loggerStore.setConfig({
      include: filtered.filter(Boolean).join(',')
    });
  }

  static clear(): void {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('cu.log.level');
      localStorage.removeItem('cu.log.include');
      localStorage.removeItem('cu.log.exclude');
      localStorage.removeItem('cu.log.format');
    }
    // Force reload from env defaults
    window.location.reload();
  }
}

// Make CU_LOG available globally in browser
if (typeof window !== 'undefined') {
  (window as any).CU_LOG = CU_LOG;
}

// Backwards compatibility: replace devLog with new logger
const _originalDevLog = console.log;
const fallbackLogger = createLogger('ui:fallback');

// Export a default logger for backwards compatibility
export const devLog = {
  debug: (message: string, ...args: any[]) => {
    fallbackLogger.debug(message, ...args);
  },
  info: (message: string, ...args: any[]) => {
    fallbackLogger.info(message, ...args);
  },
  warn: (message: string, ...args: any[]) => {
    fallbackLogger.warn(message, ...args);
  },
  error: (message: string, ...args: any[]) => {
    fallbackLogger.error(message, ...args);
  },
};

// Export store for advanced usage
export { loggerStore, LoggerStore, NamespaceLogger };


