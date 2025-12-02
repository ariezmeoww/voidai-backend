import { SubProvider, type ErrorType, type SubProviderLimits } from '../entities';
import type { ISubProviderRepository, SubProviderQuery } from '../repositories';
import type { ILogger } from '../../../core/logging';
import type { ICryptoService } from '../../../core/security';
import { isCriticalError, DEFAULT_ERROR_THRESHOLDS } from '../../shared';

export interface CreateSubProviderRequest {
  readonly providerId: string;
  readonly name: string;
  readonly apiKey: string;
  readonly priority: number;
  readonly weight: number;
  readonly modelMapping?: Record<string, string>;
  readonly timeout: number;
  readonly customHeaders?: Record<string, string>;
  readonly metadata?: Record<string, any>;
  readonly limits: SubProviderLimits;
}

export interface UpdateSubProviderRequest {
  readonly priority?: number;
  readonly weight?: number;
  readonly modelMapping?: Record<string, string>;
  readonly timeout?: number;
  readonly customHeaders?: Record<string, string>;
  readonly metadata?: Record<string, any>;
  readonly enabled?: boolean;
}

export interface SubProviderStats {
  readonly totalSubProviders: number;
  readonly enabledSubProviders: number;
  readonly healthySubProviders: number;
  readonly availableSubProviders: number;
  readonly openCircuitBreakers: number;
  readonly totalRequests: number;
  readonly totalTokenUsage: number;
  readonly avgHealthScore: number;
  readonly avgLatency: number;
}

export interface LoadBalancingOptions {
  readonly strategy: 'round_robin' | 'weighted' | 'health_based' | 'least_loaded';
  readonly maxConcurrentRequests?: number;
  readonly preferHealthy?: boolean;
}

export interface SubProviderOperationResult<T = SubProvider> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
}

export class SubProviderService {
  static readonly DEFAULT_CONFIG = {
    INITIAL_HEALTH_SCORE: 1.0,
    INITIAL_COUNTS: 0,
    CIRCUIT_BREAKER_CLOSED: 'closed'
  } as const;

  constructor(
    private readonly subProviderRepository: ISubProviderRepository,
    private readonly logger: ILogger,
    private readonly cryptoService: ICryptoService
  ) {}

  public async createSubProvider(request: CreateSubProviderRequest): Promise<SubProviderOperationResult> {
    const validation = this.validateCreateRequest(request);
    if (!validation.isValid) {
      return SubProviderOperationResult.failure(validation.error!);
    }

    const encryptedApiKey = await this.encryptApiKey(request.apiKey);
    const subProviderData = this.buildSubProviderData(request, encryptedApiKey);
    const subProvider = new SubProvider(subProviderData);

    const savedSubProvider = await this.subProviderRepository.save(subProvider);
    this.logSubProviderCreation(savedSubProvider);

    return SubProviderOperationResult.success(savedSubProvider);
  }

  public async getSubProviderById(id: string): Promise<SubProvider | null> {
    this.validateRequiredString(id, 'Sub-provider ID');
    return this.subProviderRepository.findById(id);
  }

  public async getSubProvidersByProvider(providerId: string): Promise<SubProvider[]> {
    this.validateRequiredString(providerId, 'Provider ID');
    return this.subProviderRepository.findByProvider(providerId);
  }

  public async getSubProviders(query?: SubProviderQuery): Promise<SubProvider[]> {
    return this.subProviderRepository.findMany(query);
  }

  public async getAvailableSubProviders(model?: string): Promise<SubProvider[]> {
    return this.subProviderRepository.findAvailable(model);
  }

  public async getHealthySubProviders(): Promise<SubProvider[]> {
    return this.subProviderRepository.findHealthy();
  }

  public async selectForRequest(
    model: string,
    estimatedTokens: number = 0,
    options: LoadBalancingOptions = { strategy: 'health_based' }
  ): Promise<SubProvider | null> {
    const availableSubProviders = await this.getAvailableSubProviders(model);
    if (availableSubProviders.length === 0) return null;

    const selector = new SubProviderSelector(availableSubProviders, estimatedTokens, options);
    return selector.select();
  }

