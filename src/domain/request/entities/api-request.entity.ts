export interface ApiRequestDocument {
  id: string;
  created_at: number;
  updated_at: number;
  user_id?: string;
  endpoint: string;
  model: string;
  tokens_used: bigint;
  credits_used: bigint;
  provider_id: string | null;
  method: string;
  sub_provider_id: string | null;
  user_agent: string;
  latency: number;
  response_size: number;
  request_size: number;
  status: RequestState;
  status_code: number;
  error_message: string;
  retry_count: number;
  completed_at: number;
}

export type RequestState = 'pending' | 'processing' | 'completed' | 'failed' | 'timeout';

export class ApiRequest {
  constructor(private options: ApiRequestDocument) {}

  get id(): string {
    return this.options.id;
  }

  get userId(): string | undefined {
    return this.options.user_id;
  }

  get endpoint(): string {
    return this.options.endpoint;
  }

  get method(): string {
    return this.options.method;
  }

  get model(): string {
    return this.options.model;
  }

  get providerId(): string | null {
    return this.options.provider_id;
  }

  get subProviderId(): string | null {
    return this.options.sub_provider_id;
  }

  get tokensUsed(): bigint {
    return this.options.tokens_used;
  }

  get creditsUsed(): bigint {
    return this.options.credits_used;
  }

  get latency(): number {
    return this.options.latency;
  }

  get requestStatus(): RequestState {
    return this.options.status;
  }

  get statusCode(): number {
    return this.options.status_code;
  }

  get userAgent(): string | undefined {
    return this.options.user_agent;
  }

  get createdAt(): number {
    return this.options.created_at;
  }

  get updatedAt(): number {
    return this.options.updated_at;
  }

  get completedAt(): number | undefined {
    return this.options.completed_at;
  }

  get duration(): number | undefined {
    if (!this.options.completed_at) return undefined;
    return this.options.completed_at - this.options.created_at;
  }

  get retryCount(): number {
    return this.options.retry_count;
  }

  get errorMessage(): string | undefined {
    return this.options.error_message;
  }

  get responseSize(): number {
    return this.options.response_size;
  }

  get requestSize(): number {
    return this.options.request_size;
  }

  get costPerToken(): number {
    if (this.options.tokens_used === 0n) return 0;
    return Number(this.options.credits_used) / Number(this.options.tokens_used);
  }

  isCompleted(): boolean {
    return this.options.status === 'completed';
  }

  isFailed(): boolean {
    return this.options.status === 'failed' || this.options.status === 'timeout';
  }

  isProcessing(): boolean {
    return this.options.status === 'processing';
  }

  isPending(): boolean {
    return this.options.status === 'pending';
  }

  startProcessing(): void {
    this.options.status = 'processing';
    this.options.updated_at = Date.now();
  }

  complete(
    tokensUsed: number,
    creditsUsed: number,
    latency: number,
    responseSize: number,
    statusCode: number,
    providerId?: string,
    subProviderId?: string
  ): void {
    this.options.status = 'completed';
    this.options.status_code = statusCode;
    this.options.completed_at = Date.now();
    this.options.tokens_used = BigInt(tokensUsed);
    this.options.credits_used = BigInt(creditsUsed);
    this.options.latency = latency;
    this.options.response_size = responseSize;
    this.options.updated_at = Date.now();
    
    if (providerId) this.options.provider_id = providerId;
    if (subProviderId) this.options.sub_provider_id = subProviderId;
  }

  fail(statusCode: number, errorMessage: string, latency: number, retryCount?: number): void {
    this.options.status = 'failed';
    this.options.status_code = statusCode;
    this.options.error_message = errorMessage;
    this.options.completed_at = Date.now();
    this.options.retry_count = retryCount || 0;
    this.options.latency = latency;
    this.options.updated_at = Date.now();
  }

  timeout(latency: number): void {
    this.options.status = 'timeout';
    this.options.status_code = 408;
    this.options.error_message = 'Request timeout';
    this.options.completed_at = Date.now();
    this.options.latency = latency;
    this.options.updated_at = Date.now();
  }

  updateModel(newModel: string): void {
    this.options.model = newModel;
    this.options.updated_at = Date.now();
  }

  updateProviderId(newProviderId: string): void {
    this.options.provider_id = newProviderId;
    this.options.updated_at = Date.now();
  }

  updateSubProviderId(newSubProviderId: string): void {
    this.options.sub_provider_id = newSubProviderId;
    this.options.updated_at = Date.now();
  }

  incrementRetryCount(): void {
    this.options.retry_count++;
    this.options.updated_at = Date.now();
  }

  getMetrics() {
    return {
      tokensUsed: this.options.tokens_used,
      creditsUsed: this.options.credits_used,
      latency: this.options.latency,
      responseSize: this.options.response_size,
      requestSize: this.options.request_size,
      costPerToken: this.costPerToken,
      duration: this.duration
    };
  }

  toDocument(): ApiRequestDocument {
    return this.options;
  }
}