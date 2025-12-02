import { BaseProviderAdapter, type ProviderConfiguration } from '../base';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
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
  ImageGenerationRequest,
  ImageEditRequest,
  ImageResponse,
  ModerationRequest,
  ModerationResponse
} from '../types';
import type { ILogger } from '../../../core/logging';

interface AnthropicContent {
  readonly type: 'text' | 'image' | 'tool_use' | 'tool_result' | 'thinking';
  readonly text?: string;
  readonly thinking?: string;
  readonly signature?: string;
  readonly id?: string;
  readonly name?: string;
  readonly input?: unknown;
  readonly tool_use_id?: string;
  readonly content?: string | AnthropicContent[];
  readonly cache_control?: {
    readonly type: 'ephemeral';
    readonly ttl?: '5m' | '1h';
  };
  readonly source?: {
    readonly type: 'base64' | 'url';
    readonly media_type?: string;
    readonly data?: string;
    readonly url?: string;
  };
}

interface AnthropicResponse {
  readonly id: string;
  readonly content: AnthropicContent[];
  readonly model: string;
  readonly stop_reason: string;
  readonly usage: {
    readonly input_tokens: number;
    readonly output_tokens: number;
    readonly cache_read_input_tokens?: number;
  };
}

interface AnthropicStreamEvent {
  readonly type: string;
  readonly message?: { readonly id: string };
  readonly delta?: {
    readonly type: 'thinking_delta' | 'text_delta';
    readonly text: string;
    readonly thinking?: string
  };
}

export class AnthropicAdapter extends BaseProviderAdapter {
  private static readonly ANTHROPIC_VERSION = '2023-06-01';
  private static readonly DEFAULT_MAX_TOKENS = 4096;
  private static readonly DEFAULT_TEMPERATURE = 1;
  private static readonly MESSAGES_ENDPOINT = '/messages';
  private static readonly REASONING_BUDGET_MAP = { low: 1024, medium: 2048, high: 4096 };

