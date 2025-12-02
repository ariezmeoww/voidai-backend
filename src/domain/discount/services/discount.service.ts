import type { IUserDiscountRepository } from '../repositories';
import type { IUserRepository } from '../../user/repositories';
import type { ILogger } from '../../../core/logging';
import { UserDiscountEntity } from '../entities';
import type { ModelRegistryService } from '../../provider/services/model-registry.service';

export interface DiscountConfig {
  readonly modelId: string;
  readonly discountMultiplier: number;
  readonly expiresAt: number;
}

export class DiscountService {
  private static readonly ELIGIBLE_MODELS = [
    'claude-3-haiku-20240307',
    'claude-3-5-sonnet-20240620',
    'claude-3-5-haiku-20241022',
    'claude-3-5-sonnet-20241022',
    'claude-3-7-sonnet-20250219',
    'claude-sonnet-4-20250514',
    'claude-sonnet-4-5-20250929',
    'claude-haiku-4-5-20251001',
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-2.5-flash-image',
    'gemini-2.0-flash',
    'gpt-4o-mini',
    'gpt-4o-mini-search-preview',
    'gpt-4o',
    'gpt-4o-search-preview',
    'gpt-4.1-nano',
    'gpt-4.1-mini',
    'gpt-4.1',
    'chatgpt-4o-latest',
    'gpt-5-nano',
    'gpt-5-mini',
    'gpt-5-chat',
    'gpt-5-codex',
    'gpt-5.1-codex',
    'gpt-5',
    'gpt-5.1',
    'gpt-oss-20b',
    'gpt-oss-120b',
    'o3-mini',
    'o3',
    'o4-mini',
    'deepseek-v3.1-terminus',
    'deepseek-v3.1',
    'deepseek-v3',
    'deepseek-r1',
    'sonar',
    'sonar-reasoning',
    'sonar-deep-research',
    'lumina',
    'grok-4'
  ];

  static readonly DISCOUNT_CHECK_INTERVAL_MS = 5 * 60 * 1000;
  static readonly DISCOUNT_DURATION_MS = 24 * 60 * 60 * 1000;

  private cronJobs: ReturnType<typeof setInterval>[] = [];
  private lastDiscountDate: string = '';

  constructor(
    private readonly discountRepository: IUserDiscountRepository,
    private readonly userRepository: IUserRepository,
    private readonly modelRegistry: ModelRegistryService,
    private readonly logger: ILogger
  ) {}

  public startCronJobs(): void {
    this.stopCronJobs();

    const dailyDiscountJob = setInterval(
      () => this.checkAndApplyDailyDiscount(),
      DiscountService.DISCOUNT_CHECK_INTERVAL_MS
    );

    this.cronJobs.push(dailyDiscountJob);
    this.logger.info('Discount service cron jobs started');
  }

  public stopCronJobs(): void {
    this.cronJobs.forEach(job => clearInterval(job));
    this.cronJobs = [];
    this.logger.info('Discount service cron jobs stopped');
  }

  public async checkAndApplyDailyDiscount(): Promise<void> {
    try {
      if (!this.shouldApplyDiscount()) {
        return;
      }

      await this.cleanupExpiredDiscounts();
      await this.applyUniqueDiscountsToAllUsers();
      
      this.lastDiscountDate = this.getCurrentDateString();
      
      this.logger.info('Daily discounts applied to all users');
    } catch (error) {
      this.logger.error('Failed to apply daily discount', error as Error);
    }
  }

  public async getUserDiscount(userId: string, modelId: string): Promise<number | null> {
    try {
      const discount = await this.discountRepository.findByUserIdAndModelId(userId, modelId);
      
      if (!discount || discount.isExpired()) {
        return null;
      }

      return discount.discountMultiplier;
    } catch (error) {
      this.logger.error('Failed to get user discount', error as Error);
      return null;
    }
  }

  public async getUserDiscounts(userId: string): Promise<DiscountConfig[]> {
    try {
      const discounts = await this.discountRepository.findActiveByUserId(userId);
      
      return discounts
        .filter(d => !d.isExpired())
        .map(d => ({
          modelId: d.modelId,
          discountMultiplier: d.discountMultiplier,
          expiresAt: d.expiresAt
        }));
    } catch (error) {
      this.logger.error('Failed to get user discounts', error as Error);
      return [];
    }
  }

  public async cleanupExpiredDiscounts(): Promise<void> {
    try {
      const deletedCount = await this.discountRepository.deleteExpired();
      
      if (deletedCount > 0) {
        this.logger.info('Cleaned up expired discounts', {
          metadata: { deletedCount }
        });
      }
    } catch (error) {
      this.logger.error('Failed to cleanup expired discounts', error as Error);
    }
  }

