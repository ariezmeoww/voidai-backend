import { BaseProviderAdapter, type ProviderConfiguration } from '../base';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ImageGenerationRequest,
  ImageResponse,
  ResponseMessage,
  ResponseInputParam,
  ResponsesRequest,
  ResponsesResponse,
  ResponseStreamEvent,
  StreamChunk,
  SpeechRequest,
  AudioTranscriptionRequest,
  TranscriptionResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  ImageEditRequest,
  ModerationRequest,
  ModerationResponse
} from '../types';
import type { ILogger } from '../../../core/logging';

export class XAIAdapter extends BaseProviderAdapter {
  private static readonly CHAT_COMPLETIONS_ENDPOINT = '/chat/completions';
  private static readonly IMAGES_GENERATIONS_ENDPOINT = '/images/generations';
  private static readonly DEFAULT_IMAGE_MODEL = 'grok-2-image';
  private static readonly DEFAULT_TEMPERATURE = 1;

  private static readonly EXCLUDED_PARAMS = [
    'presence_penalty',
    'frequency_penalty'
  ];

  constructor(apiKey: string, logger: ILogger) {
    const configuration: ProviderConfiguration = {
      name: 'x-ai',
      apiKey,
      baseUrl: 'https://api.x.ai/v1',
      timeout: 300000,
      rateLimitPerMinute: 240,
      requiresApiKey: true,
      supportedModels: [
        'grok-4'
      ],
      capabilities: {
        chat: true,
        audio: false,
        embeddings: false,
        images: true,
        videos: false,
        moderation: false,
        responses: true
      }
    };

    super(configuration, logger);
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse | AsyncIterable<StreamChunk>> {
    const context = this.createRequestContext(XAIAdapter.CHAT_COMPLETIONS_ENDPOINT, request.model);

    return this.executeWithLogging(context, async () => {
      const xaiRequest = this.transformChatRequest(request);

      if (request.stream) {
        return this.createChatStream(xaiRequest);
      }

      const response = await this.makeHttpRequest<ChatCompletionResponse>({
        endpoint: XAIAdapter.CHAT_COMPLETIONS_ENDPOINT,
        method: 'POST',
        body: xaiRequest,
        expectJson: true
      });

      return response as ChatCompletionResponse;
    });
  }

  async textToSpeech(_request: SpeechRequest): Promise<ArrayBuffer> {
    throw new UnsupportedOperationError('X-AI does not support text-to-speech');
  }

  async audioTranscription(_request: AudioTranscriptionRequest): Promise<TranscriptionResponse> {
    throw new UnsupportedOperationError('X-AI does not support audio transcription');
  }

  async createEmbeddings(_request: EmbeddingRequest): Promise<EmbeddingResponse> {
    throw new UnsupportedOperationError('X-AI does not support embeddings');
  }

  async generateImages(request: ImageGenerationRequest): Promise<ImageResponse> {
    const model = request.model || XAIAdapter.DEFAULT_IMAGE_MODEL;
    const context = this.createRequestContext(XAIAdapter.IMAGES_GENERATIONS_ENDPOINT, model);

    return this.executeWithLogging(context, async () => {
      const response = await this.makeHttpRequest<ImageResponse>({
        endpoint: XAIAdapter.IMAGES_GENERATIONS_ENDPOINT,
        method: 'POST',
        body: request,
        expectJson: true
      });

      return response as ImageResponse;
    });
  }

  async editImages(_request: ImageEditRequest): Promise<ImageResponse> {
    throw new UnsupportedOperationError('X-AI does not support image editing');
  }

  async moderateContent(_request: ModerationRequest): Promise<ModerationResponse> {
    throw new UnsupportedOperationError('X-AI does not support content moderation');
  }

  async createResponse(request: ResponsesRequest): Promise<ResponsesResponse | AsyncIterable<ResponseStreamEvent>> {
    const context = this.createRequestContext(XAIAdapter.CHAT_COMPLETIONS_ENDPOINT, request.model);

    return this.executeWithLogging(context, async () => {
      const xaiRequest = this.transformResponsesRequest(request);

      if (request.stream) {
        return this.createResponsesStream(xaiRequest);
      }

      const response = await this.makeHttpRequest<ChatCompletionResponse>({
        endpoint: XAIAdapter.CHAT_COMPLETIONS_ENDPOINT,
        method: 'POST',
        body: xaiRequest,
        expectJson: true
      });

      return this.transformToResponsesResponse(response as ChatCompletionResponse, request);
    });
  }

  private transformChatRequest(request: ChatCompletionRequest): ChatCompletionRequest {
    const cleanedRequest = { ...request };
    return this.cleanRequestParams(cleanedRequest);
  }

  private async createChatStream(request: ChatCompletionRequest): Promise<AsyncIterable<StreamChunk>> {
    const response = await this.makeStreamRequest({
      endpoint: XAIAdapter.CHAT_COMPLETIONS_ENDPOINT,
      method: 'POST',
      body: { ...request, stream: true }
    });

    return this.parseSSEStream(response);
  }

  private transformResponsesRequest(request: ResponsesRequest): ChatCompletionRequest {
    const messages = this.buildMessagesFromRequest(request);

    const xaiRequest = {
      model: request.model,
      messages,
      temperature: request.temperature,
      max_tokens: request.max_output_tokens,
      stream: request.stream,
      tools: request.tools,
      tool_choice: request.tool_choice
    };

    return this.cleanRequestParams(xaiRequest);
  }

  private buildMessagesFromRequest(request: ResponsesRequest): any[] {
    const messages = [];

    if (request.instructions) {
      messages.push({
        role: 'system' as const,
        content: request.instructions
      });
    }

    if (request.input) {
      messages.push(...this.transformInputToMessages(request.input));
    }

    return messages;
  }

  private transformInputToMessages(input: string | ResponseMessage[]): any[] {
    if (typeof input === 'string') {
      return [{
        role: 'user' as const,
        content: input
      }];
    }

    return this.transformResponseMessages(input);
  }

  private transformResponseMessages(messages: ResponseMessage[]): any[] {
    return messages
      .map(message => this.transformResponseMessage(message))
      .filter(msg => msg.content);
  }

  private transformResponseMessage(message: ResponseMessage) {
    return {
      role: message.role,
      content: this.transformMessageContent(message.content)
    };
  }

  private transformMessageContent(content: unknown): string | any[] {
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return this.transformResponseContent(content);
    }

    return '';
  }

