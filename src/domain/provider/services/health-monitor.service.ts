import {
  Provider,
  SubProvider,
  type HealthStatus,
  type CircuitBreakerState
} from '../entities';
import type { IProviderRepository, ISubProviderRepository } from '../repositories';
import type { ILogger } from '../../../core/logging';

export interface HealthCheckResult {
  readonly providerId: string;
  readonly subProviderId?: string;
  readonly isHealthy: boolean;
  readonly healthScore: number;
  readonly latency: number;
  readonly consecutiveErrors: number;
  readonly circuitBreakerState?: CircuitBreakerState;
  readonly timestamp: number;
}

export interface HealthStats {
  readonly totalProviders: number;
  readonly healthyProviders: number;
  readonly degradedProviders: number;
  readonly unhealthyProviders: number;
  readonly totalSubProviders: number;
  readonly healthySubProviders: number;
  readonly availableSubProviders: number;
  readonly openCircuitBreakers: number;
  readonly avgHealthScore: number;
}

export interface HealthMonitorConfig {
  readonly healthCheckInterval?: number;
  readonly circuitBreakerTimeout?: number;
  readonly autoRecoveryEnabled?: boolean;
}

export interface HealthOperationResult {
  readonly success: boolean;
  readonly error?: string;
}

export class HealthMonitorService {
  static readonly DEFAULT_CONFIG = {
    HEALTH_CHECK_INTERVAL: 10000,
    CIRCUIT_BREAKER_TIMEOUT: 60000,
    AUTO_RECOVERY_ENABLED: true,
    PROVIDER_RECOVERY_MULTIPLIER: 2
  } as const;

  private monitoringInterval?: NodeJS.Timeout;
  private readonly config: Required<HealthMonitorConfig>;

  constructor(
    private readonly providerRepository: IProviderRepository,
    private readonly subProviderRepository: ISubProviderRepository,
    private readonly logger: ILogger,
    config: HealthMonitorConfig = {}
  ) {
    this.config = {
      healthCheckInterval: config.healthCheckInterval ?? HealthMonitorService.DEFAULT_CONFIG.HEALTH_CHECK_INTERVAL,
      circuitBreakerTimeout: config.circuitBreakerTimeout ?? HealthMonitorService.DEFAULT_CONFIG.CIRCUIT_BREAKER_TIMEOUT,
      autoRecoveryEnabled: config.autoRecoveryEnabled ?? HealthMonitorService.DEFAULT_CONFIG.AUTO_RECOVERY_ENABLED
    };
  }

  public startMonitoring(): void {
    this.stopMonitoring();

    this.monitoringInterval = setInterval(
      () => this.executeMonitoringCycle(),
      this.config.healthCheckInterval
    );

    this.logMonitoringStart();
  }

