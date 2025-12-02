import type { ILogger } from '../../../core/logging';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  StreamChunk,
  SpeechRequest,
  AudioTranscriptionRequest,
  TranscriptionResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  ImageGenerationRequest,
  ImageEditRequest,
  ImageResponse,
  ModerationRequest,
  ModerationResponse,
  ResponsesRequest,
  ResponsesResponse,
  ResponseStreamEvent
} from '../types';

export type ProviderCapability = 'chat' | 'audio' | 'embeddings' | 'images' | 'videos' | 'moderation' | 'responses';

export interface ProviderCapabilities {
  readonly chat: boolean;
  readonly audio: boolean;
  readonly embeddings: boolean;
  readonly images: boolean;
  readonly videos: boolean;
  readonly moderation: boolean;
  readonly responses: boolean;
}

export interface ProviderConfiguration {
  readonly name: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly timeout: number;
  readonly rateLimitPerMinute: number;
  readonly supportedModels: readonly string[];
  readonly modelMapping?: Record<string, string>;
  readonly capabilities: ProviderCapabilities;
  readonly requiresApiKey: boolean;
  readonly includeAuth?: boolean;
}

export interface RequestContext {
  readonly requestId: string;
  readonly model: string;
  readonly endpoint: string;
  readonly startTime: number;
}

