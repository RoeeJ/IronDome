/**
 * @deprecated Use `import { debug } from '../utils/logger'` instead
 * 
 * Debug logger that only outputs when ?debug is in the URL
 */
export class DebugLogger {
  private static instance: DebugLogger;
  private enabled: boolean;
  private prefix: string = '[IronDome]';

  protected constructor() {
    // Check if debug mode is enabled via query parameter
    const urlParams = new URLSearchParams(window.location.search);
    this.enabled = urlParams.has('debug');

    if (this.enabled) {
      console.log(`%c${this.prefix} Debug mode enabled`, 'color: #00ff00; font-weight: bold');
    }
  }

  static getInstance(): DebugLogger {
    if (!DebugLogger.instance) {
      DebugLogger.instance = new DebugLogger();
    }
    return DebugLogger.instance;
  }

  /**
   * Log general debug information
   */
  log(...args: any[]): void {
    if (this.enabled) {
      console.log(`${this.prefix}`, ...args);
    }
  }

  /**
   * Log warnings
   */
  warn(...args: any[]): void {
    if (this.enabled) {
      console.warn(`${this.prefix}`, ...args);
    }
  }

  /**
   * Log errors (always shown)
   */
  error(...args: any[]): void {
    console.error(`${this.prefix}`, ...args);
  }

  /**
   * Log with a specific category
   */
  category(category: string, ...args: any[]): void {
    if (this.enabled) {
      console.log(`${this.prefix}[${category}]`, ...args);
    }
  }

  /**
   * Log performance metrics
   */
  performance(label: string, value: number, unit: string = 'ms'): void {
    if (this.enabled) {
      const color =
        value > 16.67 ? 'color: #ff0000' : value > 8 ? 'color: #ffaa00' : 'color: #00ff00';
      console.log(`%c${this.prefix}[Performance] ${label}: ${value.toFixed(2)}${unit}`, color);
    }
  }

  /**
   * Log model/asset loading
   */
  asset(action: string, asset: string, details?: any): void {
    if (this.enabled) {
      if (details) {
        console.log(`${this.prefix}[Asset] ${action}: ${asset}`, details);
      } else {
        console.log(`${this.prefix}[Asset] ${action}: ${asset}`);
      }
    }
  }

  /**
   * Create a named logger for a specific module
   */
  module(moduleName: string): ModuleLogger {
    return new ModuleLogger(moduleName, this.enabled);
  }

  /**
   * Check if debug mode is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

/**
 * Module-specific logger
 */
export class ModuleLogger {
  constructor(
    private moduleName: string,
    private enabled: boolean
  ) {}

  log(...args: any[]): void {
    if (this.enabled) {
      console.log(`[IronDome][${this.moduleName}]`, ...args);
    }
  }

  warn(...args: any[]): void {
    if (this.enabled) {
      console.warn(`[IronDome][${this.moduleName}]`, ...args);
    }
  }

  error(...args: any[]): void {
    console.error(`[IronDome][${this.moduleName}]`, ...args);
  }
}

// Export singleton instance
export const debug = DebugLogger.getInstance();
