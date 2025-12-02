import type { PrismaClient } from "@prisma/client";

export interface IDatabaseService {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getHealth(): Promise<{ status: 'healthy' | 'unhealthy'; details?: any }>;
  getPrisma(): PrismaClient;
}

export interface DatabaseConfig {
  uri: string;
  database: string;
  pool?: {
    min?: number;
    max?: number;
    acquireTimeoutMillis?: number;
    createTimeoutMillis?: number;
    idleTimeoutMillis?: number;
    reapIntervalMillis?: number;
    createRetryIntervalMillis?: number;
  };
}