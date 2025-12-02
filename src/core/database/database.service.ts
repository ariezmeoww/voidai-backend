import { PrismaClient } from '@prisma/client';
import type { IDatabaseService, DatabaseConfig } from './types';
import type { ILogger } from '../logging';

interface HealthCheckDetails {
  responseTime?: string;
  connections?: any;
  version?: string;
  uptime?: number;
  reason?: string;
  error?: string;
}

interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  details?: HealthCheckDetails;
}

export class DatabaseService implements IDatabaseService {
  private static globalInstance?: PrismaClient;
  private static isGlobalConnected = false;
  private static connectionCount = 0;
  private config: DatabaseConfig;
  private logger: ILogger;

  constructor(config: DatabaseConfig, logger: ILogger) {
    this.config = config;
    this.logger = logger;
  }

  async connect(): Promise<void> {
    if (DatabaseService.isGlobalConnected && DatabaseService.globalInstance) {
      DatabaseService.connectionCount++;
      this.logger.debug(`Reusing existing Prisma connection (count: ${DatabaseService.connectionCount})`);
      return;
    }

    try {
      if (!DatabaseService.globalInstance) {
        DatabaseService.globalInstance = new PrismaClient({
          datasources: {
            db: {
              url: this.config.uri
            }
          },
          log: ['error']
        });
        
        await DatabaseService.globalInstance.$connect();
        DatabaseService.isGlobalConnected = true;
        DatabaseService.connectionCount = 1;
        
        await this.validateConnection();
        this.logConnectionSuccess();
      }
    } catch (error) {
      this.handleConnectionError(error as Error);
    }
  }

  async disconnect(): Promise<void> {
    if (!DatabaseService.globalInstance) {
      return;
    }

    try {
      DatabaseService.connectionCount--;
      
      if (DatabaseService.connectionCount <= 0) {
        await DatabaseService.globalInstance.$disconnect();
        DatabaseService.globalInstance = undefined;
        DatabaseService.isGlobalConnected = false;
        DatabaseService.connectionCount = 0;
        this.logger.info('Global Prisma client disconnected');
      } else {
        this.logger.debug(`Prisma connection released (remaining: ${DatabaseService.connectionCount})`);
      }
    } catch (error) {
      this.logger.error('Error closing PostgreSQL connection', error as Error);
      throw error;
    }
  }

  isConnected(): boolean {
    return DatabaseService.isGlobalConnected && !!DatabaseService.globalInstance;
  }

  async getHealth(): Promise<HealthStatus> {
    if (!this.isConnectionValid()) {
      return this.createUnhealthyStatus('Not connected');
    }

    try {
      const healthDetails = await this.performHealthCheck();
      return {
        status: 'healthy',
        details: healthDetails
      };
    } catch (error) {
      return this.handleHealthCheckError(error as Error);
    }
  }

  getPrisma(): PrismaClient {
    if (!DatabaseService.globalInstance) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return DatabaseService.globalInstance;
  }

  private async validateConnection(): Promise<void> {
    if (!DatabaseService.globalInstance) {
      throw new Error('Prisma client not available');
    }
    await DatabaseService.globalInstance.$queryRaw`SELECT 1`;
  }

  private logConnectionSuccess(): void {
    this.logger.info('PostgreSQL connection established successfully', {
      metadata: { 
        database: this.config.database,
        connectionCount: DatabaseService.connectionCount
      }
    });
  }

  private handleConnectionError(error: Error): never {
    this.logger.error('PostgreSQL connection failed', error);
    throw error;
  }

  private isConnectionValid(): boolean {
    return DatabaseService.globalInstance !== undefined && DatabaseService.isGlobalConnected;
  }

  private async performHealthCheck(): Promise<HealthCheckDetails> {
    if (!DatabaseService.globalInstance) {
      throw new Error('Database not available for health check');
    }

    const start = Date.now();
    await DatabaseService.globalInstance.$queryRaw`SELECT 1`;
    const duration = Date.now() - start;

    try {
      const versionResult = await DatabaseService.globalInstance.$queryRaw<Array<{ version: string }>>`SELECT version()`;
      const version = versionResult[0]?.version || 'Unknown';

      return {
        responseTime: `${duration}ms`,
        version: version.split(' ')[0] + ' ' + version.split(' ')[1],
        uptime: Date.now(),
        connections: DatabaseService.connectionCount
      };
    } catch (error) {
      return {
        responseTime: `${duration}ms`,
        version: 'Unknown',
        uptime: Date.now(),
        connections: DatabaseService.connectionCount
      };
    }
  }

  private createUnhealthyStatus(reason: string): HealthStatus {
    return {
      status: 'unhealthy',
      details: { reason }
    };
  }

  private handleHealthCheckError(error: Error): HealthStatus {
    this.logger.error('PostgreSQL health check failed', error);
    return {
      status: 'unhealthy',
      details: {
        reason: 'Health check failed',
        error: error.message
      }
    };
  }
}