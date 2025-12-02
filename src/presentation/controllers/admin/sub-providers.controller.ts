import { Hono } from 'hono';
import { BaseController } from '../base.controller';
import {
  SubProviderService,
  HealthMonitorService,
  ProviderService,
  type CreateSubProviderRequest,
  type UpdateSubProviderRequest
} from '../../../domain/provider';
import type { ILogger } from '../../../core/logging';

export interface BulkCreateRequest {
  readonly sub_providers: ReadonlyArray<any>;
}

interface ParsedQueryParams {
  readonly page: number;
  readonly limit: number;
  readonly providerId?: string;
  readonly enabled?: boolean;
}

export class SubProvidersController extends BaseController {
  static readonly DEFAULT_CONFIG = {
    PAGE: 1,
    LIMIT: 50,
    PRIORITY: 1,
    WEIGHT: 1,
    TIMEOUT: 300000,
    MAX_REQUESTS_PER_MINUTE: 240,
    MAX_REQUESTS_PER_HOUR: 14400,
    MAX_TOKENS_PER_MINUTE: 5000000,
    MAX_CONCURRENT_REQUESTS: 30,
    HEALTH_CHECKS_LIMIT: 20
  } as const;

  constructor(
    private readonly subProviderService: SubProviderService,
    private readonly healthMonitorService: HealthMonitorService,
    private readonly providerService: ProviderService,
    logger: ILogger
  ) {
    super(logger);
  }

  public registerRoutes(): Hono {
    const app = this.createApplication();
    
    app.get('/admin/sub-providers', this.listSubProviders.bind(this));
    app.post('/admin/sub-providers', this.createSubProvider.bind(this));
    app.post('/admin/sub-providers/bulk', this.bulkCreateSubProviders.bind(this));
    app.get('/admin/sub-providers/:id', this.getSubProvider.bind(this));
    app.patch('/admin/sub-providers/:id', this.updateSubProvider.bind(this));
    app.post('/admin/sub-providers/:id/enable', this.enableSubProvider.bind(this));
    app.post('/admin/sub-providers/:id/disable', this.disableSubProvider.bind(this));
    app.post('/admin/sub-providers/:id/circuit-breaker/reset', this.resetCircuitBreaker.bind(this));
    app.delete('/admin/sub-providers/:id', this.deleteSubProvider.bind(this));
    app.get('/admin/sub-providers/health', this.getHealthStatus.bind(this));
    
    return app;
  }

  private async listSubProviders(c: any) {
    return this.handleRequest(c, async () => {
      const params = this.parseQueryParams(c);
      const query = this.buildQuery(params);
      const [subProviders, stats] = await Promise.all([
        this.subProviderService.getSubProviders(query),
        this.subProviderService.getSubProviderStats()
      ]);
      
      return {
        sub_providers: subProviders.map(sp => this.formatSummary(sp)),
        pagination: { 
          page: params.page, 
          limit: params.limit, 
          total: stats.totalSubProviders 
        },
        stats
      };
    }, 'List sub-providers');
  }