export interface HttpRequestOptions {
  readonly endpoint: string;
  readonly method: HttpMethod;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  readonly expectJson?: boolean;
  readonly fetchFunction?: any;
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export abstract class BaseProviderAdapter {
  static readonly REQUEST_ID_LENGTH = 9;
  static readonly MIN_TIMEOUT = 1000;
  static readonly MIN_RATE_LIMIT = 1;
  static readonly ADAPTER_VERSION = '1.0';
  private static readonly API_KEY_PATTERNS = [
    /sk-[a-zA-Z0-9_-]+/g, // Generic sk- pattern (covers OpenAI, Anthropic fallback, etc)
    /(sk-[a-zA-Z0-9_-]+T3BlbkFJ[a-zA-Z0-9_-]+)|(sess-[A-Za-z0-9]{40})/g, // OpenAI extended
    /sk-ant-api03-[A-Za-z0-9\-_]{93}AA/g, // Anthropic
    /sk-ant-[A-Za-z0-9\-_]{86}/g, // Anthropic secondary
    /sk-[A-Za-z0-9]{86}/g, // Anthropic third
    /(?<![a-zA-Z0-9])[A-Za-z0-9]{32}(?![a-zA-Z0-9])/g, // AI21, Mistral, Shodan (careful with false positives, checking boundaries)
    /sk_[a-z0-9]{48}/g, // ElevenLabs secondary
    /AIzaSy[A-Za-z0-9\-_]{33}/g, // MakerSuite/Google
    /AKIA[0-9A-Z]{16}/g, // AWS Access Key
    /sk-or-v1-[a-z0-9]{64}/g, // OpenRouter
    /gsk_[a-zA-Z0-9]{52}/g, // Groq
    /xai-[a-zA-Z0-9]{80}/g, // Grok
    /hf_[a-zA-Z]{34}/g, // HuggingFace
    /pplx-[a-e0-9]{48}/g, // Perplexity
    /cpk_[0-9a-f]{32}\.[0-9a-f]{32}\.[A-Za-z0-9]+/g, // Chutes
    /r8_[a-zA-Z0-9]{37}/g // Replicate
  ];

  protected readonly logger: ILogger;

  constructor(
    public readonly configuration: ProviderConfiguration,
    logger: ILogger
  ) {
    if (typeof logger === 'string') {
      throw new Error(`BaseProviderAdapter constructor expects (configuration, logger), got string as logger: "${logger}"`);
    }
    
    this.logger = logger.createChild(this.configuration.name);
    this.validateConfiguration();
  }

  get name(): string {
    return this.configuration.name;
  }

  get supportedModels(): readonly string[] {
    return this.configuration.supportedModels;
  }

  supportsModel(model: string): boolean {
    return this.configuration.supportedModels.includes(model);
  }

  supportsCapability(capability: ProviderCapability): boolean {
    return this.configuration.capabilities[capability];
  }

  getMappedModel(model: string): string {
    return this.configuration.modelMapping?.[model] ?? model;
  }

  hasCapabilities(capabilities: ProviderCapability[]): boolean {
    return capabilities.every(capability => this.supportsCapability(capability));
  }

  abstract chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse | AsyncIterable<StreamChunk>>;
  abstract textToSpeech(request: SpeechRequest): Promise<ArrayBuffer>;
  abstract audioTranscription(request: AudioTranscriptionRequest): Promise<TranscriptionResponse>;
  abstract createEmbeddings(request: EmbeddingRequest): Promise<EmbeddingResponse>;
  abstract generateImages(request: ImageGenerationRequest): Promise<ImageResponse>;
  abstract editImages(request: ImageEditRequest): Promise<ImageResponse>;
  abstract moderateContent(request: ModerationRequest): Promise<ModerationResponse>;
  abstract createResponse(request: ResponsesRequest): Promise<ResponsesResponse | AsyncIterable<ResponseStreamEvent>>;
  
  // Video generation methods (to be implemented by providers that support videos)
  async createVideo(_request: any): Promise<any> {
    throw new Error(`${this.name} does not support video generation`);
  }
  
  async getVideoStatus(_videoId: string): Promise<any> {
    throw new Error(`${this.name} does not support video status retrieval`);
  }
  
  async downloadVideo(_videoId: string, _variant?: string): Promise<ArrayBuffer> {
    throw new Error(`${this.name} does not support video download`);
  }
  
  async listVideos(_params?: any): Promise<any> {
    throw new Error(`${this.name} does not support video listing`);
  }
  
  async deleteVideo(_videoId: string): Promise<void> {
    throw new Error(`${this.name} does not support video deletion`);
  }
  
  async remixVideo(_videoId: string, _request: any): Promise<any> {
    throw new Error(`${this.name} does not support video remixing`);
  }

  protected createRequestContext(endpoint: string, model: string): RequestContext {
    return {
      requestId: this.generateRequestId(),
      model: this.getMappedModel(model),
      endpoint: this.normalizeEndpoint(endpoint),
      startTime: Date.now()
    };
  }

  protected createHttpHeaders(additionalHeaders?: Record<string, string>): Record<string, string> {
    const headers = new Map<string, string>();
    
    headers.set('Content-Type', 'application/json');
    headers.set('Accept', '*/*');
    
    if (this.shouldIncludeAuth()) {
      headers.set('Authorization', `Bearer ${this.configuration.apiKey}`);
    }

    if (additionalHeaders) {
      Object.entries(additionalHeaders).forEach(([key, value]) => {
        headers.set(key, value);
      });
    }

    return Object.fromEntries(headers);
  }

  protected async makeHttpRequest<T>(options: HttpRequestOptions): Promise<T | Response> {
    const { endpoint, method, body, headers, expectJson = true, fetchFunction } = options;
    
    try {
      const response = await this.performHttpRequest({
        url: this.buildUrl(endpoint),
        method,
        body,
        headers: this.createHttpHeaders(headers),
        fetchFunction
      });
      
      this.validateHttpResponse(response);
      
      return expectJson ? await this.parseJsonResponse<T>(response) : response;

    } catch (error) {
      throw await this.enhanceError(error as Error, endpoint, method);
    }
  }

  protected async makeStreamRequest(options: HttpRequestOptions): Promise<Response> {
    const response = await this.makeHttpRequest<Response>({
      ...options,
      expectJson: false
    });

    this.validateStreamResponse(response);
    return response as Response;
  }

  protected async executeWithLogging<T>(
    context: RequestContext,
    executor: () => Promise<T>,
    metadata?: Record<string, any>
  ): Promise<T> {
    this.logRequestStart(context, metadata);

    try {
      const result = await executor();
      this.logRequestSuccess(context, this.extractResultMetadata(result, metadata));
      return result;
    } catch (error) {
      this.logRequestError(context, error as Error);
      throw error;
    }
  }

  private async performHttpRequest(options: {
    url: string;
    method: HttpMethod;
    body?: unknown;
    headers: Record<string, string>;
    fetchFunction?: () => any;
  }): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.configuration.timeout);
    const fetchFn = options.fetchFunction || fetch;

