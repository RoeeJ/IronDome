import { LogLevel, LogEvent } from './types';

interface SeqConfig {
  endpoint: string;
  apiKey?: string;
  batchSize: number;
  batchTimeout: number;
  useProxy: boolean;
  proxyEndpoint?: string;
}

interface SeqLogEvent {
  '@t': string; // ISO 8601 timestamp
  '@l'?: string; // Level (Verbose, Debug, Information, Warning, Error, Fatal)
  '@mt': string; // Message template
  '@x'?: string; // Exception
  [key: string]: any; // Additional properties
}

export class SeqTransport {
  private config: SeqConfig;
  private logBuffer: SeqLogEvent[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private isSending = false;
  private failureCount = 0;
  private maxRetries = 3;
  private isEnabled = false;
  private readonly MAX_PAYLOAD_SIZE = 5 * 1024 * 1024; // 5MB (half of Seq's limit)
  private readonly MAX_EVENT_SIZE = 50 * 1024; // 50KB per event

  constructor(config: Partial<SeqConfig>) {
    this.config = {
      endpoint: config.endpoint || '',
      apiKey: config.apiKey,
      batchSize: config.batchSize || 100,
      batchTimeout: config.batchTimeout || 2000,
      useProxy: config.useProxy ?? false,
      proxyEndpoint: config.proxyEndpoint || '/api/logs/seq',
    };


    // Validate configuration
    this.isEnabled = this.validateConfig();
    
  }

  private validateConfig(): boolean {
    if (!this.config.endpoint && !this.config.useProxy) {
      console.warn('[SeqTransport] No endpoint configured and proxy mode disabled');
      return false;
    }

    // Allow direct mode without API key if endpoint is configured
    if (!this.config.useProxy && !this.config.endpoint) {
      console.warn('[SeqTransport] Direct mode requires endpoint');
      return false;
    }

    return true;
  }

  async log(event: LogEvent): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    const seqEvent = this.transformToSeqFormat(event);
    
    // Check event size
    const eventSize = JSON.stringify(seqEvent).length;
    if (eventSize > this.MAX_EVENT_SIZE) {
      console.warn(`[SeqTransport] Event too large (${(eventSize / 1024).toFixed(1)}KB), truncating`);
      // Truncate large properties
      if (seqEvent['@x'] && seqEvent['@x'].length > 1000) {
        seqEvent['@x'] = seqEvent['@x'].substring(0, 1000) + '... (truncated)';
      }
      Object.keys(seqEvent).forEach(key => {
        if (typeof seqEvent[key] === 'string' && seqEvent[key].length > 500) {
          seqEvent[key] = seqEvent[key].substring(0, 500) + '... (truncated)';
        }
      });
    }
    
    this.logBuffer.push(seqEvent);

    // Check if we should send immediately
    if (this.logBuffer.length >= this.config.batchSize) {
      // Don't await - let it run in background
      this.flush();
    } else {
      // Reset batch timer
      this.scheduleBatch();
    }
  }

  private transformToSeqFormat(event: LogEvent): SeqLogEvent {
    const seqEvent: SeqLogEvent = {
      '@t': event.timestamp.toISOString(),
      '@mt': event.messageTemplate || event.message,
      '@l': this.mapLogLevel(event.level),
      Module: event.module,
      Category: event.category,
      Environment: 'browser',
      Application: 'IronDome',
      SessionId: this.getSessionId(),
      UserId: this.getUserId(),
    };

    // Add custom properties
    if (event.properties) {
      Object.entries(event.properties).forEach(([key, value]) => {
        // Seq convention: capitalize property names
        const capitalizedKey = key.charAt(0).toUpperCase() + key.slice(1);
        seqEvent[capitalizedKey] = value;
      });
    }

    // Add exception if present
    if (event.error) {
      seqEvent['@x'] = event.error.stack || event.error.toString();
      seqEvent.ErrorMessage = event.error.message;
      seqEvent.ErrorType = event.error.name;
    }

    // Add performance metrics if present
    if (event.performance) {
      seqEvent.Duration = event.performance.duration;
      seqEvent.DurationUnit = event.performance.unit || 'ms';
    }

    return seqEvent;
  }

  private mapLogLevel(level: LogLevel): string {
    const levelMap: Record<LogLevel, string> = {
      [LogLevel.Debug]: 'Debug',
      [LogLevel.Info]: 'Information',
      [LogLevel.Warn]: 'Warning',
      [LogLevel.Error]: 'Error',
      [LogLevel.Fatal]: 'Fatal',
    };
    return levelMap[level] || 'Information';
  }

