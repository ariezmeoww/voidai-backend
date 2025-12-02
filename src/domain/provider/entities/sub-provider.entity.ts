import type { ErrorType } from './common';
import type { ICryptoService } from '../../../core/security';

export interface ApiKeyConfig {
  encrypted: string;
  iv: string;
  master_key: string;
  auth_tag?: string;
}

export interface SubProviderDocument {
  id: string;
  created_at: number;
  updated_at: number;
  provider_id: string;
  name: string;
  api_key: ApiKeyConfig;
  enabled: boolean;
  total_token_usage: bigint;
  model_mapping: Record<string, string>;
  last_used_at: number;
  consecutive_errors: number;
  error_count: number;
  is_active: boolean;
  last_error_at: number;
  last_error_type: string;
  priority: number;
  weight: number;
  timeout: number;
  custom_headers: Record<string, string>;
  metadata: Record<string, any>;
  avg_latency: number;
  health_score: number;
  circuit_breaker_state: 'closed' | 'open' | 'half-open';
  last_circuit_breaker_trigger: number;
  success_count: number;
  max_requests_per_minute: number;
  max_requests_per_hour: number;
  max_tokens_per_minute: number;
  max_concurrent_requests: number;
  limits: SubProviderLimits;
}

export interface RateLimitWindow {
  timestamp: number;
  count: number;
}

export interface SubProviderLimits {
  max_requests_per_minute: number;
  max_requests_per_hour: number;
  max_tokens_per_minute: number;
  max_concurrent_requests: number;
  current_request_count: number;
  current_token_count: number;
  current_concurrent_requests: number;
  request_window: RateLimitWindow[];
  token_window: RateLimitWindow[];
  last_window_reset: number;
}

export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

export class SubProvider {
  private static readonly RATE_LIMIT_WINDOW_SIZE = 60000;
  private static readonly CIRCUIT_BREAKER_TIMEOUT = 120000;
  private static readonly CIRCUIT_BREAKER_FAILURE_THRESHOLD = 3;
  private static readonly HEALTH_SCORE_THRESHOLD = 0.05;

  constructor(private options: SubProviderDocument) {}

  get id(): string {
    return this.options.id;
  }

  get name(): string {
    return this.options.name;
  }

  get providerId(): string {
    return this.options.provider_id;
  }

  get isEnabled(): boolean {
    return this.options.enabled;
  }

  get enabled(): boolean {
    return this.options.enabled;
  }

  get priority(): number {
    return this.options.priority;
  }

  get weight(): number {
    return this.options.weight;
  }

  get healthScore(): number {
    return this.options.health_score;
  }

  get consecutiveErrors(): number {
    return this.options.consecutive_errors;
  }

  get circuitBreakerState(): CircuitBreakerState {
    return this.options.circuit_breaker_state;
  }

  get avgLatency(): number {
    return this.options.avg_latency;
  }

  get successRate(): number {
    const total = this.options.success_count + this.options.error_count;
    return total > 0 ? this.options.success_count / total : 1;
  }

  get totalTokenUsage(): bigint {
    return this.options.total_token_usage;
  }

  get lastUsedAt(): number {
    return this.options.last_used_at;
  }

  get lastErrorAt(): number | undefined {
    return this.options.last_error_at;
  }

  get lastErrorType(): string | undefined {
    return this.options.last_error_type;
  }

  get errorCount(): number {
    return this.options.error_count;
  }

  get successCount(): number {
    return this.options.success_count;
  }

  get createdAt(): number {
    return this.options.created_at;
  }

  get updatedAt(): number {
    return this.options.updated_at;
  }

  getApiKey(): ApiKeyConfig {
    return { ...this.options.api_key };
  }

  getDecryptedApiKey(cryptoService: ICryptoService): string {
    const apiKeyConfig = this.getApiKey();
    
    if (!apiKeyConfig || !apiKeyConfig.encrypted || !apiKeyConfig.iv || !apiKeyConfig.master_key) {
      throw new Error(`Invalid API key configuration for sub-provider ${this.id}. Missing required fields.`);
    }
    
    try {
      return cryptoService.decrypt(
        apiKeyConfig.encrypted,
        apiKeyConfig.iv,
        apiKeyConfig.master_key,
        apiKeyConfig.auth_tag
      );
    } catch (error) {
      throw new Error(`Failed to decrypt API key for sub-provider ${this.id}: ${(error as Error).message}`);
    }
  }

  hasActiveApiKey(): boolean {
    return this.options.is_active;
  }

