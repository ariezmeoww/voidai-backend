import { ApiRequest } from '../entities';
import type { IApiRequestRepository, RequestQuery } from '../repositories';
import type { ILogger } from '../../../core/logging';

export interface CreateRequestRequest {
  readonly userId?: string;
  readonly endpoint: string;
  readonly method: string;
  readonly model?: string;
  readonly ipAddress: string;
  readonly userAgent: string;
  readonly requestSize: number;
}

export interface RequestStats {
  readonly totalRequests: number;
  readonly completedRequests: number;
  readonly failedRequests: number;
  readonly pendingRequests: number;
  readonly avgLatency: number;
  readonly avgTokensUsed: number;
  readonly avgCreditsUsed: number;
  readonly successRate: number;
  readonly totalTokensUsed: number;
  readonly totalCreditsUsed: number;
}

export interface RequestOperationResult<T = boolean> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
}

export class ApiRequestService {
  static readonly DEFAULT_VALUES = {
    TOKENS_USED: 0,
    CREDITS_USED: 0,
    LATENCY: 0,
    RESPONSE_SIZE: 0,
    STATUS_CODE: 0,
    RETRY_COUNT: 0,
    COMPLETED_AT: 0
  } as const;

  constructor(
    private readonly apiRequestRepository: IApiRequestRepository,
    private readonly logger: ILogger
  ) {}

  public async createRequest(request: CreateRequestRequest): Promise<ApiRequest> {
    const validation = this.validateCreateRequest(request);
    if (!validation.isValid) {
      throw new Error(validation.error!);
    }

    const apiRequest = this.buildApiRequest(request);
    const savedRequest = await this.apiRequestRepository.save(apiRequest);

    this.logRequestCreation(savedRequest);
    return savedRequest;
  }

  public async getRequestById(id: string): Promise<ApiRequest | null> {
    this.validateRequiredString(id, 'Request ID');
    return this.apiRequestRepository.findById(id);
  }

  public async getUserRequests(userId: string, query?: RequestQuery): Promise<ApiRequest[]> {
    this.validateRequiredString(userId, 'User ID');
    return this.apiRequestRepository.findByUser(userId, query);
  }

  public async getRequests(query?: RequestQuery): Promise<ApiRequest[]> {
    return this.apiRequestRepository.findMany(query);
  }

  public async getCompletedRequests(): Promise<ApiRequest[]> {
    return this.apiRequestRepository.findCompleted();
  }

  public async getFailedRequests(): Promise<ApiRequest[]> {
    return this.apiRequestRepository.findFailed();
  }

  public async getRequestsByModel(model: string): Promise<ApiRequest[]> {
    this.validateRequiredString(model, 'Model');
    return this.apiRequestRepository.findByModel(model);
  }

  public async getRequestsByProvider(providerId: string): Promise<ApiRequest[]> {
    this.validateRequiredString(providerId, 'Provider ID');
    return this.apiRequestRepository.findByProvider(providerId);
  }

  public async startProcessing(id: string): Promise<RequestOperationResult> {
    const request = await this.apiRequestRepository.findById(id);
    if (!request) {
      return RequestOperationResult.failure('Request not found');
    }

    if (!request.isPending()) {
      return RequestOperationResult.failure('Request is not in pending state');
    }

    request.startProcessing();
    await this.apiRequestRepository.save(request);

    return RequestOperationResult.success(true);
  }

  public async completeRequest(
    id: string,
    tokensUsed: number,
    creditsUsed: number,
    latency: number,
    responseSize: number,
    statusCode: number,
    providerId?: string,
    subProviderId?: string
  ): Promise<RequestOperationResult> {
    const request = await this.apiRequestRepository.findById(id);
    if (!request) {
      this.logger.warn('Cannot complete request - request not found', {
        metadata: { requestId: id }
      });
      return RequestOperationResult.failure('Request not found');
    }

    const statusValidation = this.validateRequestStatusForCompletion(request);
    if (!statusValidation.isValid) {
      this.logRequestStatusWarning(id, request, statusValidation.error!);
      return RequestOperationResult.failure(statusValidation.error!);
    }

    request.complete(
      tokensUsed,
      creditsUsed,
      latency,
      responseSize,
      statusCode,
      providerId,
      subProviderId
    );

    await this.apiRequestRepository.save(request);
    this.logRequestCompletion(id, {
      statusCode,
      latency,
      tokensUsed,
      creditsUsed,
      providerId,
      subProviderId
    });

    return RequestOperationResult.success(true);
  }

