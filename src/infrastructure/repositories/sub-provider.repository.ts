import { PrismaClient } from '@prisma/client';
import {
  SubProvider,
  SubProviderDocument,
  type ISubProviderRepository,
  type SubProviderFilters,
  type SubProviderQuery
} from '../../domain/provider';
import type { IDatabaseService } from '../../core/database';
import type { ILogger } from '../../core/logging';

export class SubProviderRepository implements ISubProviderRepository {
  private prisma: PrismaClient;
  private logger: ILogger;

  constructor(databaseService: IDatabaseService, logger: ILogger) {
    this.prisma = databaseService.getPrisma();
    this.logger = logger;
  }

  async findById(id: string): Promise<SubProvider | null> {
    try {
      const subProvider = await this.prisma.subProvider.findUnique({
        where: { id }
      });
      return subProvider ? this.mapToSubProvider(subProvider) : null;
    } catch (error) {
      this.logger.error('Failed to find sub-provider by ID', error as Error);
      return null;
    }
  }

  async findByProvider(providerId: string): Promise<SubProvider[]> {
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const subProviders = await this.prisma.subProvider.findMany({
          where: { providerId },
          orderBy: [
            { priority: 'desc' },
            { weight: 'desc' }
          ]
        });
        return subProviders.map(sp => this.mapToSubProvider(sp));
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(`Failed to find sub-providers by provider (attempt ${attempt}/${maxRetries})`, {
          metadata: { providerId, error: lastError.message, attempt }
        });
        
        if (attempt < maxRetries) {
          const delay = 100 * Math.pow(2, attempt - 1);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    this.logger.error('Failed to find sub-providers by provider after all retries', lastError!);
    return [];
  }

  async findMany(query?: SubProviderQuery): Promise<SubProvider[]> {
    try {
      const filter = this.buildFilter(query?.filters);
      const subProviders = await this.prisma.subProvider.findMany({
        where: filter,
        orderBy: this.buildOrderBy(query),
        take: query?.limit,
        skip: query?.offset
      });
      return subProviders.map(sp => this.mapToSubProvider(sp));
    } catch (error) {
      this.logger.error('Failed to find sub-providers', error as Error);
      return [];
    }
  }

  async findAvailable(model?: string): Promise<SubProvider[]> {
    try {
      const where: any = {
        enabled: true,
        isActive: true,
        circuitBreakerState: { in: ['closed', 'half-open'] },
        healthScore: { gte: 0.5 }
      };

      const subProviders = await this.prisma.subProvider.findMany({
        where,
        orderBy: [
          { priority: 'desc' },
          { healthScore: 'desc' },
          { weight: 'desc' }
        ]
      });

      let result = subProviders.map(sp => this.mapToSubProvider(sp));

      if (model) {
        result = result.filter(sp => sp.supportsModel(model));
      }

      return result;
    } catch (error) {
      this.logger.error('Failed to find available sub-providers', error as Error);
      return [];
    }
  }

  async findHealthy(): Promise<SubProvider[]> {
    try {
      const subProviders = await this.prisma.subProvider.findMany({
        where: {
          enabled: true,
          isActive: true,
          healthScore: { gte: 0.7 },
          circuitBreakerState: 'closed'
        },
        orderBy: [
          { healthScore: 'desc' },
          { priority: 'desc' }
        ]
      });
      return subProviders.map(sp => this.mapToSubProvider(sp));
    } catch (error) {
      this.logger.error('Failed to find healthy sub-providers', error as Error);
      return [];
    }
  }

  async findByCircuitState(state: 'closed' | 'open' | 'half-open'): Promise<SubProvider[]> {
    try {
      const subProviders = await this.prisma.subProvider.findMany({
        where: { circuitBreakerState: state },
        orderBy: { lastCircuitBreakerTrigger: 'desc' }
      });
      return subProviders.map(sp => this.mapToSubProvider(sp));
    } catch (error) {
      this.logger.error('Failed to find sub-providers by circuit state', error as Error);
      return [];
    }
  }

  async exists(id: string): Promise<boolean> {
    try {
      const count = await this.prisma.subProvider.count({
        where: { id }
      });
      return count > 0;
    } catch (error) {
      this.logger.error('Failed to check sub-provider existence', error as Error);
      return false;
    }
  }

  async save(subProvider: SubProvider): Promise<SubProvider> {
    try {
      const doc = subProvider.toDocument();
      const saved = await this.prisma.subProvider.upsert({
        where: { id: doc.id },
        update: {
          name: doc.name,
          enabled: doc.enabled,
          totalTokenUsage: BigInt(doc.total_token_usage),
          modelMapping: doc.model_mapping as any,
          lastUsedAt: BigInt(doc.last_used_at),
          consecutiveErrors: doc.consecutive_errors,
          errorCount: doc.error_count,
          isActive: doc.is_active,
          lastErrorAt: doc.last_error_at ? BigInt(doc.last_error_at) : null,
          lastErrorType: doc.last_error_type,
          priority: doc.priority,
          weight: doc.weight,
          timeout: doc.timeout,
          customHeaders: doc.custom_headers as any,
          metadata: doc.metadata as any,
          avgLatency: doc.avg_latency,
          healthScore: doc.health_score,
          circuitBreakerState: doc.circuit_breaker_state,
          lastCircuitBreakerTrigger: doc.last_circuit_breaker_trigger ? BigInt(doc.last_circuit_breaker_trigger) : null,
          successCount: doc.success_count,
          maxRequestsPerMinute: doc.max_requests_per_minute,
          maxRequestsPerHour: doc.max_requests_per_hour,
          maxTokensPerMinute: doc.max_tokens_per_minute,
          maxConcurrentRequests: doc.max_concurrent_requests,
          apiKey: doc.api_key as any,
          limits: doc.limits as any,
          updatedAt: BigInt(doc.updated_at)
        },
        create: {
          id: doc.id,
          providerId: doc.provider_id,
          name: doc.name,
          enabled: doc.enabled,
          totalTokenUsage: BigInt(doc.total_token_usage),
          modelMapping: doc.model_mapping as any,
          lastUsedAt: BigInt(doc.last_used_at),
          consecutiveErrors: doc.consecutive_errors,
          errorCount: doc.error_count,
          isActive: doc.is_active,
          lastErrorAt: doc.last_error_at ? BigInt(doc.last_error_at) : null,
          lastErrorType: doc.last_error_type,
          priority: doc.priority,
          weight: doc.weight,
          timeout: doc.timeout,
          customHeaders: doc.custom_headers as any,
          metadata: doc.metadata as any,
          avgLatency: doc.avg_latency,
          healthScore: doc.health_score,
          circuitBreakerState: doc.circuit_breaker_state,
          lastCircuitBreakerTrigger: doc.last_circuit_breaker_trigger ? BigInt(doc.last_circuit_breaker_trigger) : null,
          successCount: doc.success_count,
          maxRequestsPerMinute: doc.max_requests_per_minute,
          maxRequestsPerHour: doc.max_requests_per_hour,
          maxTokensPerMinute: doc.max_tokens_per_minute,
          maxConcurrentRequests: doc.max_concurrent_requests,
          apiKey: doc.api_key as any,
          limits: doc.limits as any,
          createdAt: BigInt(doc.created_at),
          updatedAt: BigInt(doc.updated_at)
        }
      });
      return this.mapToSubProvider(saved);
    } catch (error) {
      this.logger.error('Failed to save sub-provider', error as Error);
      throw error;
    }
  }

  async saveMany(subProviders: SubProvider[]): Promise<void> {
    if (subProviders.length === 0) {
      return;
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        for (const subProvider of subProviders) {
          const doc = subProvider.toDocument();
          await tx.subProvider.upsert({
            where: { id: doc.id },
            update: {
              name: doc.name,
              enabled: doc.enabled,
              totalTokenUsage: BigInt(doc.total_token_usage),
              modelMapping: doc.model_mapping as any,
              lastUsedAt: BigInt(doc.last_used_at),
              consecutiveErrors: doc.consecutive_errors,
              errorCount: doc.error_count,
              isActive: doc.is_active,
              lastErrorAt: doc.last_error_at ? BigInt(doc.last_error_at) : null,
              lastErrorType: doc.last_error_type,
              priority: doc.priority,
              weight: doc.weight,
              timeout: doc.timeout,
              customHeaders: doc.custom_headers as any,
              metadata: doc.metadata as any,
              avgLatency: doc.avg_latency,
              healthScore: doc.health_score,
              circuitBreakerState: doc.circuit_breaker_state,
              lastCircuitBreakerTrigger: doc.last_circuit_breaker_trigger ? BigInt(doc.last_circuit_breaker_trigger) : null,
              successCount: doc.success_count,
              maxRequestsPerMinute: doc.max_requests_per_minute,
              maxRequestsPerHour: doc.max_requests_per_hour,
              maxTokensPerMinute: doc.max_tokens_per_minute,
              maxConcurrentRequests: doc.max_concurrent_requests,
              apiKey: doc.api_key as any,
              limits: doc.limits as any,
              updatedAt: BigInt(doc.updated_at)
            },
            create: {
              id: doc.id,
              providerId: doc.provider_id,
              name: doc.name,
              enabled: doc.enabled,
              totalTokenUsage: BigInt(doc.total_token_usage),
              modelMapping: doc.model_mapping as any,
              lastUsedAt: BigInt(doc.last_used_at),
              consecutiveErrors: doc.consecutive_errors,
              errorCount: doc.error_count,
              isActive: doc.is_active,
              lastErrorAt: doc.last_error_at ? BigInt(doc.last_error_at) : null,
              lastErrorType: doc.last_error_type,
              priority: doc.priority,
              weight: doc.weight,
              timeout: doc.timeout,
              customHeaders: doc.custom_headers as any,
              metadata: doc.metadata as any,
              avgLatency: doc.avg_latency,
              healthScore: doc.health_score,
              circuitBreakerState: doc.circuit_breaker_state,
              lastCircuitBreakerTrigger: doc.last_circuit_breaker_trigger ? BigInt(doc.last_circuit_breaker_trigger) : null,
              successCount: doc.success_count,
              maxRequestsPerMinute: doc.max_requests_per_minute,
              maxRequestsPerHour: doc.max_requests_per_hour,
              maxTokensPerMinute: doc.max_tokens_per_minute,
              maxConcurrentRequests: doc.max_concurrent_requests,
              apiKey: doc.api_key as any,
              limits: doc.limits as any,
              createdAt: BigInt(doc.created_at),
              updatedAt: BigInt(doc.updated_at)
            }
          });
        }
      });
    } catch (error) {
      this.logger.error('Failed to save multiple sub-providers', error as Error);
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.prisma.subProvider.delete({
        where: { id }
      });
      return true;
    } catch (error) {
      this.logger.error('Failed to delete sub-provider', error as Error);
      return false;
    }
  }

  async count(filters?: SubProviderFilters): Promise<number> {
    try {
      const filter = this.buildFilter(filters);
      return await this.prisma.subProvider.count({
        where: filter
      });
    } catch (error) {
      this.logger.error('Failed to count sub-providers', error as Error);
      return 0;
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
      if (metrics.healthScore !== undefined) {
        updateData.healthScore = metrics.healthScore;
      }
      if (metrics.lastUsedAt !== undefined) {
        updateData.lastUsedAt = BigInt(metrics.lastUsedAt);
      }
      if (metrics.lastErrorAt !== undefined) {
        updateData.lastErrorAt = BigInt(metrics.lastErrorAt);
      }
      if (metrics.lastErrorType !== undefined) {
        updateData.lastErrorType = metrics.lastErrorType;
      }

      await this.prisma.subProvider.update({
        where: { id },
        data: updateData
      });
    } catch (error) {
      this.logger.error('Failed to update sub-provider metrics', error as Error);
      throw error;
    }
  }

  async updateLimits(id: string, limits: any): Promise<void> {
    try {
      await this.prisma.subProvider.update({
        where: { id },
        data: {
          limits: limits as any,
          updatedAt: BigInt(Date.now())
        }
      });
    } catch (error) {
      this.logger.error('Failed to update sub-provider limits', error as Error);
      throw error;
    }
  }

  async updateCircuitBreaker(id: string, state: 'closed' | 'open' | 'half-open'): Promise<void> {
    try {
      const updateData: any = {
        circuitBreakerState: state,
        updatedAt: BigInt(Date.now())
      };

      if (state === 'open') {
        updateData.lastCircuitBreakerTrigger = BigInt(Date.now());
      }

      await this.prisma.subProvider.update({
        where: { id },
        data: updateData
      });
    } catch (error) {
      this.logger.error('Failed to update sub-provider circuit breaker', error as Error);
      throw error;
    }
  }

  async resetCapacityCounters(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    try {
      await this.prisma.subProvider.updateMany({
        where: {
          id: { in: ids }
        },
        data: {
          updatedAt: BigInt(Date.now())
        }
      });
    } catch (error) {
      this.logger.error('Failed to reset capacity counters', error as Error);
      throw error;
    }
  }

  async bulkUpdateHealthScores(updates: Array<{ id: string; healthScore: number }>): Promise<void> {
    if (updates.length === 0) {
      return;
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        for (const update of updates) {
          await tx.subProvider.update({
            where: { id: update.id },
            data: {
              healthScore: update.healthScore,
              updatedAt: BigInt(Date.now())
            }
          });
        }
      });
    } catch (error) {
      this.logger.error('Failed to bulk update health scores', error as Error);
      throw error;
    }
  }

  private buildFilter(filters?: SubProviderFilters): any {
    if (!filters) {
      return {};
    }

    const filter: any = {};

    if (filters.providerId) {
      filter.providerId = filters.providerId;
    }

    if (filters.enabled !== undefined) {
      filter.enabled = filters.enabled;
    }

    if (filters.healthScore) {
      const healthFilter: any = {};
      if (filters.healthScore.min !== undefined) {
        healthFilter.gte = filters.healthScore.min;
      }
      if (filters.healthScore.max !== undefined) {
        healthFilter.lte = filters.healthScore.max;
      }
      if (Object.keys(healthFilter).length > 0) {
        filter.healthScore = healthFilter;
      }
    }

    if (filters.circuitBreakerState) {
      filter.circuitBreakerState = filters.circuitBreakerState;
    }

    return filter;
  }

  private buildOrderBy(query?: SubProviderQuery): any {
    if (!query?.sortBy) {
      return [
        { priority: 'desc' },
        { weight: 'desc' }
      ];
    }

    const sortOrder = query.sortOrder === 'desc' ? 'desc' : 'asc';
    
    switch (query.sortBy) {
      case 'priority':
        return { priority: sortOrder };
      case 'weight':
        return { weight: sortOrder };
      case 'healthScore':
        return { healthScore: sortOrder };
      case 'lastUsedAt':
        return { lastUsedAt: sortOrder };
      case 'createdAt':
        return { createdAt: sortOrder };
      default:
        return [
          { priority: 'desc' },
          { weight: 'desc' }
        ];
    }
  }

  private mapToSubProvider(prismaSubProvider: any): SubProvider {
    const doc: SubProviderDocument = {
      id: prismaSubProvider.id,
      created_at: Number(prismaSubProvider.createdAt),
      updated_at: Number(prismaSubProvider.updatedAt),
      provider_id: prismaSubProvider.providerId,
      name: prismaSubProvider.name,
      api_key: prismaSubProvider.apiKey,
      enabled: prismaSubProvider.enabled,
      total_token_usage: BigInt(prismaSubProvider.totalTokenUsage),
      model_mapping: prismaSubProvider.modelMapping,
      last_used_at: Number(prismaSubProvider.lastUsedAt),
      consecutive_errors: prismaSubProvider.consecutiveErrors,
      error_count: prismaSubProvider.errorCount,
      is_active: prismaSubProvider.isActive,
      last_error_at: prismaSubProvider.lastErrorAt ? Number(prismaSubProvider.lastErrorAt) : 0,
      last_error_type: prismaSubProvider.lastErrorType || '',
      priority: prismaSubProvider.priority,
      weight: prismaSubProvider.weight,
      timeout: prismaSubProvider.timeout,
      custom_headers: prismaSubProvider.customHeaders,
      metadata: prismaSubProvider.metadata,
      avg_latency: prismaSubProvider.avgLatency,
      health_score: prismaSubProvider.healthScore,
      circuit_breaker_state: prismaSubProvider.circuitBreakerState,
      last_circuit_breaker_trigger: prismaSubProvider.lastCircuitBreakerTrigger ? Number(prismaSubProvider.lastCircuitBreakerTrigger) : 0,
      success_count: prismaSubProvider.successCount,
      max_requests_per_minute: prismaSubProvider.maxRequestsPerMinute,
      max_requests_per_hour: prismaSubProvider.maxRequestsPerHour,
      max_tokens_per_minute: prismaSubProvider.maxTokensPerMinute,
      max_concurrent_requests: prismaSubProvider.maxConcurrentRequests,
      limits: prismaSubProvider.limits
    };
    return new SubProvider(doc);
  }
}
