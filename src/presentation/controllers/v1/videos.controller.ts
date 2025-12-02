import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { BaseController } from '../base.controller';
import { VideosService } from '../../../infrastructure/providers/handlers';
import { 
  VideoCreateRequestSchema, 
  VideoRemixRequestSchema,
  VideoVariantSchema 
} from '../../../infrastructure/providers/types';
import type { ILogger } from '../../../core/logging';
import { z } from 'zod';

const VideoIdParamSchema = z.object({
  id: z.string()
});

const VideoListQuerySchema = z.object({
  limit: z.string().optional().transform(val => val ? parseInt(val) : undefined),
  after: z.string().optional(),
  order: z.enum(['asc', 'desc']).optional()
});

const VideoDownloadQuerySchema = z.object({
  variant: VideoVariantSchema.optional().default('video')
});

export class VideosController extends BaseController {
  private readonly defaultModel = 'sora-2';

  constructor(
    private readonly videosService: VideosService,
    logger: ILogger
  ) {
    super(logger);
  }

  public registerRoutes(): Hono {
    const app = this.createApplication();

    // Create video
    app.post(
      '/v1/videos',
      async (c) => this.handleVideoCreation(c)
    );

    // Get video status
    app.get(
      '/v1/videos/:id',
      zValidator('param', VideoIdParamSchema),
      async (c) => this.handleGetVideoStatus(c)
    );

    // Download video content
    app.get(
      '/v1/videos/:id/content',
      zValidator('param', VideoIdParamSchema),
      zValidator('query', VideoDownloadQuerySchema),
      async (c) => this.handleDownloadVideo(c)
    );

    // List videos
    app.get(
      '/v1/videos',
      zValidator('query', VideoListQuerySchema),
      async (c) => this.handleListVideos(c)
    );

    // Delete video
    app.delete(
      '/v1/videos/:id',
      zValidator('param', VideoIdParamSchema),
      async (c) => this.handleDeleteVideo(c)
    );

    // Remix video
    app.post(
      '/v1/videos/:id/remix',
      zValidator('param', VideoIdParamSchema),
      zValidator('json', VideoRemixRequestSchema),
      async (c) => this.handleRemixVideo(c)
    );

    return app;
  }

  private async handleVideoCreation(c: any): Promise<Response> {
    return this.handleRequest(c, async () => {
      const formData = await c.req.formData();
      const request = this.parseVideoCreateRequest(formData);
      const validatedRequest = VideoCreateRequestSchema.parse(request);
      
      const user = this.extractUserFromContext(c);
      const clientInfo = this.extractClientInfo(c);

      return this.videosService.createVideo(validatedRequest, user, clientInfo);
    }, 'Video creation');
  }

  private async handleGetVideoStatus(c: any): Promise<Response> {
    return this.handleRequest(c, async () => {
      const { id } = c.req.valid('param');
      const user = this.extractUserFromContext(c);

      const result = await this.videosService.getVideoStatus(id, user);
      return c.json(result, 200, {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
    }, 'Get video status');
  }

  private async handleDownloadVideo(c: any): Promise<Response> {
    return this.handleRequest(c, async () => {
      const { id } = c.req.valid('param');
      const { variant } = c.req.valid('query');
      const user = this.extractUserFromContext(c);

      const videoData = await this.videosService.downloadVideo(id, variant, user);
      
      // Determine content type based on variant
      const contentType = this.getContentType(variant);
      const extension = this.getFileExtension(variant);
      
      return new Response(videoData, {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="video_${id}.${extension}"`
        }
      });
    }, 'Download video');
  }

  private async handleListVideos(c: any): Promise<Response> {
    return this.handleRequest(c, async () => {
      const params = c.req.valid('query');
      const user = this.extractUserFromContext(c);

      const result = await this.videosService.listVideos(params, user);
      return c.json(result, 200, {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
    }, 'List videos');
  }

  private async handleDeleteVideo(c: any): Promise<Response> {
    return this.handleRequest(c, async () => {
      const { id } = c.req.valid('param');
      const user = this.extractUserFromContext(c);

      await this.videosService.deleteVideo(id, user);
      
      return { 
        id,
        object: 'video',
        deleted: true 
      };
    }, 'Delete video');
  }

  private async handleRemixVideo(c: any): Promise<Response> {
    return this.handleRequest(c, async () => {
      const { id } = c.req.valid('param');
      const request = c.req.valid('json');
      const user = this.extractUserFromContext(c);
      const clientInfo = this.extractClientInfo(c);

      return this.videosService.remixVideo(id, request, user, clientInfo);
    }, 'Remix video');
  }

  private parseVideoCreateRequest(formData: FormData) {
    return {
      model: (formData.get('model') as string) || this.defaultModel,
      prompt: formData.get('prompt') as string,
      size: formData.get('size') as string | undefined,
      seconds: formData.get('seconds') as string | undefined,
      input_reference: formData.get('input_reference') as File | undefined
    };
  }

  private getContentType(variant: string): string {
    switch (variant) {
      case 'video':
        return 'video/mp4';
      case 'thumbnail':
        return 'image/webp';
      case 'spritesheet':
        return 'image/jpeg';
      default:
        return 'application/octet-stream';
    }
  }

  private getFileExtension(variant: string): string {
    switch (variant) {
      case 'video':
        return 'mp4';
      case 'thumbnail':
        return 'webp';
      case 'spritesheet':
        return 'jpg';
      default:
        return 'bin';
    }
  }
}