  public async failRequest(
    id: string,
    statusCode: number,
    errorMessage: string,
    latency: number,
    retryCount?: number
  ): Promise<RequestOperationResult> {
    const request = await this.apiRequestRepository.findById(id);
    if (!request) {
      return RequestOperationResult.failure('Request not found');
    }

    if (request.isCompleted()) {
      return RequestOperationResult.failure('Request already completed');
    }

    request.fail(statusCode, errorMessage, latency, retryCount);
    await this.apiRequestRepository.save(request);

    this.logRequestFailure(id, { statusCode, errorMessage, latency, retryCount });
    return RequestOperationResult.success(true);
  }

  public async timeoutRequest(id: string, latency: number): Promise<RequestOperationResult> {
    const request = await this.apiRequestRepository.findById(id);
    if (!request) {
      return RequestOperationResult.failure('Request not found');
    }

    if (request.isCompleted()) {
      return RequestOperationResult.failure('Request already completed');
    }

    request.timeout(latency);
    await this.apiRequestRepository.save(request);

    this.logRequestTimeout(id, latency);
    return RequestOperationResult.success(true);
  }

  public async deleteRequest(id: string): Promise<boolean> {
    const exists = await this.apiRequestRepository.exists(id);
    if (!exists) return false;

    const success = await this.apiRequestRepository.delete(id);
    if (success) {
      this.logger.debug('API request deleted', {
        metadata: { requestId: id }
      });
    }

    return success;
  }

  public async getRequestStats(userId?: string): Promise<RequestStats> {
    const query: RequestQuery | undefined = userId ? { filters: { userId } } : undefined;
    const requests = await this.apiRequestRepository.findMany(query);

    const statsCalculator = new RequestStatsCalculator(requests);
    return statsCalculator.calculate();
  }

  public async getRequestsInDateRange(from: number, to: number): Promise<ApiRequest[]> {
    if (from >= to) {
      throw new Error('From date must be before to date');
    }

    return this.apiRequestRepository.findByDateRange(from, to);
  }

  private buildApiRequest(request: CreateRequestRequest): ApiRequest {
    const now = Date.now();

    return new ApiRequest({
      id: crypto.randomUUID(),
      created_at: now,
      updated_at: now,
      user_id: request.userId,
      endpoint: request.endpoint,
      model: request.model ?? '',
      tokens_used: 0n,
      credits_used: 0n,
      provider_id: null,
      method: request.method,
      sub_provider_id: null,
      user_agent: request.userAgent,
      latency: ApiRequestService.DEFAULT_VALUES.LATENCY,
      response_size: ApiRequestService.DEFAULT_VALUES.RESPONSE_SIZE,
      request_size: request.requestSize,
      status: 'pending',
      status_code: ApiRequestService.DEFAULT_VALUES.STATUS_CODE,
      error_message: '',
      retry_count: ApiRequestService.DEFAULT_VALUES.RETRY_COUNT,
      completed_at: ApiRequestService.DEFAULT_VALUES.COMPLETED_AT
    });
  }

  private validateCreateRequest(request: CreateRequestRequest): ValidationResult {
    const requiredFields = [
      { value: request.endpoint, name: 'Endpoint' },
      { value: request.method, name: 'HTTP method' },
      { value: request.ipAddress, name: 'IP address' },
      { value: request.userAgent, name: 'User agent' }
    ];

    for (const field of requiredFields) {
      if (!field.value?.trim()) {
        return ValidationResult.failure(`${field.name} is required`);
      }
    }

    if (request.requestSize < 0) {
      return ValidationResult.failure('Request size cannot be negative');
    }

    return ValidationResult.success();
  }

