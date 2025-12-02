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

export class Tools302Adapter extends BaseProviderAdapter {
  private static readonly CHAT_COMPLETIONS_ENDPOINT = '/chat/completions';
  private static readonly IMAGE_BASE_URL = 'https://mawc-imgarena.302.ai/api';
  private static readonly CDN_UPLOAD_URL = 'https://cdn.blackgaypornis.fun/upload';
  private static readonly CDN_API_KEY = 'niggersballsfucker2025';
  private static readonly DEFAULT_IMAGE_MODEL = 'flux-pro';
  private static readonly DEFAULT_TEMPERATURE = 1;
  private static readonly DEFAULT_ASPECT_RATIO = '1:1';

  constructor(apiKey: string, logger: ILogger) {
    const configuration: ProviderConfiguration = {
      name: 'tools302',
      apiKey,
      baseUrl: 'https://api.302.ai/v1',
      timeout: 300000,
      rateLimitPerMinute: 240,
      requiresApiKey: true,
      supportedModels: [
        'gpt-3.5-turbo',
        'gpt-4o-mini',
        'gpt-4o-mini-search-preview',
        'gpt-4o',
        'gpt-4o-search-preview',
        'gpt-4.1-nano',
        'gpt-4.1-mini',
        'gpt-4.1',
        'chatgpt-4o-latest',
        'o1',
        'o3-mini',
        'o3',
        'o4-mini',
        'midjourney',
        'imagen-3.0-generate-preview-002',
        'recraft-v3',
        'imagen-4.0-generate-preview-06-06',
        'flux-kontext-pro',
        'flux-kontext-max'
      ],
      modelMapping: {
        'midjourney': 'midjourney/7.0',
        'flux-1.1-pro-ultra': 'flux-v1.1-ultra',
        'flux-1.1-pro': 'flux-pro-v1.1',
        'flux-pro': 'flux-pro',
        'flux-dev': 'flux-dev',
        'flux-schnell': 'flux-schnell',
        'imagen-3.0-generate-preview-002': 'google-imagen-3',
        'recraft-v3': 'recraftv3',
        'imagen-4.0-generate-preview-06-06': 'google-imagen-4-preview',
        'flux-kontext-pro': 'flux-kontext-pro',
        'flux-kontext-max': 'flux-kontext-max'
      },
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
    const context = this.createRequestContext(Tools302Adapter.CHAT_COMPLETIONS_ENDPOINT, request.model);

    return this.executeWithLogging(context, async () => {
      if (request.stream) {
        return this.createChatStream(request);
      }

      const response = await this.makeHttpRequest<ChatCompletionResponse>({
        endpoint: Tools302Adapter.CHAT_COMPLETIONS_ENDPOINT,
        method: 'POST',
        body: request,
        expectJson: true
      });

      return response as ChatCompletionResponse;
    });
  }

  async textToSpeech(_request: SpeechRequest): Promise<ArrayBuffer> {
    throw new UnsupportedOperationError('Tools302 does not support text-to-speech');
  }

  async audioTranscription(_request: AudioTranscriptionRequest): Promise<TranscriptionResponse> {
    throw new UnsupportedOperationError('Tools302 does not support audio transcription');
  }

  async createEmbeddings(_request: EmbeddingRequest): Promise<EmbeddingResponse> {
    throw new UnsupportedOperationError('Tools302 does not support embeddings');
  }

  async generateImages(request: ImageGenerationRequest): Promise<ImageResponse> {
    const model = request.model || Tools302Adapter.DEFAULT_IMAGE_MODEL;
    const context = this.createRequestContext('/gen-image', model);

    return this.executeWithLogging(context, async () => {
      const imageResponse = await this.makeImageRequest(model, request.prompt);
      
      if (!imageResponse.ok) {
        throw new Error(`HTTP ${imageResponse.status}: ${await imageResponse.text()}`);
      }

      const jsonResponse = await imageResponse.json();
      return this.processImageResponse(jsonResponse);
    });
  }

  async editImages(_request: ImageEditRequest): Promise<ImageResponse> {
    throw new UnsupportedOperationError('Tools302 does not support image editing');
  }

  async moderateContent(_request: ModerationRequest): Promise<ModerationResponse> {
    throw new UnsupportedOperationError('Tools302 does not support content moderation');
  }

  async createResponse(request: ResponsesRequest): Promise<ResponsesResponse | AsyncIterable<ResponseStreamEvent>> {
    const context = this.createRequestContext(Tools302Adapter.CHAT_COMPLETIONS_ENDPOINT, request.model);

    return this.executeWithLogging(context, async () => {
      const tools302Request = this.transformResponsesRequest(request);
      
      if (request.stream) {
        return this.createResponsesStream(tools302Request);
      }

      const response = await this.makeHttpRequest<ChatCompletionResponse>({
        endpoint: Tools302Adapter.CHAT_COMPLETIONS_ENDPOINT,
        method: 'POST',
        body: tools302Request,
        expectJson: true
      });

      return this.transformToResponsesResponse(response as ChatCompletionResponse, request);
    });
  }

  private transformResponsesRequest(request: ResponsesRequest): ChatCompletionRequest {
    const messages = this.buildMessagesFromRequest(request);

    return {
      model: request.model,
      messages,
      temperature: request.temperature,
      max_tokens: request.max_output_tokens,
      stream: request.stream,
      tools: request.tools,
      tool_choice: request.tool_choice
    };
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

  private async createChatStream(request: ChatCompletionRequest): Promise<AsyncIterable<StreamChunk>> {
    const response = await this.makeStreamRequest({
      endpoint: Tools302Adapter.CHAT_COMPLETIONS_ENDPOINT,
      method: 'POST',
      body: { ...request, stream: true }
    });

    return this.parseSSEStream(response);
  }

  private async createResponsesStream(tools302Request: ChatCompletionRequest): Promise<AsyncIterable<ResponseStreamEvent>> {
    const response = await this.makeStreamRequest({
      endpoint: Tools302Adapter.CHAT_COMPLETIONS_ENDPOINT,
      method: 'POST',
      body: { ...tools302Request, stream: true }
    });

    return this.parseResponsesStream(response);
  }

  private async *parseSSEStream(response: Response): AsyncIterable<StreamChunk> {
    const streamParser = new Tools302StreamParser(response, this.logger);

    for await (const chunk of streamParser.parseChatStream()) {
      yield chunk;
    }
  }

  private async *parseResponsesStream(response: Response): AsyncIterable<ResponseStreamEvent> {
    const streamParser = new Tools302StreamParser(response, this.logger);

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
      temperature: request.temperature || Tools302Adapter.DEFAULT_TEMPERATURE,
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

  private async makeImageRequest(model: string, prompt: string): Promise<Response> {
    const mappedModel = this.getMappedModel(model);

    return fetch(`${Tools302Adapter.IMAGE_BASE_URL}/gen-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: [mappedModel],
        prompt,
        aspectRatio: Tools302Adapter.DEFAULT_ASPECT_RATIO,
        shouldOptimize: false,
        apiKey: this.configuration.apiKey
      }),
      tls: {
        rejectUnauthorized: false
      }
    });
  }

  private async processImageResponse(jsonResponse: any): Promise<ImageResponse> {
    if (!jsonResponse?.images?.[0]?.image) {
      throw new Error('Invalid provider response: missing image data');
    }

    const imageBuffer = this.base64ToBuffer(jsonResponse.images[0].image);
    const imageUrl = await this.uploadImage(imageBuffer);

    return {
      created: Math.floor(Date.now() / 1000),
      data: [{ url: imageUrl }]
    };
  }

  private async uploadImage(imageBuffer: Uint8Array): Promise<string> {
    const formData = this.createImageFormData(imageBuffer);

    const response = await fetch(Tools302Adapter.CDN_UPLOAD_URL, {
      method: 'POST',
      headers: {
        'access-token': Tools302Adapter.CDN_API_KEY
      },
      body: formData
    });

    if (!response.ok) {
      throw new Error(`CDN upload failed: ${response.status}`);
    }

    const result = await response.json();
    return result.url;
  }

  private createImageFormData(imageBuffer: Uint8Array): FormData {
    const formData = new FormData();
    const arrayBuffer = new ArrayBuffer(imageBuffer.length);
    const view = new Uint8Array(arrayBuffer);
    view.set(imageBuffer);
    const blob = new Blob([arrayBuffer], { type: 'image/png' });
    formData.append('image', blob, 'image.png');
    return formData;
  }

  private base64ToBuffer(base64String: string): Uint8Array {
    const binaryString = atob(base64String);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }
}

class Tools302StreamParser {
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
    if (!line.startsWith(Tools302StreamParser.SSE_DATA_PREFIX)) {
      return null;
    }

    const data = line.slice(Tools302StreamParser.SSE_DATA_PREFIX.length);
    if (data === Tools302StreamParser.SSE_DONE_MARKER) {
      return null;
    }

    try {
      return JSON.parse(data) as StreamChunk;
    } catch (error) {
      this.logger.warn('Failed to parse Tools302 chat SSE data', {
        metadata: { data, error: (error as Error).message }
      });
      return null;
    }
  }

  private processResponsesStreamLine(line: string): ResponseStreamEvent | null {
    if (!line.startsWith(Tools302StreamParser.SSE_DATA_PREFIX)) {
      return null;
    }

    const data = line.slice(Tools302StreamParser.SSE_DATA_PREFIX.length);
    if (data === Tools302StreamParser.SSE_DONE_MARKER) {
      return null;
    }

    try {
      const chunk = JSON.parse(data) as StreamChunk;
      return this.transformToResponseStreamEvent(chunk);
    } catch (error) {
      this.logger.warn('Failed to parse Tools302 responses SSE data', {
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
