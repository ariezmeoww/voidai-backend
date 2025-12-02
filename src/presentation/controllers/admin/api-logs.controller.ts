import { Hono } from 'hono';
import { BaseController } from '../base.controller';
import { ApiRequestService, type RequestQuery } from '../../../domain/request';
import type { ILogger } from '../../../core/logging';

export interface StatsQueryParams {
  readonly user_id?: string;
  readonly date_from?: string;
  readonly date_to?: string;
}

export class ApiLogsController extends BaseController {
  static readonly DEFAULT_CONFIG = {
    PAGE: 1,
    LIMIT: 100
  } as const;

  constructor(
    private readonly apiRequestService: ApiRequestService,
    logger: ILogger
  ) {
    super(logger);
  }

  public registerRoutes(): Hono {
    const app = this.createApplication();

    app.get('/admin/api-logs', this.listApiLogs.bind(this));
    app.get('/admin/api-logs/:id', this.getApiLog.bind(this));
    app.get('/admin/api-logs/stats/summary', this.getApiLogsSummary.bind(this));
    app.delete('/admin/api-logs/:id', this.deleteApiLog.bind(this));

    return app;
  }

  private async listApiLogs(c: any) {
    return this.handleRequest(c, async () => {
      const queryParams = this.parseQueryParams(c);
      const query = this.buildRequestQuery(queryParams);

      const [requests, stats] = await Promise.all([
        this.apiRequestService.getRequests(query),
        this.apiRequestService.getRequestStats()
      ]);

      return this.formatApiLogsListResponse(requests, stats, queryParams);
    }, 'List API logs');
  }

  private async getApiLog(c: any) {
    return this.handleRequest(c, async () => {
      const requestId = c.req.param('id');
      const apiRequest = await this.apiRequestService.getRequestById(requestId);
      
      if (!apiRequest) {
        throw new Error('API request not found');
      }

      return this.formatDetailedApiLogResponse(apiRequest);
    }, 'Get API log details');
  }

  private async getApiLogsSummary(c: any) {
    return this.handleRequest(c, async () => {
      const queryParams = this.parseStatsQueryParams(c);
      
      const requests = await this.fetchRequestsForStats(queryParams);
      const stats = await this.apiRequestService.getRequestStats(queryParams.userId);
      
      const breakdown = this.calculateBreakdownStats(requests);

      return {
        summary_stats: stats,
        breakdown,
        date_range: {
          from: queryParams.dateFrom,
          to: queryParams.dateTo
        }
      };
    }, 'Get API logs summary');
  }

  private async deleteApiLog(c: any) {
    return this.handleRequest(c, async () => {
      const requestId = c.req.param('id');
      const success = await this.apiRequestService.deleteRequest(requestId);
      
      if (!success) {
        throw new Error('API request not found');
      }

      return { success: true };
    }, 'Delete API log');
  }

  private parseQueryParams(c: any): ParsedQueryParams {
    const page = parseInt(c.req.query('page') || ApiLogsController.DEFAULT_CONFIG.PAGE.toString());
    const limit = parseInt(c.req.query('limit') || ApiLogsController.DEFAULT_CONFIG.LIMIT.toString());
    const userId = c.req.query('user_id');
    const model = c.req.query('model');
    const status = c.req.query('status');
    const dateFrom = c.req.query('date_from') ? parseInt(c.req.query('date_from')!) : undefined;
    const dateTo = c.req.query('date_to') ? parseInt(c.req.query('date_to')!) : undefined;

    return { page, limit, userId, model, status, dateFrom, dateTo };
  }

  private parseStatsQueryParams(c: any): ParsedStatsParams {
    const userId = c.req.query('user_id');
    const dateFrom = c.req.query('date_from') ? parseInt(c.req.query('date_from')!) : undefined;
    const dateTo = c.req.query('date_to') ? parseInt(c.req.query('date_to')!) : undefined;

    return { userId, dateFrom, dateTo };
  }