  public stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
      this.logger.info('Health monitoring stopped');
    }
  }

  public async performHealthChecks(): Promise<HealthCheckResult[]> {
    try {
      const providers = await this.providerRepository.findMany();
      const healthChecker = new HealthChecker(this.subProviderRepository);
      const results = await healthChecker.checkAllProviders(providers);

      this.logHealthCheckCompletion(results);
      return results;

    } catch (error) {
      this.logger.error('Failed to perform health checks', error as Error);
      return [];
    }
  }

  public async getHealthStats(): Promise<HealthStats> {
    const providers = await this.providerRepository.findMany();
    const allSubProviders = await this.subProviderRepository.findMany();

    const statsCalculator = new HealthStatsCalculator(providers, allSubProviders);
    return statsCalculator.calculate();
  }

  public async updateProviderHealth(providerId: string, status: HealthStatus): Promise<HealthOperationResult> {
    try {
      const provider = await this.providerRepository.findById(providerId);
      if (!provider) {
        return HealthOperationResult.failure(`Provider ${providerId} not found`);
      }

      const previousStatus = provider.healthStatus;
      provider.updateHealthStatus(status);
      await this.providerRepository.save(provider);

      this.logProviderHealthUpdate(providerId, status, previousStatus);
      return HealthOperationResult.success();

    } catch (error) {
      this.logger.error('Failed to update provider health', error as Error, {
        metadata: { providerId, status }
      });
      return HealthOperationResult.failure('Failed to update provider health');
    }
  }

  public async forceCircuitBreakerOpen(subProviderId: string): Promise<HealthOperationResult> {
    try {
      const subProvider = await this.subProviderRepository.findById(subProviderId);
      if (!subProvider) {
        return HealthOperationResult.failure(`Sub-provider ${subProviderId} not found`);
      }

      subProvider.openCircuitBreaker();
      await this.subProviderRepository.save(subProvider);

      this.logger.warn('Circuit breaker manually opened', {
        metadata: { subProviderId }
      });

      return HealthOperationResult.success();

    } catch (error) {
      this.logger.error('Failed to open circuit breaker', error as Error, {
        metadata: { subProviderId }
      });
      return HealthOperationResult.failure('Failed to open circuit breaker');
    }
  }

  private async executeMonitoringCycle(): Promise<void> {
    try {
      await this.performHealthChecks();
      
      if (this.config.autoRecoveryEnabled) {
        const recoveryManager = new AutoRecoveryManager(
          this.subProviderRepository,
          this.providerRepository,
          this.config.circuitBreakerTimeout,
          this.logger
        );
        await recoveryManager.attemptRecovery();
      }

    } catch (error) {
      this.logger.error('Health monitoring cycle failed', error as Error);
    }
  }

  private logMonitoringStart(): void {
    this.logger.info('Health monitoring started', {
      metadata: {
        interval: this.config.healthCheckInterval,
        autoRecovery: this.config.autoRecoveryEnabled
      }
    });
  }

  private logHealthCheckCompletion(results: HealthCheckResult[]): void {
    this.logger.debug('Health checks completed', {
      metadata: {
        totalChecks: results.length,
        healthyChecks: results.filter(r => r.isHealthy).length
      }
    });
  }

  private logProviderHealthUpdate(providerId: string, newStatus: HealthStatus, previousStatus: HealthStatus): void {
    this.logger.info('Provider health status updated', {
      metadata: {
        providerId,
        newStatus,
        previousStatus
      }
    });
  }
}

class HealthChecker {
  constructor(private readonly subProviderRepository: ISubProviderRepository) {}

  public async checkAllProviders(providers: Provider[]): Promise<HealthCheckResult[]> {
    const results: HealthCheckResult[] = [];

    for (const provider of providers) {
      const providerResult = this.checkProviderHealth(provider);
      results.push(providerResult);

      if (provider.needsSubProviders) {
        const subProviderResults = await this.checkSubProviders(provider.id);
        results.push(...subProviderResults);
      }
    }

    return results;
  }

  private checkProviderHealth(provider: Provider): HealthCheckResult {
    const metrics = provider.getMetrics();
    
    return HealthCheckResult.create({
      providerId: provider.id,
      isHealthy: provider.isHealthy(),
      healthScore: metrics.successRate,
      latency: metrics.avgLatency,
      consecutiveErrors: provider.consecutiveErrors,
      timestamp: Date.now()
    });
  }

  private async checkSubProviders(providerId: string): Promise<HealthCheckResult[]> {
    const subProviders = await this.subProviderRepository.findByProvider(providerId);
    
    return subProviders.map(subProvider => 
      HealthCheckResult.create({
        providerId: subProvider.providerId,
        subProviderId: subProvider.id,
        isHealthy: subProvider.isHealthy(),
        healthScore: subProvider.healthScore,
        latency: subProvider.avgLatency,
        consecutiveErrors: subProvider.consecutiveErrors,
        circuitBreakerState: subProvider.circuitBreakerState,
        timestamp: Date.now()
      })
    );
  }
}

class HealthStatsCalculator {
  constructor(
    private readonly providers: Provider[],
    private readonly subProviders: SubProvider[]
  ) {}

  public calculate(): HealthStats {
    const providerStats = this.calculateProviderStats();
    const subProviderStats = this.calculateSubProviderStats();

    return {
      totalProviders: this.providers.length,
      ...providerStats,
      totalSubProviders: this.subProviders.length,
      ...subProviderStats,
      avgHealthScore: this.calculateAverageHealthScore()
    };
  }

  private calculateProviderStats() {
    return {
      healthyProviders: this.providers.filter(p => p.isHealthy()).length,
      degradedProviders: this.providers.filter(p => p.isDegraded()).length,
      unhealthyProviders: this.providers.filter(p => p.isUnhealthy()).length
    };
  }

