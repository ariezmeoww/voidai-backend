import { PrismaClient } from '@prisma/client';
import {
  Provider,
  ProviderDocument,
  type IProviderRepository,
  type ProviderFilters
} from '../../domain/provider';
import type { IDatabaseService } from '../../core/database';
import type { ILogger } from '../../core/logging';

export class ProviderRepository implements IProviderRepository {
  private prisma: PrismaClient;
  private logger: ILogger;

  constructor(databaseService: IDatabaseService, logger: ILogger) {
    this.prisma = databaseService.getPrisma();
    this.logger = logger;
  }

  async findById(id: string): Promise<Provider | null> {
    try {
      const provider = await this.prisma.provider.findUnique({
        where: { id }
      });
      return provider ? this.mapToProvider(provider) : null;
    } catch (error) {
      this.logger.error('Failed to find provider by ID', error as Error);
      return null;
    }
  }

  async findByName(name: string): Promise<Provider | null> {
    try {
      const provider = await this.prisma.provider.findUnique({
        where: { name }
      });
      return provider ? this.mapToProvider(provider) : null;
    } catch (error) {
      this.logger.error('Failed to find provider by name', error as Error);
      return null;
    }
  }

  async findMany(): Promise<Provider[]> {
    try {
      this.logger.debug('Starting provider findMany query');
      const providers = await this.prisma.provider.findMany();
      this.logger.debug('Found providers in database', {
        metadata: { count: providers.length }
      });
      return providers.map(provider => this.mapToProvider(provider));
    } catch (error) {
      this.logger.error('Failed to find providers', error as Error);
      return [];
    }
  }

  async findAvailable(): Promise<Provider[]> {
    try {
      const providers = await this.prisma.provider.findMany({
        where: {
          isActive: true,
          healthStatus: { in: ['healthy', 'degraded'] }
        },
        orderBy: { priority: 'desc' }
      });
      return providers.map(provider => this.mapToProvider(provider));
    } catch (error) {
      this.logger.error('Failed to find available providers', error as Error);
      return [];
    }
  }

  async findByModel(model: string): Promise<Provider[]> {
    try {
      const providers = await this.prisma.provider.findMany({
        where: {
          supportedModels: {
            has: model
          },
          isActive: true
        },
        orderBy: { priority: 'desc' }
      });
      return providers.map(provider => this.mapToProvider(provider));
    } catch (error) {
      this.logger.error('Failed to find providers by model', error as Error);
      return [];
    }
  }

  async findHealthy(): Promise<Provider[]> {
    try {
      const providers = await this.prisma.provider.findMany({
        where: {
          isActive: true,
          healthStatus: 'healthy'
        },
        orderBy: { priority: 'desc' }
      });
      return providers.map(provider => this.mapToProvider(provider));
    } catch (error) {
      this.logger.error('Failed to find healthy providers', error as Error);
      return [];
    }
  }

  async exists(id: string): Promise<boolean> {
    try {
      const count = await this.prisma.provider.count({
        where: { id }
      });
      return count > 0;
    } catch (error) {
      this.logger.error('Failed to check provider existence', error as Error);
      return false;
    }
  }