  constructor(apiKey: string, logger: ILogger) {
    const configuration: ProviderConfiguration = {
      name: 'anthropic',
      apiKey,
      baseUrl: 'https://api.anthropic.com/v1',
      timeout: 300000,
      rateLimitPerMinute: 240,
      requiresApiKey: true,
      supportedModels: [
        'claude-3-5-sonnet-20240620',
        'claude-3-5-haiku-20241022',
        'claude-3-5-sonnet-20241022',
        'claude-3-7-sonnet-20250219',
        'claude-sonnet-4-20250514',
        'claude-opus-4-20250514',
        'claude-opus-4-1-20250805',
        'claude-opus-4-5-20251101',
        'claude-sonnet-4-5-20250929',
        'claude-haiku-4-5-20251001'
      ],
      capabilities: {
        chat: true,
        audio: false,
        embeddings: false,
        images: false,
        videos: false,
        moderation: false,
        responses: true
      }
    };

    super(configuration, logger);
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse | AsyncIterable<StreamChunk>> {
    const context = this.createRequestContext(AnthropicAdapter.MESSAGES_ENDPOINT, request.model);

    return this.executeWithLogging(context, async () => {
      const anthropicRequest = this.transformChatRequest(request);

      if (request.stream) {
        return this.createChatStream(anthropicRequest, request.model, Boolean(request.reasoning_effort));
      }

      const response = await this.makeHttpRequest<AnthropicResponse>({
        endpoint: AnthropicAdapter.MESSAGES_ENDPOINT,
        method: 'POST',
        body: anthropicRequest,
        expectJson: true
      });

      return this.transformChatResponse(response as AnthropicResponse, request.model);
    });
  }

  async textToSpeech(_request: SpeechRequest): Promise<ArrayBuffer> {
    throw new UnsupportedOperationError('Anthropic does not support text-to-speech');
  }

  async audioTranscription(_request: AudioTranscriptionRequest): Promise<TranscriptionResponse> {
    throw new UnsupportedOperationError('Anthropic does not support audio transcription');
  }

  async createEmbeddings(_request: EmbeddingRequest): Promise<EmbeddingResponse> {
    throw new UnsupportedOperationError('Anthropic does not support embeddings');
  }

  async generateImages(_request: ImageGenerationRequest): Promise<ImageResponse> {
    throw new UnsupportedOperationError('Anthropic does not support image generation');
  }

  async editImages(_request: ImageEditRequest): Promise<ImageResponse> {
    throw new UnsupportedOperationError('Anthropic does not support image editing');
  }

  async moderateContent(_request: ModerationRequest): Promise<ModerationResponse> {
    throw new UnsupportedOperationError('Anthropic does not support content moderation');
  }

  async createResponse(request: ResponsesRequest): Promise<ResponsesResponse | AsyncIterable<ResponseStreamEvent>> {
    const context = this.createRequestContext(AnthropicAdapter.MESSAGES_ENDPOINT, request.model);

    return this.executeWithLogging(context, async () => {
      const anthropicRequest = this.transformResponsesRequest(request);

      if (request.stream) {
        return this.createResponsesStream(anthropicRequest, Boolean(request.reasoning?.effort));
      }

      const response = await this.makeHttpRequest<AnthropicResponse>({
        endpoint: AnthropicAdapter.MESSAGES_ENDPOINT,
        method: 'POST',
        body: anthropicRequest,
        expectJson: true
      });

      return this.transformToResponsesResponse(response as AnthropicResponse, request);
    });
  }

  protected createHttpHeaders(additionalHeaders?: Record<string, string>): Record<string, string> {
    const anthropicHeaders = {
      'X-Api-Key': this.configuration.apiKey,
      'Anthropic-Version': AnthropicAdapter.ANTHROPIC_VERSION
    };

    return super.createHttpHeaders({ ...anthropicHeaders, ...additionalHeaders });
  }

  private transformChatRequest(request: ChatCompletionRequest): unknown {
    const { systemMessages, userMessages } = this.separateSystemMessages(request.messages);
    const transformedMessages = userMessages.map((msg, index, array) => 
      this.transformMessage(msg, index === array.length - 1)
    );

    const anthropicRequest: any = {
      model: this.getMappedModel(request.model),
      // Anthropic Messages API expects `max_tokens`
      max_tokens: (request.max_tokens ?? request.max_completion_tokens) || AnthropicAdapter.DEFAULT_MAX_TOKENS,
      messages: transformedMessages,
      system: this.buildSystemArray(systemMessages),
      temperature: request.temperature,
      stream: request.stream,
      stop_sequences: this.transformStopSequences(request.stop)
    };

    if (request.reasoning_effort) {
      const effort = request.reasoning_effort as keyof typeof AnthropicAdapter.REASONING_BUDGET_MAP;
      const budget = AnthropicAdapter.REASONING_BUDGET_MAP[effort];
      anthropicRequest.thinking = { type: 'enabled', budget_tokens: budget };
      anthropicRequest.temperature = 1.0;
      if (anthropicRequest.max_tokens <= budget) anthropicRequest.max_tokens = budget + 1;
    }

    return anthropicRequest;
  }

  private separateSystemMessages(messages: any[]) {
    const systemMessages = messages.filter(m => m.role === 'system');
    const userMessages = messages.filter(m => m.role !== 'system');
    return { systemMessages, userMessages };
  }

  private buildSystemArray(systemMessages: any[]): AnthropicContent[] {
    const systemArray: AnthropicContent[] = [];
    
    for (const message of systemMessages) {
      if (typeof message.content === 'string') {
        systemArray.push({
          type: 'text',
          text: message.content
        });
      } else if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part.type === 'text' && part.text) {
            systemArray.push({
              type: 'text',
              text: part.text
            });
          }
        }
      }
    }

    if (systemArray.length > 0) {
      systemArray[systemArray.length - 1] = {
        ...systemArray[systemArray.length - 1],
        cache_control: { type: 'ephemeral' }
      };
    }

    return systemArray;
  }

  private transformMessage(msg: any, isLastMessage: boolean = false) {
    return {
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: this.transformMessageContent(msg.content, isLastMessage)
    };
  }

  private transformMessageContent(content: unknown, isLastMessage: boolean = false): string | AnthropicContent[] {
    if (typeof content === 'string') {
      return [{
        type: 'text',
        text: content,
        ...(isLastMessage ? { cache_control: { type: 'ephemeral' } } : {})
      }];
    }

    if (!Array.isArray(content)) {
      return '';
    }

    const transformedContent = content.map(part => this.transformContentPart(part));
    return transformedContent.filter(part => part.type !== 'text' || part.text);
  }

  private transformContentPart(part: any): AnthropicContent {
    switch (part.type) {
      case 'text':
      case 'input_text':
        return { type: 'text', text: part.text };
      case 'image_url':
      case 'input_image':
        return this.transformImageContent(part);
      default:
        return { type: 'text', text: '' };
    }
  }

  private transformImageContent(part: any): AnthropicContent {
    const imageUrl = part.image_url?.url || part.image_url;
    const isBase64 = imageUrl?.startsWith('data:');
    let mediaType = 'image/jpeg';

    if (isBase64) {
      const match = imageUrl.match(/^data:(image\/[a-zA-Z+]+);base64,/);
      if (match) {
        mediaType = match[1];
      }
    }
    
    return {
      type: 'image',
      source: {
        type: isBase64 ? 'base64' : 'url',
        media_type: mediaType,
        data: isBase64 ? imageUrl.split(',')[1] : undefined,
        url: !isBase64 && imageUrl?.startsWith('http') ? imageUrl : undefined
      }
    };
  }

  private transformStopSequences(stop: string | string[] | undefined): string[] | undefined {
    if (!stop) return undefined;
    return Array.isArray(stop) ? stop : [stop];
  }

  private extractThinkingBlocks(content: AnthropicContent[]): any[] {
    return content
      .filter(block => block.type === 'thinking' && block.thinking !== undefined)
      .map(block => {
        return {
          type: block.type,
          thinking: block.thinking as string,
          signature: block.signature
        };
      });
  }

  private transformChatResponse(response: AnthropicResponse, model: string): ChatCompletionResponse {
    const content = this.extractTextContent(response.content);
    const thinkingBlocks = this.extractThinkingBlocks(response.content);
    
    return {
      id: response.id,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content,
          tool_calls: undefined,
          reasoning_content: thinkingBlocks.length > 0 ? thinkingBlocks : undefined
        },
        finish_reason: this.mapStopReason(response.stop_reason)
      }],
      usage: this.transformChatUsage(response.usage)
    };
  }

  private extractTextContent(content: AnthropicContent[]): string {
    return content.find(c => c.type === 'text')?.text || '';
  }

  private mapStopReason(stopReason: string): 'stop' | 'length' | null {
    if (stopReason === 'end_turn' || stopReason === 'stop_sequence') return 'stop';
    if (stopReason === 'max_tokens') return 'length';
    return null;
  }

  private transformChatUsage(usage: AnthropicResponse['usage']) {
    return {
      prompt_tokens: usage.input_tokens,
      completion_tokens: usage.output_tokens,
      total_tokens: usage.input_tokens + usage.output_tokens
    };
  }

  private transformResponsesUsage(usage: AnthropicResponse['usage']) {
    return {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      total_tokens: usage.input_tokens + usage.output_tokens
    };
  }

  private async createChatStream(anthropicRequest: any, model: string, hasReasoning: boolean): Promise<AsyncIterable<StreamChunk>> {
    const response = await this.makeStreamRequest({
      endpoint: AnthropicAdapter.MESSAGES_ENDPOINT,
      method: 'POST',
      body: { ...anthropicRequest, stream: true }
    });

    return this.parseAnthropicChatStream(response, model, hasReasoning);
  }

  private async *parseAnthropicChatStream(response: Response, model: string, hasReasoning: boolean): AsyncIterable<StreamChunk> {
    const streamParser = new AnthropicStreamParser(response, this.logger);
    
    for await (const event of streamParser.parse()) {
      if (event.type === 'content_block_delta') {
        if (hasReasoning && event.delta?.type === 'thinking_delta' && event.delta?.thinking) {
          yield this.createReasoningStreamChunk(event, model, [{
            type: 'thinking',
            thinking: event.delta.thinking
          }]);
        }
      }
      
      if (this.isChatStreamEvent(event)) {
        yield this.transformChatStreamEvent(event, model);
      }
    }
  }

  private isChatStreamEvent(event: AnthropicStreamEvent): boolean {
    return event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && Boolean(event.delta?.text);
  }

  private createReasoningStreamChunk(event: AnthropicStreamEvent, model: string, thinkingBlocks: any[]): StreamChunk {
    return {
      id: event.message?.id || 'chatcmpl-anthropic',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        delta: {
          role: 'assistant',
          content: '',
          reasoning_content: thinkingBlocks
        },
        finish_reason: null
      }]
    };
  }

  private transformChatStreamEvent(event: AnthropicStreamEvent, model: string): StreamChunk {
    return {
      id: event.message?.id || 'chatcmpl-anthropic',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        delta: {
          role: 'assistant',
          content: event.delta?.text || ''
        },
        finish_reason: null
      }]
    };
  }

  private transformResponsesRequest(request: ResponsesRequest): unknown {
    const baseRequest: any = {
      model: this.getMappedModel(request.model),
      // Anthropic Responses API expects `max_output_tokens`
      max_output_tokens: request.max_output_tokens || AnthropicAdapter.DEFAULT_MAX_TOKENS,
      messages: this.transformResponseMessages(request),
      system: request.instructions,
      temperature: request.temperature,
      stream: request.stream
    };

    if (request.reasoning?.effort) {
      const effort = request.reasoning.effort as keyof typeof AnthropicAdapter.REASONING_BUDGET_MAP;
      const budget = AnthropicAdapter.REASONING_BUDGET_MAP[effort];
      baseRequest.thinking = { type: 'enabled', budget_tokens: budget };
      baseRequest.temperature = 1.0;
      if (baseRequest.max_output_tokens <= budget) baseRequest.max_output_tokens = budget + 1;
    }

    return baseRequest;
  }

  private transformResponseMessages(request: ResponsesRequest): any[] {
    if (!request.input) return [];

    if (typeof request.input === 'string') {
      return [{ role: 'user', content: request.input }];
    }

    return this.transformResponseMessageArray(request.input);
  }

  private transformResponseMessageArray(messages: ResponseMessage[]): any[] {
    return messages
      .map(message => this.transformResponseMessage(message))
      .filter(msg => msg.content);
  }

  private transformResponseMessage(message: ResponseMessage) {
    return {
      role: message.role === 'system' ? 'user' : message.role,
      content: this.transformResponseMessageContent(message.content)
    };
  }

  private transformResponseMessageContent(content: unknown): string | AnthropicContent[] {
    if (typeof content === 'string') {
      return content;
    }

    if (!Array.isArray(content)) {
      return '';
    }

    const transformedContent = content
      .map(item => this.transformResponseContentItem(item))
      .filter(item => this.isValidContent(item));

    return this.optimizeContentArray(transformedContent);
  }

  private transformResponseContentItem(item: ResponseInputParam): AnthropicContent {
    if (item.type === 'input_text' && item.text) {
      return { type: 'text', text: item.text };
    }

    if (item.type === 'input_image' && item.image_url) {
      return this.transformResponseImageContent(item);
    }

    return { type: 'text', text: '' };
  }

  private transformResponseImageContent(item: ResponseInputParam): AnthropicContent {
    const isBase64 = item.image_url?.startsWith('data:');
    let mediaType = 'image/jpeg';

    if (isBase64) {
      const match = item.image_url?.match(/^data:(image\/[a-zA-Z+]+);base64,/);
      if (match) {
        mediaType = match[1];
      }
    }
    
    return {
      type: 'image',
      source: {
        type: isBase64 ? 'base64' : 'url',
        media_type: mediaType,
        data: isBase64 ? item.image_url?.split(',')[1] : undefined,
        url: !isBase64 && item.image_url?.startsWith('http') ? item.image_url : undefined
      }
    };
  }

  private isValidContent(item: AnthropicContent): boolean {
    return item.type !== 'text' || Boolean(item.text);
  }

  private optimizeContentArray(content: AnthropicContent[]): string | AnthropicContent[] {
    if (content.length === 1 && content[0].type === 'text' && content[0].text) {
      return content[0].text;
    }
    return content;
  }

  private async createResponsesStream(anthropicRequest: any, hasReasoning: boolean): Promise<AsyncIterable<ResponseStreamEvent>> {
    const response = await this.makeStreamRequest({
      endpoint: AnthropicAdapter.MESSAGES_ENDPOINT,
      method: 'POST',
      body: { ...anthropicRequest, stream: true }
    });

    return this.parseResponsesStream(response, hasReasoning);
  }

  private async *parseResponsesStream(response: Response, hasReasoning: boolean): AsyncIterable<ResponseStreamEvent> {
    const streamParser = new AnthropicStreamParser(response, this.logger);
    const thinkingBlocks: any[] = [];
    let hasYieldedReasoningMessage = false;
    
    for await (const event of streamParser.parse()) {
      if (event.type === 'content_block_delta') {
        if (event.delta?.type === 'thinking_delta' && event.delta?.thinking) {
          thinkingBlocks.push({
            type: 'thinking',
            thinking: event.delta.thinking
          });
        }

        if (hasReasoning && !hasYieldedReasoningMessage && thinkingBlocks.length > 0 && event.delta?.type === 'text_delta') {
          yield this.createReasoningResponseEvent(event, thinkingBlocks);
          hasYieldedReasoningMessage = true;
        }
      }
      
      if (this.isResponseStreamEvent(event)) {
        yield this.transformResponseStreamEvent(event);
      }
    }
  }

  private isResponseStreamEvent(event: AnthropicStreamEvent): boolean {
    return event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && Boolean(event.delta?.text);
  }

  private createReasoningResponseEvent(event: AnthropicStreamEvent, thinkingBlocks: any[]): ResponseStreamEvent {
    return {
      type: 'response.output_text.delta',
      item_id: event.message?.id || 'resp-anthropic',
      output_index: 0,
      content_index: 0,
      delta: '',
      reasoning: { content: thinkingBlocks }
    };
  }

  private transformResponseStreamEvent(event: AnthropicStreamEvent): ResponseStreamEvent {
    return {
      type: 'response.output_text.delta',
      item_id: event.message?.id || 'resp-anthropic',
      output_index: 0,
      content_index: 0,
      delta: event.delta?.text || ''
    };
  }

  private transformToResponsesResponse(response: AnthropicResponse, request: ResponsesRequest): ResponsesResponse {
    const content = this.extractTextContent(response.content);
    const thinkingBlocks = this.extractThinkingBlocks(response.content);
    
    const reasoning = request.reasoning || { effort: null };
    if (thinkingBlocks.length > 0) {
      reasoning.content = thinkingBlocks;
    }
    
    return {
      id: response.id,
      object: 'response',
      created_at: Math.floor(Date.now() / 1000),
      status: 'completed',
      instructions: request.instructions || null,
      max_output_tokens: request.max_output_tokens || null,
      model: response.model,
      output: [{
        type: 'message',
        id: response.id,
        status: 'completed',
        role: 'assistant',
        content: [{
          type: 'output_text',
          text: content
        }]
      }],
      parallel_tool_calls: request.parallel_tool_calls || false,
      reasoning: reasoning,
      temperature: request.temperature || AnthropicAdapter.DEFAULT_TEMPERATURE,
      text: request.text || { format: { type: 'text' } },
      tool_choice: request.tool_choice || 'auto',
      tools: request.tools || [],
      usage: this.transformResponsesUsage(response.usage)
    };
  }
}

class AnthropicStreamParser {
  private static readonly SSE_DATA_PREFIX = 'data: ';
  private static readonly SSE_DONE_MARKER = '[DONE]';

  constructor(
    private readonly response: Response,
    private readonly logger: ILogger
  ) {}

  async *parse(): AsyncIterable<AnthropicStreamEvent> {
    const reader = this.response.body?.getReader();
    if (!reader) {
      throw new Error('No response body available for streaming');
    }

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
          yield* this.processLine(line);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private *processLine(line: string): Generator<AnthropicStreamEvent> {
    if (!line.startsWith(AnthropicStreamParser.SSE_DATA_PREFIX)) {
      return;
    }

    const data = line.slice(AnthropicStreamParser.SSE_DATA_PREFIX.length);
    if (data === AnthropicStreamParser.SSE_DONE_MARKER) {
      return;
    }

    try {
      const event = JSON.parse(data) as AnthropicStreamEvent;
      yield event;
    } catch (error) {
      this.logger.warn('Failed to parse Anthropic SSE data', {
        metadata: { data, error: (error as Error).message }
      });
    }
  }
}

class UnsupportedOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedOperationError';
  }
}