  private calculateSubProviderStats() {
    return {
      healthySubProviders: this.subProviders.filter(sp => sp.isHealthy()).length,
      availableSubProviders: this.subProviders.filter(sp => sp.isAvailable()).length,
      openCircuitBreakers: this.subProviders.filter(sp => sp.isCircuitBreakerOpen()).length
    };
  }

  private calculateAverageHealthScore(): number {
    if (this.subProviders.length === 0) return 0;
    
    const totalScore = this.subProviders.reduce((sum, sp) => sum + sp.healthScore, 0);
    return totalScore / this.subProviders.length;
  }
}

class AutoRecoveryManager {
  constructor(
    private readonly subProviderRepository: ISubProviderRepository,
    private readonly providerRepository: IProviderRepository,
    private readonly circuitBreakerTimeout: number,
    private readonly logger: ILogger
  ) {}

  public async attemptRecovery(): Promise<void> {
    await this.attemptCircuitBreakerRecovery();
    await this.attemptProviderRecovery();
  }

  private async attemptCircuitBreakerRecovery(): Promise<void> {
    const allSubProviders = await this.subProviderRepository.findMany();
    const openCircuitBreakers = allSubProviders.filter(sp => sp.isCircuitBreakerOpen());

    for (const subProvider of openCircuitBreakers) {
      const timeSinceOpen = Date.now() - (subProvider.getMetrics().lastErrorAt || 0);
      
      if (timeSinceOpen > this.circuitBreakerTimeout) {
        await this.transitionToHalfOpen(subProvider, timeSinceOpen);
      }
    }
  }

  private async attemptProviderRecovery(): Promise<void> {
    const unhealthyProviders = await this.providerRepository.findMany({
      filters: { healthStatus: 'unhealthy' }
    });

    for (const provider of unhealthyProviders) {
      await this.attemptProviderAutoRecovery(provider);
    }
  }

  private async transitionToHalfOpen(subProvider: SubProvider, timeSinceOpen: number): Promise<void> {
    subProvider.halfOpenCircuitBreaker();
    await this.subProviderRepository.save(subProvider);
    
    this.logger.info('Circuit breaker moved to half-open state', {
      metadata: {
        subProviderId: subProvider.id,
        timeSinceOpen
      }
    });
  }

  private async attemptProviderAutoRecovery(provider: Provider): Promise<void> {
    if (provider.healthStatus !== 'unhealthy') return;

    const metrics = provider.getMetrics();
    const timeSinceLastError = Date.now() - (metrics.lastErrorAt || 0);
    const recoveryThreshold = this.circuitBreakerTimeout * HealthMonitorService.DEFAULT_CONFIG.PROVIDER_RECOVERY_MULTIPLIER;
    
    if (timeSinceLastError > recoveryThreshold && provider.consecutiveErrors > 0) {
      const canRecover = await this.canProviderRecover(provider);
      
      if (canRecover) {
        provider.updateHealthStatus('degraded');
        await this.providerRepository.save(provider);
        
        this.logProviderRecoveryAttempt(provider, timeSinceLastError);
      }
    }
  }

  private async canProviderRecover(provider: Provider): Promise<boolean> {
    if (!provider.needsSubProviders) return true;
    
    const subProviders = await this.subProviderRepository.findByProvider(provider.id);
    const healthySubProviders = subProviders.filter(sp => sp.isHealthy());
    
    return healthySubProviders.length > 0;
  }

  private logProviderRecoveryAttempt(provider: Provider, timeSinceLastError: number): void {
    this.logger.info('Provider auto-recovery attempted', {
      metadata: {
        providerId: provider.id,
        timeSinceLastError
      }
    });
  }
}

namespace HealthCheckResult {
  export function create(params: {
    providerId: string;
    subProviderId?: string;
    isHealthy: boolean;
    healthScore: number;
    latency: number;
    consecutiveErrors: number;
    circuitBreakerState?: CircuitBreakerState;
    timestamp: number;
  }): HealthCheckResult {
    return {
      providerId: params.providerId,
      subProviderId: params.subProviderId,
      isHealthy: params.isHealthy,
      healthScore: params.healthScore,
      latency: params.latency,
      consecutiveErrors: params.consecutiveErrors,
      circuitBreakerState: params.circuitBreakerState,
      timestamp: params.timestamp
    };
  }
}

namespace HealthOperationResult {
  export function success(): HealthOperationResult {
    return { success: true };
  }

  export function failure(error: string): HealthOperationResult {
    return { success: false, error };
  }
}