  async save(provider: Provider): Promise<Provider> {
    try {
      const doc = provider.toDocument();
      const saved = await this.prisma.provider.upsert({
        where: { id: doc.id },
        update: {
          name: doc.name,
          needsSubProviders: doc.needs_sub_providers,
          totalTokenUsage: BigInt(doc.total_token_usage),
          avgLatency: doc.avg_latency,
          errorCount: doc.error_count,
          successCount: doc.success_count,
          isActive: doc.is_active,
          lastUsedAt: BigInt(doc.last_used_at),
          lastErrorAt: doc.last_error_at ? BigInt(doc.last_error_at) : null,
          priority: doc.priority,
          baseUrl: doc.base_url,
          timeout: doc.timeout,
          supportedModels: doc.supported_models,
          features: doc.features,
          consecutiveErrors: doc.consecutive_errors,
          timeoutCount: doc.timeout_count,
          healthStatus: doc.health_status,
          uptime: doc.uptime,
          rateLimits: doc.rate_limits as any,
          throughput: doc.throughput as any,
          performance: doc.performance as any,
          capacity: doc.capacity as any,
          updatedAt: BigInt(doc.updated_at)
        },
        create: {
          id: doc.id,
          name: doc.name,
          needsSubProviders: doc.needs_sub_providers,
          totalTokenUsage: BigInt(doc.total_token_usage),
          avgLatency: doc.avg_latency,
          errorCount: doc.error_count,
          successCount: doc.success_count,
          isActive: doc.is_active,
          lastUsedAt: BigInt(doc.last_used_at),
          lastErrorAt: doc.last_error_at ? BigInt(doc.last_error_at) : null,
          priority: doc.priority,
          baseUrl: doc.base_url,
          timeout: doc.timeout,
          supportedModels: doc.supported_models,
          features: doc.features,
          consecutiveErrors: doc.consecutive_errors,
          timeoutCount: doc.timeout_count,
          healthStatus: doc.health_status,
          uptime: doc.uptime,
          rateLimits: doc.rate_limits as any,
          throughput: doc.throughput as any,
          performance: doc.performance as any,
          capacity: doc.capacity as any,
          createdAt: BigInt(doc.created_at),
          updatedAt: BigInt(doc.updated_at)
        }
      });
      return this.mapToProvider(saved);
    } catch (error) {
      this.logger.error('Failed to save provider', error as Error);
      throw error;
    }
  }

