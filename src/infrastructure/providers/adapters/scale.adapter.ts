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

export class ScaleAdapter extends BaseProviderAdapter {
  private static readonly API_KEY = 'sk-XhUovArWt415VoLQc0E-5w';
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
      name: 'scale',
      apiKey: ScaleAdapter.API_KEY,
      baseUrl: 'https://litellm.ml.scaleinternal.com/v1',
      timeout: 300000,
      rateLimitPerMinute: 240,
      requiresApiKey: false,
      supportedModels: [
        'deepseek-r1',
        'deepseek-v3',
        'deepseek-v3.1',
        'deepseek-v3.1-terminus',
        'sonar-pro',
        'sonar',
        'sonar-reasoning',
        'sonar-reasoning-pro',
        'sonar-deep-research',
        'gpt-oss-20b',
        'gpt-oss-120b',
        'kimi-k2-instruct'
      ],
      modelMapping: {
        'deepseek-r1': 'fireworks_ai/deepseek-r1-0528',
        'deepseek-v3': 'fireworks_ai/deepseek-v3-0324',
        'deepseek-v3.1': 'fireworks_ai/deepseek-v3p1',
        'deepseek-v3.1-terminus': 'fireworks_ai/deepseek-v3p1-terminus',
        'sonar-pro': 'perplexity/sonar-pro',
        'sonar': 'perplexity/sonar',
        'sonar-reasoning': 'perplexity/sonar-reasoning',
        'sonar-reasoning-pro': 'perplexity/sonar-reasoning-pro',
        'sonar-deep-research': 'perplexity/sonar-deep-research',
        'gpt-oss-120b': 'fireworks_ai/gpt-oss-120b',
        'gpt-oss-20b': 'fireworks_ai/gpt-oss-20b',
        'kimi-k2-instruct': 'fireworks_ai/kimi-k2-instruct'
      },
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
    const context = this.createRequestContext(ScaleAdapter.CHAT_COMPLETIONS_ENDPOINT, request.model);