  private buildRequestQuery(params: ParsedQueryParams): RequestQuery {
    return {
      filters: {
        userId: params.userId,
        model: params.model,
        status: params.status as any,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo
      },
      limit: params.limit,
      offset: (params.page - 1) * params.limit,
      sortBy: 'createdAt' as const,
      sortOrder: 'desc' as const
    };
  }

  private async fetchRequestsForStats(params: ParsedStatsParams) {
    if (params.dateFrom && params.dateTo) {
      return this.apiRequestService.getRequestsInDateRange(params.dateFrom, params.dateTo);
    }
    return this.apiRequestService.getRequests();
  }

  private calculateBreakdownStats(requests: any[]) {
    const breakdown = new StatsBreakdownCalculator(requests);
    return breakdown.calculate();
  }

  private formatApiLogsListResponse(requests: any[], stats: any, params: ParsedQueryParams) {
    return {
      requests: requests.map(req => this.formatApiLogSummary(req)),
      pagination: {
        page: params.page,
        limit: params.limit,
        total: stats.totalRequests
      },
      stats
    };
  }

  private formatApiLogSummary(req: any) {
    return {
      id: req.id,
      user_id: req.userId,
      endpoint: req.endpoint,
      method: req.method,
      model: req.model,
      provider_id: req.providerId,
      sub_provider_id: req.subProviderId,
      status: req.requestStatus,
      status_code: req.statusCode,
      tokens_used: req.tokensUsed,
      credits_used: req.creditsUsed,
      latency: req.latency,
      request_size: req.requestSize,
      response_size: req.responseSize,
      error_message: req.errorMessage,
      retry_count: req.retryCount,
      user_agent: req.userAgent,
      created_at: req.createdAt,
      completed_at: req.completedAt,
      duration: req.duration
    };
  }

  private formatDetailedApiLogResponse(apiRequest: any) {
    return {
      id: apiRequest.id,
      user_id: apiRequest.userId,
      endpoint: apiRequest.endpoint,
      method: apiRequest.method,
      model: apiRequest.model,
      provider_id: apiRequest.providerId,
      sub_provider_id: apiRequest.subProviderId,
      status: apiRequest.requestStatus,
      status_code: apiRequest.statusCode,
      tokens_used: apiRequest.tokensUsed,
      credits_used: apiRequest.creditsUsed,
      latency: apiRequest.latency,
      request_size: apiRequest.requestSize,
      response_size: apiRequest.responseSize,
      error_message: apiRequest.errorMessage,
      retry_count: apiRequest.retryCount,
      user_agent: apiRequest.userAgent,
      created_at: apiRequest.createdAt,
      updated_at: apiRequest.updatedAt,
      metrics: apiRequest.getMetrics()
    };
  }
}

class StatsBreakdownCalculator {
  private readonly modelStats: Record<string, number> = {};
  private readonly providerStats: Record<string, number> = {};
  private readonly statusStats: Record<string, number> = {};

  constructor(private readonly requests: any[]) {}

  public calculate() {
    for (const request of this.requests) {
      this.processRequest(request);
    }

    return {
      by_model: this.modelStats,
      by_provider: this.providerStats,
      by_status: this.statusStats
    };
  }

  private processRequest(request: any): void {
    this.updateModelStats(request.model);
    this.updateProviderStats(request.providerId);
    this.updateStatusStats(request.requestStatus);
  }

  private updateModelStats(model: string): void {
    if (model) {
      this.modelStats[model] = (this.modelStats[model] || 0) + 1;
    }
  }

  private updateProviderStats(providerId: string): void {
    if (providerId) {
      this.providerStats[providerId] = (this.providerStats[providerId] || 0) + 1;
    }
  }

  private updateStatusStats(status: string): void {
    this.statusStats[status] = (this.statusStats[status] || 0) + 1;
  }
}

interface ParsedQueryParams {
  readonly page: number;
  readonly limit: number;
  readonly userId?: string;
  readonly model?: string;
  readonly status?: string;
  readonly dateFrom?: number;
  readonly dateTo?: number;
}

interface ParsedStatsParams {
  readonly userId?: string;
  readonly dateFrom?: number;
  readonly dateTo?: number;
}