  async saveMany(providers: Provider[]): Promise<void> {
    if (providers.length === 0) {
      return;
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        for (const provider of providers) {
          const doc = provider.toDocument();
          await tx.provider.upsert({
            where: { id: doc.id },
            update: {
              name: doc.name,
              needsSubProviders: doc.needs_sub_providers,
              totalTokenUsage: BigInt(doc.total_token_usage),
              avgLatency: doc.avg_latency,
              errorCount: doc.error_count,
              successCount: doc.success_count,
              isActive: doc.is_active,
              lastUsedAt: BigInt(doc.last_used_at),
              lastErrorAt: doc.last_error_at ? BigInt(doc.last_error_at) : null,
              priority: doc.priority,
              baseUrl: doc.base_url,
              timeout: doc.timeout,
              supportedModels: doc.supported_models,
              features: doc.features,
              consecutiveErrors: doc.consecutive_errors,
              timeoutCount: doc.timeout_count,
              healthStatus: doc.health_status,
              uptime: doc.uptime,
              rateLimits: doc.rate_limits as any,
              throughput: doc.throughput as any,
              performance: doc.performance as any,
              capacity: doc.capacity as any,
              updatedAt: BigInt(doc.updated_at)
            },
            create: {
              id: doc.id,
              name: doc.name,
              needsSubProviders: doc.needs_sub_providers,
              totalTokenUsage: BigInt(doc.total_token_usage),
              avgLatency: doc.avg_latency,
              errorCount: doc.error_count,
              successCount: doc.success_count,
              isActive: doc.is_active,
              lastUsedAt: BigInt(doc.last_used_at),
              lastErrorAt: doc.last_error_at ? BigInt(doc.last_error_at) : null,
              priority: doc.priority,
              baseUrl: doc.base_url,
              timeout: doc.timeout,
              supportedModels: doc.supported_models,
              features: doc.features,
              consecutiveErrors: doc.consecutive_errors,
              timeoutCount: doc.timeout_count,
              healthStatus: doc.health_status,
              uptime: doc.uptime,
              rateLimits: doc.rate_limits as any,
              throughput: doc.throughput as any,
              performance: doc.performance as any,
              capacity: doc.capacity as any,
              createdAt: BigInt(doc.created_at),
              updatedAt: BigInt(doc.updated_at)
            }
          });
        }
      });
    } catch (error) {
      this.logger.error('Failed to save multiple providers', error as Error);
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.prisma.provider.delete({
        where: { id }
      });
      return true;
    } catch (error) {
      this.logger.error('Failed to delete provider', error as Error);
      return false;
    }
  }

  async count(filters?: ProviderFilters): Promise<number> {
    try {
      const filter = this.buildFilter(filters);
      return await this.prisma.provider.count({
        where: filter
      });
    } catch (error) {
      this.logger.error('Failed to count providers', error as Error);
      return 0;
    }
  }

  async updateHealthStatus(id: string, status: 'healthy' | 'degraded' | 'unhealthy'): Promise<void> {
    try {
      await this.prisma.provider.update({
        where: { id },
        data: {
          healthStatus: status,
          updatedAt: BigInt(Date.now())
        }
      });
    } catch (error) {
      this.logger.error('Failed to update provider health status', error as Error);
      throw error;
    }
  }

  async updateMetrics(id: string, metrics: any): Promise<void> {
    try {
      const updateData: any = {
        updatedAt: BigInt(Date.now())
      };

      if (metrics.totalTokenUsage !== undefined) {
        updateData.totalTokenUsage = metrics.totalTokenUsage;
      }
      if (metrics.avgLatency !== undefined) {
        updateData.avgLatency = metrics.avgLatency;
      }
      if (metrics.errorCount !== undefined) {
        updateData.errorCount = metrics.errorCount;
      }
      if (metrics.successCount !== undefined) {
        updateData.successCount = metrics.successCount;
      }
      if (metrics.consecutiveErrors !== undefined) {
        updateData.consecutiveErrors = metrics.consecutiveErrors;
      }
      if (metrics.timeoutCount !== undefined) {
        updateData.timeoutCount = metrics.timeoutCount;
      }
      if (metrics.lastUsedAt !== undefined) {
        updateData.lastUsedAt = BigInt(metrics.lastUsedAt);
      }
      if (metrics.lastErrorAt !== undefined) {
        updateData.lastErrorAt = BigInt(metrics.lastErrorAt);
      }

      await this.prisma.provider.update({
        where: { id },
        data: updateData
      });
    } catch (error) {
      this.logger.error('Failed to update provider metrics', error as Error);
      throw error;
    }
  }

  private buildFilter(filters?: ProviderFilters): any {
    if (!filters) {
      return {};
    }

    const filter: any = {};

    if (filters.isActive !== undefined) {
      filter.isActive = filters.isActive;
    }

    if (filters.healthStatus) {
      filter.healthStatus = filters.healthStatus;
    }

    if (filters.supportedModel) {
      filter.supportedModels = {
        has: filters.supportedModel
      };
    }

    if (filters.minPriority !== undefined) {
      filter.priority = {
        gte: filters.minPriority
      };
    }

    return filter;
  }

  private mapToProvider(prismaProvider: any): Provider {
    const doc: ProviderDocument = {
      id: prismaProvider.id,
      created_at: Number(prismaProvider.createdAt),
      updated_at: Number(prismaProvider.updatedAt),
      name: prismaProvider.name,
      needs_sub_providers: prismaProvider.needsSubProviders,
      total_token_usage: BigInt(prismaProvider.totalTokenUsage),
      avg_latency: prismaProvider.avgLatency,
      error_count: prismaProvider.errorCount,
      success_count: prismaProvider.successCount,
      is_active: prismaProvider.isActive,
      last_used_at: Number(prismaProvider.lastUsedAt),
      last_error_at: prismaProvider.lastErrorAt ? Number(prismaProvider.lastErrorAt) : 0,
      priority: prismaProvider.priority,
      base_url: prismaProvider.baseUrl,
      timeout: prismaProvider.timeout,
      supported_models: prismaProvider.supportedModels,
      rate_limits: prismaProvider.rateLimits,
      throughput: prismaProvider.throughput,
      features: prismaProvider.features,
      consecutive_errors: prismaProvider.consecutiveErrors,
      timeout_count: prismaProvider.timeoutCount,
      health_status: prismaProvider.healthStatus,
      uptime: prismaProvider.uptime,
      performance: prismaProvider.performance,
      capacity: prismaProvider.capacity
    };
    return new Provider(doc);
  }
}
