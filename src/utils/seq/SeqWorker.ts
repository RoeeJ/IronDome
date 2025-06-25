/**
 * Web Worker for Seq logging to prevent main thread blocking
 */

interface SeqLogEvent {
  '@t': string;
  '@l'?: string;
  '@mt': string;
  '@x'?: string;
  [key: string]: any;
}

interface SeqConfig {
  endpoint: string;
  apiKey?: string;
  useProxy: boolean;
  proxyEndpoint?: string;
}

interface WorkerMessage {
  type: 'init' | 'log' | 'flush' | 'batch';
  config?: SeqConfig;
  events?: SeqLogEvent[];
}

class SeqWorkerHandler {
  private config: SeqConfig | null = null;
  private logBuffer: SeqLogEvent[] = [];
  private readonly MAX_PAYLOAD_SIZE = 5 * 1024 * 1024; // 5MB
  private batchTimer: number | null = null;
  private readonly BATCH_TIMEOUT = 2000;

  constructor() {
    self.addEventListener('message', this.handleMessage.bind(this));
  }

  private handleMessage(event: MessageEvent<WorkerMessage>) {
    const { type, config, events } = event.data;

    switch (type) {
      case 'init':
        this.config = config!;
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

  private scheduleBatch() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    this.batchTimer = setTimeout(() => {
      this.flushLogs();
    }, this.BATCH_TIMEOUT);
  }

  private flushLogs() {
    if (this.logBuffer.length === 0 || !this.config) {
      return;
    }

    const batch = [...this.logBuffer];
    this.logBuffer = [];

    this.sendBatch(batch);
  }

  private async sendBatch(events: SeqLogEvent[]) {
    if (!this.config) return;

    const endpoint = this.config.useProxy 
      ? this.config.proxyEndpoint! 
      : `${this.config.endpoint}/api/events/raw`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/vnd.serilog.clef',
    };

    if (!this.config.useProxy && this.config.apiKey) {
      headers['X-Seq-ApiKey'] = this.config.apiKey;
    }

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
          if (response.status === 413) {
            // Try smaller chunks
            const halfSize = Math.floor(chunk.length / 2);
            if (halfSize > 0) {
              await this.sendBatch(chunk.slice(0, halfSize));
              await this.sendBatch(chunk.slice(halfSize));
            }
            continue;
          }
          throw new Error(`Seq request failed: ${response.status} ${response.statusText}`);
        }
      } catch (error) {
        console.error('[SeqWorker] Failed to send batch:', error);
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

// Initialize the worker handler
new SeqWorkerHandler();