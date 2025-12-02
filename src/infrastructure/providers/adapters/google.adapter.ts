import { BaseProviderAdapter, type ProviderConfiguration } from '../base';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ImageGenerationRequest,
  ImageResponse,
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

interface GooglePart {
  readonly thought?: boolean;
  readonly text?: string;
  readonly inlineData?: { mimeType: string; data: string };
  readonly fileData?: { mimeType: string; fileUri: string };
  readonly functionCall?: { name: string; args: any };
  readonly functionResponse?: { name: string; response: any };
  readonly thought_signature?: string;
}

interface GoogleCandidate {
  readonly content: { parts: GooglePart[]; role: string };
  readonly finishReason: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION';
  readonly index: number;
}

interface GoogleResponse {
  readonly candidates: GoogleCandidate[];
  readonly usageMetadata?: {
    readonly promptTokenCount: number;
    readonly candidatesTokenCount: number;
    readonly totalTokenCount: number;
    readonly thoughtsTokenCount?: number;
  };
  readonly responseId: string;
}

export class GoogleAdapter extends BaseProviderAdapter {
  private static readonly DEFAULT_TEMPERATURE = 1;
  private static readonly DEFAULT_IMAGE_MODEL = 'imagen-3.0-generate-002';

  constructor(apiKey: string, logger: ILogger) {
    const configuration: ProviderConfiguration = {
      name: 'google',
      apiKey,
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      timeout: 300000,
      rateLimitPerMinute: 240,
      requiresApiKey: true,
      supportedModels: [
        'gemini-1.5-flash',
        'gemini-1.5-pro',
        'gemini-2.0-flash',
        'gemini-2.5-flash-lite-preview-06-17',
        'gemini-2.5-flash',
        'gemini-2.5-pro',
        'gemini-2.5-flash-image',
        'gemini-3-pro-preview',
        'gemini-3-pro-image-preview',
        'imagen-3.0-generate-002',
        'imagen-4.0-generate-preview-06-06'
      ],
      capabilities: {
        chat: true,
        audio: false,
        embeddings: true,
        images: true,
        videos: false,
        moderation: false,
        responses: true
      },
      includeAuth: false
    };

    super(configuration, logger);
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse | AsyncIterable<StreamChunk>> {
    const endpoint = this.buildChatEndpoint(request.model, request.stream);
    const context = this.createRequestContext(endpoint, request.model);

    return this.executeWithLogging(context, async () => {
      const googleRequest = this.buildGoogleRequest(request);

      if (request.stream) {
        return this.streamChatCompletion(googleRequest, request.model, endpoint);
      }

      const response = await this.makeHttpRequest<GoogleResponse>({
        endpoint,
        method: 'POST',
        body: googleRequest,
        headers: { 'Content-Type': 'application/json' },
        expectJson: true
      });

      return this.buildChatResponse(response as GoogleResponse, request.model);
    });
  }

  async textToSpeech(_request: SpeechRequest): Promise<ArrayBuffer> {
    throw new UnsupportedOperationError('Google does not support text-to-speech via this adapter');
  }

  async audioTranscription(_request: AudioTranscriptionRequest): Promise<TranscriptionResponse> {
    throw new UnsupportedOperationError('Google does not support audio transcription via this adapter');
  }

  async createEmbeddings(_request: EmbeddingRequest): Promise<EmbeddingResponse> {
    throw new UnsupportedOperationError('Google does not support embeddings via this adapter');
  }

  async generateImages(request: ImageGenerationRequest): Promise<ImageResponse> {
    const model = request.model || GoogleAdapter.DEFAULT_IMAGE_MODEL;
    const endpoint = `/models/${model}:predict`;
    const context = this.createRequestContext(endpoint, model);

    return this.executeWithLogging(context, async () => {
      const googleRequest = this.buildImageRequest(request);

      const response = await this.makeHttpRequest<any>({
        endpoint,
        method: 'POST',
        body: googleRequest,
        headers: {
          'x-goog-api-key': this.configuration.apiKey,
          'Content-Type': 'application/json'
        },
        expectJson: true
      });

      return this.transformImageResponse(response);
    });
  }

  async editImages(_request: ImageEditRequest): Promise<ImageResponse> {
    throw new UnsupportedOperationError('Google does not support image editing');
  }

  async moderateContent(_request: ModerationRequest): Promise<ModerationResponse> {
    throw new UnsupportedOperationError('Google does not support content moderation');
  }

  async createResponse(request: ResponsesRequest): Promise<ResponsesResponse | AsyncIterable<ResponseStreamEvent>> {
    const endpoint = this.buildResponsesEndpoint(request.model, request.stream);
    const context = this.createRequestContext(endpoint, request.model);

    return this.executeWithLogging(context, async () => {
      const googleRequest = this.transformResponsesRequest(request);

      if (request.stream) {
        return this.createResponsesStream(googleRequest, endpoint);
      }

      const response = await this.makeHttpRequest<GoogleResponse>({
        endpoint,
        method: 'POST',
        body: googleRequest,
        headers: { 'Content-Type': 'application/json' },
        expectJson: true
      });

      return this.transformToResponsesResponse(response as GoogleResponse, request);
    });
  }

  private buildChatEndpoint(model: string, stream?: boolean): string {
    const action = stream ? 'streamGenerateContent' : 'generateContent';
    const streamParam = stream ? '&alt=sse' : '';
    return `/models/${model}:${action}?key=${this.configuration.apiKey}${streamParam}`;
  }

  private buildResponsesEndpoint(model: string, stream?: boolean): string {
    return this.buildChatEndpoint(model, stream);
  }

  private buildGoogleRequest(request: ChatCompletionRequest): unknown {
    const contents = request.messages.map(msg => {
      const parts = this.convertMessageContentToParts(msg.content, request.model);

      const isGemini3 = request.model.startsWith('gemini-3');
      const dummySignature = "skip_thought_signature_validator";

      if (msg.role === 'assistant') {

        if ((msg as any).reasoning_content) {
          const reasoningParts = ((msg as any).reasoning_content as any[]).map(r => ({
            text: r.thinking,
            thought: true,
            thought_signature: r.signature || (isGemini3 ? dummySignature : undefined)
          }));
          parts.unshift(...reasoningParts);
        }

        if (isGemini3) {
          parts.forEach((part: any) => {
            if ((typeof part.text === 'string') && !part.thought_signature) {
              part.thought_signature = dummySignature;
            }
          });
        }
      }

      let role = msg.role === 'assistant' ? 'model' : 'user';
      if (request.model === 'gemini-3-pro-image-preview' && role === 'model') {
        role = 'user';
      }

      return {
        role,
        parts
      };
    });

    const generationConfig: any = {
      temperature: request.temperature,
      maxOutputTokens: request.max_tokens
    };

    if ((request as any).responseModalities) {
      generationConfig.responseModalities = (request as any).responseModalities;
    }

    if ((request as any).image_config) {
      const imageConfig = (request as any).image_config;

      const aspectRatio = imageConfig.aspect_ratio || imageConfig.aspectRatio;
      const imageSize = imageConfig.image_size || imageConfig.imageSize;

      if (aspectRatio || imageSize || imageConfig.width || imageConfig.height) {
        generationConfig.imageConfig = {};

        if (aspectRatio) {
          generationConfig.imageConfig.aspectRatio = aspectRatio;
        }

        if (imageSize) {
          generationConfig.imageConfig.imageSize = imageSize;
        }

      }

      if (imageConfig.responseModalities && !generationConfig.responseModalities) {
        generationConfig.responseModalities = imageConfig.responseModalities;
      }
    }

    // Only gemini-3-pro-preview supports thinking, NOT gemini-3-pro-image-preview
    const supportsThinking = request.model === 'gemini-3-pro-preview';

    if (supportsThinking) {
      generationConfig.thinkingConfig = {
        thinkingLevel: request.reasoning_effort === 'low' ? 'low' : 'high',
        includeThoughts: true
      };
    } else if (request.reasoning_effort && !request.model.includes('image')) {
      generationConfig.thinkingConfig = {
        includeThoughts: true,
        thinkingBudget: this.mapReasoningEffortToBudget(request.reasoning_effort)
      };
    }

    const googleRequest: any = {
      contents,
      generationConfig
    };

    if (request.tools && request.tools.length > 0) {
      googleRequest.tools = this.convertToolsToGoogleFormat(request.tools);

      if (request.tool_choice) {
        googleRequest.toolConfig = this.convertToolChoiceToGoogleFormat(request.tool_choice);
      }
    }

    if ((request as any).image_config || (request as any).responseModalities) {
      this.logger.info('Image generation request', {
        metadata: {
          model: request.model,
          imageConfig: (request as any).image_config,
          responseModalities: (request as any).responseModalities,
          generationConfig: googleRequest.generationConfig
        }
      });
    }

    return googleRequest;
  }

  private convertMessageContentToParts(content: unknown, model?: string): GooglePart[] {
    if (typeof content === 'string') {
      return [{ text: content }];
    }

    if (Array.isArray(content)) {
      return content.map(part => {

        if (part.type === 'text') {
          return { text: part.text || '' };
        }

        if (part.type === 'image_url' && part.image_url?.url) {
          const url = part.image_url.url;

          if (url.startsWith('data:')) {
            const match = url.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              const [, mimeType, data] = match;
              return {
                inlineData: {
                  mimeType,
                  data
                }
              };
            }
          }

          if (url.startsWith('http://') || url.startsWith('https://')) {
            return {
              fileData: {
                mimeType: 'image/jpeg', 
                fileUri: url
              }
            };
          }
        }

        return { text: '' };
      }).filter(part => part.text || part.inlineData || part.fileData);
    }

    return [{ text: '' }];
  }