  public async reserveSubProviderCapacity(id: string, estimatedTokens: number = 0): Promise<boolean> {
    const subProvider = await this.subProviderRepository.findById(id);
    if (!subProvider) return false;

    const reserved = subProvider.reserveCapacity(estimatedTokens);
    if (reserved) {
      await this.subProviderRepository.save(subProvider);
    }

    return reserved;
  }

  public async releaseSubProviderCapacity(id: string): Promise<void> {
    this.logger.debug('Attempting to release sub-provider capacity', {
      metadata: { subProviderId: id }
    });

    const subProvider = await this.subProviderRepository.findById(id);
    if (!subProvider) {
      this.logger.warn('Sub-provider not found when releasing capacity', {
        metadata: { subProviderId: id }
      });
      return;
    }

    const beforeCount = subProvider.getLimits().currentConcurrentRequests;
    subProvider.releaseCapacity();
    const afterCount = subProvider.getLimits().currentConcurrentRequests;
    
    this.logger.debug('Released sub-provider capacity', {
      metadata: {
        subProviderId: id,
        beforeCount,
        afterCount,
        released: beforeCount - afterCount
      }
    });

    await this.subProviderRepository.save(subProvider);
  }

  public async recordSubProviderSuccess(id: string, latency: number, tokensUsed: number): Promise<void> {
    const subProvider = await this.subProviderRepository.findById(id);
    if (!subProvider) {
      this.logSubProviderNotFound('record success', id);
      return;
    }

    subProvider.recordSuccess(latency, tokensUsed);
    await this.subProviderRepository.save(subProvider);
  }

  public async recordSubProviderError(
    id: string,
    errorType: ErrorType,
    latency?: number,
    errorMessage?: string
  ): Promise<void> {
    const subProvider = await this.subProviderRepository.findById(id);
    if (!subProvider) {
      this.logSubProviderNotFound('record error', id);
      return;
    }

    subProvider.recordError(errorType, latency);

    if (errorMessage && isCriticalError(errorMessage)) {
      await this.handleCriticalError(subProvider, errorMessage, errorType);
    }

    await this.subProviderRepository.save(subProvider);
  }

  public async updateSubProvider(id: string, request: UpdateSubProviderRequest): Promise<SubProviderOperationResult> {
    const subProvider = await this.subProviderRepository.findById(id);
    if (!subProvider) {
      return SubProviderOperationResult.failure('Sub-provider not found');
    }

    const updater = new SubProviderUpdater(subProvider);
    updater.applyUpdates(request);

    const savedSubProvider = await this.subProviderRepository.save(subProvider);
    return SubProviderOperationResult.success(savedSubProvider);
  }

  public async enableSubProvider(id: string): Promise<boolean> {
    return this.toggleSubProviderStatus(id, true, 'enabled');
  }

  public async disableSubProvider(id: string): Promise<boolean> {
    return this.toggleSubProviderStatus(id, false, 'disabled');
  }

  public async resetCircuitBreaker(id: string): Promise<boolean> {
    const subProvider = await this.subProviderRepository.findById(id);
    if (!subProvider) return false;

    subProvider.closeCircuitBreaker();
    await this.subProviderRepository.save(subProvider);

    this.logger.info('Circuit breaker reset', { metadata: { subProviderId: id } });
    return true;
  }

  public async deleteSubProvider(id: string): Promise<boolean> {
    const exists = await this.subProviderRepository.exists(id);
    if (!exists) return false;

    const success = await this.subProviderRepository.delete(id);
    if (success) {
      this.logger.info('Sub-provider deleted successfully', {
        metadata: { subProviderId: id }
      });
    }

    return success;
  }

  public async getSubProviderStats(providerId?: string): Promise<SubProviderStats> {
    const query: SubProviderQuery | undefined = providerId 
      ? { filters: { providerId } } 
      : undefined;

    const allSubProviders = await this.subProviderRepository.findMany(query);
    const statsCalculator = new SubProviderStatsCalculator(allSubProviders);
    return statsCalculator.calculate();
  }

