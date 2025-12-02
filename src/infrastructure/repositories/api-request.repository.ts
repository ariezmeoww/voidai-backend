import { PrismaClient } from '@prisma/client';
import {
  ApiRequest,
  ApiRequestDocument,
  type IApiRequestRepository,
  type RequestFilters,
  type RequestQuery
} from '../../domain/request';
import type { IDatabaseService } from '../../core/database';
import type { ILogger } from '../../core/logging';

export class ApiRequestRepository implements IApiRequestRepository {
  private prisma: PrismaClient;
  private logger: ILogger;

  constructor(databaseService: IDatabaseService, logger: ILogger) {
    this.prisma = databaseService.getPrisma();
    this.logger = logger;
  }

  async findById(id: string): Promise<ApiRequest | null> {
    try {
      const request = await this.prisma.apiRequest.findUnique({
        where: { id }
      });
      return request ? this.mapToApiRequest(request) : null;
    } catch (error) {
      this.logger.error('Failed to find API request by ID', error as Error);
      return null;
    }
  }

  async findByUser(userId: string, query?: RequestQuery): Promise<ApiRequest[]> {
    try {
      const filter = this.buildFilter({ ...query?.filters, userId });
      const requests = await this.prisma.apiRequest.findMany({
        where: filter,
        orderBy: this.buildOrderBy(query),
        take: query?.limit,
        skip: query?.offset
      });
      return requests.map(req => this.mapToApiRequest(req));
    } catch (error) {
      this.logger.error('Failed to find API requests by user', error as Error);
      return [];
    }
  }

  async findMany(query?: RequestQuery): Promise<ApiRequest[]> {
    try {
      const filter = this.buildFilter(query?.filters);
      const requests = await this.prisma.apiRequest.findMany({
        where: filter,
        orderBy: this.buildOrderBy(query),
        take: query?.limit,
        skip: query?.offset
      });
      return requests.map(req => this.mapToApiRequest(req));
    } catch (error) {
      this.logger.error('Failed to find API requests', error as Error);
      return [];
    }
  }

  async findCompleted(): Promise<ApiRequest[]> {
    try {
      const requests = await this.prisma.apiRequest.findMany({
        where: { status: 'completed' },
        orderBy: { completedAt: 'desc' }
      });
      return requests.map(req => this.mapToApiRequest(req));
    } catch (error) {
      this.logger.error('Failed to find completed API requests', error as Error);
      return [];
    }
  }

  async findFailed(): Promise<ApiRequest[]> {
    try {
      const requests = await this.prisma.apiRequest.findMany({
        where: { 
          status: { in: ['failed', 'timeout'] }
        },
        orderBy: { completedAt: 'desc' }
      });
      return requests.map(req => this.mapToApiRequest(req));
    } catch (error) {
      this.logger.error('Failed to find failed API requests', error as Error);
      return [];
    }
  }

  async findByModel(model: string): Promise<ApiRequest[]> {
    try {
      const requests = await this.prisma.apiRequest.findMany({
        where: { model },
        orderBy: { createdAt: 'desc' }
      });
      return requests.map(req => this.mapToApiRequest(req));
    } catch (error) {
      this.logger.error('Failed to find API requests by model', error as Error);
      return [];
    }
  }

  async findByProvider(providerId: string): Promise<ApiRequest[]> {
    try {
      const requests = await this.prisma.apiRequest.findMany({
        where: { providerId },
        orderBy: { createdAt: 'desc' }
      });
      return requests.map(req => this.mapToApiRequest(req));
    } catch (error) {
      this.logger.error('Failed to find API requests by provider', error as Error);
      return [];
    }
  }

  async findByDateRange(from: number, to: number): Promise<ApiRequest[]> {
    try {
      const requests = await this.prisma.apiRequest.findMany({
        where: {
          createdAt: {
            gte: BigInt(from),
            lte: BigInt(to)
          }
        },
        orderBy: { createdAt: 'desc' }
      });
      return requests.map(req => this.mapToApiRequest(req));
    } catch (error) {
      this.logger.error('Failed to find API requests by date range', error as Error);
      return [];
    }
  }

  async exists(id: string): Promise<boolean> {
    try {
      const count = await this.prisma.apiRequest.count({
        where: { id }
      });
      return count > 0;
    } catch (error) {
      this.logger.error('Failed to check API request existence', error as Error);
      return false;
    }
  }

