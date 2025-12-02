import { PrismaClient } from '@prisma/client';
import { ApiKey, ApiKeyDocument, type IApiKeyRepository } from '../../domain/user';
import type { IDatabaseService } from '../../core/database';
import type { ILogger } from '../../core/logging';

export class ApiKeyRepository implements IApiKeyRepository {
  private prisma: PrismaClient;
  private logger: ILogger;

  constructor(databaseService: IDatabaseService, logger: ILogger) {
    this.prisma = (databaseService as any).getPrisma();
    this.logger = logger;
  }

  async findById(id: string): Promise<ApiKey | null> {
    try {
      const apiKey = await this.prisma.apiKey.findUnique({
        where: { id }
      });
      return apiKey ? this.mapToApiKey(apiKey) : null;
    } catch (error) {
      this.logger.error('Failed to find API key by ID', error as Error);
      return null;
    }
  }

  async findBySearchHash(searchHash: string): Promise<ApiKey | null> {
    try {
      const apiKey = await this.prisma.apiKey.findUnique({
        where: { searchHash }
      });
      return apiKey ? this.mapToApiKey(apiKey) : null;
    } catch (error) {
      this.logger.error('Failed to find API key by search hash', error as Error);
      return null;
    }
  }

  async findByUserId(userId: string): Promise<ApiKey[]> {
    try {
      const apiKeys = await this.prisma.apiKey.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' }
      });
      return apiKeys.map(key => this.mapToApiKey(key));
    } catch (error) {
      this.logger.error('Failed to find API keys by user ID', error as Error);
      return [];
    }
  }

  async findByUserIdAndName(userId: string, name: string): Promise<ApiKey | null> {
    try {
      const apiKey = await this.prisma.apiKey.findFirst({
        where: { 
          userId,
          name 
        }
      });
      return apiKey ? this.mapToApiKey(apiKey) : null;
    } catch (error) {
      this.logger.error('Failed to find API key by user ID and name', error as Error);
      return null;
    }
  }

  async save(apiKey: ApiKey): Promise<ApiKey> {
    try {
      const doc = apiKey.toDocument();
      const saved = await this.prisma.apiKey.upsert({
        where: { id: doc.id },
        update: {
          name: doc.name,
          encrypted: doc.encrypted,
          salt: doc.salt,
          algorithm: doc.algorithm,
          searchHash: doc.search_hash,
          lastUsedAt: doc.last_used_at ? BigInt(doc.last_used_at) : null,
          isActive: doc.is_active
        },
        create: {
          id: doc.id,
          name: doc.name,
          encrypted: doc.encrypted,
          salt: doc.salt,
          algorithm: doc.algorithm,
          searchHash: doc.search_hash,
          createdAt: BigInt(doc.created_at),
          lastUsedAt: doc.last_used_at ? BigInt(doc.last_used_at) : null,
          isActive: doc.is_active,
          userId: doc.user_id
        }
      });
      return this.mapToApiKey(saved);
    } catch (error) {
      this.logger.error('Failed to save API key', error as Error);
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.prisma.apiKey.delete({
        where: { id }
      });
      return true;
    } catch (error) {
      this.logger.error('Failed to delete API key', error as Error);
      return false;
    }
  }

  async deleteByUserId(userId: string): Promise<number> {
    try {
      const result = await this.prisma.apiKey.deleteMany({
        where: { userId }
      });
      return result.count;
    } catch (error) {
      this.logger.error('Failed to delete API keys by user ID', error as Error);
      return 0;
    }
  }

  async updateLastUsed(id: string): Promise<void> {
    try {
      await this.prisma.apiKey.update({
        where: { id },
        data: { lastUsedAt: BigInt(Date.now()) }
      });
    } catch (error) {
      this.logger.error('Failed to update API key last used', error as Error);
      throw error;
    }
  }

  async activate(id: string): Promise<void> {
    try {
      await this.prisma.apiKey.update({
        where: { id },
        data: { isActive: true }
      });
    } catch (error) {
      this.logger.error('Failed to activate API key', error as Error);
      throw error;
    }
  }

  async deactivate(id: string): Promise<void> {
    try {
      await this.prisma.apiKey.update({
        where: { id },
        data: { isActive: false }
      });
    } catch (error) {
      this.logger.error('Failed to deactivate API key', error as Error);
      throw error;
    }
  }

  async count(userId?: string): Promise<number> {
    try {
      return await this.prisma.apiKey.count({
        where: userId ? { userId } : undefined
      });
    } catch (error) {
      this.logger.error('Failed to count API keys', error as Error);
      return 0;
    }
  }

  private mapToApiKey(prismaApiKey: any): ApiKey {
    const doc: ApiKeyDocument = {
      id: prismaApiKey.id,
      name: prismaApiKey.name,
      encrypted: prismaApiKey.encrypted,
      salt: prismaApiKey.salt,
      algorithm: prismaApiKey.algorithm,
      search_hash: prismaApiKey.searchHash,
      created_at: Number(prismaApiKey.createdAt),
      last_used_at: prismaApiKey.lastUsedAt ? Number(prismaApiKey.lastUsedAt) : undefined,
      is_active: prismaApiKey.isActive,
      user_id: prismaApiKey.userId
    };
    return new ApiKey(doc);
  }
}