  public async applyDiscountToUser(userId: string): Promise<DiscountConfig> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    
    const selectedModel = this.selectRandomModel(user.plan, user.isRPVerified);
    const discountMultiplier = this.generateDiscountMultiplier();
    const expiresAt = Date.now() + DiscountService.DISCOUNT_DURATION_MS;
    const createdAt = Date.now();

    // Delete existing discount for this user and model if any
    const existingDiscount = await this.discountRepository.findByUserIdAndModelId(
      userId,
      selectedModel
    );

    if (existingDiscount) {
      await this.discountRepository.delete(existingDiscount.id);
    }

    // Create new discount
    const discount = UserDiscountEntity.create({
      id: crypto.randomUUID(),
      userId,
      modelId: selectedModel,
      discountMultiplier,
      expiresAt,
      createdAt
    });

    await this.discountRepository.save(discount);

    this.logger.info('Manual discount applied to user', {
      metadata: {
        userId,
        model: selectedModel,
        multiplier: discountMultiplier,
        expiresAt: new Date(expiresAt).toISOString()
      }
    });

    return {
      modelId: selectedModel,
      discountMultiplier,
      expiresAt
    };
  }

  public getEligibleModels(): ReadonlyArray<string> {
    return DiscountService.ELIGIBLE_MODELS;
  }

  private shouldApplyDiscount(): boolean {
    const now = new Date();
    const currentDateString = this.getCurrentDateString();
    
    // Check if we already applied discount today
    if (this.lastDiscountDate === currentDateString) {
      return false;
    }

    // Check if it's 6 PM CET (18:00)
    const cetTime = this.getCETTime(now);
    const hour = cetTime.getHours();
    const minute = cetTime.getMinutes();
    
    // Apply discount at 6 PM CET (between 18:00 and 18:05)
    return hour === 18 && minute < 5;
  }

  private getCETTime(date: Date): Date {
    // Convert to CET (UTC+1) or CEST (UTC+2 during daylight saving)
    const utcTime = date.getTime();
    const cetOffset = this.getCETOffset(date);
    return new Date(utcTime + cetOffset * 60 * 60 * 1000);
  }

  private getCETOffset(date: Date): number {
    // CET is UTC+1, CEST is UTC+2
    // Approximate daylight saving check (late March to late October)
    const month = date.getUTCMonth();
    const isDST = month > 2 && month < 10;
    return isDST ? 2 : 1;
  }

  private getCurrentDateString(): string {
    const cetTime = this.getCETTime(new Date());
    return cetTime.toISOString().split('T')[0];
  }

  private selectRandomModel(userPlan: string, isRPVerified: boolean): string {
    let eligibleModels = DiscountService.ELIGIBLE_MODELS;
    
    // If user is NOT RP verified, filter models to only those they already have access to
    if (!isRPVerified) {
      eligibleModels = DiscountService.ELIGIBLE_MODELS.filter(modelId =>
        this.modelRegistry.hasAccess(modelId, userPlan)
      );
      
      // If no models match their plan, fallback to all eligible models
      if (eligibleModels.length === 0) {
        eligibleModels = DiscountService.ELIGIBLE_MODELS;
      }
    }
    // If user IS RP verified, they can roll any model (no filtering needed)
    
    const randomIndex = Math.floor(Math.random() * eligibleModels.length);
    return eligibleModels[randomIndex];
  }

  private generateDiscountMultiplier(): number {
    // Generate random multiplier between 1.5 and 3.0
    const min = 1.5;
    const max = 3.0;
    const multiplier = Math.random() * (max - min) + min;
    return Math.round(multiplier * 10) / 10; // Round to 1 decimal place
  }

  private async applyUniqueDiscountsToAllUsers(): Promise<void> {
    const users = await this.userRepository.findMany();
    const expiresAt = Date.now() + DiscountService.DISCOUNT_DURATION_MS;
    const createdAt = Date.now();

    for (const user of users) {
      try {
        // Generate unique random model and multiplier for EACH user
        const selectedModel = this.selectRandomModel(user.plan, user.isRPVerified);
        const discountMultiplier = this.generateDiscountMultiplier();

        // Delete all existing discounts for this user
        const existingDiscounts = await this.discountRepository.findActiveByUserId(user.id);
        for (const existingDiscount of existingDiscounts) {
          await this.discountRepository.delete(existingDiscount.id);
        }

        // Create new unique discount for this user
        const discount = UserDiscountEntity.create({
          id: crypto.randomUUID(),
          userId: user.id,
          modelId: selectedModel,
          discountMultiplier,
          expiresAt,
          createdAt
        });

        await this.discountRepository.save(discount);
        
        this.logger.info('Discount applied', {
          metadata: {
            userId: user.id,
            model: selectedModel,
            multiplier: discountMultiplier
          }
        });
      } catch (error) {
        this.logger.error(`Failed to apply discount for user ${user.id}`, error as Error);
      }
    }
  }
}