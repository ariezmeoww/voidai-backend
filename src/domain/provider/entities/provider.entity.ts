import { ErrorType } from './common';

export interface ProviderDocument {
  id: string;
  created_at: number;
  updated_at: number;
  name: string;
  needs_sub_providers: boolean;
  total_token_usage: bigint;
  avg_latency: number;
  error_count: number;
  success_count: number;
  is_active: boolean;
  last_used_at: number;
  last_error_at: number;
  priority: number;
  base_url: string;
  timeout: number;
  supported_models: string[];
  rate_limits: ProviderRateLimit;
  throughput: ProviderThroughput;
  features: string[];
  consecutive_errors: number;
  timeout_count: number;
  health_status: HealthStatus;
  uptime: number;
  performance: ProviderPerformance;
  capacity: ProviderCapacity;
}

export interface ProviderRateLimit {
  requests_per_minute: number;
  requests_per_hour: number;
  tokens_per_minute: number;
}

export interface ProviderThroughput {
  requests_per_second: number;
  tokens_per_second: number;
  peak_requests_per_second: number;
  peak_tokens_per_second: number;
}

export interface ProviderPerformance {
  min_latency: number;
  max_latency: number;
  p50_latency: number;
  p95_latency: number;
  p99_latency: number;
  latency_history: Array<{ timestamp: number; latency: number }>;
  last_percentile_calculation: number;
}