    try {
      const isFormData = options.body instanceof FormData ||
                        (options.body && typeof (options.body as any).append === 'function');
      
      if (isFormData) {
        // For FormData, don't stringify and don't set Content-Type
        // Let the browser/runtime set the correct multipart boundary
        const cleanHeaders = Object.fromEntries(
          Object.entries(options.headers).filter(([key]) =>
            key.toLowerCase() !== 'content-type'
          )
        );
        
        return await fetchFn(options.url, {
          method: options.method,
          headers: cleanHeaders,
          body: options.body as BodyInit,
          signal: controller.signal
        });
      }
      
      // For non-FormData, stringify and use provided headers
      const body = options.body ? JSON.stringify(options.body) : undefined;
      
      return await fetchFn(options.url, {
        method: options.method,
        headers: options.headers,
        body,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private validateHttpResponse(response: Response): void {
    if (!response.ok) {
      throw new HttpError(response.status, response.statusText, response);
    }
  }

  private validateStreamResponse(response: unknown): void {
    if (!(response instanceof Response)) {
      throw new Error('Expected Response object for streaming request');
    }
  }

  private async parseJsonResponse<T>(response: Response): Promise<T> {
    try {
      return await response.json();
    } catch (error) {
      throw new Error(`Failed to parse JSON response: ${(error as Error).message}`);
    }
  }

  private async enhanceError(error: Error, endpoint: string, method: HttpMethod): Promise<Error> {
    if (error instanceof HttpError) {
      return await this.createHttpError(error, endpoint, method);
    }

    const sanitizedEndpoint = this.sanitizeApiKey(endpoint);

    if (error.name === 'AbortError') {
      const timeoutMessage = `Request timeout after ${this.configuration.timeout}ms for ${method} ${sanitizedEndpoint}`;
      const apiError = new ProviderApiError(408, 'timeout', timeoutMessage);
      apiError.provider = this.configuration.name;
      apiError.endpoint = sanitizedEndpoint;
      apiError.method = method;
      return apiError;
    }
    
    if (this.isNetworkError(error)) {
      const networkMessage = `Network error for ${method} ${sanitizedEndpoint}: ${error.message}`;
      const apiError = new ProviderApiError(503, 'network_error', networkMessage);
      apiError.provider = this.configuration.name;
      apiError.endpoint = sanitizedEndpoint;
      apiError.method = method;
      return apiError;
    }
    
    return error;
  }

  private async createHttpError(httpError: HttpError, endpoint: string, method: HttpMethod): Promise<Error> {
    const sanitizedEndpoint = this.sanitizeApiKey(endpoint);
    const baseMessage = `HTTP ${httpError.status} for ${method} ${sanitizedEndpoint}`;
    
    if (httpError.response) {
      try {
        // Attempt to read raw response once; prefer text to preserve provider payload
        const contentType = httpError.response.headers.get('content-type') || '';
        const rawBody = contentType.includes('application/json')
          ? JSON.stringify(await httpError.response.clone().json())
          : await httpError.response.clone().text();

        // Sanitize the raw body to remove any API keys
        const sanitizedRawBody = this.sanitizeApiKey(rawBody);

        // Attempt to extract structured fields if JSON
        let extractedMessage = '';
        let extractedType: string | undefined;
        let extractedCode: string | undefined;
        let extractedParam: string | undefined;
        try {
          if (contentType.includes('application/json')) {
            const data = await httpError.response.json();
            extractedMessage = this.sanitizeApiKey(data?.error?.message || data?.message || httpError.statusText || '');
            extractedType = data?.error?.type || data?.type;
            extractedCode = data?.error?.code;
            extractedParam = data?.error?.param;
          }
        } catch {}

        const finalMessage = sanitizedRawBody ? `${baseMessage}: ${sanitizedRawBody}` : `${baseMessage}: ${extractedMessage || httpError.statusText}`;

        const apiError = new ProviderApiError(httpError.status, extractedType || 'provider_error', finalMessage);
        apiError.code = extractedCode;
        apiError.param = extractedParam;
        apiError.raw = sanitizedRawBody;
        apiError.provider = this.configuration.name;
        apiError.endpoint = sanitizedEndpoint;
        apiError.method = method;
        return apiError;
      } catch {
        const apiError = new ProviderApiError(httpError.status, 'provider_error', `${baseMessage}: ${httpError.statusText}`);
        apiError.provider = this.configuration.name;
        apiError.endpoint = sanitizedEndpoint;
        apiError.method = method;
        return apiError;
      }
    }
    
    const apiError = new ProviderApiError(httpError.status, 'provider_error', `${baseMessage}: ${httpError.statusText}`);
    apiError.provider = this.configuration.name;
    apiError.endpoint = sanitizedEndpoint;
    apiError.method = method;
    return apiError;
  }



  private isNetworkError(error: Error): boolean {
    const networkErrorIndicators = ['Failed to fetch', 'NetworkError', 'fetch'];
    return networkErrorIndicators.some(indicator => 
      error.message.includes(indicator)
    );
  }

  private buildUrl(endpoint: string): string {
    const baseUrl = this.configuration.baseUrl.replace(/\/+$/, '');
    const normalizedEndpoint = this.normalizeEndpoint(endpoint);
    return `${baseUrl}${normalizedEndpoint}`;
  }

  private normalizeEndpoint(endpoint: string): string {
    return endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  }

  private generateRequestId(): string {
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random()
      .toString(36)
      .substring(2, 2 + BaseProviderAdapter.REQUEST_ID_LENGTH);
    
    return `${this.configuration.name}-${timestamp}-${randomPart}`;
  }

  private shouldIncludeAuth(): boolean {
    if (this.configuration.includeAuth === false) {
      return false;
    }
    return this.configuration.apiKey.length > 0;
  }

  private extractResultMetadata(result: unknown, existingMetadata?: Record<string, any>): Record<string, any> {
    const metadata = { ...existingMetadata };

    if (result && typeof result === 'object') {
      if ('usage' in result) {
        metadata.usage = result.usage;
      }
      if ('data' in result && Array.isArray(result.data)) {
        metadata.resultCount = result.data.length;
      }
    }

    return metadata;
  }

  private validateConfiguration(): void {
    const validator = new ConfigurationValidator(this.configuration);
    validator.validate();
  }

  private sanitizeApiKey(text: string): string {
    let sanitized = text;
    for (const pattern of BaseProviderAdapter.API_KEY_PATTERNS) {
      sanitized = sanitized.replace(pattern, (match) => {
        // If the match starts with common prefixes, preserve prefix + redacted
        if (match.startsWith('sk-')) return 'sk-***REDACTED***';
        if (match.startsWith('AIzaSy')) return 'AIzaSy***REDACTED***';
        if (match.startsWith('gsk_')) return 'gsk_***REDACTED***';
        if (match.startsWith('xai-')) return 'xai-***REDACTED***';
        if (match.startsWith('hf_')) return 'hf_***REDACTED***';
        return '***REDACTED***';
      });
    }
    return sanitized;
  }

  private logRequestStart(context: RequestContext, metadata?: Record<string, any>): void {
    this.logger.info('Provider request initiated', {
      requestId: context.requestId,
      metadata: {
        provider: this.configuration.name,
        model: context.model,
        endpoint: this.sanitizeApiKey(context.endpoint),
        ...metadata
      }
    });
  }

  private logRequestSuccess(context: RequestContext, metadata?: Record<string, any>): void {
    const duration = Date.now() - context.startTime;

    this.logger.info('Provider request completed successfully', {
      requestId: context.requestId,
      metadata: {
        provider: this.configuration.name,
        model: context.model,
        endpoint: this.sanitizeApiKey(context.endpoint),
        duration,
        ...metadata
      }
    });
  }

  private logRequestError(context: RequestContext, error: Error): void {
    const duration = Date.now() - context.startTime;

    this.logger.error('Provider request failed', error, {
      requestId: context.requestId,
      metadata: {
        provider: this.configuration.name,
        model: context.model,
        endpoint: this.sanitizeApiKey(context.endpoint),
        duration,
        errorType: error.constructor.name,
        errorMessage: this.sanitizeApiKey(error.message)
      }
    });
  }
}

export class ProviderApiError extends Error {
  public statusCode: number;
  public type: string;
  public code?: string;
  public param?: string;
  public raw?: string;
  public provider?: string;
  public endpoint?: string;
  public method?: string;

  constructor(statusCode: number, type: string, message: string) {
    super(message);
    this.name = 'ProviderApiError';
    this.statusCode = statusCode;
    this.type = type;
  }
}

class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly response?: Response
  ) {
    super(`HTTP ${status}: ${statusText}`);
    this.name = 'HttpError';
  }
}

class ConfigurationValidator {
  constructor(private readonly config: ProviderConfiguration) {}

