import { PLAN_CONFIGS, type UserPlan } from '../../shared';
import type { IUserRepository } from '../repositories';
import type { ILogger } from '../../../core/logging';

export interface CreditTransaction {
  readonly userId: string;
  readonly amount: number;
  readonly type: 'debit' | 'credit' | 'reset';
  readonly reason: string;
  readonly timestamp: number;
  readonly metadata?: Record<string, any>;
}

export interface CreditStats {
  readonly totalCreditsIssued: number;
  readonly totalCreditsUsed: number;
  readonly totalTransactions: number;
  readonly usersByPlan: Record<UserPlan, number>;
  readonly avgCreditsPerUser: number;
  readonly avgUsagePerUser: number;
}

export interface CreditOperationResult {
  readonly success: boolean;
  readonly newBalance?: number;
  readonly error?: string;
}

export class CreditService {
  static readonly RESET_INTERVAL_MS = 24 * 60 * 60 * 1000;
  static readonly CRON_CHECK_INTERVAL_MS = 5 * 60 * 1000;

  private cronJobs: NodeJS.Timeout[] = [];

  constructor(
    private readonly userRepository: IUserRepository,
    private readonly logger: ILogger
  ) {}

  public startCronJobs(): void {
    this.stopCronJobs();

    const dailyResetJob = setInterval(
      () => this.performDailyReset(),
      CreditService.CRON_CHECK_INTERVAL_MS
    );

    this.cronJobs.push(dailyResetJob);
    this.logger.info('Credit service cron jobs started');
  }

  public stopCronJobs(): void {
    this.cronJobs.forEach(job => clearInterval(job));
    this.cronJobs = [];
    this.logger.info('Credit service cron jobs stopped');
  }

  public async addCredits(userId: string, amount: number, reason: string): Promise<CreditOperationResult> {
    const validation = this.validateCreditAmount(amount);
    if (!validation.isValid) {
      return CreditOperationResult.failure(validation.error!);
    }

    const user = await this.userRepository.findById(userId);
    if (!user) {
      return CreditOperationResult.failure('User not found');
    }

    const newCredits = user.credits + amount;
    await this.userRepository.updateCredits(userId, newCredits);

    this.logCreditOperation('added', {
      userId,
      amount,
      newTotal: newCredits,
      reason
    });

    return CreditOperationResult.success(newCredits);
  }

  public async deductCredits(
    userId: string,
    amount: number,
    reason: string,
    endpoint?: string,
    tokensUsed?: number
  ): Promise<CreditOperationResult> {
    const validation = this.validateCreditAmount(amount);
    if (!validation.isValid) {
      return CreditOperationResult.failure(validation.error!);
    }

    const user = await this.userRepository.findById(userId);
    if (!user) {
      return CreditOperationResult.failure('User not found');
    }

    const newBalance = await this.processDeduction(user, amount, endpoint, tokensUsed);

    this.logCreditOperation('deducted', {
      userId,
      amount,
      newTotal: newBalance,
      reason,
      endpoint: endpoint ?? 'unknown',
      tokensUsed: tokensUsed ?? 0
    });

    return CreditOperationResult.success(newBalance);
  }