  isHealthy(): boolean {
    return this.options.health_score > SubProvider.HEALTH_SCORE_THRESHOLD &&
           (this.options.circuit_breaker_state === 'closed' || this.options.circuit_breaker_state === 'half-open');
  }

  isAvailable(): boolean {
    return this.options.enabled && 
           this.isHealthy() && 
           !this.isRateLimited() &&
           !this.isConcurrencyLimited() &&
           this.hasActiveApiKey();
  }

  isRateLimited(): boolean {
    this.cleanupOldWindows();
    const currentRPM = this.getCurrentRequestsPerMinute();
    const currentTPM = this.getCurrentTokensPerMinute();
    
    return currentRPM >= this.options.limits.max_requests_per_minute ||
           currentTPM >= this.options.limits.max_tokens_per_minute;
  }

  isConcurrencyLimited(): boolean {
    return this.options.limits.current_concurrent_requests >= this.options.limits.max_concurrent_requests;
  }

  isCircuitBreakerOpen(): boolean {
    return this.options.circuit_breaker_state === 'open';
  }

  supportsModel(model: string): boolean {
    return Object.keys(this.options.model_mapping).length === 0 ||
           this.options.model_mapping.hasOwnProperty(model);
  }

  mapModel(model: string): string {
    return this.options.model_mapping[model] || model;
  }

  canHandleRequest(estimatedTokens: number = 0): boolean {
    if (!this.isAvailable()) return false;

    this.cleanupOldWindows();
    const currentRPM = this.getCurrentRequestsPerMinute();
    const currentTPM = this.getCurrentTokensPerMinute();

    return (currentRPM + 1) <= this.options.limits.max_requests_per_minute &&
           (currentTPM + estimatedTokens) <= this.options.limits.max_tokens_per_minute &&
           (this.options.limits.current_concurrent_requests + 1) <= this.options.limits.max_concurrent_requests;
  }

  reserveCapacity(estimatedTokens: number = 0): boolean {
    if (!this.canHandleRequest(estimatedTokens)) return false;

    const now = Date.now();
    const currentMinute = this.getCurrentMinuteTimestamp(now);

    this.addToWindow(this.options.limits.request_window, currentMinute, 1);
    
    if (estimatedTokens > 0) {
      this.addToWindow(this.options.limits.token_window, currentMinute, estimatedTokens);
    }

    this.options.limits.current_concurrent_requests++;
    return true;
  }

  releaseCapacity(): void {
    this.options.limits.current_concurrent_requests = Math.max(0, this.options.limits.current_concurrent_requests - 1);
    this.options.updated_at = Date.now();
  }

  recordSuccess(latency: number, tokensUsed: number): void {
    this.updateRequestMetrics(true);
    this.updateTokenMetrics(tokensUsed);
    this.updateLatencyMetrics(latency);
    this.resetConsecutiveErrors();
    this.updateHealthScore();
    this.updateCircuitBreaker();
    this.updateLastUsedTimestamp();
    this.options.updated_at = Date.now();
  }

  recordError(errorType: ErrorType, latency?: number): void {
    this.updateRequestMetrics(false);
    this.incrementConsecutiveErrors();
    this.updateLastError(errorType);
    
    if (latency) {
      this.updateLatencyMetrics(latency);
    }
    
    this.updateHealthScore();
    this.updateCircuitBreaker();
    this.updateLastUsedTimestamp();
    this.options.updated_at = Date.now();
  }

  enable(): void {
    this.options.enabled = true;
    this.options.updated_at = Date.now();
  }

  disable(): void {
    this.options.enabled = false;
    this.options.updated_at = Date.now();
  }

  updateName(newName: string): void {
    this.options.name = newName;
    this.options.updated_at = Date.now();
  }

  updateApiKey(newApiKey: ApiKeyConfig): void {
    this.options.api_key = { ...newApiKey };
    this.options.updated_at = Date.now();
  }

  updateModelMapping(newMapping: Record<string, string>): void {
    this.options.model_mapping = { ...newMapping };
    this.options.updated_at = Date.now();
  }

  openCircuitBreaker(): void {
    this.options.circuit_breaker_state = 'open';
    this.options.last_circuit_breaker_trigger = Date.now();
    this.options.updated_at = Date.now();
  }

  closeCircuitBreaker(): void {
    this.options.circuit_breaker_state = 'closed';
    this.options.consecutive_errors = 0;
    this.options.updated_at = Date.now();
  }

  halfOpenCircuitBreaker(): void {
    this.options.circuit_breaker_state = 'half-open';
    this.options.updated_at = Date.now();
  }

