import { BaseProviderAdapter, type ProviderConfiguration } from '../base';
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
  VideoCreateRequest,
  VideoRemixRequest,
  VideoResponse,
  VideoListResponse,
  VideoVariant,
  ModerationRequest,
  ModerationResponse,
  ResponsesRequest,
  ResponsesResponse,
  ResponseStreamEvent
} from '../types';
import type { ILogger } from '../../../core/logging';

export class OpenAIAdapter extends BaseProviderAdapter {
  private static readonly CHAT_COMPLETIONS_ENDPOINT = '/chat/completions';
  private static readonly AUDIO_SPEECH_ENDPOINT = '/audio/speech';
  private static readonly AUDIO_TRANSCRIPTIONS_ENDPOINT = '/audio/transcriptions';
  private static readonly EMBEDDINGS_ENDPOINT = '/embeddings';
  private static readonly IMAGES_GENERATIONS_ENDPOINT = '/images/generations';
  private static readonly IMAGES_EDITS_ENDPOINT = '/images/edits';
  private static readonly VIDEOS_ENDPOINT = '/videos';
  private static readonly RESPONSES_ENDPOINT = '/responses';
  private static readonly DEFAULT_IMAGE_MODEL = 'dall-e-3';
  private static readonly DEFAULT_IMAGE_EDIT_MODEL = 'dall-e-2';

