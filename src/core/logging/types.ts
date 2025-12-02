export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: number;
  context?: string;
  requestId?: string;
  operation?: string;
  duration?: number;
  metadata?: Record<string, any>;
  error?: Error;
}

export interface LoggerOptions {
  level: LogLevel;
  context?: string;
  enableConsole?: boolean;
}

export interface ILogger {
  error(message: string, error?: Error, extra?: Partial<LogEntry>): void;
  warn(message: string, extra?: Partial<LogEntry>): void;
  info(message: string, extra?: Partial<LogEntry>): void;
  debug(message: string, extra?: Partial<LogEntry>): void;
  createChild(context: string): ILogger;
  setLevel(level: LogLevel): void;
  getLevel(): LogLevel;
}