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
  '@t': string;
  '@l'?: string;
  '@mt': string;
  '@x'?: string;
  [key: string]: any;
}

interface WorkerMessage {
  type: 'init' | 'log' | 'flush' | 'batch';
  config?: SeqConfig;
  events?: SeqLogEvent[];
}

export class WebWorkerTransport {
  private config: SeqConfig;
  private worker: Worker | null = null;
  private logBuffer: SeqLogEvent[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private isEnabled = false;
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

    this.isEnabled = this.validateConfig();
    
    if (this.isEnabled) {
      // PERFORMANCE: Defer worker initialization to avoid blocking startup
      setTimeout(() => this.initializeWorker(), 1000);
    }
  }

  private validateConfig(): boolean {
    if (!this.config.endpoint && !this.config.useProxy) {
      console.warn('[WebWorkerTransport] No endpoint configured and proxy mode disabled');
      return false;
    }

    if (!this.config.useProxy && !this.config.endpoint) {
      console.warn('[WebWorkerTransport] Direct mode requires endpoint');
      return false;
    }

    return true;
  }

  private async initializeWorker() {
    if (!('Worker' in globalThis)) {
      console.warn('[WebWorkerTransport] Web Workers not supported, falling back to main thread');
      return;
    }

    try {
      // Create inline worker for better compatibility with Bun
      const workerCode = `
        ${this.getWorkerCode()}
        new SeqWorkerHandler();
      `;
      
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      this.worker = new Worker(workerUrl);
      
      // Clean up the blob URL after worker is created
      URL.revokeObjectURL(workerUrl);
      
      // Initialize worker with config
      const message: WorkerMessage = {
        type: 'init',
        config: this.config
      };
      this.worker.postMessage(message);

      console.log('[WebWorkerTransport] Worker initialized successfully');
    } catch (error) {
      console.error('[WebWorkerTransport] Failed to initialize worker:', error);
      this.worker = null;
    }
  }

  private getWorkerCode(): string {
    // Inline worker code to avoid module loading issues
    return `
      class SeqWorkerHandler {
        constructor() {
          this.config = null;
          this.logBuffer = [];
          this.MAX_PAYLOAD_SIZE = 5 * 1024 * 1024; // 5MB
          this.batchTimer = null;
          this.BATCH_TIMEOUT = 2000;
          
          self.addEventListener('message', this.handleMessage.bind(this));
        }

        handleMessage(event) {
          const { type, config, events } = event.data;

          switch (type) {
            case 'init':
              this.config = config;
              break;
            case 'log':
              if (events) {
                this.logBuffer.push(...events);
                this.scheduleBatch();
              }
              break;
            case 'batch':
              if (events) {
                this.sendBatch(events);
              }
              break;
            case 'flush':
              this.flushLogs();
              break;
          }
        }

        scheduleBatch() {
          if (this.batchTimer) {
            clearTimeout(this.batchTimer);
          }

          this.batchTimer = setTimeout(() => {
            this.flushLogs();
          }, this.BATCH_TIMEOUT);
        }

        flushLogs() {
          if (this.logBuffer.length === 0 || !this.config) {
            return;
          }

          const batch = [...this.logBuffer];
          this.logBuffer = [];

          this.sendBatch(batch);
        }

        async sendBatch(events) {
          if (!this.config) return;

          const endpoint = this.config.useProxy 
            ? this.config.proxyEndpoint 
            : \`\${this.config.endpoint}/api/events/raw\`;

          const headers = {
            'Content-Type': 'application/vnd.serilog.clef',
          };

          if (!this.config.useProxy && this.config.apiKey) {
            headers['X-Seq-ApiKey'] = this.config.apiKey;
          }

          const chunks = this.splitIntoChunks(events);
          
          for (const chunk of chunks) {
            const body = chunk.map(e => JSON.stringify(e)).join('\\n');
            
            try {
              const response = await fetch(endpoint, {
                method: 'POST',
                headers,
                body,
                credentials: this.config.useProxy ? 'include' : 'omit',
              });

              if (!response.ok) {
                if (response.status === 413) {
                  const halfSize = Math.floor(chunk.length / 2);
                  if (halfSize > 0) {
                    await this.sendBatch(chunk.slice(0, halfSize));
                    await this.sendBatch(chunk.slice(halfSize));
                  }
                  continue;
                }
                throw new Error(\`Seq request failed: \${response.status} \${response.statusText}\`);
              }
            } catch (error) {
              console.error('[SeqWorker] Failed to send batch:', error);
            }
          }
        }

        splitIntoChunks(events) {
          const chunks = [];
          let currentChunk = [];
          let currentSize = 0;

          for (const event of events) {
            const eventJson = JSON.stringify(event);
            const eventSize = eventJson.length + 1;

            if (eventSize > this.MAX_PAYLOAD_SIZE) {
              if (currentChunk.length > 0) {
                chunks.push(currentChunk);
                currentChunk = [];
                currentSize = 0;
              }
              chunks.push([event]);
              continue;
            }

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
      }
    `;
  }