  public async resetUserCredits(userId: string): Promise<CreditOperationResult> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      return CreditOperationResult.failure('User not found');
    }

    const defaultCredits = this.getDefaultCreditsForPlan(user.plan as UserPlan);
    const bonusCredits = this.getBonusCreditsForUser(user);
    const totalCredits = defaultCredits + bonusCredits;
    
    user.resetCredits(totalCredits);
    await this.userRepository.save(user);

    this.logCreditReset(user, totalCredits, bonusCredits);
    return CreditOperationResult.success(totalCredits);
  }

  public async performDailyReset(): Promise<void> {
    try {
      const usersToReset = await this.getUsersRequiringReset();
      
      if (usersToReset.length === 0) {
        this.logger.debug('No users need credit reset at this time');
        return;
      }

      const resetResults = await this.resetMultipleUsers(usersToReset);
      this.logDailyResetCompletion(resetResults);

    } catch (error) {
      this.logger.error('Daily credit reset failed', error as Error);
    }
  }

  public async getCreditStats(): Promise<CreditStats> {
    const users = await this.userRepository.findMany();
    const statsCalculator = new CreditStatsCalculator(users);
    return statsCalculator.calculate();
  }

  private validateCreditAmount(amount: number): ValidationResult {
    if (amount <= 0) {
      return ValidationResult.failure('Credit amount must be positive');
    }
    return ValidationResult.success();
  }

  private async processDeduction(
    user: any,
    amount: number,
    endpoint?: string,
    tokensUsed?: number
  ): Promise<number> {
    if (endpoint && tokensUsed !== undefined) {
      user.debitCredits(amount, tokensUsed);
      await this.userRepository.save(user);
      return user.credits;
    } else {
      const newCredits = user.credits - amount;
      await this.userRepository.updateCredits(user.id, newCredits);
      return newCredits;
    }
  }

  private getDefaultCreditsForPlan(plan: UserPlan): number {
    return PLAN_CONFIGS[plan]?.credits ?? 0;
  }

  private getBonusCreditsForUser(user: any): number {
    if (user.isRPVerified && user.isRPBonusActive) {
      return 50000;
    }
    return 0;
  }

  private async getUsersRequiringReset(): Promise<any[]> {
    const users = await this.userRepository.findMany();
    const now = Date.now();
    
    return users.filter(user => {
      const timeSinceLastReset = now - user.creditsLastReset;
      return timeSinceLastReset >= CreditService.RESET_INTERVAL_MS;
    });
  }

  private async resetMultipleUsers(users: any[]): Promise<ResetResult> {
    let successCount = 0;
    let failureCount = 0;

    for (const user of users) {
      const result = await this.resetUserCredits(user.id);
      if (result.success) {
        successCount++;
      } else {
        failureCount++;
      }
    }

    return { successCount, failureCount, totalUsers: users.length };
  }

  private logCreditOperation(operation: string, metadata: Record<string, any>): void {
    this.logger.info(`Credits ${operation}`, { metadata });
  }

  private logCreditReset(user: any, newCredits: number, bonusCredits: number = 0): void {
    this.logger.info('User credits reset', {
      metadata: {
        userId: user.id,
        plan: user.plan,
        newCredits,
        bonusCredits,
        rpVerified: user.isRPVerified,
        rpBonusActive: user.isRPBonusActive,
        resetTimestamp: user.creditsLastReset
      }
    });
  }

  private logDailyResetCompletion(result: ResetResult): void {
    this.logger.info('Daily credit reset completed', {
      metadata: {
        usersReset: result.successCount,
        failures: result.failureCount,
        totalUsers: result.totalUsers
      }
    });
  }
}

class CreditStatsCalculator {
  constructor(private readonly users: any[]) {}

  public calculate(): CreditStats {
    const usersByPlan = this.initializeUsersByPlan();
    let totalCreditsIssued = 0n;
    let totalCreditsUsed = 0n;

    for (const user of this.users) {
      this.processUser(user, usersByPlan);
      const stats = user.getUsageStats();
      totalCreditsUsed += stats.totalCreditsUsed;
      totalCreditsIssued += BigInt(user.credits) + stats.totalCreditsUsed;
    }

    return {
      totalCreditsIssued: Number(totalCreditsIssued),
      totalCreditsUsed: Number(totalCreditsUsed),
      totalTransactions: this.users.length,
      usersByPlan,
      avgCreditsPerUser: this.calculateAverage(Number(totalCreditsIssued)),
      avgUsagePerUser: this.calculateAverage(Number(totalCreditsUsed))
    };
  }

  private initializeUsersByPlan(): Record<UserPlan, number> {
    return {
      free: 0,
      economy: 0,
      basic: 0,
      premium: 0,
      contributor: 0,
      pro: 0,
      ultra: 0,
      enterprise: 0,
      admin: 0
    };
  }

  private processUser(user: any, usersByPlan: Record<UserPlan, number>): void {
    const plan = user.plan as UserPlan;
    if (plan in usersByPlan) {
      usersByPlan[plan]++;
    }
  }

  private calculateAverage(total: number): number {
    return this.users.length > 0 ? total / this.users.length : 0;
  }
}

class ValidationResult {
  private constructor(
    private readonly valid: boolean,
    public readonly error?: string
  ) {}

  public static success(): ValidationResult {
    return new ValidationResult(true);
  }

  public static failure(error: string): ValidationResult {
    return new ValidationResult(false, error);
  }

  public get isValid(): boolean {
    return this.valid;
  }
}

namespace CreditOperationResult {
  export function success(newBalance: number): CreditOperationResult {
    return { success: true, newBalance };
  }

  export function failure(error: string): CreditOperationResult {
    return { success: false, error };
  }
}

interface ResetResult {
  readonly successCount: number;
  readonly failureCount: number;
  readonly totalUsers: number;
}