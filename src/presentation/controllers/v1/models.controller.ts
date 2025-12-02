import { Hono } from 'hono';
import { BaseController } from '../base.controller';
import { ModelsService } from '../../../infrastructure/providers/handlers';
import type { ILogger } from '../../../core/logging';

export class ModelsController extends BaseController {
  constructor(
    private readonly modelsService: ModelsService,
    logger: ILogger
  ) {
    super(logger);
  }

  public registerRoutes(): Hono {
    const app = this.createApplication();

    app.get('/v1/models', async (c) => this.handleGetModels(c));
    app.get('/v1/models/:id', async (c) => this.handleGetModelInfo(c));

    return app;
  }

  private async handleGetModels(c: any): Promise<Response> {
    return this.handleRequest(c, async () => {
      return this.modelsService.getAvailableModels();
    }, 'Get models');
  }

  private async handleGetModelInfo(c: any): Promise<Response> {
    return this.handleRequest(c, async () => {
      const modelId = c.req.param('id');
      return this.modelsService.getModelInfo(modelId);
    }, 'Get model info');
  }
}