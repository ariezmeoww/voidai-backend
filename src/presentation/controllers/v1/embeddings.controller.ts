import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { BaseController } from '../base.controller';
import { EmbeddingsService } from '../../../infrastructure/providers/handlers';
import { EmbeddingRequestSchema } from '../../../infrastructure/providers/types';
import type { ILogger } from '../../../core/logging';

export class EmbeddingsController extends BaseController {
  constructor(
    private readonly embeddingsService: EmbeddingsService,
    logger: ILogger
  ) {
    super(logger);
  }

  public registerRoutes(): Hono {
    const app = this.createApplication();

    app.post(
      '/v1/embeddings',
      zValidator('json', EmbeddingRequestSchema),
      async (c) => this.handleCreateEmbeddings(c)
    );

    return app;
  }

  private async handleCreateEmbeddings(c: any): Promise<Response> {
    return this.handleRequest(c, async () => {
      const request = c.req.valid('json');
      const user = this.extractUserFromContext(c);
      const clientInfo = this.extractClientInfo(c);

      return this.embeddingsService.createEmbeddings(request, user, clientInfo);
    }, 'Create embeddings');
  }
}