  public async disableSubProviderForCriticalError(
    id: string,
    errorMessage: string,
    errorType: ErrorType
  ): Promise<boolean> {
    const subProvider = await this.subProviderRepository.findById(id);
    if (!subProvider) return false;

    await this.handleCriticalError(subProvider, errorMessage, errorType);
    await this.subProviderRepository.save(subProvider);

    return !subProvider.isEnabled;
  }

  private async encryptApiKey(apiKey: string): Promise<EncryptedApiKey> {
    const masterKey = crypto.randomUUID();
    const encryptedApiKey = this.cryptoService.encrypt(apiKey, masterKey);
    const [iv, authTag, encrypted] = encryptedApiKey.split(':');

    return { encrypted, iv, authTag, masterKey };
  }

  private buildSubProviderData(request: CreateSubProviderRequest, encryptedApiKey: EncryptedApiKey): any {
    const now = Date.now();

    return {
      id: crypto.randomUUID(),
      created_at: now,
      updated_at: now,
      provider_id: request.providerId,
      name: request.name,
      api_key: {
        encrypted: encryptedApiKey.encrypted,
        iv: encryptedApiKey.iv,
        auth_tag: encryptedApiKey.authTag,
        master_key: encryptedApiKey.masterKey
      },
      enabled: true,
      total_token_usage: 0n,
      model_mapping: request.modelMapping ?? {},
      last_used_at: now,
      consecutive_errors: SubProviderService.DEFAULT_CONFIG.INITIAL_COUNTS,
      error_count: SubProviderService.DEFAULT_CONFIG.INITIAL_COUNTS,
      is_active: true,
      last_error_at: SubProviderService.DEFAULT_CONFIG.INITIAL_COUNTS,
      last_error_type: '',
      priority: request.priority,
      weight: request.weight,
      timeout: request.timeout,
      custom_headers: request.customHeaders ?? {},
      metadata: request.metadata ?? {},
      avg_latency: SubProviderService.DEFAULT_CONFIG.INITIAL_COUNTS,
      health_score: SubProviderService.DEFAULT_CONFIG.INITIAL_HEALTH_SCORE,
      circuit_breaker_state: SubProviderService.DEFAULT_CONFIG.CIRCUIT_BREAKER_CLOSED,
      last_circuit_breaker_trigger: SubProviderService.DEFAULT_CONFIG.INITIAL_COUNTS,
      success_count: SubProviderService.DEFAULT_CONFIG.INITIAL_COUNTS,
      max_requests_per_minute: request.limits.max_requests_per_minute,
      max_requests_per_hour: request.limits.max_requests_per_hour,
      max_tokens_per_minute: request.limits.max_tokens_per_minute,
      max_concurrent_requests: request.limits.max_concurrent_requests,
      limits: {
        max_requests_per_minute: request.limits.max_requests_per_minute,
        max_requests_per_hour: request.limits.max_requests_per_hour,
        max_tokens_per_minute: request.limits.max_tokens_per_minute,
        max_concurrent_requests: request.limits.max_concurrent_requests,
        current_request_count: SubProviderService.DEFAULT_CONFIG.INITIAL_COUNTS,
        current_token_count: SubProviderService.DEFAULT_CONFIG.INITIAL_COUNTS,
        current_concurrent_requests: SubProviderService.DEFAULT_CONFIG.INITIAL_COUNTS,
        request_window: [],
        token_window: [],
        last_window_reset: now
      }
    };
  }

  private validateCreateRequest(request: CreateSubProviderRequest): ValidationResult {
    const requiredStringFields = [
      { value: request.providerId, name: 'Provider ID' },
      { value: request.name, name: 'Sub-provider name' },
      { value: request.apiKey, name: 'API key' }
    ];

    for (const field of requiredStringFields) {
      if (!field.value?.trim()) {
        return ValidationResult.failure(`${field.name} is required`);
      }
    }

    if (request.timeout <= 0) {
      return ValidationResult.failure('Timeout must be positive');
    }

    if (request.weight <= 0) {
      return ValidationResult.failure('Weight must be positive');
    }

    return ValidationResult.success();
  }

  private validateRequiredString(value: string, fieldName: string): void {
    if (!value?.trim()) {
      throw new Error(`${fieldName} is required`);
    }
  }

