import winston from 'winston';
import path from 'path';
import fs from 'fs';
import type { ILogger, LogEntry, LogLevel, LoggerOptions } from './types';

// Determine logs directory - use /app/logs in Docker, otherwise relative to project root
const getLogsDir = (): string => {
  if (process.env.LOGS_DIR) {
    return process.env.LOGS_DIR;
  }
  // In Docker, use /app/logs (the WORKDIR)
  if (fs.existsSync('/app')) {
    return '/app/logs';
  }
  // Local development - use project root
  return path.join(process.cwd(), 'logs');
};

const LOGS_DIR = getLogsDir();

// Try to create logs directory, but don't crash if we can't
try {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
} catch (err) {
  console.warn(`Warning: Could not create logs directory at ${LOGS_DIR}. File logging disabled.`);
}

export class Logger implements ILogger {
  private winston: winston.Logger;
  private context?: string;

  constructor(options: LoggerOptions) {
    this.context = options.context;
    this.winston = this.createWinstonLogger(options);
  }

  error(message: string, error?: Error, extra: Partial<LogEntry> = {}): void {
    this.winston.error(message, {
      error: error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : undefined,
      context: this.context,
      ...extra
    });
  }

  warn(message: string, extra: Partial<LogEntry> = {}): void {
    this.winston.warn(message, {
      context: this.context,
      ...extra
    });
  }

  info(message: string, extra: Partial<LogEntry> = {}): void {
    this.winston.info(message, {
      context: this.context,
      ...extra
    });
  }

  debug(message: string, extra: Partial<LogEntry> = {}): void {
    this.winston.debug(message, {
      context: this.context,
      ...extra
    });
  }

  createChild(context: string): ILogger {
    const childContext = this.context 
      ? `${this.context}:${context}` 
      : context;

    return new Logger({
      level: this.winston.level as LogLevel,
      context: childContext,
      enableConsole: true
    });
  }

  setLevel(level: LogLevel): void {
    this.winston.level = level;
  }

  getLevel(): LogLevel {
    return this.winston.level as LogLevel;
  }

  private createWinstonLogger(options: LoggerOptions): winston.Logger {
    const transports: winston.transport[] = [];

    // Console transport
    if (options.enableConsole !== false) {
      transports.push(
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize({ all: true }),
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
            winston.format.errors({ stack: true }),
            this.createConsoleFormat()
          )
        })
      );
    }

    // File transports - only add if logs directory exists and is writable
    if (fs.existsSync(LOGS_DIR)) {
      // File transport for errors only
      transports.push(
        new winston.transports.File({
          filename: path.join(LOGS_DIR, 'error.log'),
          level: 'error',
          format: winston.format.combine(
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
            winston.format.errors({ stack: true }),
            this.createFileFormat()
          ),
          maxsize: 10 * 1024 * 1024, // 10MB
          maxFiles: 5,
          tailable: true
        })
      );

      // File transport for all logs
      transports.push(
        new winston.transports.File({
          filename: path.join(LOGS_DIR, 'combined.log'),
          format: winston.format.combine(
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
            winston.format.errors({ stack: true }),
            this.createFileFormat()
          ),
          maxsize: 10 * 1024 * 1024, // 10MB
          maxFiles: 5,
          tailable: true
        })
      );
    }

    return winston.createLogger({
      level: options.level,
      transports,
      exitOnError: false,
      silent: process.env.NODE_ENV === 'test'
    });
  }

  private createFileFormat(): winston.Logform.Format {
    return winston.format.printf((info) => {
      const { timestamp, level, message, context, requestId, metadata, error } = info;

      const logObject: Record<string, any> = {
        timestamp,
        level,
        message,
        ...(context && { context }),
        ...(requestId && { requestId }),
        ...(metadata && { metadata }),
        ...(error && { error })
      };

      return JSON.stringify(logObject);
    });
  }

  private createConsoleFormat(): winston.Logform.Format {
    return winston.format.printf((info) => {
      const { timestamp, level, message, context, requestId, operation, duration, metadata, error } = info;
      
      let logLine = `[${timestamp}] ${level}`;
      
      if (context) {
        logLine += ` [${context}]`;
      }
      
      if (requestId) {
        logLine += ` [${requestId}]`;
      }
      
      logLine += `: ${message}`;
      
      if (operation && duration) {
        logLine += ` (${duration}ms)`;
      }

      if (metadata && Object.keys(metadata).length > 0) {
        const metaStr = Object.entries(metadata)
          .map(([key, value]) => {
            if (typeof value === 'object' && value !== null) {
              return `${key}=${JSON.stringify(value)}`;
            }
            return `${key}=${value}`;
          })
          .join(', ');
        logLine += ` - ${metaStr}`;
      }

      if (error) {
        logLine += ` | ${(error as Error).message}`;
      }

      return logLine;
    });
  }
}

export function createLogger(options: LoggerOptions): ILogger {
  return new Logger(options);
}