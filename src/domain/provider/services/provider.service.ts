import { Provider, type HealthStatus, type ErrorType } from '../entities';
import type { IProviderRepository, ProviderQuery } from '../repositories';
import type { ILogger } from '../../../core/logging';

export interface CreateProviderRequest {
  readonly name: string;
  readonly needsSubProviders: boolean;
  readonly priority: number;
  readonly baseUrl: string;
  readonly timeout: number;
  readonly supportedModels: ReadonlyArray<string>;
  readonly rateLimits: RateLimits;
  readonly features: ReadonlyArray<string>;
}

export interface UpdateProviderRequest {
  readonly needsSubProviders?: boolean;
  readonly priority?: number;
  readonly baseUrl?: string;
  readonly timeout?: number;
  readonly supportedModels?: ReadonlyArray<string>;
  readonly rateLimits?: RateLimits;
  readonly features?: ReadonlyArray<string>;
}

export interface RateLimits {
  readonly requestsPerMinute: number;
  readonly requestsPerHour: number;
  readonly tokensPerMinute: number;
}

export interface ProviderStats {
  readonly totalProviders: number;
  readonly activeProviders: number;
  readonly healthyProviders: number;
  readonly degradedProviders: number;
  readonly unhealthyProviders: number;
  readonly totalRequests: number;
  readonly totalTokenUsage: number;
  readonly avgSuccessRate: number;
  readonly avgLatency: number;
}

export interface ProviderOperationResult<T = Provider> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
}

export interface GetProvidersForModelOptions {
  readonly onlyHealthy?: boolean;
  readonly limit?: number;
}

export class ProviderService {
  static readonly DEFAULT_CONFIG = {
    MAX_CONCURRENT_REQUESTS: 100,
    INITIAL_UPTIME: 0,
    INITIAL_QUEUE_LENGTH: 0,
    INITIAL_UTILIZATION: 0
  } as const;

  constructor(
    private readonly providerRepository: IProviderRepository,
    private readonly logger: ILogger
  ) {}

  public async createProvider(request: CreateProviderRequest): Promise<ProviderOperationResult> {
    const validation = this.validateCreateRequest(request);
    if (!validation.isValid) {
      return ProviderOperationResult.failure(validation.error!);
    }

    const providerData = this.buildProviderData(request);
    const provider = new Provider(providerData);
    
    const savedProvider = await this.providerRepository.save(provider);
    this.logProviderCreation(savedProvider);

    return ProviderOperationResult.success(savedProvider);
  }

  public async getProviderById(id: string): Promise<Provider | null> {
    this.validateRequiredString(id, 'Provider ID');
    return this.providerRepository.findById(id);
  }

  public async getProviderByName(name: string): Promise<Provider | null> {
    this.validateRequiredString(name, 'Provider name');
    return this.providerRepository.findByName(name);
  }

  public async getProviders(query?: ProviderQuery): Promise<Provider[]> {
    return this.providerRepository.findMany(query);
  }

  public async getAvailableProviders(): Promise<Provider[]> {
    return this.providerRepository.findAvailable();
  }

  public async getHealthyProviders(): Promise<Provider[]> {
    return this.providerRepository.findHealthy();
  }

  public async getProvidersByModel(model: string): Promise<Provider[]> {
    this.validateRequiredString(model, 'Model name');
    return this.providerRepository.findByModel(model);
  }

  public async updateProvider(id: string, request: UpdateProviderRequest): Promise<ProviderOperationResult> {
    const provider = await this.providerRepository.findById(id);
    if (!provider) {
      return ProviderOperationResult.failure('Provider not found');
    }

    const updater = new ProviderUpdater(provider);
    updater.applyUpdates(request);

    const savedProvider = await this.providerRepository.save(provider);
    return ProviderOperationResult.success(savedProvider);
  }

  public async updateProviderHealth(id: string, status: HealthStatus): Promise<ProviderOperationResult<void>> {
    const provider = await this.providerRepository.findById(id);
    if (!provider) {
      return ProviderOperationResult.failure(`Provider with ID ${id} not found`);
    }

    provider.updateHealthStatus(status);
    await this.providerRepository.save(provider);

    this.logHealthStatusUpdate(id, status);
    return ProviderOperationResult.success(undefined);
  }

  public async recordProviderSuccess(id: string, latency: number, tokensUsed: number): Promise<void> {
    const provider = await this.providerRepository.findById(id);
    if (!provider) {
      this.logProviderNotFound('record success', id);
      return;
    }

    provider.recordSuccess(latency, tokensUsed);
    await this.providerRepository.save(provider);
  }