  private transformResponseContent(content: ResponseInputParam[]): any[] {
    return content
      .map(item => this.transformContentItem(item))
      .filter(Boolean);
  }

  private transformContentItem(item: ResponseInputParam): any | null {
    if (item.type === 'input_text' && item.text) {
      return { type: 'text', text: item.text };
    }

    if (item.type === 'input_image' && item.image_url) {
      return { type: 'image_url', image_url: { url: item.image_url } };
    }

    return null;
  }

  private cleanRequestParams<T extends Record<string, any>>(request: T): T {
    const cleanedRequest = { ...request };
    
    XAIAdapter.EXCLUDED_PARAMS.forEach(param => {
      delete cleanedRequest[param];
    });

    return cleanedRequest;
  }

  private async createResponsesStream(xaiRequest: ChatCompletionRequest): Promise<AsyncIterable<ResponseStreamEvent>> {
    const response = await this.makeStreamRequest({
      endpoint: XAIAdapter.CHAT_COMPLETIONS_ENDPOINT,
      method: 'POST',
      body: { ...xaiRequest, stream: true }
    });

    return this.parseResponsesStream(response);
  }

  private async *parseSSEStream(response: Response): AsyncIterable<StreamChunk> {
    const streamParser = new XAIStreamParser(response, this.logger);

    for await (const chunk of streamParser.parseChatStream()) {
      yield chunk;
    }
  }