export interface ProviderCapacity {
  max_concurrent_requests: number;
  current_concurrent_requests: number;
  queue_length: number;
  utilization_percent: number;
}

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export class Provider {
  private static readonly LATENCY_HISTORY_MAX_AGE = 10 * 60 * 1000;
  private static readonly LATENCY_HISTORY_MAX_ENTRIES = 1000;
  private static readonly PERCENTILE_CALCULATION_INTERVAL = 5000;
  private static readonly THROUGHPUT_WINDOW_SIZE = 1000;


  constructor(private options: ProviderDocument) {}

  get id(): string {
    return this.options.id;
  }

  get name(): string {
    return this.options.name;
  }

  get isActive(): boolean {
    return this.options.is_active;
  }

  get needsSubProviders(): boolean {
    return this.options.needs_sub_providers;
  }

  get priority(): number {
    return this.options.priority || 0;
  }

  get supportedModels(): readonly string[] {
    return [...(this.options.supported_models || [])];
  }

  get successRate(): number {
    const total = this.options.success_count + this.options.error_count;
    return total > 0 ? this.options.success_count / total : 0;
  }

  get avgLatency(): number {
    return this.options.avg_latency;
  }

  get totalTokenUsage(): bigint {
    return this.options.total_token_usage;
  }

  get healthStatus(): HealthStatus {
    return this.options.health_status || 'healthy';
  }

  get consecutiveErrors(): number {
    return this.options.consecutive_errors || 0;
  }

  get createdAt(): number {
    return this.options.created_at;
  }

  get updatedAt(): number {
    return this.options.updated_at;
  }

  get lastUsedAt(): number {
    return this.options.last_used_at;
  }

  get lastErrorAt(): number | undefined {
    return this.options.last_error_at;
  }

  get errorCount(): number {
    return this.options.error_count;
  }

  get successCount(): number {
    return this.options.success_count;
  }

  isHealthy(): boolean {
    return this.options.health_status === 'healthy';
  }

  isDegraded(): boolean {
    return this.options.health_status === 'degraded';
  }

  isUnhealthy(): boolean {
    return this.options.health_status === 'unhealthy';
  }

  supportsModel(model: string): boolean {
    return (this.options.supported_models || []).includes(model);
  }

  supportsFeature(feature: string): boolean {
    return (this.options.features || []).includes(feature);
  }

  canHandleLoad(): boolean {
    const utilizationThreshold = 90;
    return this.options.capacity.utilization_percent < utilizationThreshold && this.isHealthy();
  }

  recordSuccess(latency: number, tokensUsed: number): void {
    this.updateTokenMetrics(tokensUsed);
    this.updateLatencyMetrics(latency);
    this.updatePerformanceMetrics(latency);
    this.updateThroughputMetrics(tokensUsed);
    this.resetConsecutiveErrors();
    this.updateHealthBasedOnMetrics();
    this.updateLastUsedTimestamp();
    this.options.updated_at = Date.now();
  }

  recordError(errorType: ErrorType): void {
    this.incrementConsecutiveErrors();
    
    if (errorType === 'timeout') {
      this.options.timeout_count = (this.options.timeout_count || 0) + 1;
    }
    
    this.updateHealthBasedOnMetrics();
    this.updateLastUsedTimestamp();
    this.options.last_error_at = Date.now();
    this.options.updated_at = Date.now();
  }

  recordTimeout(latency: number): void {
    this.recordError('timeout');
    this.updateLatencyMetrics(latency);
  }

  updateHealthStatus(status: HealthStatus): void {
    this.options.health_status = status;
    this.options.updated_at = Date.now();
  }

  incrementConcurrentRequests(): boolean {
    if (this.options.capacity.current_concurrent_requests >= this.options.capacity.max_concurrent_requests) {
      return false;
    }
    
    this.options.capacity.current_concurrent_requests++;
    this.updateCapacityMetrics();
    return true;
  }

  decrementConcurrentRequests(): void {
    this.options.capacity.current_concurrent_requests = Math.max(0, this.options.capacity.current_concurrent_requests - 1);
    this.updateCapacityMetrics();
  }

  activate(): void {
    this.options.is_active = true;
    this.options.updated_at = Date.now();
  }

  deactivate(): void {
    this.options.is_active = false;
    this.options.updated_at = Date.now();
  }

  updateName(newName: string): void {
    this.options.name = newName;
    this.options.updated_at = Date.now();
  }

  addSupportedModel(model: string): void {
    if (!this.options.supported_models) {
      this.options.supported_models = [];
    }
    if (!this.options.supported_models.includes(model)) {
      this.options.supported_models.push(model);
      this.options.updated_at = Date.now();
    }
  }

  removeSupportedModel(model: string): void {
    if (this.options.supported_models) {
      this.options.supported_models = this.options.supported_models.filter(m => m !== model);
      this.options.updated_at = Date.now();
    }
  }

  updateNeedsSubProviders(needsSubProviders: boolean): void {
    this.options.needs_sub_providers = needsSubProviders;
    this.options.updated_at = Date.now();
  }

  updatePriority(priority: number): void {
    this.options.priority = priority;
    this.options.updated_at = Date.now();
  }

  updateBaseUrl(baseUrl: string): void {
    this.options.base_url = baseUrl;
    this.options.updated_at = Date.now();
  }

  updateTimeout(timeout: number): void {
    this.options.timeout = timeout;
    this.options.updated_at = Date.now();
  }

  updateRateLimits(rateLimits: { requestsPerMinute: number; requestsPerHour: number; tokensPerMinute: number }): void {
    this.options.rate_limits = {
      requests_per_minute: rateLimits.requestsPerMinute,
      requests_per_hour: rateLimits.requestsPerHour,
      tokens_per_minute: rateLimits.tokensPerMinute
    };
    this.options.updated_at = Date.now();
  }

  updateFeatures(features: string[]): void {
    this.options.features = [...features];
    this.options.updated_at = Date.now();
  }

  getMetrics() {
    return {
      totalTokenUsage: Number(this.options.total_token_usage),
      totalRequests: this.options.success_count + this.options.error_count,
      successCount: this.options.success_count,
      errorCount: this.options.error_count,
      consecutiveErrors: this.options.consecutive_errors || 0,
      timeoutCount: this.options.timeout_count || 0,
      avgLatency: this.options.avg_latency,
      successRate: this.successRate,
      healthStatus: this.options.health_status,
      uptime: this.options.uptime || 0,
      lastUsedAt: this.options.last_used_at,
      lastErrorAt: this.options.last_error_at,
      throughput: { ...this.options.throughput },
      performance: { ...this.options.performance },
      capacity: { ...this.options.capacity }
    };
  }

  toDocument(): ProviderDocument {
    return {
      ...this.options,
      throughput: this.options.throughput
    };
  }

  private updateTokenMetrics(tokensUsed: number): void {
    this.options.total_token_usage += BigInt(tokensUsed);
  }

  private updateLatencyMetrics(latency: number): void {
    const total = this.options.success_count + this.options.error_count;
    if (total === 1 || this.options.avg_latency === 0 || !isFinite(this.options.avg_latency)) {
      this.options.avg_latency = latency;
    } else {
      this.options.avg_latency = ((this.options.avg_latency * (total - 1)) + latency) / total;
    }
  }

  private updatePerformanceMetrics(latency: number): void {
    const now = Date.now();
    
    this.options.performance.latency_history.push({ timestamp: now, latency });
    this.cleanupOldLatencyHistory(now);
    
    this.options.performance.min_latency = Math.min(this.options.performance.min_latency || Infinity, latency);
    this.options.performance.max_latency = Math.max(this.options.performance.max_latency, latency);
    
    if (now - this.options.performance.last_percentile_calculation > Provider.PERCENTILE_CALCULATION_INTERVAL) {
      this.calculateLatencyPercentiles();
      this.options.performance.last_percentile_calculation = now;
    }
  }

  private cleanupOldLatencyHistory(now: number): void {
    this.options.performance.latency_history = this.options.performance.latency_history
      .filter(entry => now - entry.timestamp <= Provider.LATENCY_HISTORY_MAX_AGE)
      .slice(-Provider.LATENCY_HISTORY_MAX_ENTRIES);
  }

  private calculateLatencyPercentiles(): void {
    const latencies = this.options.performance.latency_history
      .map(entry => entry.latency)
      .sort((a, b) => a - b);
    
    if (latencies.length === 0) return;
    
    this.options.performance.p50_latency = this.calculatePercentile(latencies, 0.50);
    this.options.performance.p95_latency = this.calculatePercentile(latencies, 0.95);
    this.options.performance.p99_latency = this.calculatePercentile(latencies, 0.99);
  }

  private calculatePercentile(sortedArray: number[], percentile: number): number {
    if (sortedArray.length === 0) return 0;
    if (sortedArray.length === 1) return sortedArray[0];
    
    const index = (sortedArray.length - 1) * percentile;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    
    if (lower === upper) return sortedArray[lower];
    
    const weight = index - lower;
    return sortedArray[lower] * (1 - weight) + sortedArray[upper] * weight;
  }

  private updateThroughputMetrics(tokensUsed: number): void {
    if (!this.options.throughput) {
      this.options.throughput = {
        requests_per_second: 0,
        tokens_per_second: 0,
        peak_requests_per_second: 0,
        peak_tokens_per_second: 0
      };
    }
    
    const now = Date.now();
    const windowSize = Provider.THROUGHPUT_WINDOW_SIZE;
    
    this.options.throughput.requests_per_second = this.calculateRPS(now, windowSize);
    this.options.throughput.tokens_per_second = this.calculateTPS(tokensUsed, windowSize);
    
    this.options.throughput.peak_requests_per_second = Math.max(
      this.options.throughput.peak_requests_per_second,
      this.options.throughput.requests_per_second
    );
    
    this.options.throughput.peak_tokens_per_second = Math.max(
      this.options.throughput.peak_tokens_per_second,
      this.options.throughput.tokens_per_second
    );
  }

  private calculateRPS(now: number, windowSize: number): number {
    const timeDiff = now - (this.options.last_used_at - windowSize);
    return timeDiff > 0 ? (this.options.success_count + this.options.error_count) / (timeDiff / 1000) : 0;
  }

  private calculateTPS(tokensUsed: number, windowSize: number): number {
    return tokensUsed / (windowSize / 1000);
  }

  private updateCapacityMetrics(): void {
    const utilization = this.options.capacity.max_concurrent_requests > 0 
      ? (this.options.capacity.current_concurrent_requests / this.options.capacity.max_concurrent_requests) * 100
      : 0;
    
    this.options.capacity.utilization_percent = Math.min(100, utilization);
  }

  private resetConsecutiveErrors(): void {
    this.options.consecutive_errors = 0;
    this.options.success_count++;
  }

  private incrementConsecutiveErrors(): void {
    this.options.consecutive_errors = (this.options.consecutive_errors || 0) + 1;
    this.options.error_count++;
  }

  private updateHealthBasedOnMetrics(): void {
    const consecutiveErrors = this.options.consecutive_errors || 0;
    const successRate = this.successRate;
    const totalRequests = this.options.success_count + this.options.error_count;
    
    if (consecutiveErrors >= 10 || (totalRequests >= 10 && successRate < 0.3)) {
      this.options.health_status = 'unhealthy';
    } else if (consecutiveErrors >= 5 || (totalRequests >= 5 && successRate < 0.6)) {
      this.options.health_status = 'degraded';
    } else {
      this.options.health_status = 'healthy';
    }
  }

  private updateLastUsedTimestamp(): void {
    this.options.last_used_at = Date.now();
  }
}