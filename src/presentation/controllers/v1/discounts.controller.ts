import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { DiscountService } from '../../../domain/discount';
import type { ModelRegistryService } from '../../../domain/provider';
import type { ILogger } from '../../../core/logging';
import { BaseController } from '../base.controller';

export class DiscountsController extends BaseController {
  constructor(
    private readonly discountService: DiscountService,
    private readonly modelRegistry: ModelRegistryService,
    logger: ILogger
  ) {
    super(logger);
  }

  public registerRoutes(): Hono {
    const app = this.createApplication();

    app.get('/v1/discounts/my-discounts', (c: Context) => this.getUserDiscounts(c));
    app.get('/v1/discounts/eligible-models', (c: Context) => this.getEligibleModels(c));

    return app;
  }

  public async getUserDiscounts(c: Context): Promise<Response> {
    try {
      // Verify user is authenticated
      const user = c.get('user');
      if (!user || !user.id) {
        throw new HTTPException(401, {
          message: JSON.stringify({
            error: {
              message: 'You didn\'t provide an API key. You need to provide your API key in an Authorization header using Bearer auth (i.e. Authorization: Bearer YOUR_KEY).',
              type: 'authentication_error',
              code: 'missing_header'
            }
          })
        });
      }

      const userId = user.id;
      const discounts = await this.discountService.getUserDiscounts(userId);
      const eligibleModels = this.discountService.getEligibleModels();
      const now = Date.now();

      const activeDiscounts = discounts.map(d => {
        const model = this.modelRegistry.getById(d.modelId);
        const timeRemaining = Math.max(0, d.expiresAt - now);
        
        // Calculate time components
        const hours = Math.floor(timeRemaining / (1000 * 60 * 60));
        const minutes = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((timeRemaining % (1000 * 60)) / 1000);

        // Calculate pricing
        const originalMultiplier = model?.multiplier ?? 0;
        const discountedMultiplier = originalMultiplier / d.discountMultiplier;
        const savingsPercent = ((1 - 1 / d.discountMultiplier) * 100).toFixed(1);

        return {
          model_id: d.modelId,
          model_name: model?.id ?? d.modelId,
          model_owner: model?.ownedBy ?? 'unknown',
          discount: {
            multiplier: d.discountMultiplier,
            savings_percent: `${savingsPercent}%`,
            description: `${d.discountMultiplier}x cheaper!`
          },
          pricing: {
            original_multiplier: originalMultiplier,
            discounted_multiplier: discountedMultiplier,
            cost_per_1k_tokens: {
              original: originalMultiplier * 1000,
              discounted: discountedMultiplier * 1000,
              you_save: (originalMultiplier - discountedMultiplier) * 1000
            }
          },
          expires_at: d.expiresAt,
          time_remaining: {
            total_seconds: Math.floor(timeRemaining / 1000),
            formatted: `${hours}h ${minutes}m ${seconds}s`,
            hours,
            minutes,
            seconds
          }
        };
      });

      const response = c.json({
        active_discounts: activeDiscounts,
        has_discount: activeDiscounts.length > 0,
        eligible_models: eligibleModels,
        next_rotation: {
          time: '6:00 PM CET',
          description: 'New discounted model selected daily'
        },
        info: {
          discount_rotation: 'Daily at 6 PM CET',
          duration: '24 hours',
          discount_range: '1.5x to 3.0x (33% - 67% off)'
        }
      });
      
      // Prevent caching of authenticated user-specific data
      response.headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');
      response.headers.set('Pragma', 'no-cache');
      response.headers.set('Expires', '0');
      
      return response;
    } catch (error) {
      const errorId = crypto.randomUUID();
      const timestamp = new Date().toISOString();
      this.logger.error('Error fetching user discounts', error as Error, {
        metadata: { errorId, timestamp, errorMessage: (error as Error).message }
      });
      return c.json(
        {
          error: {
            message: `An error occurred. Reference: ${errorId} at ${timestamp}`,
            type: 'api_error',
            reference_id: errorId,
            timestamp
          }
        },
        500
      );
    }
  }

  public async getEligibleModels(c: Context): Promise<Response> {
    try {
      // Verify user is authenticated
      const user = c.get('user');
      if (!user || !user.id) {
        throw new HTTPException(401, {
          message: JSON.stringify({
            error: {
              message: 'You didn\'t provide an API key. You need to provide your API key in an Authorization header using Bearer auth (i.e. Authorization: Bearer YOUR_KEY).',
              type: 'authentication_error',
              code: 'missing_header'
            }
          })
        });
      }

      const eligibleModels = this.discountService.getEligibleModels();

      const response = c.json({
        eligible_models: eligibleModels,
        count: eligibleModels.length,
        info: {
          description: 'Models eligible for daily discounts',
          discount_rotation: 'Daily at 6 PM CET',
          duration: '24 hours',
          discount_range: '1.5x to 3.0x'
        }
      });
      
      // Prevent caching of authenticated user-specific data
      response.headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');
      response.headers.set('Pragma', 'no-cache');
      response.headers.set('Expires', '0');
      
      return response;
    } catch (error) {
      const errorId = crypto.randomUUID();
      const timestamp = new Date().toISOString();
      this.logger.error('Error fetching eligible models', error as Error, {
        metadata: { errorId, timestamp, errorMessage: (error as Error).message }
      });
      return c.json(
        {
          error: {
            message: `An error occurred. Reference: ${errorId} at ${timestamp}`,
            type: 'api_error',
            reference_id: errorId,
            timestamp
          }
        },
        500
      );
    }
  }
}