  private async toggleSubProviderStatus(id: string, enabled: boolean, action: string): Promise<boolean> {
    const subProvider = await this.subProviderRepository.findById(id);
    if (!subProvider) return false;

    if (enabled) {
      subProvider.enable();
    } else {
      subProvider.disable();
    }

    await this.subProviderRepository.save(subProvider);
    this.logger.info(`Sub-provider ${action}`, { metadata: { subProviderId: id } });
    return true;
  }

  private async handleCriticalError(
    subProvider: SubProvider,
    errorMessage: string,
    errorType: ErrorType
  ): Promise<void> {
    const criticalErrorHandler = new CriticalErrorHandler(subProvider, this.logger);
    await criticalErrorHandler.handle(errorMessage, errorType);
  }

  private logSubProviderCreation(subProvider: SubProvider): void {
    this.logger.info('Sub-provider created successfully', {
      metadata: {
        subProviderId: subProvider.id,
        providerId: subProvider.providerId,
        name: subProvider.name
      }
    });
  }

  private logSubProviderNotFound(operation: string, id: string): void {
    this.logger.warn(`Attempted to ${operation} for non-existent sub-provider`, {
      metadata: { subProviderId: id }
    });
  }
}

class SubProviderSelector {
  constructor(
    private readonly subProviders: SubProvider[],
    private readonly estimatedTokens: number,
    private readonly options: LoadBalancingOptions
  ) {}

  public select(): SubProvider | null {
    const eligibleSubProviders = this.filterEligible();
    if (eligibleSubProviders.length === 0) return null;

    return this.selectByStrategy(eligibleSubProviders);
  }

  private filterEligible(): SubProvider[] {
    return this.subProviders.filter(sp => sp.canHandleRequest(this.estimatedTokens));
  }

  private selectByStrategy(subProviders: SubProvider[]): SubProvider {
    const strategyMap = {
      weighted: () => this.selectByWeight(subProviders),
      health_based: () => this.selectByHealth(subProviders),
      least_loaded: () => this.selectByLoad(subProviders),
      round_robin: () => this.selectRoundRobin(subProviders)
    };

    const strategy = strategyMap[this.options.strategy] || strategyMap.round_robin;
    return strategy();
  }

  private selectByWeight(subProviders: SubProvider[]): SubProvider {
    const totalWeight = subProviders.reduce((sum, sp) => sum + sp.weight, 0);
    const random = Math.random() * totalWeight;

    let currentWeight = 0;
    for (const subProvider of subProviders) {
      currentWeight += subProvider.weight;
      if (random <= currentWeight) {
        return subProvider;
      }
    }

    return subProviders[0];
  }

  private selectByHealth(subProviders: SubProvider[]): SubProvider {
    return subProviders.reduce((best, current) =>
      current.healthScore > best.healthScore ? current : best
    );
  }

  private selectByLoad(subProviders: SubProvider[]): SubProvider {
    return subProviders.reduce((least, current) => {
      const currentLoad = current.getLimits().currentConcurrentRequests;
      const leastLoad = least.getLimits().currentConcurrentRequests;
      return currentLoad < leastLoad ? current : least;
    });
  }

  private selectRoundRobin(subProviders: SubProvider[]): SubProvider {
    return subProviders[Math.floor(Math.random() * subProviders.length)];
  }
}

class SubProviderUpdater {
  constructor(private readonly subProvider: SubProvider) {}

  public applyUpdates(request: UpdateSubProviderRequest): void {
    if (request.enabled !== undefined) {
      this.updateEnabledStatus(request.enabled);
    }

    if (request.modelMapping) {
      this.subProvider.updateModelMapping(request.modelMapping);
    }
  }

  private updateEnabledStatus(enabled: boolean): void {
    if (enabled) {
      this.subProvider.enable();
    } else {
      this.subProvider.disable();
    }
  }
}

class SubProviderStatsCalculator {
  constructor(private readonly subProviders: SubProvider[]) {}

  public calculate(): SubProviderStats {
    const counts = this.calculateCounts();
    const totals = this.calculateTotals();
    const averages = this.calculateAverages();

    return {
      totalSubProviders: this.subProviders.length,
      ...counts,
      ...totals,
      ...averages
    };
  }

