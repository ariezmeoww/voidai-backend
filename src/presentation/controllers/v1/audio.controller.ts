import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { BaseController } from '../base.controller';
import { AudioService } from '../../../infrastructure/providers/handlers';
import { SpeechRequestSchema, AudioTranscriptionRequest } from '../../../infrastructure/providers/types';
import type { ILogger } from '../../../core/logging';

type ResponseFormat = 'json' | 'text' | 'srt' | 'verbose_json' | 'vtt';

export class AudioController extends BaseController {
  private readonly defaultModel = 'whisper-1';
  private readonly defaultResponseFormat: ResponseFormat = 'json';
  private readonly audioContentType = 'audio/mpeg';
  private readonly audioFilename = 'speech.mp3';

  constructor(
    private readonly audioService: AudioService,
    logger: ILogger
  ) {
    super(logger);
  }

  public registerRoutes(): Hono {
    const app = this.createApplication();

    app.post(
      '/v1/audio/speech',
      zValidator('json', SpeechRequestSchema),
      async (c) => this.handleTextToSpeech(c)
    );

    app.post(
      '/v1/audio/transcriptions',
      async (c) => this.handleAudioTranscription(c)
    );

    app.post(
      '/v1/audio/translations',
      async (c) => this.handleAudioTranslation(c)
    );

    return app;
  }

  private async handleTextToSpeech(c: any): Promise<Response> {
    return this.handleRequest(c, async () => {
      const request = c.req.valid('json');
      const user = this.extractUserFromContext(c);
      const clientInfo = this.extractClientInfo(c);

      const audioBuffer = await this.audioService.textToSpeech(request, user, clientInfo);
      
      return this.createAudioResponse(audioBuffer);
    }, 'Text-to-speech');
  }

  private async handleAudioTranscription(c: any): Promise<Response> {
    return this.handleRequest(c, async () => {
      const formData = await c.req.formData();
      const request = this.parseAudioRequest(formData, true);
      
      this.validateAudioFile(request.file);
      
      const user = this.extractUserFromContext(c);
      const clientInfo = this.extractClientInfo(c);

      return this.audioService.transcribeAudio(request, user, clientInfo);
    }, 'Audio transcription');
  }

  private async handleAudioTranslation(c: any): Promise<Response> {
    return this.handleRequest(c, async () => {
      const formData = await c.req.formData();
      const request = this.parseAudioRequest(formData, false);
      
      this.validateAudioFile(request.file);
      
      const user = this.extractUserFromContext(c);
      const clientInfo = this.extractClientInfo(c);

      return this.audioService.transcribeAudio(request, user, clientInfo);
    }, 'Audio translation');
  }

  private parseAudioRequest(formData: FormData, includeLanguage: boolean): AudioTranscriptionRequest {
    const file = formData.get('file') as File;
    const model = (formData.get('model') as string) || this.defaultModel;
    const prompt = formData.get('prompt') as string | null;
    const responseFormatStr = formData.get('response_format') as string | null;
    const temperatureStr = formData.get('temperature') as string | null;

    const responseFormat = this.validateResponseFormat(responseFormatStr);

    const request: AudioTranscriptionRequest = {
      file,
      model,
      prompt: prompt || undefined,
      response_format: responseFormat,
      temperature: temperatureStr ? this.parseTemperature(temperatureStr) : undefined
    };

    if (includeLanguage) {
      const language = formData.get('language') as string | null;
      request.language = language || undefined;
    }

    return request;
  }

  private validateResponseFormat(format: string | null): ResponseFormat {
    if (!format) {
      return this.defaultResponseFormat;
    }

    const validFormats: ResponseFormat[] = ['json', 'text', 'srt', 'verbose_json', 'vtt'];
    
    if (validFormats.includes(format as ResponseFormat)) {
      return format as ResponseFormat;
    }

    throw new Error(`Invalid response format: ${format}. Must be one of: ${validFormats.join(', ')}`);
  }

  private parseTemperature(temperatureStr: string): number {
    const temperature = parseFloat(temperatureStr);
    
    if (isNaN(temperature)) {
      throw new Error('Invalid temperature value');
    }
    
    if (temperature < 0 || temperature > 2) {
      throw new Error('Temperature must be between 0 and 2');
    }
    
    return temperature;
  }

  private validateAudioFile(file: File): void {
    if (!file) {
      throw new Error('Audio file is required');
    }

    if (file.size === 0) {
      throw new Error('Audio file cannot be empty');
    }

    const maxFileSize = 25 * 1024 * 1024;
    if (file.size > maxFileSize) {
      throw new Error('Audio file size cannot exceed 25MB');
    }
  }

  private createAudioResponse(audioBuffer: ArrayBuffer): Response {
    return new Response(audioBuffer, {
      headers: {
        'Content-Type': this.audioContentType,
        'Content-Disposition': `attachment; filename="${this.audioFilename}"`
      }
    });
  }
}