  async log(event: LogEvent): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    const seqEvent = this.transformToSeqFormat(event);
    
    // Check event size
    const eventSize = JSON.stringify(seqEvent).length;
    if (eventSize > this.MAX_EVENT_SIZE) {
      console.warn(`[WebWorkerTransport] Event too large (${(eventSize / 1024).toFixed(1)}KB), truncating`);
      this.truncateEvent(seqEvent);
    }

    if (this.worker) {
      // Send to worker for processing - but batch locally first to avoid too many messages
      this.logBuffer.push(seqEvent);
      if (this.logBuffer.length >= this.config.batchSize) {
        const batch = [...this.logBuffer];
        this.logBuffer = [];
        const message: WorkerMessage = {
          type: 'log',
          events: batch
        };
        this.worker.postMessage(message);
      } else {
        this.scheduleBatch();
      }
    } else {
      // Fallback to main thread batching
      this.logBuffer.push(seqEvent);
      if (this.logBuffer.length >= this.config.batchSize) {
        this.flushMainThread();
      } else {
        this.scheduleBatch();
      }
    }
  }

  private truncateEvent(seqEvent: SeqLogEvent): void {
    if (seqEvent['@x'] && seqEvent['@x'].length > 1000) {
      seqEvent['@x'] = seqEvent['@x'].substring(0, 1000) + '... (truncated)';
    }
    Object.keys(seqEvent).forEach(key => {
      if (typeof seqEvent[key] === 'string' && seqEvent[key].length > 500) {
        seqEvent[key] = seqEvent[key].substring(0, 500) + '... (truncated)';
      }
    });
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
      this.flushMainThread();
    }, this.config.batchTimeout);
  }

  private async flushMainThread(): Promise<void> {
    if (this.logBuffer.length === 0) return;

    const batch = [...this.logBuffer];
    this.logBuffer = [];

    if (this.worker) {
      const message: WorkerMessage = {
        type: 'log', // Use 'log' type for consistency
        events: batch
      };
      this.worker.postMessage(message);
    }
  }

  async flush(): Promise<void> {
    if (this.worker) {
      const message: WorkerMessage = { type: 'flush' };
      this.worker.postMessage(message);
    } else {
      await this.flushMainThread();
    }
  }

  private getSessionId(): string {
    let sessionId = sessionStorage.getItem('irondome_session_id');
    if (!sessionId) {
      sessionId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      sessionStorage.setItem('irondome_session_id', sessionId);
    }
    return sessionId;
  }

  private getUserId(): string | undefined {
    return undefined;
  }

  setupUnloadHandler(): void {
    if (!this.isEnabled) return;

    const flushOnUnload = () => {
      this.flush();
    };

    window.addEventListener('beforeunload', flushOnUnload);
    window.addEventListener('pagehide', flushOnUnload);
  }

  destroy(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }
    this.flush();
    
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}