  private async createSubProvider(c: any) {
    return this.handleRequest(c, async () => {
      const data = await c.req.json();
      const provider = await this.findProviderByName(data.provider_name);
      const request = this.buildCreateRequest(data, provider.id);
      const result = await this.subProviderService.createSubProvider(request);
      
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to create sub-provider');
      }
      
      return this.formatResponse(result.data, provider.name);
    }, 'Create sub-provider');
  }

  private async bulkCreateSubProviders(c: any) {
    return this.handleRequest(c, async () => {
      const { sub_providers } = await c.req.json() as BulkCreateRequest;
      this.validateBulkRequest(sub_providers);
      const creator = new BulkSubProviderCreator(this.subProviderService, this.providerService);
      return creator.create(sub_providers);
    }, 'Bulk create sub-providers');
  }

  private async getSubProvider(c: any) {
    return this.handleRequest(c, async () => {
      const id = c.req.param('id');
      const subProvider = await this.subProviderService.getSubProviderById(id);
      
      if (!subProvider) throw new Error('Sub-provider not found');
      
      return this.formatDetailed(subProvider);
    }, 'Get sub-provider details');
  }

  private async updateSubProvider(c: any) {
    return this.handleRequest(c, async () => {
      const id = c.req.param('id');
      const updates = await c.req.json() as UpdateSubProviderRequest;
      const result = await this.subProviderService.updateSubProvider(id, updates);
      
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Sub-provider not found');
      }
      
      return { 
        id: result.data.id, 
        updated_at: result.data.updatedAt, 
        changes: updates 
      };
    }, 'Update sub-provider');
  }

  private async enableSubProvider(c: any) {
    return this.handleRequest(c, async () => {
      const id = c.req.param('id');
      const success = await this.subProviderService.enableSubProvider(id);
      
      if (!success) throw new Error('Sub-provider not found');
      
      return { success: true, enabled: true };
    }, 'Enable sub-provider');
  }

  private async disableSubProvider(c: any) {
    return this.handleRequest(c, async () => {
      const id = c.req.param('id');
      const success = await this.subProviderService.disableSubProvider(id);
      
      if (!success) throw new Error('Sub-provider not found');
      
      return { success: true, enabled: false };
    }, 'Disable sub-provider');
  }

  private async resetCircuitBreaker(c: any) {
    return this.handleRequest(c, async () => {
      const id = c.req.param('id');
      const success = await this.subProviderService.resetCircuitBreaker(id);
      
      if (!success) throw new Error('Sub-provider not found');
      
      return { success: true, circuit_breaker_state: 'closed' };
    }, 'Reset circuit breaker');
  }

  private async deleteSubProvider(c: any) {
    return this.handleRequest(c, async () => {
      const id = c.req.param('id');
      const success = await this.subProviderService.deleteSubProvider(id);
      
      if (!success) throw new Error('Sub-provider not found');
      
      return { success: true };
    }, 'Delete sub-provider');
  }

  private async getHealthStatus(c: any) {
    return this.handleRequest(c, async () => {
      const [healthStats, healthChecks] = await Promise.all([
        this.healthMonitorService.getHealthStats(),
        this.healthMonitorService.performHealthChecks()
      ]);
      
      return { 
        health_stats: healthStats, 
        recent_checks: healthChecks.slice(0, SubProvidersController.DEFAULT_CONFIG.HEALTH_CHECKS_LIMIT) 
      };
    }, 'Get health status');
  }

  private parseQueryParams(c: any): ParsedQueryParams {
    const page = parseInt(c.req.query('page') || SubProvidersController.DEFAULT_CONFIG.PAGE.toString());
    const limit = parseInt(c.req.query('limit') || SubProvidersController.DEFAULT_CONFIG.LIMIT.toString());
    const providerId = c.req.query('provider_id');
    const enabledQuery = c.req.query('enabled');
    const enabled = enabledQuery === 'true' ? true : enabledQuery === 'false' ? false : undefined;
    
    return { page, limit, providerId, enabled };
  }

  private buildQuery(params: ParsedQueryParams) {
    return {
      filters: { 
        providerId: params.providerId, 
        enabled: params.enabled 
      },
      limit: params.limit,
      offset: (params.page - 1) * params.limit,
      sortBy: 'healthScore' as const,
      sortOrder: 'desc' as const
    };
  }

  private formatSummary(sp: any) {
    return {
      id: sp.id,
      provider_id: sp.providerId,
      name: sp.name,
      enabled: sp.isEnabled,
      health_score: sp.healthScore,
      circuit_breaker_state: sp.circuitBreakerState,
      avg_latency: sp.avgLatency,
      success_rate: sp.successRate,
      metrics: sp.getMetrics(),
      limits: sp.getLimits(),
      created_at: sp.createdAt,
      updated_at: sp.updatedAt
    };
  }

  private formatDetailed(sp: any) {
    return {
      id: sp.id,
      provider_id: sp.providerId,
      name: sp.name,
      enabled: sp.isEnabled,
      priority: sp.priority,
      weight: sp.weight,
      health_score: sp.healthScore,
      circuit_breaker_state: sp.circuitBreakerState,
      avg_latency: sp.avgLatency,
      success_rate: sp.successRate,
      consecutive_errors: sp.consecutiveErrors,
      api_key: sp.getApiKey(),
      metrics: sp.getMetrics(),
      limits: sp.getLimits(),
      created_at: sp.createdAt,
      updated_at: sp.updatedAt
    };
  }

  private formatResponse(subProvider: any, providerName: string) {
    return {
      id: subProvider.id,
      provider_id: subProvider.providerId,
      provider_name: providerName,
      name: subProvider.name,
      enabled: subProvider.isEnabled,
      priority: subProvider.priority,
      weight: subProvider.weight,
      created_at: subProvider.createdAt
    };
  }

  private async findProviderByName(providerName: string) {
    const provider = await this.providerService.getProviderByName(providerName);
    if (!provider) throw new Error(`Provider '${providerName}' not found`);
    return provider;
  }

  private buildCreateRequest(data: any, providerId: string): CreateSubProviderRequest {
    const now = Date.now();
    return {
      providerId,
      name: data.name,
      apiKey: data.api_key,
      priority: data.priority ?? SubProvidersController.DEFAULT_CONFIG.PRIORITY,
      weight: data.weight ?? SubProvidersController.DEFAULT_CONFIG.WEIGHT,
      timeout: data.timeout ?? SubProvidersController.DEFAULT_CONFIG.TIMEOUT,
      customHeaders: data.custom_headers ?? {},
      metadata: data.metadata ?? {},
      modelMapping: data.model_mapping ?? {},
      limits: {
        max_requests_per_minute: data.limits?.max_requests_per_minute ?? SubProvidersController.DEFAULT_CONFIG.MAX_REQUESTS_PER_MINUTE,
        max_requests_per_hour: data.limits?.max_requests_per_hour ?? SubProvidersController.DEFAULT_CONFIG.MAX_REQUESTS_PER_HOUR,
        max_tokens_per_minute: data.limits?.max_tokens_per_minute ?? SubProvidersController.DEFAULT_CONFIG.MAX_TOKENS_PER_MINUTE,
        max_concurrent_requests: data.limits?.max_concurrent_requests ?? SubProvidersController.DEFAULT_CONFIG.MAX_CONCURRENT_REQUESTS,
        current_request_count: 0,
        current_token_count: 0,
        current_concurrent_requests: 0,
        request_window: [],
        token_window: [],
        last_window_reset: now
      }
    };
  }

  private validateBulkRequest(subProviders: ReadonlyArray<any>): void {
    if (!Array.isArray(subProviders) || subProviders.length === 0) {
      throw new Error('Sub-providers array is required');
    }
  }
}

