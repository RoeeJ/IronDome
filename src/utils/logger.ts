/**
 * Central logger initialization with optional Seq support
 *
 * This module checks environment variables and creates the appropriate logger instance.
 * Use this instead of importing DebugLogger directly to get Seq support when enabled.
 */

import { DebugLogger } from './DebugLogger';
import { SeqEnabledLogger } from './seq/SeqEnabledLogger';
import { LogVerbosity } from './LogCategories';

// Check if Seq is enabled via environment variables
const seqEnabled =
  (typeof Bun !== 'undefined' && Bun.env.VITE_SEQ_ENABLED === 'true') ||
  (typeof process !== 'undefined' && process.env.VITE_SEQ_ENABLED === 'true') ||
  (window as any).__ENV__?.SEQ_ENABLED === 'true' ||
  false;

// Create the appropriate logger instance
let loggerInstance: DebugLogger;

if (seqEnabled) {
  try {
    loggerInstance = SeqEnabledLogger.getInstance();
  } catch (error) {
    console.error('[Logger] Failed to initialize Seq logger, falling back to standard:', error);
    loggerInstance = DebugLogger.getInstance();
  }
} else {
  loggerInstance = DebugLogger.getInstance();
}

// Export the logger instance
export const debug = loggerInstance;

// Also export a function to get the logger instance directly
export function getLogger(): DebugLogger {
  return loggerInstance;
}

// Export verbosity control function
export function setSeqVerbosity(level: number): void {
  if (loggerInstance && 'setVerbosityLevel' in loggerInstance) {
    (loggerInstance as any).setVerbosityLevel(level);
  }
}

// Export structured logging helpers for Seq
export function logStructured(
  template: string,
  properties: Record<string, any>,
  level?: any
): void {
  const logger = getLogger() as any;
  if (logger.structured) {
    logger.structured(template, properties, level);
  } else {
    // Fallback for standard logger
    logger.log(template, properties);
  }
}

// Environment configuration helper
export interface SeqConfig {
  enabled: boolean;
  endpoint?: string;
  apiKey?: string;
  useProxy?: boolean;
  proxyEndpoint?: string;
  batchSize?: number;
  batchTimeout?: number;
}

export function getSeqConfig(): SeqConfig {
  const bunEnv = typeof Bun !== 'undefined' ? Bun.env : {};
  const processEnv = typeof process !== 'undefined' ? process.env : {};
  const windowEnv = (window as any).__ENV__ || {};

  // Helper to get env var from multiple sources
  const getEnv = (key: string): string | undefined => {
    return bunEnv[key] || processEnv[key] || windowEnv[key.replace('VITE_', '')];
  };

  return {
    enabled: getEnv('VITE_SEQ_ENABLED') === 'true',
    endpoint: getEnv('VITE_SEQ_ENDPOINT'),
    apiKey: getEnv('VITE_SEQ_API_KEY'),
    useProxy: getEnv('VITE_SEQ_USE_PROXY') === 'true',
    proxyEndpoint: getEnv('VITE_SEQ_PROXY_ENDPOINT'),
    batchSize: parseInt(getEnv('VITE_SEQ_BATCH_SIZE') || '100'),
    batchTimeout: parseInt(getEnv('VITE_SEQ_BATCH_TIMEOUT') || '2000'),
  };
}

// Test function to verify Seq is working
export async function testSeq(): Promise<void> {
  console.log('=== Testing Seq Integration ===');

  const config = getSeqConfig();
  console.log('Seq Config:', config);

  const logger = getLogger();
  console.log('Logger type:', logger.constructor.name);
  console.log('Logger instance:', logger);

  // Check if Web Worker is being used
  if ((logger as any).seqTransport) {
    const transport = (logger as any).seqTransport;
    console.log('Transport type:', transport.constructor.name);
    console.log('Web Worker support:', 'Worker' in globalThis);
  }

  // Test various log methods
  console.log('Sending test logs...');

  logger.log('Test log message from testSeq()');
  logger.warn('Test warning message');
  logger.error('Test error message', new Error('Test error'));
  logger.category('TestCategory', 'Test category message');
  logger.performance('TestOperation', 123.45, 'ms');

  // Test structured logging if available
  if ((logger as any).structured) {
    (logger as any).structured('Test structured log: User {UserId} performed {Action}', {
      UserId: 'test-user',
      Action: 'test-action',
      Timestamp: new Date().toISOString(),
    });
  }

  // Test high volume logging to verify no main thread blocking
  console.log('Testing high volume logging (should not block main thread)...');
  for (let i = 0; i < 100; i++) {
    logger.category('PerformanceTest', `High volume log ${i}`, { iteration: i });
  }

  // Force flush if available
  if ((logger as any).flush) {
    console.log('Flushing logs...');
    await (logger as any).flush();
    console.log('Logs flushed');
  }

  console.log('Test complete - check Seq dashboard and verify no frame drops');
}

// Make test function available globally
if (typeof window !== 'undefined') {
  (window as any).testSeq = testSeq;
  (window as any).getSeqConfig = getSeqConfig;
  (window as any).flushSeq = async () => {
    const logger = getLogger() as any;
    if (logger.flush) {
      await logger.flush();
    }
  };
  (window as any).debugLogger = getLogger();
  (window as any).setSeqVerbosity = setSeqVerbosity;
  (window as any).LogVerbosity = LogVerbosity;
}

// Export LogVerbosity for external use
export { LogVerbosity };