  constructor(apiKey: string, logger: ILogger) {
    const configuration: ProviderConfiguration = {
      name: 'openai',
      apiKey,
      baseUrl: 'https://api.openai.com/v1',
      timeout: 300000,
      rateLimitPerMinute: 240,
      requiresApiKey: true,
      supportedModels: [
        'gpt-4o-mini',
        'gpt-4o-mini-search-preview',
        'gpt-4o',
        'gpt-4o-search-preview',
        'gpt-4.1-nano',
        'gpt-4.1-mini',
        'gpt-4.1',
        'chatgpt-4o-latest',
        'gpt-5-nano',
        'gpt-5-mini',
        'gpt-5-chat',
        'gpt-5',
        'gpt-5-codex',
        'gpt-5.1-codex',
        'gpt-5.1-codex-mini',
        'o1',
        'o3-mini',
        'o3',
        'o4-mini',
        'dall-e-3',
        'gpt-image-1',
        'text-embedding-3-small',
        'text-embedding-3-large',
        'tts-1',
        'tts-1-hd',
        'gpt-4o-mini-tts',
        'whisper-1',
        'gpt-4o-mini-transcribe',
        'gpt-4o-transcribe',
      ],
      capabilities: {
        chat: true,
        audio: true,
        embeddings: true,
        images: true,
        videos: false,
        moderation: false,
        responses: true
      }
    };

    super(configuration, logger);
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse | AsyncIterable<StreamChunk>> {
    if (this.isCodexModel(request.model)) {
      return this.chatCompletionViaResponses(request);
    }

    const context = this.createRequestContext(OpenAIAdapter.CHAT_COMPLETIONS_ENDPOINT, request.model);

    return this.executeWithLogging(context, async () => {
      const transformedRequest = this.transformMaxTokensForModel(request);
      
      if (transformedRequest.stream) {
        return this.createChatStream(transformedRequest);
      }

      const response = await this.makeHttpRequest<ChatCompletionResponse>({
        endpoint: OpenAIAdapter.CHAT_COMPLETIONS_ENDPOINT,
        method: 'POST',
        body: transformedRequest,
        expectJson: true
      });

      return response as ChatCompletionResponse;
    });
  }

  async textToSpeech(request: SpeechRequest): Promise<ArrayBuffer> {
    const context = this.createRequestContext(OpenAIAdapter.AUDIO_SPEECH_ENDPOINT, request.model);

    return this.executeWithLogging(context, async () => {
      const response = await this.makeHttpRequest<Response>({
        endpoint: OpenAIAdapter.AUDIO_SPEECH_ENDPOINT,
        method: 'POST',
        body: request,
        expectJson: false
      });

      return (response as Response).arrayBuffer();
    });
  }

  async audioTranscription(request: AudioTranscriptionRequest): Promise<TranscriptionResponse> {
    const context = this.createRequestContext(OpenAIAdapter.AUDIO_TRANSCRIPTIONS_ENDPOINT, request.model);

    return this.executeWithLogging(context, async () => {
      const formData = this.createAudioFormData(request);
      const headers = this.createHttpHeaders();

      const response = await this.makeStreamRequest({
        endpoint: OpenAIAdapter.AUDIO_TRANSCRIPTIONS_ENDPOINT,
        method: 'POST',
        body: formData,
        headers
      });

      return response.json() as Promise<TranscriptionResponse>;
    });
  }

  async createEmbeddings(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const context = this.createRequestContext(OpenAIAdapter.EMBEDDINGS_ENDPOINT, request.model);

    return this.executeWithLogging(context, async () => {
      const response = await this.makeHttpRequest<EmbeddingResponse>({
        endpoint: OpenAIAdapter.EMBEDDINGS_ENDPOINT,
        method: 'POST',
        body: request,
        expectJson: true
      });

      return response as EmbeddingResponse;
    });
  }

  async generateImages(request: ImageGenerationRequest): Promise<ImageResponse> {
    const model = request.model || OpenAIAdapter.DEFAULT_IMAGE_MODEL;
    const context = this.createRequestContext(OpenAIAdapter.IMAGES_GENERATIONS_ENDPOINT, model);

    return this.executeWithLogging(context, async () => {
      const requestBody = model === 'gpt-image-1'
        ? { ...request, moderation: 'low' }
        : request;

      const response = await this.makeHttpRequest<ImageResponse>({
        endpoint: OpenAIAdapter.IMAGES_GENERATIONS_ENDPOINT,
        method: 'POST',
        body: requestBody,
        expectJson: true
      });

      return this.transformImageResponse(response);
    });
  }

  async editImages(request: ImageEditRequest): Promise<ImageResponse> {
    const model = request.model || OpenAIAdapter.DEFAULT_IMAGE_EDIT_MODEL;
    const context = this.createRequestContext(OpenAIAdapter.IMAGES_EDITS_ENDPOINT, model);

    return this.executeWithLogging(context, async () => {
      const formData = this.createImageEditFormData(request);
      const headers = this.createHttpHeaders();

      const response = await this.makeStreamRequest({
        endpoint: OpenAIAdapter.IMAGES_EDITS_ENDPOINT,
        method: 'POST',
        body: formData,
        headers
      });

      return response.json() as Promise<ImageResponse>;
    });
  }

  async moderateContent(_request: ModerationRequest): Promise<ModerationResponse> {
    throw new UnsupportedOperationError('OpenAI does not support content moderation');
  }

  async createResponse(request: ResponsesRequest): Promise<ResponsesResponse | AsyncIterable<ResponseStreamEvent>> {
    const context = this.createRequestContext(OpenAIAdapter.RESPONSES_ENDPOINT, request.model);

    return this.executeWithLogging(context, async () => {
      if (request.stream) {
        return this.createResponseStream(request);
      }

      const response = await this.makeHttpRequest<ResponsesResponse>({
        endpoint: OpenAIAdapter.RESPONSES_ENDPOINT,
        method: 'POST',
        body: request,
        expectJson: true
      });

      return response as ResponsesResponse;
    });
  }

  async createVideo(request: VideoCreateRequest): Promise<VideoResponse> {
    const context = this.createRequestContext(OpenAIAdapter.VIDEOS_ENDPOINT, request.model);

    return this.executeWithLogging(context, async () => {
      const formData = this.createVideoFormData(request);
      const headers = this.createHttpHeaders();

      const response = await this.makeStreamRequest({
        endpoint: OpenAIAdapter.VIDEOS_ENDPOINT,
        method: 'POST',
        body: formData,
        headers
      });

      return response.json() as Promise<VideoResponse>;
    });
  }

  async getVideoStatus(videoId: string): Promise<VideoResponse> {
    const endpoint = `${OpenAIAdapter.VIDEOS_ENDPOINT}/${videoId}?_=${Date.now()}`;
    const context = this.createRequestContext(endpoint, 'sora-2');

    return this.executeWithLogging(context, async () => {
      const response = await this.makeHttpRequest<VideoResponse>({
        endpoint,
        method: 'GET',
        expectJson: true,
        headers: { 'Cache-Control': 'no-cache' }
      });

      return response as VideoResponse;
    });
  }

  async downloadVideo(videoId: string, variant: VideoVariant = 'video'): Promise<ArrayBuffer> {
    const endpoint = `${OpenAIAdapter.VIDEOS_ENDPOINT}/${videoId}/content?variant=${variant}`;
    const context = this.createRequestContext(endpoint, 'sora-2');

    return this.executeWithLogging(context, async () => {
      const response = await this.makeHttpRequest<Response>({
        endpoint,
        method: 'GET',
        expectJson: false
      });

      return (response as Response).arrayBuffer();
    });
  }

  async listVideos(params?: { limit?: number; after?: string; order?: 'asc' | 'desc' }): Promise<VideoListResponse> {
    const queryParams = new URLSearchParams();
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.after) queryParams.append('after', params.after);
    if (params?.order) queryParams.append('order', params.order);
    
    const endpoint = `${OpenAIAdapter.VIDEOS_ENDPOINT}${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    const context = this.createRequestContext(endpoint, 'sora-2');

    return this.executeWithLogging(context, async () => {
      const response = await this.makeHttpRequest<VideoListResponse>({
        endpoint,
        method: 'GET',
        expectJson: true
      });

      return response as VideoListResponse;
    });
  }

  async deleteVideo(videoId: string): Promise<void> {
    const endpoint = `${OpenAIAdapter.VIDEOS_ENDPOINT}/${videoId}`;
    const context = this.createRequestContext(endpoint, 'sora-2');

    return this.executeWithLogging(context, async () => {
      await this.makeHttpRequest({
        endpoint,
        method: 'DELETE',
        expectJson: false
      });
    });
  }

  async remixVideo(videoId: string, request: VideoRemixRequest): Promise<VideoResponse> {
    const endpoint = `${OpenAIAdapter.VIDEOS_ENDPOINT}/${videoId}/remix`;
    const context = this.createRequestContext(endpoint, 'sora-2');

    return this.executeWithLogging(context, async () => {
      const response = await this.makeHttpRequest<VideoResponse>({
        endpoint,
        method: 'POST',
        body: request,
        expectJson: true
      });

      return response as VideoResponse;
    });
  }

  private transformMaxTokensForModel(request: ChatCompletionRequest): ChatCompletionRequest {
    const modelsRequiringTransform = [
      'gpt-5-nano',
      'gpt-5-mini',
      'gpt-5-chat',
      'gpt-5',
      'o1',
      'o3-mini',
      'o3',
      'o4-mini'
    ];

    if (modelsRequiringTransform.includes(request.model) && request.max_tokens !== undefined) {
      const { max_tokens, ...rest } = request;
      return {
        ...rest,
        max_completion_tokens: max_tokens
      };
    }

    return request;
  }

  private async createChatStream(request: ChatCompletionRequest): Promise<AsyncIterable<StreamChunk>> {
    const response = await this.makeStreamRequest({
      endpoint: OpenAIAdapter.CHAT_COMPLETIONS_ENDPOINT,
      method: 'POST',
      body: { ...request, stream: true }
    });

    return this.parseSSEStream(response);
  }

  private async createResponseStream(request: ResponsesRequest): Promise<AsyncIterable<ResponseStreamEvent>> {
    const response = await this.makeStreamRequest({
      endpoint: OpenAIAdapter.RESPONSES_ENDPOINT,
      method: 'POST',
      body: { ...request, stream: true }
    });

    return this.parseSSEStream(response);
  }

  private async *parseSSEStream(response: Response): AsyncIterable<any> {
    const streamParser = new OpenAIStreamParser(response, this.logger);

    for await (const event of streamParser.parseStream()) {
      yield event;
    }
  }

  private createAudioFormData(request: AudioTranscriptionRequest): FormData {
    const formData = new FormData();
    formData.append('file', request.file);
    formData.append('model', request.model);

    if (request.language) formData.append('language', request.language);
    if (request.prompt) formData.append('prompt', request.prompt);
    if (request.response_format) formData.append('response_format', request.response_format);
    if (request.temperature !== undefined) formData.append('temperature', request.temperature.toString());

    return formData;
  }

  private createImageEditFormData(request: ImageEditRequest): FormData {
    const formData = new FormData();
    formData.append('model', request.model);
    formData.append('prompt', request.prompt);

    const pngBlob = new Blob([request.image], { type: 'image/png' });
    const imageFile = new File([pngBlob], 'image.png', { type: 'image/png' });
    formData.append('image', imageFile);

    if (request.mask) formData.append('mask', request.mask);
    if (request.n) formData.append('n', request.n.toString());
    if (request.size) formData.append('size', request.size);

    return formData;
  }

  private transformImageResponse(response: any): ImageResponse {
    return {
      created: response.created,
      data: response.data
    };
  }

  private createVideoFormData(request: VideoCreateRequest): FormData {
    const formData = new FormData();
    formData.append('model', request.model);
    formData.append('prompt', request.prompt);

    if (request.size) formData.append('size', request.size);
    if (request.seconds) formData.append('seconds', request.seconds);
    if (request.input_reference) {
      formData.append('input_reference', request.input_reference);
    }

    return formData;
  }

  private isCodexModel(model: string): boolean {
    return model === 'gpt-5-codex' || model === 'gpt-5.1-codex';
  }

  private async chatCompletionViaResponses(request: ChatCompletionRequest): Promise<ChatCompletionResponse | AsyncIterable<StreamChunk>> {
    const context = this.createRequestContext(OpenAIAdapter.RESPONSES_ENDPOINT, request.model);

    return this.executeWithLogging(context, async () => {
      const responsesRequest = this.convertChatToResponsesRequest(request);
      
      if (request.stream) {
        const responseStream = await this.createResponseStream(responsesRequest);
        return this.convertResponseStreamToChatStream(responseStream);
      }

      const response = await this.makeHttpRequest<ResponsesResponse>({
        endpoint: OpenAIAdapter.RESPONSES_ENDPOINT,
        method: 'POST',
        body: responsesRequest,
        expectJson: true
      });

      return this.convertResponsesToChatCompletion(response as ResponsesResponse);
    });
  }

  private convertChatToResponsesRequest(chatRequest: ChatCompletionRequest): ResponsesRequest {
    const messages = chatRequest.messages || [];
    const lastMessage = messages[messages.length - 1];
    const previousMessages = messages.slice(0, -1);

    let instructions = '';
    if (previousMessages.length > 0) {
      instructions = previousMessages
        .map(msg => {
          const role = msg.role === 'assistant' ? 'Assistant' : msg.role === 'system' ? 'System' : 'User';
          const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
          return `${role}: ${content}`;
        })
        .join('\n\n');
    }

    let input = '';
    if (lastMessage) {
      input = typeof lastMessage.content === 'string' ? lastMessage.content : JSON.stringify(lastMessage.content);
    }

    let maxOutputTokens = chatRequest.max_tokens || chatRequest.max_completion_tokens;
    if (maxOutputTokens !== undefined && maxOutputTokens < 16) {
      maxOutputTokens = 16;
    }

    const responsesRequest: ResponsesRequest = {
      model: chatRequest.model,
      input,
      instructions: instructions || undefined,
      stream: chatRequest.stream,
      temperature: chatRequest.temperature,
      max_output_tokens: maxOutputTokens,
      reasoning: { effort: 'medium' }
    };

    return responsesRequest;
  }

  private convertResponsesToChatCompletion(responsesResponse: ResponsesResponse): ChatCompletionResponse {
    let content = '';
    if (responsesResponse.output && Array.isArray(responsesResponse.output)) {
      for (const output of responsesResponse.output) {
        if (output.content && Array.isArray(output.content)) {
          for (const item of output.content) {
            if (item.type === 'output_text' && item.text) {
              content += item.text;
            }
          }
        }
      }
    }

    const chatResponse: ChatCompletionResponse = {
      id: responsesResponse.id || `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: responsesResponse.created_at || Math.floor(Date.now() / 1000),
      model: responsesResponse.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content
          },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: responsesResponse.usage?.input_tokens || 0,
        completion_tokens: responsesResponse.usage?.output_tokens || 0,
        total_tokens: responsesResponse.usage?.total_tokens || 0
      }
    };

    if (responsesResponse.usage?.output_tokens_details?.reasoning_tokens) {
      chatResponse.usage.completion_tokens_details = {
        reasoning_tokens: responsesResponse.usage.output_tokens_details.reasoning_tokens
      };
    }

    return chatResponse;
  }

  private async *convertResponseStreamToChatStream(responseStream: AsyncIterable<ResponseStreamEvent>): AsyncIterable<StreamChunk> {
    let sequenceNumber = 0;
    const requestId = `chatcmpl-${Date.now()}`;

    for await (const event of responseStream) {
      sequenceNumber++;

      if (event.type === 'response.output_text.delta' && event.delta) {
        const chunk: StreamChunk = {
          id: requestId,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: event.response?.model || 'gpt-5-codex',
          choices: [
            {
              index: 0,
              delta: {
                content: event.delta
              },
              finish_reason: null
            }
          ]
        };
        yield chunk;
      } else if (event.type === 'response.completed') {
        const finalChunk: any = {
          id: requestId,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: event.response?.model || 'gpt-5-codex',
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: 'stop'
            }
          ]
        };

        if (event.response?.usage) {
          finalChunk.usage = {
            prompt_tokens: event.response.usage.input_tokens || 0,
            completion_tokens: event.response.usage.output_tokens || 0,
            total_tokens: event.response.usage.total_tokens || 0
          };
        }

        yield finalChunk as StreamChunk;
      }
    }
  }
}

class OpenAIStreamParser {
  private static readonly SSE_DATA_PREFIX = 'data: ';
  private static readonly SSE_DONE_MARKER = '[DONE]';

  constructor(
    private readonly response: Response,
    private readonly logger: ILogger
  ) {}

  async *parseStream(): AsyncIterable<any> {
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
          const event = this.processStreamLine(line);
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

  private processStreamLine(line: string): any | null {
    if (!line.startsWith(OpenAIStreamParser.SSE_DATA_PREFIX)) {
      return null;
    }

    const data = line.slice(OpenAIStreamParser.SSE_DATA_PREFIX.length);
    if (data === OpenAIStreamParser.SSE_DONE_MARKER) {
      return null;
    }

    try {
      return JSON.parse(data);
    } catch (error) {
      this.logger.warn('Failed to parse OpenAI SSE data', {
        metadata: { data, error: (error as Error).message }
      });
      return null;
    }
  }
}

class UnsupportedOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedOperationError';
  }
}