  async save(request: ApiRequest): Promise<ApiRequest> {
    try {
      const doc = request.toDocument();
      const saved = await this.prisma.apiRequest.upsert({
        where: { id: doc.id },
        update: {
          userId: doc.user_id || null,
          endpoint: doc.endpoint,
          model: doc.model,
          tokensUsed: BigInt(doc.tokens_used),
          creditsUsed: BigInt(doc.credits_used),
          providerId: doc.provider_id || null,
          method: doc.method,
          subProviderId: doc.sub_provider_id || null,
          userAgent: doc.user_agent,
          latency: doc.latency,
          responseSize: doc.response_size,
          requestSize: doc.request_size,
          status: doc.status,
          statusCode: doc.status_code,
          errorMessage: doc.error_message,
          retryCount: doc.retry_count,
          completedAt: doc.completed_at ? BigInt(doc.completed_at) : null,
          updatedAt: BigInt(doc.updated_at)
        },
        create: {
          id: doc.id,
          userId: doc.user_id || null,
          endpoint: doc.endpoint,
          model: doc.model,
          tokensUsed: BigInt(doc.tokens_used),
          creditsUsed: BigInt(doc.credits_used),
          providerId: doc.provider_id || null,
          method: doc.method,
          subProviderId: doc.sub_provider_id || null,
          userAgent: doc.user_agent,
          latency: doc.latency,
          responseSize: doc.response_size,
          requestSize: doc.request_size,
          status: doc.status,
          statusCode: doc.status_code,
          errorMessage: doc.error_message,
          retryCount: doc.retry_count,
          completedAt: doc.completed_at ? BigInt(doc.completed_at) : null,
          createdAt: BigInt(doc.created_at),
          updatedAt: BigInt(doc.updated_at)
        }
      });
      return this.mapToApiRequest(saved);
    } catch (error) {
      this.logger.error('Failed to save API request', error as Error);
      throw error;
    }
  }