  private buildImageRequest(request: ImageGenerationRequest): unknown {
    const parameters: any = {
      sampleCount: request.n || 1,
      aspectRatio: this.mapImageSize(request.size)
    };

    if (request.size === '2048x2048') {
      parameters.width = 2048;
      parameters.height = 2048;
    } else if (request.size === '4096x4096') {
      parameters.width = 4096;
      parameters.height = 4096;
    }

    return {
      instances: [{ prompt: request.prompt }],
      parameters
    };
  }

  private transformResponsesRequest(request: ResponsesRequest): unknown {
    const contents = this.buildResponsesContents(request);

    return {
      contents,
      generationConfig: {
        temperature: request.temperature,
        maxOutputTokens: request.max_output_tokens
      }
    };
  }

  private buildResponsesContents(request: ResponsesRequest): any[] {
    const contents = [];

    if (request.instructions) {
      contents.push({
        role: 'user',
        parts: [{ text: request.instructions }]
      });
    }

    if (typeof request.input === 'string') {
      contents.push({
        role: 'user',
        parts: [{ text: request.input }]
      });
    }

    return contents;
  }

  private extractMessageText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';

    return content
      .filter(part => part.type === 'text')
      .map(part => part.text || '')
      .join(' ');
  }

  private buildChatResponse(response: GoogleResponse, model: string): ChatCompletionResponse {
    const candidate = response.candidates?.[0];
    const content = this.extractTextContent(candidate?.content?.parts);
    const thinkingBlocks = this.extractThinkingBlocks(candidate?.content?.parts);
    const toolCalls = this.extractToolCalls(candidate?.content?.parts);
    const images = this.extractImages(candidate?.content?.parts);

    const message: any = {
      role: 'assistant',
      content: content || null,
      tool_calls: toolCalls,
      reasoning_content: thinkingBlocks.length > 0 ? thinkingBlocks : undefined
    };

    if (images.length > 0) {
      message.images = images;
    }

    return {
      id: response.responseId,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message,
        finish_reason: candidate ? this.mapGoogleFinishReason(candidate.finishReason) : 'stop'
      }],
      usage: this.transformUsage(response.usageMetadata)
    };
  }

  private buildFullContent(parts?: GooglePart[]): string | any[] {
    if (!parts) return '';

    const textParts = parts.filter(part => part.text && !part.thought);
    const imageParts = parts.filter(part => part.inlineData?.mimeType?.startsWith('image/'));

    if (imageParts.length > 0) {
      const contentArray: any[] = [];

      textParts.forEach(part => {
        if (part.text) {
          contentArray.push({
            type: 'text',
            text: part.text
          });
        }
      });

      imageParts.forEach(part => {
        if (part.inlineData) {
          contentArray.push({
            type: 'image_url',
            image_url: {
              url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`
            }
          });
        }
      });

      return contentArray;
    }

    return textParts.map(part => part.text).join('');
  }

  private extractTextContent(parts?: GooglePart[]): string {
    if (!parts) return '';
    return parts
      .filter(part => part.text && !part.thought)
      .map(part => part.text)
      .join('');
  }

  private extractThinkingBlocks(parts?: GooglePart[]): any[] {
    if (!parts) return [];
    return parts
      .filter(part => part.thought && part.text)
      .map(part => ({
        type: 'thinking',
        thinking: part.text as string,
        signature: part.thought_signature
      }));
  }

  private extractToolCalls(parts?: GooglePart[]): any[] | undefined {
    if (!parts) return undefined;

    const toolCalls = parts
      .filter(part => part.functionCall)
      .map(part => ({
        id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: 'function',
        function: {
          name: part.functionCall!.name,
          arguments: JSON.stringify(part.functionCall!.args)
        }
      }));

    return toolCalls.length > 0 ? toolCalls : undefined;
  }

  private extractImages(parts?: GooglePart[]): any[] {
    if (!parts) return [];
    return parts
      .filter(part => part.inlineData?.mimeType?.startsWith('image/'))
      .map(part => ({
        type: 'image_url',
        image_url: {
          url: `data:${part.inlineData?.mimeType};base64,${part.inlineData?.data}`
        }
      }));
  }

  private transformToResponsesResponse(response: GoogleResponse, request: ResponsesRequest): ResponsesResponse {
    const candidate = response.candidates?.[0];
    const content = this.extractTextContent(candidate?.content?.parts);
    const thinkingBlocks = this.extractThinkingBlocks(candidate?.content?.parts);

    const reasoning = request.reasoning || { effort: null };
    if (thinkingBlocks.length > 0) {
      reasoning.content = thinkingBlocks;
    }

    return {
      id: response.responseId,
      object: 'response',
      created_at: Math.floor(Date.now() / 1000),
      status: 'completed',
      instructions: request.instructions || null,
      max_output_tokens: request.max_output_tokens || null,
      model: request.model,
      output: [{
        type: 'message',
        id: response.responseId,
        status: 'completed',
        role: 'assistant',
        content: [{
          type: 'output_text',
          text: content
        }]
      }],
      parallel_tool_calls: request.parallel_tool_calls || false,
      reasoning: reasoning,
      temperature: request.temperature || GoogleAdapter.DEFAULT_TEMPERATURE,
      text: request.text || { format: { type: 'text' } },
      tool_choice: request.tool_choice || 'auto',
      tools: request.tools || [],
      usage: this.transformResponsesUsage(response.usageMetadata)
    };
  }

  private transformUsage(usageMetadata?: GoogleResponse['usageMetadata']) {
    const usage: any = {
      prompt_tokens: usageMetadata?.promptTokenCount || 0,
      completion_tokens: usageMetadata?.candidatesTokenCount || 0,
      total_tokens: usageMetadata?.totalTokenCount || 0
    };

    if (usageMetadata?.thoughtsTokenCount) {
      usage.completion_tokens_details = {
        reasoning_tokens: usageMetadata.thoughtsTokenCount
      };
    }

    return usage;
  }

  private transformResponsesUsage(usageMetadata?: GoogleResponse['usageMetadata']) {
    const usage: any = {
      input_tokens: usageMetadata?.promptTokenCount || 0,
      output_tokens: usageMetadata?.candidatesTokenCount || 0,
      total_tokens: usageMetadata?.totalTokenCount || 0
    };

    if (usageMetadata?.thoughtsTokenCount) {
      usage.output_tokens_details = {
        reasoning_tokens: usageMetadata.thoughtsTokenCount
      };
    }

    return usage;
  }

  private async *streamChatCompletion(
    request: unknown,
    model: string,
    endpoint: string
  ): AsyncIterable<StreamChunk> {
    const response = await this.makeStreamRequest({
      endpoint,
      method: 'POST',
      body: request,
      headers: { 'Content-Type': 'application/json' }
    });

    const streamParser = new GoogleStreamParser(response, this.logger);

    for await (const chunk of streamParser.parseChatStream(model)) {
      yield chunk;
    }
  }

  private async createResponsesStream(
    googleRequest: unknown,
    endpoint: string
  ): Promise<AsyncIterable<ResponseStreamEvent>> {
    const response = await this.makeStreamRequest({
      endpoint,
      method: 'POST',
      body: googleRequest,
      headers: { 'Content-Type': 'application/json' }
    });

    const streamParser = new GoogleStreamParser(response, this.logger);
    return streamParser.parseResponsesStream();
  }

  private mapGoogleFinishReason(reason: string): 'stop' | 'length' | 'content_filter' {
    switch (reason) {
      case 'STOP': return 'stop';
      case 'MAX_TOKENS': return 'length';
      case 'SAFETY': return 'content_filter';
      case 'RECITATION': return 'content_filter';
      default: return 'stop';
    }
  }

  private mapReasoningEffortToLevel(effort: 'low' | 'medium' | 'high'): string {

    const levelMap: Record<string, string> = {
      'low': 'low',
      'medium': 'high',  
      'high': 'high'
    };
    return levelMap[effort] || 'high';
  }

  private mapReasoningEffortToBudget(effort: 'low' | 'medium' | 'high'): number {

    const budgetMap: Record<string, number> = {
      'low': 2048,
      'medium': 8192,
      'high': 16384
    };
    return budgetMap[effort] || 2048;
  }

  private convertToolsToGoogleFormat(tools: any[]): any[] {

    return [{
      functionDeclarations: tools.map(tool => ({
        name: tool.function.name,
        description: tool.function.description || '',
        parameters: tool.function.parameters
      }))
    }];
  }

  private convertToolChoiceToGoogleFormat(toolChoice: any): any {

    if (typeof toolChoice === 'string') {
      if (toolChoice === 'none') {
        return { functionCallingConfig: { mode: 'NONE' } };
      } else if (toolChoice === 'auto') {
        return { functionCallingConfig: { mode: 'AUTO' } };
      } else if (toolChoice === 'required') {
        return { functionCallingConfig: { mode: 'ANY' } };
      }
    } else if (typeof toolChoice === 'object' && toolChoice.function?.name) {

      return {
        functionCallingConfig: {
          mode: 'ANY',
          allowedFunctionNames: [toolChoice.function.name]
        }
      };
    }

    return { functionCallingConfig: { mode: 'AUTO' } };
  }

  private mapImageSize(size?: string): string {
    const sizeMap: Record<string, string> = {
      '256x256': '1:1',
      '512x512': '1:1',
      '1024x1024': '1:1',
      '2048x2048': '1:1',
      '4096x4096': '1:1',
      '1536x1024': '16:9',
      '1024x1536': '9:16'
    };
    return size && sizeMap[size] ? sizeMap[size] : '1:1';
  }

  private transformImageResponse(response: any): ImageResponse {
    const images = response.predictions.map((prediction: any) => ({
      url: prediction.uri || `data:image/png;base64,${prediction.bytesBase64Encoded}`
    }));

    return {
      created: Math.floor(Date.now() / 1000),
      data: images
    };
  }
}

class GoogleStreamParser {
  private static readonly SSE_DATA_PREFIX = 'data: ';
  private static readonly SSE_DONE_MARKER = '[DONE]';

  constructor(
    private readonly response: Response,
    private readonly logger: ILogger
  ) {}

  async *parseChatStream(model: string): AsyncIterable<StreamChunk> {
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
          if (!line.trim() || !line.startsWith(GoogleStreamParser.SSE_DATA_PREFIX)) continue;

          const chunks = this.processChatStreamLine(line, model);
          for (const chunk of chunks) {
            yield chunk;
          }
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
          if (!line.trim() || !line.startsWith(GoogleStreamParser.SSE_DATA_PREFIX)) continue;

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

  private processChatStreamLine(line: string, model: string): StreamChunk[] {
    const jsonStr = line.slice(GoogleStreamParser.SSE_DATA_PREFIX.length);
    if (jsonStr === GoogleStreamParser.SSE_DONE_MARKER) {
      return [];
    }

    try {
      const data = JSON.parse(jsonStr) as GoogleResponse;
      return Array.from(this.processStreamData(data, model));
    } catch (error) {
      this.logger.warn('Failed to parse Google chat SSE data', {
        metadata: { line, error: (error as Error).message }
      });
      return [];
    }
  }

  private processResponsesStreamLine(line: string): ResponseStreamEvent | null {
    const jsonStr = line.slice(GoogleStreamParser.SSE_DATA_PREFIX.length);
    if (jsonStr === GoogleStreamParser.SSE_DONE_MARKER) {
      return null;
    }

    try {
      const data = JSON.parse(jsonStr) as GoogleResponse;
      const candidate = data.candidates?.[0];
      const content = candidate?.content?.parts?.[0]?.text;

      if (content) {
        return {
          type: 'response.output_text.delta',
          item_id: data.responseId,
          output_index: 0,
          content_index: 0,
          delta: content
        };
      }

      return null;
    } catch (error) {
      this.logger.warn('Failed to parse Google responses SSE data', {
        metadata: { line, error: (error as Error).message }
      });
      return null;
    }
  }

  private *processStreamData(data: GoogleResponse, model: string): Generator<StreamChunk> {
    if (!data.candidates?.[0]) return;

    const candidate = data.candidates[0];
    const baseChunk = {
      id: data.responseId,
      object: 'chat.completion.chunk' as const,
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta: {}, finish_reason: null }]
    };

    if (candidate.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.thought && part.text) {
          yield {
            ...baseChunk,
            choices: [{
              index: 0,
              delta: {
                reasoning_content: [{
                  type: 'thinking',
                  thinking: part.text,
                  signature: part.thought_signature
                }]
              },
              finish_reason: null
            }]
          };
        } else if (part.text) {
          yield {
            ...baseChunk,
            choices: [{
              index: 0,
              delta: { content: part.text },
              finish_reason: null
            }]
          };
        } else if (part.inlineData?.mimeType?.startsWith('image/')) {

          yield {
            ...baseChunk,
            choices: [{
              index: 0,
              delta: {
                images: [{
                  type: 'image_url',
                  image_url: {
                    url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`
                  }
                }]
              },
              finish_reason: null
            }]
          };
        } else if (part.functionCall) {
          yield {
            ...baseChunk,
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  id: this.generateToolCallId(),
                  type: 'function',
                  function: {
                    name: part.functionCall.name,
                    arguments: JSON.stringify(part.functionCall.args)
                  }
                }]
              },
              finish_reason: null
            }]
          };
        }
      }
    }

    if (candidate.finishReason) {
      yield {
        ...baseChunk,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: this.mapGoogleFinishReason(candidate.finishReason)
        }]
      };
    }
  }

  private generateToolCallId(): string {
    return `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private mapGoogleFinishReason(reason: string): 'stop' | 'length' | 'content_filter' {
    switch (reason) {
      case 'STOP': return 'stop';
      case 'MAX_TOKENS': return 'length';
      case 'SAFETY': return 'content_filter';
      case 'RECITATION': return 'content_filter';
      default: return 'stop';
    }
  }
}

class UnsupportedOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedOperationError';
  }
}