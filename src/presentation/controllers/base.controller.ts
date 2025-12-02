import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AuthenticatedUser } from '../../infrastructure/providers/types';
import type { ILogger } from '../../core/logging';

export interface ApiErrorResponse {
  error: {
    message: string;
    type: string;
    code?: string;
    param?: string;
  };
}

export interface ApiSuccessResponse {
  data?: any;
  message?: string;
  [key: string]: any;
}

interface ClientInfo {
  ip: string;
  userAgent: string;
  origin: string;
}

interface RequestMetadata {
  method: string;
  path: string;
  duration?: number;
}

export abstract class BaseController {
  protected readonly logger: ILogger;
  
  constructor(logger: ILogger) {
    this.logger = logger.createChild(this.constructor.name);
  }
  
  protected createApplication(): Hono {
    return new Hono();
  }
  
  protected createSuccessResponse(data: any, message?: string): ApiSuccessResponse {
    const response: ApiSuccessResponse = {};
    
    if (this.isPlainObject(data)) {
      Object.assign(response, data);
    } else {
      response.data = data;
    }
    
    if (message) {
      response.message = message;
    }
    
    return response;
  }
  
  protected createErrorResponse(
    message: string,
    code?: string,
    param?: string
  ): ApiErrorResponse {
    return {
      error: {
        message,
        type: 'api_error',
        ...(code && { code }),
        ...(param && { param })
      }
    };
  }
  
  protected extractUserFromContext(c: Context): AuthenticatedUser {
    const user = c.get('user') as AuthenticatedUser;
    
    if (!user) {
      this.logger.warn('User context not found in request', {
        metadata: {
          requestId: this.getRequestId(c),
          path: c.req.path
        }
      });
      throw new Error('User context not found');
    }
    
    return user;
  }
  
  protected getRequestId(c: Context): string {
    return c.get('requestId') || this.generateFallbackRequestId();
  }
  
  protected extractClientInfo(c: Context): ClientInfo {
    return {
      ip: this.extractClientIp(c),
      userAgent: c.req.header('user-agent') || 'unknown',
      origin: c.req.header('origin') || 'unknown'
    };
  }
  
  protected async handleRequest(
    c: Context,
    handler: () => Promise<any>,
    operation?: string
  ): Promise<Response> {
    const startTime = Date.now();
    const requestId = this.getRequestId(c);
    const metadata = this.createRequestMetadata(c);
    
    try {
      this.logRequestStart(operation, requestId, metadata);
      
      const result = await handler();
      
      this.logRequestSuccess(operation, requestId, startTime);
      
      return this.createResponse(c, result);
    } catch (error) {
      return this.handleRequestError(
        error as Error, 
        c, 
        operation, 
        requestId, 
        metadata, 
        startTime
      );
    }
  }
  
  public abstract registerRoutes(): Hono;
  
  public registerRoutesWithoutMiddleware(): Hono {
    return this.registerRoutes();
  }
  
  private isPlainObject(value: unknown): value is Record<string, any> {
    return typeof value === 'object' && 
           value !== null && 
           !Array.isArray(value) && 
           value.constructor === Object;
  }
  
  private extractClientIp(c: Context): string {
    return (
      c.req.header('cf-connecting-ip') ||
      c.req.header('x-forwarded-for') ||
      c.req.header('x-real-ip') ||
      'unknown'
    );
  }
  
  private generateFallbackRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
  
  private createRequestMetadata(c: Context): RequestMetadata {
    return {
      method: c.req.method,
      path: c.req.path
    };
  }
  
  private logRequestStart(
    operation: string | undefined, 
    requestId: string, 
    metadata: RequestMetadata
  ): void {
    if (!operation) return;
    
    this.logger.debug(`${operation} started`, {
      requestId,
      metadata
    });
  }
  
  private logRequestSuccess(
    operation: string | undefined, 
    requestId: string, 
    startTime: number
  ): void {
    if (!operation) return;
    
    this.logger.debug(`${operation} completed`, {
      requestId,
      metadata: {
        duration: Date.now() - startTime
      }
    });
  }
  
  private createResponse(c: Context, result: any): Response {
    if (result instanceof Response) {
      return result;
    }
    
    return c.json(result);
  }
  
  private handleRequestError(
    error: Error,
    c: Context,
    operation: string | undefined,
    requestId: string,
    metadata: RequestMetadata,
    startTime: number
  ): Response {
    const timestamp = new Date().toISOString();
    const anyErr: any = error as any;
    const statusCode = (anyErr && typeof anyErr.statusCode === 'number') ? anyErr.statusCode : 500;

    // Log full error details server-side
    this.logger.error(
      `Request failed: ${operation || 'Unknown operation'}`,
      error,
      {
        requestId,
        metadata: {
          ...metadata,
          duration: Date.now() - startTime,
          status: statusCode,
          timestamp,
          errorMessage: error.message,
          errorStack: error.stack,
          ...(anyErr.type ? { errorType: anyErr.type } : {}),
          ...(anyErr.code ? { errorCode: anyErr.code } : {}),
          ...(anyErr.raw ? { upstreamRaw: anyErr.raw } : {})
        }
      }
    );

    // Return sanitized error to client with reference ID
    const sanitizedError = {
      error: {
        message: `An error occurred. Reference: ${requestId} at ${timestamp}`,
        type: 'api_error',
        code: 'request_failed',
        reference_id: requestId,
        timestamp
      }
    };

    return c.json(sanitizedError, statusCode);
  }
}