    return this.executeWithLogging(context, async () => {
      const scaleRequest = this.transformRequest(request);

      if (request.stream) {
        return this.createChatStream(scaleRequest);
      }

      const response = await this.makeHttpRequest<ChatCompletionResponse>({
        endpoint: ScaleAdapter.CHAT_COMPLETIONS_ENDPOINT,
        method: 'POST',
        body: scaleRequest,
        expectJson: true
      });

      return response as ChatCompletionResponse;
    });
  }

  async textToSpeech(request: SpeechRequest): Promise<ArrayBuffer> {
    const context = this.createRequestContext(ScaleAdapter.AUDIO_SPEECH_ENDPOINT, request.model);

    return this.executeWithLogging(context, async () => {
      const scaleRequest = this.transformRequest(request);

      const response = await this.makeHttpRequest<Response>({
        endpoint: ScaleAdapter.AUDIO_SPEECH_ENDPOINT,
        method: 'POST',
        body: scaleRequest,
        expectJson: false
      });

      return (response as Response).arrayBuffer();
    });
  }

  async audioTranscription(request: AudioTranscriptionRequest): Promise<TranscriptionResponse> {
    const context = this.createRequestContext(ScaleAdapter.AUDIO_TRANSCRIPTIONS_ENDPOINT, request.model);

    return this.executeWithLogging(context, async () => {
      const formData = this.createAudioFormData(request);
      const headers = this.createHttpHeaders();

      const response = await this.makeStreamRequest({
        endpoint: ScaleAdapter.AUDIO_TRANSCRIPTIONS_ENDPOINT,
        method: 'POST',
        body: formData,
        headers
      });

      return response.json() as Promise<TranscriptionResponse>;
    });
  }

  async createEmbeddings(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const context = this.createRequestContext(ScaleAdapter.EMBEDDINGS_ENDPOINT, request.model);

    return this.executeWithLogging(context, async () => {
      const scaleRequest = this.transformRequest(request);

      const response = await this.makeHttpRequest<EmbeddingResponse>({
        endpoint: ScaleAdapter.EMBEDDINGS_ENDPOINT,
        method: 'POST',
        body: scaleRequest,
        expectJson: true
      });

      return response as EmbeddingResponse;
    });
  }

  async generateImages(request: ImageGenerationRequest): Promise<ImageResponse> {
    const model = request.model || ScaleAdapter.DEFAULT_IMAGE_MODEL;
    const context = this.createRequestContext(ScaleAdapter.IMAGES_GENERATIONS_ENDPOINT, model);

    return this.executeWithLogging(context, async () => {
      const scaleRequest = this.transformRequest(request);

      const response = await this.makeHttpRequest<ImageResponse>({
        endpoint: ScaleAdapter.IMAGES_GENERATIONS_ENDPOINT,
        method: 'POST',
        body: scaleRequest,
        expectJson: true
      });

      return this.transformImageResponse(response);
    });
  }

  async editImages(request: ImageEditRequest): Promise<ImageResponse> {
    const model = request.model || ScaleAdapter.DEFAULT_IMAGE_EDIT_MODEL;
    const context = this.createRequestContext(ScaleAdapter.IMAGES_EDITS_ENDPOINT, model);

    return this.executeWithLogging(context, async () => {
      const formData = this.createImageEditFormData(request);
      const headers = this.createHttpHeaders();

      const response = await this.makeStreamRequest({
        endpoint: ScaleAdapter.IMAGES_EDITS_ENDPOINT,
        method: 'POST',
        body: formData,
        headers
      });

      return response.json() as Promise<ImageResponse>;
    });
  }

  async moderateContent(request: ModerationRequest): Promise<ModerationResponse> {
    const model = request.model || ScaleAdapter.DEFAULT_MODERATION_MODEL;
    const context = this.createRequestContext(ScaleAdapter.MODERATIONS_ENDPOINT, model);

    return this.executeWithLogging(context, async () => {
      const scaleRequest = this.transformRequest(request);

      const response = await this.makeHttpRequest<ModerationResponse>({
        endpoint: ScaleAdapter.MODERATIONS_ENDPOINT,
        method: 'POST',
        body: scaleRequest,
        expectJson: true
      });

      return response as ModerationResponse;
    });
  }

  async createResponse(request: ResponsesRequest): Promise<ResponsesResponse | AsyncIterable<ResponseStreamEvent>> {
    const context = this.createRequestContext(ScaleAdapter.RESPONSES_ENDPOINT, request.model);

    return this.executeWithLogging(context, async () => {
      const scaleRequest = this.transformRequest(request);

      if (request.stream) {
        return this.createResponseStream(scaleRequest);
      }

      const response = await this.makeHttpRequest<ResponsesResponse>({
        endpoint: ScaleAdapter.RESPONSES_ENDPOINT,
        method: 'POST',
        body: scaleRequest,
        expectJson: true
      });

      return response as ResponsesResponse;
    });
  }


  private transformRequest(request: any): any {
    const mappedModel = this.getMappedModel(request.model);

    let transformedRequest: any = {
      ...request,
      model: mappedModel,
      drop_params: true
    };

    // If routing to Anthropic via Scale, ensure Anthropic's token param is present
    if (typeof mappedModel === 'string' && mappedModel.startsWith('anthropic/')) {
      const desiredMax =
        request.max_output_tokens ??
        request.max_completion_tokens ??
        request.max_tokens;

      // Scale's /chat/completions expects OpenAI schema (max_tokens).
      if (desiredMax !== undefined) {
        transformedRequest.max_tokens = desiredMax;
      }

      // Ensure provider-specific param isn't forwarded
      if ('max_output_tokens' in transformedRequest) delete transformedRequest.max_output_tokens;
    }

    return request.model === 'gpt-image-1'
      ? { ...transformedRequest, moderation: 'low' }
      : transformedRequest;
  }

  private async createChatStream(request: ChatCompletionRequest): Promise<AsyncIterable<StreamChunk>> {
    const response = await this.makeStreamRequest({
      endpoint: ScaleAdapter.CHAT_COMPLETIONS_ENDPOINT,
      method: 'POST',
      body: { ...request, stream: true },
      headers: {
        'Accept': 'text/event-stream'
      }
    });

    return this.parseSSEStream(response);
  }

  private async createResponseStream(request: ResponsesRequest): Promise<AsyncIterable<ResponseStreamEvent>> {
    const response = await this.makeStreamRequest({
      endpoint: ScaleAdapter.RESPONSES_ENDPOINT,
      method: 'POST',
      body: { ...request, stream: true },
      headers: {
        'Accept': 'text/event-stream'
      }
    });

    return this.parseSSEStream(response);
  }

  private async *parseSSEStream(response: Response): AsyncIterable<any> {
    const streamParser = new ScaleStreamParser(response, this.logger);

    for await (const event of streamParser.parseStream()) {
      yield event;
    }
  }

  private createAudioFormData(request: AudioTranscriptionRequest): FormData {
    const formData = new FormData();
    formData.append('file', request.file);
    formData.append('model', this.getMappedModel(request.model));

    if (request.language) formData.append('language', request.language);
    if (request.prompt) formData.append('prompt', request.prompt);
    if (request.response_format) formData.append('response_format', request.response_format);
    if (request.temperature !== undefined) formData.append('temperature', request.temperature.toString());

    return formData;
  }

  private createImageEditFormData(request: ImageEditRequest): FormData {
    const formData = new FormData();
    formData.append('model', this.getMappedModel(request.model));
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

class ScaleStreamParser {
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
    if (!line.startsWith(ScaleStreamParser.SSE_DATA_PREFIX)) {
      return null;
    }

    const data = line.slice(ScaleStreamParser.SSE_DATA_PREFIX.length);
    if (data === ScaleStreamParser.SSE_DONE_MARKER) {
      return null;
    }

    try {
      return JSON.parse(data);
    } catch (error) {
      this.logger.warn('Failed to parse Scale SSE data', {
        metadata: { data, error: (error as Error).message }
      });
      return null;
    }
  }
}