  getCurrentRequestsPerMinute(): number {
    this.cleanupOldWindows();
    return this.options.limits.request_window.reduce((sum, window) => sum + window.count, 0);
  }

  getCurrentTokensPerMinute(): number {
    this.cleanupOldWindows();
    return this.options.limits.token_window.reduce((sum, window) => sum + window.count, 0);
  }

  getMetrics() {
    return {
      totalTokenUsage: Number(this.options.total_token_usage),
      totalRequests: this.options.success_count + this.options.error_count,
      successCount: this.options.success_count,
      errorCount: this.options.error_count,
      consecutiveErrors: this.options.consecutive_errors,
      avgLatency: this.options.avg_latency,
      successRate: this.successRate,
      healthScore: this.options.health_score,
      circuitBreakerState: this.options.circuit_breaker_state,
      lastUsedAt: this.options.last_used_at,
      lastErrorAt: this.options.last_error_at,
      lastErrorType: this.options.last_error_type
    };
  }

  getLimits() {
    return {
      maxRequestsPerMinute: this.options.limits.max_requests_per_minute,
      maxTokensPerMinute: this.options.limits.max_tokens_per_minute,
      maxConcurrentRequests: this.options.limits.max_concurrent_requests,
      currentRequestCount: this.getCurrentRequestsPerMinute(),
      currentTokenCount: this.getCurrentTokensPerMinute(),
      currentConcurrentRequests: this.options.limits.current_concurrent_requests,
      isRateLimited: this.isRateLimited(),
      isConcurrencyLimited: this.isConcurrencyLimited()
    };
  }

  toDocument(): SubProviderDocument {
    return this.options;
  }

  private cleanupOldWindows(): void {
    const now = Date.now();
    const cutoff = now - SubProvider.RATE_LIMIT_WINDOW_SIZE;

    this.options.limits.request_window = this.options.limits.request_window.filter(w => w.timestamp > cutoff);
    this.options.limits.token_window = this.options.limits.token_window.filter(w => w.timestamp > cutoff);
    
    this.updateCurrentCounts();
  }

  private updateCurrentCounts(): void {
    this.options.limits.current_request_count = this.options.limits.request_window.reduce((sum, w) => sum + w.count, 0);
    this.options.limits.current_token_count = this.options.limits.token_window.reduce((sum, w) => sum + w.count, 0);
  }

  private getCurrentMinuteTimestamp(now: number): number {
    return Math.floor(now / 60000) * 60000;
  }

  private addToWindow(window: RateLimitWindow[], timestamp: number, count: number): void {
    const existing = window.find(w => w.timestamp === timestamp);
    if (existing) {
      existing.count += count;
    } else {
      window.push({ timestamp, count });
    }
  }

  private updateRequestMetrics(success: boolean): void {
    if (success) {
      this.options.success_count++;
    } else {
      this.options.error_count++;
    }
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

  private resetConsecutiveErrors(): void {
    this.options.consecutive_errors = 0;
  }

  private incrementConsecutiveErrors(): void {
    this.options.consecutive_errors++;
  }

  private updateLastError(errorType: ErrorType): void {
    this.options.last_error_at = Date.now();
    this.options.last_error_type = errorType;
  }

  private updateHealthScore(): void {
    const successRate = this.successRate;
    const total = this.options.success_count + this.options.error_count;
    
    if (total === 0) {
      this.options.health_score = 0.8;
      return;
    }
    
    const errorPenalty = Math.min(this.options.consecutive_errors * 0.05, 0.3);
    const latencyPenalty = Math.max(0, (this.options.avg_latency - 60000) / 120000);
    
    this.options.health_score = Math.max(0.3, Math.min(1, successRate - errorPenalty - latencyPenalty));
  }

  private updateCircuitBreaker(): void {
    switch (this.options.circuit_breaker_state) {
      case 'closed':
        if (this.options.consecutive_errors >= SubProvider.CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
          this.openCircuitBreaker();
        }
        break;

      case 'open':
        const timeSinceOpen = Date.now() - (this.options.last_circuit_breaker_trigger || 0);
        if (timeSinceOpen > SubProvider.CIRCUIT_BREAKER_TIMEOUT) {
          this.halfOpenCircuitBreaker();
        }
        break;

      case 'half-open':
        if (this.options.consecutive_errors === 0 && this.options.success_count > 0) {
          this.closeCircuitBreaker();
        } else if (this.options.consecutive_errors >= 2) {
          this.openCircuitBreaker();
        }
        break;
    }
  }

  private updateLastUsedTimestamp(): void {
    this.options.last_used_at = Date.now();
  }
}