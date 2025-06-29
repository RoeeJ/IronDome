import { DebugLogger } from '../DebugLogger';
import { WebWorkerTransport } from './WebWorkerTransport';
import { LogLevel, LogEvent, ILogTransport } from './types';
import {
  LogVerbosity,
  LOG_CATEGORY_VERBOSITY,
  DEFAULT_SEQ_VERBOSITY,
  RATE_LIMITED_CATEGORIES,
  RATE_LIMIT_PER_SECOND,
} from '../LogCategories';

/**
 * Enhanced debug logger with Seq support
 */
export class SeqEnabledLogger extends DebugLogger {
  private static seqInstance: SeqEnabledLogger;
  private transports: ILogTransport[] = [];
  private seqTransport?: WebWorkerTransport;
  private structuredLoggingEnabled = false;
  private verbosityLevel: LogVerbosity = DEFAULT_SEQ_VERBOSITY;
  private rateLimiters: Map<string, { count: number; resetTime: number }> = new Map();

  protected constructor() {
    super();
    this.initializeSeq();
  }

  static getInstance(): SeqEnabledLogger {
    if (!SeqEnabledLogger.seqInstance) {
      SeqEnabledLogger.seqInstance = new SeqEnabledLogger();
    }
    return SeqEnabledLogger.seqInstance;
  }

  private initializeSeq(): void {
    // Check for Seq configuration in environment
    const seqEnabled =
      this.getEnvVar('VITE_SEQ_ENABLED') === 'true' || this.getEnvVar('SEQ_ENABLED') === 'true';

    if (!seqEnabled) {
      return;
    }

    const config = {
      endpoint: this.getEnvVar('VITE_SEQ_ENDPOINT') || this.getEnvVar('SEQ_ENDPOINT') || '',
      apiKey: this.getEnvVar('VITE_SEQ_API_KEY') || this.getEnvVar('SEQ_API_KEY'),
      batchSize: parseInt(
        this.getEnvVar('VITE_SEQ_BATCH_SIZE') || this.getEnvVar('SEQ_BATCH_SIZE') || '100'
      ),
      batchTimeout: parseInt(
        this.getEnvVar('VITE_SEQ_BATCH_TIMEOUT') || this.getEnvVar('SEQ_BATCH_TIMEOUT') || '2000'
      ),
      useProxy:
        this.getEnvVar('VITE_SEQ_USE_PROXY') === 'true' ||
        this.getEnvVar('SEQ_USE_PROXY') === 'true',
      proxyEndpoint:
        this.getEnvVar('VITE_SEQ_PROXY_ENDPOINT') || this.getEnvVar('SEQ_PROXY_ENDPOINT'),
    };

    try {
      this.seqTransport = new WebWorkerTransport(config);
      this.transports.push(this.seqTransport);
      this.structuredLoggingEnabled = true;
      this.seqTransport.setupUnloadHandler();
      console.log(
        '[SeqEnabledLogger] Initialized WebWorker-based Seq transport for off-main-thread logging'
      );
    } catch (error) {
      console.error('[SeqEnabledLogger] Failed to initialize Seq transport:', error);
    }
  }

  private getEnvVar(key: string): string | undefined {
    // Support Bun, process.env, and window env vars
    const bunEnv = typeof Bun !== 'undefined' ? Bun.env[key] : undefined;
    const processEnv = typeof process !== 'undefined' ? process.env[key] : undefined;
    const windowEnv = (window as any).__ENV__?.[key];

    return bunEnv || processEnv || windowEnv;
  }

  private shouldLogToSeq(category?: string, level: LogLevel = LogLevel.Info): boolean {
    if (!this.structuredLoggingEnabled) return false;

    // Always log errors and warnings to Seq
    if (level >= LogLevel.Warn) return true;

    // Check category verbosity
    if (category) {
      const categoryVerbosity = LOG_CATEGORY_VERBOSITY[category] ?? LogVerbosity.MEDIUM;
      if (categoryVerbosity > this.verbosityLevel) {
        return false;
      }

      // Check rate limiting
      if (RATE_LIMITED_CATEGORIES.has(category)) {
        return this.checkRateLimit(category);
      }
    }

    return true;
  }

