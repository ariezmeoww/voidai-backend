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
  ModerationRequest,
  ModerationResponse,
  ResponsesRequest,
  ResponsesResponse,
  ResponseStreamEvent
} from '../types';
import type { ILogger } from '../../../core/logging';

export class SentisumAdapter extends BaseProviderAdapter {
  private static readonly API_KEY = 'sk-1234';
  private static readonly CHAT_COMPLETIONS_ENDPOINT = '/chat/completions';
  private static readonly AUDIO_SPEECH_ENDPOINT = '/audio/speech';
  private static readonly AUDIO_TRANSCRIPTIONS_ENDPOINT = '/audio/transcriptions';
  private static readonly EMBEDDINGS_ENDPOINT = '/embeddings';
  private static readonly IMAGES_GENERATIONS_ENDPOINT = '/images/generations';
  private static readonly IMAGES_EDITS_ENDPOINT = '/images/edits';
  private static readonly MODERATIONS_ENDPOINT = '/moderations';
  private static readonly RESPONSES_ENDPOINT = '/responses';
  private static readonly DEFAULT_IMAGE_MODEL = 'dall-e-3';
  private static readonly DEFAULT_IMAGE_EDIT_MODEL = 'dall-e-2';
  private static readonly DEFAULT_MODERATION_MODEL = 'text-moderation-latest';

  constructor(logger: ILogger) {
    const configuration: ProviderConfiguration = {
      name: 'sentisum',
      apiKey: SentisumAdapter.API_KEY,
      baseUrl: 'https://litellm.dev.sentisum.com/openai/v1',
      timeout: 300000,
      rateLimitPerMinute: 240,
      requiresApiKey: false,
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
        'gpt-5-nano',
        'gpt-5-mini',
        'gpt-5-chat',
        'gpt-5',
        'gpt-5.1',
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
        'gpt-4o-transcribe'
      ],
      capabilities: {
        chat: true,
        audio: true,
        embeddings: true,
        images: true,
        videos: false,
        moderation: true,
        responses: true
      }
    };

    super(configuration, logger);
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse | AsyncIterable<StreamChunk>> {
    const context = this.createRequestContext(SentisumAdapter.CHAT_COMPLETIONS_ENDPOINT, request.model);

    return this.executeWithLogging(context, async () => {
      const transformedRequest = this.transformMaxTokensForModel(request);
      
      if (transformedRequest.stream) {
        return this.createChatStream(transformedRequest);
      }

      const response = await this.makeHttpRequest<ChatCompletionResponse>({
        endpoint: SentisumAdapter.CHAT_COMPLETIONS_ENDPOINT,
        method: 'POST',
        body: transformedRequest,
        expectJson: true
      });

      return response as ChatCompletionResponse;
    });
  }

  async textToSpeech(request: SpeechRequest): Promise<ArrayBuffer> {
    const context = this.createRequestContext(SentisumAdapter.AUDIO_SPEECH_ENDPOINT, request.model);

    return this.executeWithLogging(context, async () => {
      const response = await this.makeHttpRequest<Response>({
        endpoint: SentisumAdapter.AUDIO_SPEECH_ENDPOINT,
        method: 'POST',
        body: request,
        expectJson: false
      });

      return (response as Response).arrayBuffer();
    });
  }

  async audioTranscription(request: AudioTranscriptionRequest): Promise<TranscriptionResponse> {
    const context = this.createRequestContext(SentisumAdapter.AUDIO_TRANSCRIPTIONS_ENDPOINT, request.model);

    return this.executeWithLogging(context, async () => {
      const formData = this.createAudioFormData(request);
      const headers = this.createHttpHeaders();

      const response = await this.makeStreamRequest({
        endpoint: SentisumAdapter.AUDIO_TRANSCRIPTIONS_ENDPOINT,
        method: 'POST',
        body: formData,
        headers
      });

      return response.json() as Promise<TranscriptionResponse>;
    });
  }

  async createEmbeddings(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const context = this.createRequestContext(SentisumAdapter.EMBEDDINGS_ENDPOINT, request.model);

    return this.executeWithLogging(context, async () => {
      const response = await this.makeHttpRequest<EmbeddingResponse>({
        endpoint: SentisumAdapter.EMBEDDINGS_ENDPOINT,
        method: 'POST',
        body: request,
        expectJson: true
      });

      return response as EmbeddingResponse;
    });
  }

