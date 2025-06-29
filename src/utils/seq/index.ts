import { DebugLogger } from '../DebugLogger';
import { SeqEnabledLogger } from './SeqEnabledLogger';

/**
 * Factory function to create the appropriate logger based on environment configuration
 */
export function createLogger(): DebugLogger {
  // Check if Seq is enabled via environment variables
  const seqEnabled =
    (import.meta as any).env?.VITE_SEQ_ENABLED === 'true' ||
    (window as any).__ENV__?.SEQ_ENABLED === 'true' ||
    false;

  if (seqEnabled) {
    console.log('[Logger] Initializing Seq-enabled logger');
    return SeqEnabledLogger.getInstance();
  }

  // Fall back to standard debug logger
  return DebugLogger.getInstance();
}

// Re-export types for convenience
export { LogLevel } from './types';
export type { LogEvent, ILogTransport } from './types';
export { SeqTransport } from './SeqTransport';
export { SeqEnabledLogger } from './SeqEnabledLogger';
