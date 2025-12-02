import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { BaseController } from '../base.controller';
import { ChatService } from '../../../infrastructure/providers/handlers';
import { ChatCompletionRequestSchema } from '../../../infrastructure/providers/types';
import type { ILogger } from '../../../core/logging';

export class ChatController extends BaseController {
  constructor(
    private readonly chatService: ChatService,
    logger: ILogger
  ) {
    super(logger);
  }

  public registerRoutes(): Hono {
    const app = this.createApplication();

    app.post(
      '/v1/chat/completions',
      zValidator('json', ChatCompletionRequestSchema),
      async (c: any) => this.handleChatCompletion(c)
    );

    return app;
  }

  private async handleChatCompletion(c: any): Promise<Response> {
    return this.handleRequest(c, async () => {
      const request = c.req.valid('json');
      const user = this.extractUserFromContext(c);
      const clientInfo = this.extractClientInfo(c);

      const result = await this.chatService.chatCompletion(request, user, clientInfo);
      
      if (this.isStreamResponse(result)) {
        return this.createStreamResponse(result, c.req.signal);
      }

      return result;
    }, 'Chat completion');
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
        // Minimal invisible keepalive to exceed Bun/proxy idle limits without changing payload
        const KEEPALIVE_INTERVAL_MS = 20000;
        let keepAliveTimer: any | null = null;
        const startKeepAlive = () => {
          if (keepAliveTimer) return;
          keepAliveTimer = setInterval(() => {
            if (isClosed || abortSignal?.aborted) return;
            try {
              // SSE comment (ignored by SSE clients that only process 'data:' lines)
              controller.enqueue(encoder.encode(':\n\n'));
            } catch {
              // Ignore enqueue errors on closed streams
            }
          }, KEEPALIVE_INTERVAL_MS);
        };
        const stopKeepAlive = () => {
          if (keepAliveTimer) {
            clearInterval(keepAliveTimer);
            keepAliveTimer = null;
          }
        };

        const safeClose = () => {
          stopKeepAlive();
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
              logger.error('Error finalizing aborted chat stream', error as Error);
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
          // Begin keepalive immediately in case provider takes time before first token
          startKeepAlive();

          for await (const chunk of streamData) {
            if (isClosed || abortSignal?.aborted) {
              break;
            }

            if (chunk !== null && chunk !== undefined) {
              const chunkData = safeStringify(chunk);
              const sseData = `data: ${chunkData}\n\n`;
              controller.enqueue(encoder.encode(sseData));
            }
          }

          if (!isClosed && !abortSignal?.aborted) {
            try {
              const doneData = `data: [DONE]\n\n`;
              controller.enqueue(encoder.encode(doneData));
            } catch {
              isClosed = true;
            }
          }

          safeClose();

        } catch (error) {
          // Generate error reference for tracking
          const errorId = crypto.randomUUID();
          const timestamp = new Date().toISOString();

          // Log full error details server-side
          logger.error('[STREAM ERROR]', error as Error, {
            metadata: {
              errorId,
              timestamp,
              errorMessage: (error as Error).message,
              errorStack: (error as Error).stack
            }
          });

          // Send sanitized error to client with reference ID
          if (!isClosed) {
            try {
              const errorChunk = {
                id: 'error',
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: 'error',
                choices: [{
                  index: 0,
                  delta: { content: `\n\n[An error occurred. Reference: ${errorId} at ${timestamp}]` },
                  finish_reason: 'error'
                }]
              };
              const errorData = safeStringify(errorChunk);
              controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
              controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
            } catch (e) {
              logger.error('Failed to send error to client', e as Error);
            }
          }

          safeClose();
        }
      },

      cancel() {
        // Ensure keepalive is stopped
        // (ReadableStream cancel can be called independently of our close path)
        // Stop timer indirectly via safeClose above, but also mark closed here
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

  private safeStringify(chunk: any): string {
    try {
      const safeChunk = chunk ?? {};
      return JSON.stringify(safeChunk);
    } catch (error) {
      this.logger.error('Error stringifying chunk', error as Error);
      return JSON.stringify({ error: 'Failed to serialize chunk' });
    }
  }
}