  async generateImages(request: ImageGenerationRequest): Promise<ImageResponse> {
    const model = request.model || SentisumAdapter.DEFAULT_IMAGE_MODEL;
    const context = this.createRequestContext(SentisumAdapter.IMAGES_GENERATIONS_ENDPOINT, model);

    return this.executeWithLogging(context, async () => {
      const requestBody = model === 'gpt-image-1'
        ? { ...request, moderation: 'low' }
        : request;

      const response = await this.makeHttpRequest<ImageResponse>({
        endpoint: SentisumAdapter.IMAGES_GENERATIONS_ENDPOINT,
        method: 'POST',
        body: requestBody,
        expectJson: true
      });

      return this.transformImageResponse(response);
    });
  }

  async editImages(request: ImageEditRequest): Promise<ImageResponse> {
    const model = request.model || SentisumAdapter.DEFAULT_IMAGE_EDIT_MODEL;
    const context = this.createRequestContext(SentisumAdapter.IMAGES_EDITS_ENDPOINT, model);

    return this.executeWithLogging(context, async () => {
      const formData = this.createImageEditFormData(request);
      const headers = this.createHttpHeaders();

      const response = await this.makeStreamRequest({
        endpoint: SentisumAdapter.IMAGES_EDITS_ENDPOINT,
        method: 'POST',
        body: formData,
        headers
      });

      return response.json() as Promise<ImageResponse>;
    });
  }

  async moderateContent(request: ModerationRequest): Promise<ModerationResponse> {
    const model = request.model || SentisumAdapter.DEFAULT_MODERATION_MODEL;
    const context = this.createRequestContext(SentisumAdapter.MODERATIONS_ENDPOINT, model);

    return this.executeWithLogging(context, async () => {
      const response = await this.makeHttpRequest<ModerationResponse>({
        endpoint: SentisumAdapter.MODERATIONS_ENDPOINT,
        method: 'POST',
        body: request,
        expectJson: true
      });

      return response as ModerationResponse;
    });
  }

  async createResponse(request: ResponsesRequest): Promise<ResponsesResponse | AsyncIterable<ResponseStreamEvent>> {
    const context = this.createRequestContext(SentisumAdapter.RESPONSES_ENDPOINT, request.model);

    return this.executeWithLogging(context, async () => {
      if (request.stream) {
        return this.createResponseStream(request);
      }

      const response = await this.makeHttpRequest<ResponsesResponse>({
        endpoint: SentisumAdapter.RESPONSES_ENDPOINT,
        method: 'POST',
        body: request,
        expectJson: true
      });

      return response as ResponsesResponse;
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
      endpoint: SentisumAdapter.CHAT_COMPLETIONS_ENDPOINT,
      method: 'POST',
      body: { ...request, stream: true }
    });

    return this.parseSSEStream(response);
  }

  private async createResponseStream(request: ResponsesRequest): Promise<AsyncIterable<ResponseStreamEvent>> {
    const response = await this.makeStreamRequest({
      endpoint: SentisumAdapter.RESPONSES_ENDPOINT,
      method: 'POST',
      body: { ...request, stream: true }
    });

    return this.parseSSEStream(response);
  }

  private async *parseSSEStream(response: Response): AsyncIterable<any> {
    const streamParser = new SentisumStreamParser(response, this.logger);

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
}

class SentisumStreamParser {
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
    // Skip empty lines and SSE comment lines (keepalives start with ':')
    if (!line.trim() || line.startsWith(':')) {
      return null;
    }

    if (!line.startsWith(SentisumStreamParser.SSE_DATA_PREFIX)) {
      return null;
    }

    const data = line.slice(SentisumStreamParser.SSE_DATA_PREFIX.length);
    if (data === SentisumStreamParser.SSE_DONE_MARKER) {
      return null;
    }

    try {
      return JSON.parse(data);
    } catch (error) {
      this.logger.warn('Failed to parse Sentisum SSE data', {
        metadata: { data, error: (error as Error).message }
      });
      return null;
    }
  }
}