  public async recordProviderError(id: string, errorType: ErrorType): Promise<void> {
    const provider = await this.providerRepository.findById(id);
    if (!provider) {
      this.logProviderNotFound('record error', id);
      return;
    }

    provider.recordError(errorType);
    await this.providerRepository.save(provider);
  }

  public async deleteProvider(id: string): Promise<boolean> {
    const exists = await this.providerRepository.exists(id);
    if (!exists) return false;

    const success = await this.providerRepository.delete(id);
    if (success) {
      this.logger.info('Provider deleted successfully', {
        metadata: { providerId: id }
      });
    }

    return success;
  }

  public async getProviderStats(): Promise<ProviderStats> {
    const allProviders = await this.providerRepository.findMany();
    const statsCalculator = new ProviderStatsCalculator(allProviders);
    return statsCalculator.calculate();
  }

  public async getProvidersForModel(model: string, options?: GetProvidersForModelOptions): Promise<Provider[]> {
    const providers = await this.getProvidersByModel(model);
    const providerSelector = new ProviderSelector(providers, options);
    return providerSelector.select();
  }

  private buildProviderData(request: CreateProviderRequest): any {
    const now = Date.now();

    return {
      id: crypto.randomUUID(),
      created_at: now,
      updated_at: now,
      name: request.name,
      needs_sub_providers: request.needsSubProviders,
      total_token_usage: 0n,
      avg_latency: 0,
      error_count: 0,
      success_count: 0,
      is_active: true,
      last_used_at: now,
      last_error_at: 0,
      priority: request.priority,
      base_url: request.baseUrl,
      timeout: request.timeout,
      supported_models: [...request.supportedModels],
      rate_limits: {
        requests_per_minute: request.rateLimits.requestsPerMinute,
        requests_per_hour: request.rateLimits.requestsPerHour,
        tokens_per_minute: request.rateLimits.tokensPerMinute
      },
      throughput: {
        requests_per_second: 0,
        tokens_per_second: 0,
        peak_requests_per_second: 0,
        peak_tokens_per_second: 0
      },
      features: [...request.features],
      consecutive_errors: 0,
      timeout_count: 0,
      health_status: 'healthy',
      uptime: ProviderService.DEFAULT_CONFIG.INITIAL_UPTIME,
      performance: {
        min_latency: Infinity,
        max_latency: 0,
        p50_latency: 0,
        p95_latency: 0,
        p99_latency: 0,
        latency_history: [],
        last_percentile_calculation: now
      },
      capacity: {
        max_concurrent_requests: ProviderService.DEFAULT_CONFIG.MAX_CONCURRENT_REQUESTS,
        current_concurrent_requests: 0,
        queue_length: ProviderService.DEFAULT_CONFIG.INITIAL_QUEUE_LENGTH,
        utilization_percent: ProviderService.DEFAULT_CONFIG.INITIAL_UTILIZATION
      }
    };
  }

  private validateCreateRequest(request: CreateProviderRequest): ValidationResult {
    const requiredStringFields = [
      { value: request.name, name: 'Provider name' },
      { value: request.baseUrl, name: 'Provider base URL' }
    ];

    for (const field of requiredStringFields) {
      if (!field.value?.trim()) {
        return ValidationResult.failure(`${field.name} is required`);
      }
    }

    if (request.timeout <= 0) {
      return ValidationResult.failure('Provider timeout must be positive');
    }

    if (!Array.isArray(request.supportedModels) || request.supportedModels.length === 0) {
      return ValidationResult.failure('Provider must support at least one model');
    }

    const rateLimitsValidation = this.validateRateLimits(request.rateLimits);
    if (!rateLimitsValidation.isValid) {
      return rateLimitsValidation;
    }

    return ValidationResult.success();
  }

  private validateRateLimits(rateLimits: RateLimits): ValidationResult {
    if (!rateLimits) {
      return ValidationResult.failure('Rate limits are required');
    }

    const limits = [
      { value: rateLimits.requestsPerMinute, name: 'requests per minute' },
      { value: rateLimits.requestsPerHour, name: 'requests per hour' },
      { value: rateLimits.tokensPerMinute, name: 'tokens per minute' }
    ];

    for (const limit of limits) {
      if (limit.value <= 0) {
        return ValidationResult.failure(`Rate limit for ${limit.name} must be positive`);
      }
    }

    return ValidationResult.success();
  }

  private validateRequiredString(value: string, fieldName: string): void {
    if (!value?.trim()) {
      throw new Error(`${fieldName} is required`);
    }
  }

  private logProviderCreation(provider: Provider): void {
    this.logger.info('Provider created successfully', {
      metadata: {
        providerId: provider.id,
        providerName: provider.name,
        needsSubProviders: provider.needsSubProviders
      }
    });
  }

