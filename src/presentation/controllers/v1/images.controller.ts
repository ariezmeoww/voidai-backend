import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { BaseController } from '../base.controller';
import { ImagesService } from '../../../infrastructure/providers/handlers';
import { ImageGenerationRequestSchema, ImageEditRequestSchema } from '../../../infrastructure/providers/types';
import type { ILogger } from '../../../core/logging';

export class ImagesController extends BaseController {
  private readonly defaultModel = 'dall-e-2';
  private readonly defaultImageCount = 1;

  constructor(
    private readonly imagesService: ImagesService,
    logger: ILogger
  ) {
    super(logger);
  }

  public registerRoutes(): Hono {
    const app = this.createApplication();

    app.post(
      '/v1/images/generations',
      zValidator('json', ImageGenerationRequestSchema),
      async (c) => this.handleImageGeneration(c)
    );

    app.post(
      '/v1/images/edits',
      async (c) => this.handleImageEdit(c)
    );

    return app;
  }

  private async handleImageGeneration(c: any): Promise<Response> {
    return this.handleRequest(c, async () => {
      const request = c.req.valid('json');
      const user = this.extractUserFromContext(c);
      const clientInfo = this.extractClientInfo(c);

      return this.imagesService.generateImages(request, user, clientInfo);
    }, 'Image generation');
  }

  private async handleImageEdit(c: any): Promise<Response> {
    return this.handleRequest(c, async () => {
      const formData = await c.req.formData();
      const request = this.parseImageEditRequest(formData);
      const validatedRequest = ImageEditRequestSchema.parse(request);
      
      const user = this.extractUserFromContext(c);
      const clientInfo = this.extractClientInfo(c);

      return this.imagesService.editImages(validatedRequest, user, clientInfo);
    }, 'Image editing');
  }

  private parseImageEditRequest(formData: FormData) {
    return {
      image: formData.get('image') as File,
      prompt: formData.get('prompt') as string,
      model: (formData.get('model') as string) || this.defaultModel,
      n: this.parseImageCount(formData.get('n') as string),
      size: formData.get('size') as string,
      mask: formData.get('mask') as File | null
    };
  }

  private parseImageCount(countStr: string | null): number {
    if (!countStr) {
      return this.defaultImageCount;
    }

    const count = parseInt(countStr);
    return isNaN(count) ? this.defaultImageCount : count;
  }
}