  validate(): void {
    const errors = [
      ...this.validateAuth(),
      ...this.validateUrl(),
      ...this.validateModels(),
      ...this.validateTiming(),
      ...this.validateCapabilities()
    ];

    if (errors.length > 0) {
      throw new Error(
        `Invalid configuration for provider ${this.config.name}: ${errors.join(', ')}`
      );
    }
  }

  private validateAuth(): string[] {
    if (this.config.requiresApiKey && this.config.includeAuth !== false && !this.config.apiKey) {
      return ['API key is required'];
    }
    return [];
  }

  private validateUrl(): string[] {
    const errors: string[] = [];

    if (!this.config.baseUrl) {
      errors.push('Base URL is required');
    } else if (!this.isValidUrl(this.config.baseUrl)) {
      errors.push('Base URL must be a valid URL');
    }

    return errors;
  }

  private validateModels(): string[] {
    return this.config.supportedModels.length === 0 
      ? ['At least one supported model is required'] 
      : [];
  }

  private validateTiming(): string[] {
    const errors: string[] = [];

    if (this.config.timeout < BaseProviderAdapter.MIN_TIMEOUT) {
      errors.push(`Timeout must be at least ${BaseProviderAdapter.MIN_TIMEOUT}ms`);
    }

    if (this.config.rateLimitPerMinute < BaseProviderAdapter.MIN_RATE_LIMIT) {
      errors.push(`Rate limit must be at least ${BaseProviderAdapter.MIN_RATE_LIMIT} request per minute`);
    }

    return errors;
  }

  private validateCapabilities(): string[] {
    return this.hasAnyCapability() 
      ? [] 
      : ['At least one capability must be enabled'];
  }

  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  private hasAnyCapability(): boolean {
    return Object.values(this.config.capabilities).some(Boolean);
  }
}