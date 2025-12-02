import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { BaseController } from '../base.controller';
import { ModerationsService } from '../../../infrastructure/providers/handlers';
import { ModerationRequestSchema } from '../../../infrastructure/providers/types';
import type { ILogger } from '../../../core/logging';

export class ModerationsController extends BaseController {
  constructor(
    private readonly moderationsService: ModerationsService,
    logger: ILogger
  ) {
    super(logger);
  }

  public registerRoutes(): Hono {
    const app = this.createApplication();

    app.post(
      '/v1/moderations',
      zValidator('json', ModerationRequestSchema),
      async (c) => this.handleContentModeration(c)
    );

    return app;
  }

  private async handleContentModeration(c: any): Promise<Response> {
    return this.handleRequest(c, async () => {
      const request = c.req.valid('json');
      const user = this.extractUserFromContext(c);
      const clientInfo = this.extractClientInfo(c);

      return this.moderationsService.moderateContent(request, user, clientInfo);
    }, 'Content moderation');
  }
}