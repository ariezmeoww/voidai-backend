import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { BaseController } from '../base.controller';
import { ResponsesService } from '../../../infrastructure/providers/handlers';
import { ResponsesRequestSchema } from '../../../infrastructure/providers/types';
import type { ILogger } from '../../../core/logging';

export class ResponsesController extends BaseController {
  constructor(
    private readonly responsesService: ResponsesService,
    logger: ILogger
  ) {
    super(logger);
  }

  public registerRoutes(): Hono {
    const app = this.createApplication();

    app.post(
      '/v1/responses',
      zValidator('json', ResponsesRequestSchema),
      async (c) => this.handleCreateResponse(c)
    );

    return app;
  }

  private async handleCreateResponse(c: any): Promise<Response> {
    return this.handleRequest(c, async () => {
      const request = c.req.valid('json');
      const user = this.extractUserFromContext(c);
      const clientInfo = this.extractClientInfo(c);

      const result = await this.responsesService.createResponse(request, user, clientInfo);
      
      if (this.isStreamResponse(result)) {
        return this.createStreamResponse(result, c.req.signal);
      }

      return result;
    }, 'Create response');
  }

  private isStreamResponse(result: any): result is AsyncIterable<any> {
    return result && typeof result === 'object' && Symbol.asyncIterator in result;
  }

  private createStreamResponse(streamData: any, abortSignal?: AbortSignal): Response {
    const encoder = new TextEncoder();
    const logger = this.logger;
    const safeStringify = this.safeStringify.bind(this);

    let isClosed = false;
    
    const stream = new ReadableStream({
      async start(controller) {
        const safeClose = () => {
          if (!isClosed) {
            isClosed = true;
            controller.close();
          }
        };
        
        const abortHandler = async () => {
          if (streamData && typeof streamData.finalizeSuccessfulStream === 'function') {
            try {
              await streamData.finalizeSuccessfulStream();
            } catch (error) {
              logger.error('Error finalizing aborted response stream', error as Error);
            }
          }
          
          safeClose();
        };

        if (abortSignal) {
          if (abortSignal?.aborted) {
            await abortHandler();
            return;
          }
          abortSignal.addEventListener('abort', abortHandler);
        }

        try {
          for await (const event of streamData) {
            if (isClosed || abortSignal?.aborted) {
              break;
            }

            if (event !== null && event !== undefined) {
              try {
                const eventData = safeStringify(event);
                const eventType = event?.type || 'data';
                
                const sseData = `event: ${eventType}\ndata: ${eventData}\n\n`;
                controller.enqueue(encoder.encode(sseData));
              } catch {
                isClosed = true;
              }
            }
          }

          safeClose();

        } catch (error) {
          logger.error('Stream processing error', error as Error);
          safeClose();
        }
      },

      cancel() {
        isClosed = true;
        if (streamData && typeof streamData.finalizeSuccessfulStream === 'function') {
          streamData.finalizeSuccessfulStream().catch((error: Error) => {
            logger.error('Error finalizing cancelled stream', error);
          });
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no'
      }
    });
  }

  private safeStringify(event: any): string {
    try {
      const safeEvent = event ?? {};
      return JSON.stringify(safeEvent);
    } catch (error) {
      this.logger.error('Error stringifying event', error as Error);
      return JSON.stringify({ error: 'Failed to serialize event' });
    }
  }
}