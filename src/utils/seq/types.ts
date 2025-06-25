export enum LogLevel {
  Debug = 0,
  Info = 1,
  Warn = 2,
  Error = 3,
  Fatal = 4,
}

export interface LogEvent {
  timestamp: Date;
  level: LogLevel;
  message: string;
  messageTemplate?: string;
  module?: string;
  category?: string;
  properties?: Record<string, any>;
  error?: Error;
  performance?: {
    duration: number;
    unit?: string;
  };
}

export interface ILogTransport {
  log(event: LogEvent): Promise<void>;
  flush?(): Promise<void>;
  destroy?(): void;
}