  private validateRequestStatusForCompletion(request: ApiRequest): ValidationResult {
    if (request.isCompleted()) {
      return ValidationResult.failure('Request already completed');
    }

    if (request.isFailed()) {
      return ValidationResult.failure('Request already failed');
    }

    if (!request.isProcessing() && !request.isPending()) {
      return ValidationResult.failure('Request in invalid state for completion');
    }

    return ValidationResult.success();
  }

  private validateRequiredString(value: string, fieldName: string): void {
    if (!value?.trim()) {
      throw new Error(`${fieldName} is required`);
    }
  }

  private logRequestCreation(request: ApiRequest): void {
    this.logger.debug('API request created', {
      metadata: {
        requestId: request.id,
        userId: request.userId,
        endpoint: request.endpoint
      }
    });
  }

  private logRequestCompletion(id: string, metadata: Record<string, any>): void {
    this.logger.info('API request completed', {
      metadata: { requestId: id, ...metadata }
    });
  }

  private logRequestFailure(id: string, metadata: Record<string, any>): void {
    this.logger.warn('API request failed', {
      metadata: { requestId: id, ...metadata }
    });
  }

  private logRequestTimeout(id: string, latency: number): void {
    this.logger.warn('API request timed out', {
      metadata: { requestId: id, latency }
    });
  }

  private logRequestStatusWarning(id: string, request: ApiRequest, error: string): void {
    this.logger.warn(`Cannot complete request - ${error}`, {
      metadata: {
        requestId: id,
        currentStatus: request.requestStatus,
        completedAt: request.completedAt,
        errorMessage: request.errorMessage
      }
    });
  }
}

class RequestStatsCalculator {
  constructor(private readonly requests: ApiRequest[]) {}

  public calculate(): RequestStats {
    const completedRequests = this.getCompletedRequests();
    const failedRequests = this.getFailedRequests();
    const pendingRequests = this.getPendingRequests();

    return {
      totalRequests: this.requests.length,
      completedRequests: completedRequests.length,
      failedRequests: failedRequests.length,
      pendingRequests: pendingRequests.length,
      avgLatency: this.calculateAverageLatency(completedRequests),
      avgTokensUsed: this.calculateAverageTokens(completedRequests),
      avgCreditsUsed: this.calculateAverageCredits(completedRequests),
      successRate: this.calculateSuccessRate(completedRequests.length),
      totalTokensUsed: this.calculateTotalTokens(),
      totalCreditsUsed: this.calculateTotalCredits()
    };
  }

  private getCompletedRequests(): ApiRequest[] {
    return this.requests.filter(r => r.isCompleted());
  }

  private getFailedRequests(): ApiRequest[] {
    return this.requests.filter(r => r.isFailed());
  }

  private getPendingRequests(): ApiRequest[] {
    return this.requests.filter(r => r.isPending() || r.isProcessing());
  }

  private calculateAverageLatency(completedRequests: ApiRequest[]): number {
    return this.calculateAverage(completedRequests, r => r.latency);
  }

  private calculateAverageTokens(completedRequests: ApiRequest[]): number {
    return this.calculateAverage(completedRequests, r => Number(r.tokensUsed));
  }

  private calculateAverageCredits(completedRequests: ApiRequest[]): number {
    return this.calculateAverage(completedRequests, r => Number(r.creditsUsed));
  }

  private calculateAverage(items: ApiRequest[], selector: (item: ApiRequest) => number): number {
    if (items.length === 0) return 0;
    return items.reduce((sum, item) => sum + selector(item), 0) / items.length;
  }

  private calculateSuccessRate(completedCount: number): number {
    return this.requests.length > 0 ? completedCount / this.requests.length : 0;
  }

  private calculateTotalTokens(): number {
    return this.requests.reduce((sum, r) => sum + Number(r.tokensUsed), 0);
  }

  private calculateTotalCredits(): number {
    return this.requests.reduce((sum, r) => sum + Number(r.creditsUsed), 0);
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

namespace RequestOperationResult {
  export function success<T>(data: T): RequestOperationResult<T> {
    return { success: true, data };
  }

  export function failure<T>(error: string): RequestOperationResult<T> {
    return { success: false, error };
  }
}