  private checkRateLimit(category: string): boolean {
    const now = Date.now();
    const limiter = this.rateLimiters.get(category);

    if (!limiter || now > limiter.resetTime) {
      // Reset the rate limiter
      this.rateLimiters.set(category, {
        count: 1,
        resetTime: now + 1000, // Reset every second
      });
      return true;
    }

    if (limiter.count < RATE_LIMIT_PER_SECOND) {
      limiter.count++;
      return true;
    }

    return false;
  }

  setVerbosityLevel(level: LogVerbosity): void {
    this.verbosityLevel = level;
  }

  // Override base methods to add Seq support
  log(...args: any[]): void {
    super.log(...args);

    if (this.shouldLogToSeq(undefined, LogLevel.Info)) {
      this.logToTransports({
        timestamp: new Date(),
        level: LogLevel.Info,
        message: this.formatMessage(args),
        messageTemplate: this.extractTemplate(args),
        properties: this.extractProperties(args),
      });
    }
  }

  warn(...args: any[]): void {
    super.warn(...args);

    if (this.shouldLogToSeq(undefined, LogLevel.Warn)) {
      this.logToTransports({
        timestamp: new Date(),
        level: LogLevel.Warn,
        message: this.formatMessage(args),
        messageTemplate: this.extractTemplate(args),
        properties: this.extractProperties(args),
      });
    }
  }

  error(...args: any[]): void {
    super.error(...args);

    // Always log errors to Seq
    if (this.structuredLoggingEnabled) {
      const error = args.find(arg => arg instanceof Error);
      this.logToTransports({
        timestamp: new Date(),
        level: LogLevel.Error,
        message: this.formatMessage(args),
        messageTemplate: this.extractTemplate(args),
        properties: this.extractProperties(args),
        error: error as Error,
      });
    }
  }

  category(category: string, ...args: any[]): void {
    super.category(category, ...args);

    if (this.shouldLogToSeq(category, LogLevel.Info)) {
      this.logToTransports({
        timestamp: new Date(),
        level: LogLevel.Info,
        message: this.formatMessage(args),
        messageTemplate: this.extractTemplate(args),
        category,
        properties: this.extractProperties(args),
      });
    }
  }

  performance(label: string, value: number, unit: string = 'ms'): void {
    super.performance(label, value, unit);

    if (this.structuredLoggingEnabled) {
      this.logToTransports({
        timestamp: new Date(),
        level: LogLevel.Info,
        message: `${label}: ${value.toFixed(2)}${unit}`,
        messageTemplate: '{Label}: {Value}{Unit}',
        category: 'Performance',
        properties: {
          label,
          value,
          unit,
        },
        performance: {
          duration: value,
          unit,
        },
      });
    }
  }

  asset(action: string, asset: string, details?: any): void {
    super.asset(action, asset, details);

    if (this.structuredLoggingEnabled) {
      this.logToTransports({
        timestamp: new Date(),
        level: LogLevel.Info,
        message: `${action}: ${asset}`,
        messageTemplate: '{Action}: {Asset}',
        category: 'Asset',
        properties: {
          action,
          asset,
          ...details,
        },
      });
    }
  }

  /**
   * Enhanced module logger that supports Seq
   */
  module(moduleName: string): SeqModuleLogger {
    return new SeqModuleLogger(moduleName, this.isEnabled(), this);
  }

  /**
   * Log structured data directly (Seq-specific feature)
   */
  structured(
    template: string,
    properties: Record<string, any>,
    level: LogLevel = LogLevel.Info
  ): void {
    const message = this.renderTemplate(template, properties);

    // Log to console if debug enabled
    if (this.isEnabled()) {
      const logFn =
        level >= LogLevel.Error
          ? console.error
          : level >= LogLevel.Warn
            ? console.warn
            : console.log;
      logFn(`[IronDome]`, message, properties);
    }

    // Log to Seq
    if (this.structuredLoggingEnabled) {
      this.logToTransports({
        timestamp: new Date(),
        level,
        message,
        messageTemplate: template,
        properties,
      });
    }
  }