  async saveMany(requests: ApiRequest[]): Promise<void> {
    if (requests.length === 0) {
      return;
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        for (const request of requests) {
          const doc = request.toDocument();
          await tx.apiRequest.upsert({
            where: { id: doc.id },
            update: {
              userId: doc.user_id || null,
              endpoint: doc.endpoint,
              model: doc.model,
              tokensUsed: BigInt(doc.tokens_used),
              creditsUsed: BigInt(doc.credits_used),
              providerId: doc.provider_id || null,
              method: doc.method,
              subProviderId: doc.sub_provider_id || null,
              userAgent: doc.user_agent,
              latency: doc.latency,
              responseSize: doc.response_size,
              requestSize: doc.request_size,
              status: doc.status,
              statusCode: doc.status_code,
              errorMessage: doc.error_message,
              retryCount: doc.retry_count,
              completedAt: doc.completed_at ? BigInt(doc.completed_at) : null,
              updatedAt: BigInt(doc.updated_at)
            },
            create: {
              id: doc.id,
              userId: doc.user_id || null,
              endpoint: doc.endpoint,
              model: doc.model,
              tokensUsed: BigInt(doc.tokens_used),
              creditsUsed: BigInt(doc.credits_used),
              providerId: doc.provider_id || null,
              method: doc.method,
              subProviderId: doc.sub_provider_id || null,
              userAgent: doc.user_agent,
              latency: doc.latency,
              responseSize: doc.response_size,
              requestSize: doc.request_size,
              status: doc.status,
              statusCode: doc.status_code,
              errorMessage: doc.error_message,
              retryCount: doc.retry_count,
              completedAt: doc.completed_at ? BigInt(doc.completed_at) : null,
              createdAt: BigInt(doc.created_at),
              updatedAt: BigInt(doc.updated_at)
            }
          });
        }
      });
    } catch (error) {
      this.logger.error('Failed to save multiple API requests', error as Error);
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.prisma.apiRequest.delete({
        where: { id }
      });
      return true;
    } catch (error) {
      this.logger.error('Failed to delete API request', error as Error);
      return false;
    }
  }

  async count(filters?: RequestFilters): Promise<number> {
    try {
      const filter = this.buildFilter(filters);
      return await this.prisma.apiRequest.count({
        where: filter
      });
    } catch (error) {
      this.logger.error('Failed to count API requests', error as Error);
      return 0;
    }
  }

  async getUsageStats(userId?: string): Promise<{
    totalRequests: number;
    totalTokens: number;
    totalCredits: number;
    avgLatency: number;
    successRate: number;
  }> {
    try {
      const where = userId ? { userId } : {};
      
      const [totalStats, successStats] = await Promise.all([
        this.prisma.apiRequest.aggregate({
          where,
          _count: { id: true },
          _sum: {
            tokensUsed: true,
            creditsUsed: true
          },
          _avg: {
            latency: true
          }
        }),
        this.prisma.apiRequest.count({
          where: {
            ...where,
            status: 'completed'
          }
        })
      ]);

      const totalRequests = totalStats._count.id || 0;
      const successRate = totalRequests > 0 ? (successStats / totalRequests) * 100 : 0;

      return {
        totalRequests,
        totalTokens: Number(totalStats._sum.tokensUsed || 0n),
        totalCredits: Number(totalStats._sum.creditsUsed || 0n),
        avgLatency: totalStats._avg.latency || 0,
        successRate
      };
    } catch (error) {
      this.logger.error('Failed to get usage stats', error as Error);
      return {
        totalRequests: 0,
        totalTokens: 0,
        totalCredits: 0,
        avgLatency: 0,
        successRate: 0
      };
    }
  }

  private buildFilter(filters?: RequestFilters): any {
    if (!filters) {
      return {};
    }

    const filter: any = {};

    if (filters.userId) {
      filter.userId = filters.userId;
    }

    if (filters.endpoint) {
      filter.endpoint = filters.endpoint;
    }

    if (filters.model) {
      filter.model = filters.model;
    }

    if (filters.providerId) {
      filter.providerId = filters.providerId;
    }

    if (filters.status) {
      filter.status = filters.status;
    }

    if (filters.dateFrom || filters.dateTo) {
      const dateFilter: any = {};
      if (filters.dateFrom) {
        dateFilter.gte = BigInt(filters.dateFrom);
      }
      if (filters.dateTo) {
        dateFilter.lte = BigInt(filters.dateTo);
      }
      filter.createdAt = dateFilter;
    }

    if (filters.minLatency || filters.maxLatency) {
      const latencyFilter: any = {};
      if (filters.minLatency) {
        latencyFilter.gte = filters.minLatency;
      }
      if (filters.maxLatency) {
        latencyFilter.lte = filters.maxLatency;
      }
      filter.latency = latencyFilter;
    }

    return filter;
  }

  private buildOrderBy(query?: RequestQuery): any {
    if (!query?.sortBy) {
      return { createdAt: 'desc' };
    }

    const sortOrder = query.sortOrder === 'desc' ? 'desc' : 'asc';
    
    switch (query.sortBy) {
      case 'createdAt':
        return { createdAt: sortOrder };
      case 'completedAt':
        return { completedAt: sortOrder };
      case 'latency':
        return { latency: sortOrder };
      case 'tokensUsed':
        return { tokensUsed: sortOrder };
      case 'creditsUsed':
        return { creditsUsed: sortOrder };
      default:
        return { createdAt: 'desc' };
    }
  }

  private mapToApiRequest(prismaRequest: any): ApiRequest {
    const doc: ApiRequestDocument = {
      id: prismaRequest.id,
      created_at: Number(prismaRequest.createdAt),
      updated_at: Number(prismaRequest.updatedAt),
      user_id: prismaRequest.userId || undefined,
      endpoint: prismaRequest.endpoint,
      model: prismaRequest.model,
      tokens_used: BigInt(prismaRequest.tokensUsed),
      credits_used: BigInt(prismaRequest.creditsUsed),
      provider_id: prismaRequest.providerId || null,
      method: prismaRequest.method,
      sub_provider_id: prismaRequest.subProviderId || null,
      user_agent: prismaRequest.userAgent || '',
      latency: prismaRequest.latency,
      response_size: prismaRequest.responseSize,
      request_size: prismaRequest.requestSize,
      status: prismaRequest.status,
      status_code: prismaRequest.statusCode,
      error_message: prismaRequest.errorMessage || '',
      retry_count: prismaRequest.retryCount,
      completed_at: prismaRequest.completedAt ? Number(prismaRequest.completedAt) : 0
    };
    return new ApiRequest(doc);
  }
}