class BulkSubProviderCreator {
  constructor(
    private readonly subProviderService: SubProviderService,
    private readonly providerService: ProviderService
  ) {}

  public async create(subProviders: ReadonlyArray<any>) {
    const providerNames = [...new Set(subProviders.map(sp => sp.provider_name))];
    const providers = await Promise.all(providerNames.map(name => this.providerService.getProviderByName(name)));
    const providerMap = new Map<string, any>();
    
    providerNames.forEach((name, i) => { 
      if (providers[i]) providerMap.set(name, providers[i]); 
    });
    
    const results = await Promise.allSettled(
      subProviders.map(sp => this.createSingle(sp, providerMap.get(sp.provider_name)))
    );
    
    const created: any[] = [];
    const errors: any[] = [];
    
    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      if (res.status === 'fulfilled') {
        created.push(res.value);
      } else {
        errors.push(this.formatError(subProviders[i], res.reason as Error));
      }
    }
    
    return { 
      created: created.length, 
      errors: errors.length, 
      sub_providers: created, 
      failed: errors 
    };
  }

  private async createSingle(data: any, provider: any) {
    if (!provider) throw new Error(`Provider '${data.provider_name}' not found`);
    
    const request = this.buildCreateRequest(data, provider.id);
    const result = await this.subProviderService.createSubProvider(request);
    
    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to create sub-provider');
    }
    
    return {
      id: result.data.id,
      provider_id: result.data.providerId,
      provider_name: provider.name,
      name: result.data.name,
      enabled: result.data.isEnabled
    };
  }

  private buildCreateRequest(data: any, providerId: string): CreateSubProviderRequest {
    const now = Date.now();
    return {
      providerId,
      name: data.name,
      apiKey: data.api_key,
      priority: data.priority ?? SubProvidersController.DEFAULT_CONFIG.PRIORITY,
      weight: data.weight ?? SubProvidersController.DEFAULT_CONFIG.WEIGHT,
      timeout: data.timeout ?? SubProvidersController.DEFAULT_CONFIG.TIMEOUT,
      customHeaders: data.custom_headers ?? {},
      metadata: data.metadata ?? {},
      modelMapping: data.model_mapping ?? {},
      limits: {
        max_requests_per_minute: data.limits?.max_requests_per_minute ?? SubProvidersController.DEFAULT_CONFIG.MAX_REQUESTS_PER_MINUTE,
        max_requests_per_hour: data.limits?.max_requests_per_hour ?? SubProvidersController.DEFAULT_CONFIG.MAX_REQUESTS_PER_HOUR,
        max_tokens_per_minute: data.limits?.max_tokens_per_minute ?? SubProvidersController.DEFAULT_CONFIG.MAX_TOKENS_PER_MINUTE,
        max_concurrent_requests: data.limits?.max_concurrent_requests ?? SubProvidersController.DEFAULT_CONFIG.MAX_CONCURRENT_REQUESTS,
        current_request_count: 0,
        current_token_count: 0,
        current_concurrent_requests: 0,
        request_window: [],
        token_window: [],
        last_window_reset: now
      }
    };
  }

  private formatError(data: any, error: Error) {
    const errorId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    this.logger.error('Sub-provider operation failed', error, {
      metadata: { errorId, timestamp, name: data.name, provider_name: data.provider_name, errorMessage: error.message }
    });
    return {
      name: data.name || 'unknown',
      provider_name: data.provider_name || 'unknown',
      error: `Operation failed. Reference: ${errorId}`,
      reference_id: errorId,
      timestamp
    };
  }
}