  private logHealthStatusUpdate(providerId: string, status: HealthStatus): void {
    this.logger.info('Provider health status updated', {
      metadata: {
        providerId,
        healthStatus: status
      }
    });
  }

  private logProviderNotFound(operation: string, providerId: string): void {
    this.logger.warn(`Attempted to ${operation} for non-existent provider`, {
      metadata: { providerId }
    });
  }
}

class ProviderUpdater {
  constructor(private readonly provider: Provider) {}

  public applyUpdates(request: UpdateProviderRequest): void {
    if (request.supportedModels) {
      this.updateSupportedModels(request.supportedModels);
    }
    
    if (request.needsSubProviders !== undefined) {
      this.provider.updateNeedsSubProviders(request.needsSubProviders);
    }
    
    if (request.priority !== undefined) {
      this.provider.updatePriority(request.priority);
    }
    
    if (request.baseUrl) {
      this.provider.updateBaseUrl(request.baseUrl);
    }
    
    if (request.timeout !== undefined) {
      this.provider.updateTimeout(request.timeout);
    }
    
    if (request.rateLimits) {
      this.provider.updateRateLimits(request.rateLimits);
    }
    
    if (request.features) {
      this.updateFeatures(request.features);
    }
  }

  private updateSupportedModels(newModels: ReadonlyArray<string>): void {
    const currentModels = [...this.provider.supportedModels];
    currentModels.forEach(model => this.provider.removeSupportedModel(model));
    newModels.forEach(model => this.provider.addSupportedModel(model));
  }
  
  private updateFeatures(newFeatures: ReadonlyArray<string>): void {
    this.provider.updateFeatures([...newFeatures]);
  }
}

class ProviderStatsCalculator {
  constructor(private readonly providers: Provider[]) {}

  public calculate(): ProviderStats {
    const healthCounts = this.calculateHealthCounts();
    const activeCount = this.providers.filter(p => p.isActive).length;
    const usageTotals = this.calculateUsageTotals();
    const averages = this.calculateAverages();

    return {
      totalProviders: this.providers.length,
      activeProviders: activeCount,
      ...healthCounts,
      ...usageTotals,
      ...averages
    };
  }

  private calculateHealthCounts() {
    return {
      healthyProviders: this.providers.filter(p => p.isHealthy()).length,
      degradedProviders: this.providers.filter(p => p.isDegraded()).length,
      unhealthyProviders: this.providers.filter(p => p.isUnhealthy()).length
    };
  }

  private calculateUsageTotals() {
    return {
      totalRequests: this.providers.reduce((sum, p) => sum + p.getMetrics().totalRequests, 0),
      totalTokenUsage: Number(this.providers.reduce((sum, p) => sum + Number(p.getMetrics().totalTokenUsage), 0))
    };
  }

  private calculateAverages() {
    if (this.providers.length === 0) {
      return { avgSuccessRate: 0, avgLatency: 0 };
    }

    const totalSuccessRate = this.providers.reduce((sum, p) => sum + p.successRate, 0);
    const totalLatency = this.providers.reduce((sum, p) => sum + p.avgLatency, 0);

    return {
      avgSuccessRate: totalSuccessRate / this.providers.length,
      avgLatency: totalLatency / this.providers.length
    };
  }
}

class ProviderSelector {
  constructor(
    private readonly providers: Provider[],
    private readonly options?: GetProvidersForModelOptions
  ) {}

  public select(): Provider[] {
    let filtered = this.filterProviders();
    const sorted = this.sortProviders(filtered);
    return this.limitResults(sorted);
  }

  private filterProviders(): Provider[] {
    if (this.options?.onlyHealthy) {
      return this.providers.filter(p => p.isHealthy());
    }
    return this.providers;
  }

  private sortProviders(providers: Provider[]): Provider[] {
    return providers.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      return b.successRate - a.successRate;
    });
  }

  private limitResults(providers: Provider[]): Provider[] {
    return this.options?.limit ? providers.slice(0, this.options.limit) : providers;
  }
}

class ValidationResult {
  private constructor(
    private readonly valid: boolean,
    public readonly error?: string
  ) {}

  public static success(): ValidationResult {
    return new ValidationResult(true);
  }

  public static failure(error: string): ValidationResult {
    return new ValidationResult(false, error);
  }

  public get isValid(): boolean {
    return this.valid;
  }
}

namespace ProviderOperationResult {
  export function success<T>(data: T): ProviderOperationResult<T> {
    return { success: true, data };
  }

  export function failure<T>(error: string): ProviderOperationResult<T> {
    return { success: false, error };
  }
}