  private calculateCounts() {
    return {
      enabledSubProviders: this.subProviders.filter(sp => sp.isEnabled).length,
      healthySubProviders: this.subProviders.filter(sp => sp.isHealthy()).length,
      availableSubProviders: this.subProviders.filter(sp => sp.isAvailable()).length,
      openCircuitBreakers: this.subProviders.filter(sp => sp.isCircuitBreakerOpen()).length
    };
  }

  private calculateTotals() {
    return {
      totalRequests: this.subProviders.reduce((sum, sp) => sum + sp.getMetrics().totalRequests, 0),
      totalTokenUsage: Number(this.subProviders.reduce((sum, sp) => sum + Number(sp.getMetrics().totalTokenUsage), 0))
    };
  }

  private calculateAverages() {
    if (this.subProviders.length === 0) {
      return { avgHealthScore: 0, avgLatency: 0 };
    }

    const totalHealthScore = this.subProviders.reduce((sum, sp) => sum + sp.healthScore, 0);
    const totalLatency = this.subProviders.reduce((sum, sp) => sum + sp.avgLatency, 0);

    return {
      avgHealthScore: totalHealthScore / this.subProviders.length,
      avgLatency: totalLatency / this.subProviders.length
    };
  }
}

class CriticalErrorHandler {
  constructor(
    private readonly subProvider: SubProvider,
    private readonly logger: ILogger
  ) {}

  public async handle(errorMessage: string, errorType: ErrorType): Promise<void> {
    const shouldDisable = this.shouldDisableForCriticalError(errorMessage);

    if (shouldDisable) {
      this.disableSubProvider(errorMessage, errorType);
    } else {
      this.logCriticalErrorWarning(errorMessage, errorType);
    }
  }

  private shouldDisableForCriticalError(errorMessage: string): boolean {
    if (isCriticalError(errorMessage)) return true;

    const recentCriticalErrors = this.countRecentCriticalErrors();
    return recentCriticalErrors >= DEFAULT_ERROR_THRESHOLDS.maxConsecutiveErrors ||
           this.subProvider.consecutiveErrors >= DEFAULT_ERROR_THRESHOLDS.maxConsecutiveErrors;
  }

  private countRecentCriticalErrors(): number {
    const now = Date.now();
    const windowStart = now - (DEFAULT_ERROR_THRESHOLDS.errorWindowSeconds * 1000);

    if (!this.subProvider.lastErrorAt || this.subProvider.lastErrorAt < windowStart) {
      return 0;
    }

    return this.subProvider.consecutiveErrors;
  }

  private disableSubProvider(errorMessage: string, errorType: ErrorType): void {
    this.subProvider.disable();

    this.logger.error('Sub-provider disabled due to critical error', Error(errorMessage), {
      metadata: {
        subProviderId: this.subProvider.id,
        providerId: this.subProvider.providerId,
        name: this.subProvider.name,
        errorMessage,
        errorType,
        consecutiveErrors: this.subProvider.consecutiveErrors,
        healthScore: this.subProvider.healthScore
      }
    });
  }

  private logCriticalErrorWarning(errorMessage: string, errorType: ErrorType): void {
    this.logger.warn('Critical error detected but sub-provider not disabled yet', {
      metadata: {
        subProviderId: this.subProvider.id,
        providerId: this.subProvider.providerId,
        name: this.subProvider.name,
        errorMessage,
        errorType,
        consecutiveErrors: this.subProvider.consecutiveErrors,
        healthScore: this.subProvider.healthScore,
        threshold: DEFAULT_ERROR_THRESHOLDS.maxConsecutiveErrors
      }
    });
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

namespace SubProviderOperationResult {
  export function success<T>(data: T): SubProviderOperationResult<T> {
    return { success: true, data };
  }

  export function failure<T>(error: string): SubProviderOperationResult<T> {
    return { success: false, error };
  }
}

interface EncryptedApiKey {
  readonly encrypted: string;
  readonly iv: string;
  readonly authTag: string;
  readonly masterKey: string;
}