  private scheduleBatch(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    this.batchTimer = setTimeout(() => {
      this.flush();
    }, this.config.batchTimeout);
  }

  async flush(): Promise<void> {
    if (this.isSending || this.logBuffer.length === 0) {
      return;
    }

    this.isSending = true;
    const batch = [...this.logBuffer];
    this.logBuffer = [];

    try {
      await this.sendBatch(batch);
      this.failureCount = 0;
    } catch (error) {
      console.error('[SeqTransport] Failed to send batch:', error);
      this.failureCount++;

      // Re-queue logs if we haven't exceeded retry limit
      if (this.failureCount < this.maxRetries) {
        this.logBuffer.unshift(...batch);
      } else {
        this.failureCount = 0;
      }
    } finally {
      this.isSending = false;
    }
  }

  private async sendBatch(events: SeqLogEvent[]): Promise<void> {
    const endpoint = this.config.useProxy 
      ? this.config.proxyEndpoint! 
      : `${this.config.endpoint}/api/events/raw`;

    const headers: HeadersInit = {
      'Content-Type': 'application/vnd.serilog.clef',
    };

    if (!this.config.useProxy && this.config.apiKey) {
      headers['X-Seq-ApiKey'] = this.config.apiKey;
    }

    // Split into chunks if payload is too large
    const chunks = this.splitIntoChunks(events);
    
    for (const chunk of chunks) {
      const body = chunk.map(e => JSON.stringify(e)).join('\n');
      
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body,
          credentials: this.config.useProxy ? 'include' : 'omit',
        });

        if (!response.ok) {
          // Special handling for 413 errors
          if (response.status === 413) {
            console.error('[SeqTransport] Payload too large, will retry with smaller chunks');
            // Recursively send smaller chunks
            const halfSize = Math.floor(chunk.length / 2);
            if (halfSize > 0) {
              await this.sendBatch(chunk.slice(0, halfSize));
              await this.sendBatch(chunk.slice(halfSize));
            }
            continue;
          }
          const responseText = await response.text();
          throw new Error(`Seq request failed: ${response.status} ${response.statusText} - ${responseText}`);
        }
      } catch (error) {
        throw error;
      }
    }
  }

  private splitIntoChunks(events: SeqLogEvent[]): SeqLogEvent[][] {
    const chunks: SeqLogEvent[][] = [];
    let currentChunk: SeqLogEvent[] = [];
    let currentSize = 0;

    for (const event of events) {
      const eventJson = JSON.stringify(event);
      const eventSize = eventJson.length + 1; // +1 for newline

      // If single event is too large, add it alone
      if (eventSize > this.MAX_PAYLOAD_SIZE) {
        if (currentChunk.length > 0) {
          chunks.push(currentChunk);
          currentChunk = [];
          currentSize = 0;
        }
        chunks.push([event]); // Send oversized event alone
        continue;
      }

      // Check if adding this event would exceed limit
      if (currentSize + eventSize > this.MAX_PAYLOAD_SIZE) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentSize = 0;
      }

      currentChunk.push(event);
      currentSize += eventSize;
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  private getSessionId(): string {
    // Get or create session ID
    let sessionId = sessionStorage.getItem('irondome_session_id');
    if (!sessionId) {
      sessionId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      sessionStorage.setItem('irondome_session_id', sessionId);
    }
    return sessionId;
  }

  private getUserId(): string | undefined {
    // Override this method if you have user authentication
    return undefined;
  }

  // Ensure all logs are sent before page unload
  setupUnloadHandler(): void {
    if (!this.isEnabled) return;

    const flushOnUnload = () => {
      // Use sendBeacon for reliability during page unload
      if (this.logBuffer.length > 0 && 'sendBeacon' in navigator) {
        const endpoint = this.config.useProxy 
          ? this.config.proxyEndpoint! 
          : `${this.config.endpoint}/api/events/raw`;
        
        const body = this.logBuffer.map(e => JSON.stringify(e)).join('\n');
        const blob = new Blob([body], { type: 'application/vnd.serilog.clef' });
        
        navigator.sendBeacon(endpoint, blob);
      }
    };

    window.addEventListener('beforeunload', flushOnUnload);
    window.addEventListener('pagehide', flushOnUnload);
  }

  destroy(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }
    this.flush();
  }
}