  private logToTransports(event: LogEvent): void {
    this.transports.forEach(transport => {
      transport.log(event).catch(error => {
        console.error('[SeqEnabledLogger] Transport error:', error);
      });
    });
  }

  private formatMessage(args: any[]): string {
    return args
      .map(arg => {
        if (typeof arg === 'object' && arg !== null) {
          try {
            return JSON.stringify(arg);
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      })
      .join(' ');
  }

  private extractTemplate(args: any[]): string | undefined {
    // If first argument is a string with placeholders, treat as template
    if (args.length > 0 && typeof args[0] === 'string') {
      const template = args[0];
      if (template.includes('{') && template.includes('}')) {
        return template;
      }
    }
    return undefined;
  }

  private extractProperties(args: any[]): Record<string, any> | undefined {
    // Extract objects from arguments as properties
    const properties: Record<string, any> = {};
    let hasProperties = false;

    args.forEach((arg, index) => {
      if (typeof arg === 'object' && arg !== null && !(arg instanceof Error)) {
        Object.assign(properties, arg);
        hasProperties = true;
      } else if (index > 0) {
        // Store non-object arguments as indexed properties
        properties[`arg${index}`] = arg;
        hasProperties = true;
      }
    });

    return hasProperties ? properties : undefined;
  }

  private renderTemplate(template: string, properties: Record<string, any>): string {
    return template.replace(/\{(\w+)\}/g, (match, key) => {
      return properties[key] !== undefined ? String(properties[key]) : match;
    });
  }

  /**
   * Flush all pending logs
   */
  async flush(): Promise<void> {
    await Promise.all(this.transports.map(transport => transport.flush?.() || Promise.resolve()));
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.transports.forEach(transport => {
      transport.destroy?.();
    });
    this.transports = [];
  }
}

/**
 * Enhanced module logger with Seq support
 */
export class SeqModuleLogger {
  constructor(
    private moduleName: string,
    private enabled: boolean,
    private logger: SeqEnabledLogger
  ) {}

  log(...args: any[]): void {
    if (this.enabled) {
      console.log(`[IronDome][${this.moduleName}]`, ...args);
    }

    if ((this.logger as any).shouldLogToSeq(this.moduleName, LogLevel.Info)) {
      (this.logger as any).logToTransports({
        timestamp: new Date(),
        level: LogLevel.Info,
        message: (this.logger as any).formatMessage(args),
        messageTemplate: (this.logger as any).extractTemplate(args),
        module: this.moduleName,
        properties: (this.logger as any).extractProperties(args),
      });
    }
  }

  warn(...args: any[]): void {
    if (this.enabled) {
      console.warn(`[IronDome][${this.moduleName}]`, ...args);
    }

    if ((this.logger as any).structuredLoggingEnabled) {
      (this.logger as any).logToTransports({
        timestamp: new Date(),
        level: LogLevel.Warn,
        message: (this.logger as any).formatMessage(args),
        messageTemplate: (this.logger as any).extractTemplate(args),
        module: this.moduleName,
        properties: (this.logger as any).extractProperties(args),
      });
    }
  }

  error(...args: any[]): void {
    console.error(`[IronDome][${this.moduleName}]`, ...args);

    if ((this.logger as any).structuredLoggingEnabled) {
      const error = args.find(arg => arg instanceof Error);
      (this.logger as any).logToTransports({
        timestamp: new Date(),
        level: LogLevel.Error,
        message: (this.logger as any).formatMessage(args),
        messageTemplate: (this.logger as any).extractTemplate(args),
        module: this.moduleName,
        properties: (this.logger as any).extractProperties(args),
        error: error as Error,
      });
    }
  }

  /**
   * Log structured data with module context
   */
  structured(
    template: string,
    properties: Record<string, any>,
    level: LogLevel = LogLevel.Info
  ): void {
    const enhancedProperties = { ...properties, module: this.moduleName };
    (this.logger as any).structured(template, enhancedProperties, level);
  }
}