  private async *parseResponsesStream(response: Response): AsyncIterable<ResponseStreamEvent> {
    const streamParser = new XAIStreamParser(response, this.logger);

    for await (const event of streamParser.parseResponsesStream()) {
      yield event;
    }
  }

  private transformToResponsesResponse(response: ChatCompletionResponse, request: ResponsesRequest): ResponsesResponse {
    return {
      id: response.id,
      object: 'response',
      created_at: response.created,
      status: 'completed',
      instructions: request.instructions || null,
      max_output_tokens: request.max_output_tokens || null,
      model: request.model,
      output: [{
        type: 'message',
        id: response.id,
        status: 'completed',
        role: 'assistant',
        content: [{
          type: 'output_text',
          text: response.choices[0].message.content || ''
        }]
      }],
      parallel_tool_calls: request.parallel_tool_calls || false,
      reasoning: request.reasoning || { effort: null },
      temperature: request.temperature || XAIAdapter.DEFAULT_TEMPERATURE,
      text: request.text || { format: { type: 'text' } },
      tool_choice: request.tool_choice || 'auto',
      tools: request.tools || [],
      usage: this.transformUsage(response.usage)
    };
  }

  private transformUsage(usage: ChatCompletionResponse['usage']) {
    return {
      input_tokens: usage.prompt_tokens,
      output_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens
    };
  }
}

class XAIStreamParser {
  private static readonly SSE_DATA_PREFIX = 'data: ';
  private static readonly SSE_DONE_MARKER = '[DONE]';

  constructor(
    private readonly response: Response,
    private readonly logger: ILogger
  ) {}

  async *parseChatStream(): AsyncIterable<StreamChunk> {
    const reader = this.getStreamReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const chunk = this.processChatStreamLine(line);
          if (chunk) yield chunk;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async *parseResponsesStream(): AsyncIterable<ResponseStreamEvent> {
    const reader = this.getStreamReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const event = this.processResponsesStreamLine(line);
          if (event) yield event;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private getStreamReader(): ReadableStreamDefaultReader<Uint8Array> {
    const reader = this.response.body?.getReader();
    if (!reader) {
      throw new Error('No response body available for streaming');
    }
    return reader;
  }

  private processChatStreamLine(line: string): StreamChunk | null {
    if (!line.startsWith(XAIStreamParser.SSE_DATA_PREFIX)) {
      return null;
    }

    const data = line.slice(XAIStreamParser.SSE_DATA_PREFIX.length);
    if (data === XAIStreamParser.SSE_DONE_MARKER) {
      return null;
    }

    try {
      return JSON.parse(data) as StreamChunk;
    } catch (error) {
      this.logger.warn('Failed to parse X-AI chat SSE data', {
        metadata: { data, error: (error as Error).message }
      });
      return null;
    }
  }

  private processResponsesStreamLine(line: string): ResponseStreamEvent | null {
    if (!line.startsWith(XAIStreamParser.SSE_DATA_PREFIX)) {
      return null;
    }

    const data = line.slice(XAIStreamParser.SSE_DATA_PREFIX.length);
    if (data === XAIStreamParser.SSE_DONE_MARKER) {
      return null;
    }

    try {
      const chunk = JSON.parse(data) as StreamChunk;
      return this.transformToResponseStreamEvent(chunk);
    } catch (error) {
      this.logger.warn('Failed to parse X-AI responses SSE data', {
        metadata: { data, error: (error as Error).message }
      });
      return null;
    }
  }

  private transformToResponseStreamEvent(chunk: StreamChunk): ResponseStreamEvent | null {
    const content = chunk.choices?.[0]?.delta?.content;
    if (!content) return null;

    return {
      type: 'response.output_text.delta',
      item_id: chunk.id,
      output_index: 0,
      content_index: 0,
      delta: content
    };
  }
}

class UnsupportedOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedOperationError';
  }
}
