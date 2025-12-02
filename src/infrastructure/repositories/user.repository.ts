import { PrismaClient } from '@prisma/client';
import {
  User,
  UserDocument,
  type IUserRepository,
  type UserFilters,
  type UserQuery
} from '../../domain/user';
import type { IDatabaseService } from '../../core/database';
import type { ILogger } from '../../core/logging';

interface PlanUpdate {
  id: string;
  plan: string;
  expiresAt: number;
}

interface SortFieldMapping {
  [key: string]: string;
}

export class UserRepository implements IUserRepository {
  private static readonly SORT_FIELD_MAPPING: SortFieldMapping = {
    name: 'name',
    createdAt: 'createdAt',
    lastRequestAt: 'lastRequestAt',
    credits: 'credits'
  };

  private prisma: PrismaClient;
  private logger: ILogger;

  constructor(databaseService: IDatabaseService, logger: ILogger) {
    this.prisma = databaseService.getPrisma();
    this.logger = logger;
  }

  async findById(id: string): Promise<User | null> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id }
      });
      return user ? this.mapToUser(user) : null;
    } catch (error) {
      this.logger.error('Failed to find user by ID', error as Error);
      return null;
    }
  }

  async findByName(name: string): Promise<User | null> {
    try {
      const user = await this.prisma.user.findFirst({
        where: { name }
      });
      return user ? this.mapToUser(user) : null;
    } catch (error) {
      this.logger.error('Failed to find user by name', error as Error);
      return null;
    }
  }

  async findByApiKeyHash(keyHash: string): Promise<User | null> {
    try {
      const apiKey = await this.prisma.apiKey.findUnique({
        where: { searchHash: keyHash },
        include: {
          user: true
        }
      });
      return apiKey?.user ? this.mapToUser(apiKey.user) : null;
    } catch (error) {
      this.logger.error('Failed to find user by API key', error as Error);
      return null;
    }
  }

  async findMany(query?: UserQuery): Promise<User[]> {
    try {
      const filter = this.buildFilter(query?.filters);
      const users = await this.prisma.user.findMany({
        where: filter,
        orderBy: this.buildOrderBy(query),
        take: query?.limit,
        skip: query?.offset
      });
      return users.map(user => this.mapToUser(user));
    } catch (error) {
      this.logger.error('Failed to find users', error as Error);
      return [];
    }
  }

  async findExpiredPlans(): Promise<User[]> {
    try {
      const users = await this.prisma.user.findMany({
        where: {
          planExpiresAt: {
            lt: Math.floor(Date.now() / 1000)
          }
        }
      });
      return users.map(user => this.mapToUser(user));
    } catch (error) {
      this.logger.error('Failed to find expired plans', error as Error);
      return [];
    }
  }

  async findLowCredits(threshold: number): Promise<User[]> {
    try {
      const users = await this.prisma.user.findMany({
        where: {
          credits: {
            lt: threshold
          }
        }
      });
      return users.map(user => this.mapToUser(user));
    } catch (error) {
      this.logger.error('Failed to find low credit users', error as Error);
      return [];
    }
  }

  async exists(id: string): Promise<boolean> {
    try {
      const count = await this.prisma.user.count({
        where: { id }
      });
      return count > 0;
    } catch (error) {
      this.logger.error('Failed to check user existence', error as Error);
      return false;
    }
  }

  async save(user: User): Promise<User> {
    try {
      const doc = user.toDocument();
      const saved = await this.prisma.user.upsert({
        where: { id: doc.id },
        update: {
          name: doc.name,
          plan: doc.plan,
          enabled: doc.enabled,
          credits: BigInt(doc.credits),
          creditsLastReset: BigInt(doc.credits_last_reset),
          updatedAt: BigInt(doc.updated_at),
          ipWhitelist: doc.ip_whitelist,
          maxConcurrentRequests: doc.max_concurrent_requests,
          planExpiresAt: BigInt(doc.plan_expires_at),
          totalRequests: BigInt(doc.total_requests),
          totalTokensUsed: BigInt(doc.total_tokens_used),
          totalCreditsUsed: BigInt(doc.total_credits_used),
          lastRequestAt: doc.last_request_at ? BigInt(doc.last_request_at) : null,
          rpVerified: doc.rp_verified,
          rpVerificationDate: doc.rp_verification_date ? BigInt(doc.rp_verification_date) : null,
          rpBonusTokensExpires: doc.rp_bonus_tokens_expires ? BigInt(doc.rp_bonus_tokens_expires) : null,
          rpDiscountUsed: doc.rp_discount_used
        },
        create: {
          id: doc.id,
          name: doc.name,
          plan: doc.plan,
          enabled: doc.enabled,
          credits: BigInt(doc.credits),
          creditsLastReset: BigInt(doc.credits_last_reset),
          createdAt: BigInt(doc.created_at),
          updatedAt: BigInt(doc.updated_at),
          ipWhitelist: doc.ip_whitelist,
          maxConcurrentRequests: doc.max_concurrent_requests,
          planExpiresAt: BigInt(doc.plan_expires_at),
          totalRequests: BigInt(doc.total_requests),
          totalTokensUsed: BigInt(doc.total_tokens_used),
          totalCreditsUsed: BigInt(doc.total_credits_used),
          lastRequestAt: doc.last_request_at ? BigInt(doc.last_request_at) : null,
          rpVerified: doc.rp_verified,
          rpVerificationDate: doc.rp_verification_date ? BigInt(doc.rp_verification_date) : null,
          rpBonusTokensExpires: doc.rp_bonus_tokens_expires ? BigInt(doc.rp_bonus_tokens_expires) : null,
          rpDiscountUsed: doc.rp_discount_used
        }
      });
      return this.mapToUser(saved);
    } catch (error) {
      this.logger.error('Failed to save user', error as Error);
      throw error;
    }
  }

  async saveMany(users: User[]): Promise<void> {
    if (users.length === 0) {
      return;
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        for (const user of users) {
          const doc = user.toDocument();
          await tx.user.upsert({
            where: { id: doc.id },
            update: {
              name: doc.name,
              plan: doc.plan,
              enabled: doc.enabled,
              credits: BigInt(doc.credits),
              creditsLastReset: BigInt(doc.credits_last_reset),
              updatedAt: BigInt(doc.updated_at),
              ipWhitelist: doc.ip_whitelist,
              maxConcurrentRequests: doc.max_concurrent_requests,
              planExpiresAt: BigInt(doc.plan_expires_at),
              totalRequests: BigInt(doc.total_requests),
              totalTokensUsed: BigInt(doc.total_tokens_used),
              totalCreditsUsed: BigInt(doc.total_credits_used),
              lastRequestAt: doc.last_request_at ? BigInt(doc.last_request_at) : null,
              rpVerified: doc.rp_verified,
              rpVerificationDate: doc.rp_verification_date ? BigInt(doc.rp_verification_date) : null,
              rpBonusTokensExpires: doc.rp_bonus_tokens_expires ? BigInt(doc.rp_bonus_tokens_expires) : null,
              rpDiscountUsed: doc.rp_discount_used
            },
            create: {
              id: doc.id,
              name: doc.name,
              plan: doc.plan,
              enabled: doc.enabled,
              credits: BigInt(doc.credits),
              creditsLastReset: BigInt(doc.credits_last_reset),
              createdAt: BigInt(doc.created_at),
              updatedAt: BigInt(doc.updated_at),
              ipWhitelist: doc.ip_whitelist,
              maxConcurrentRequests: doc.max_concurrent_requests,
              planExpiresAt: BigInt(doc.plan_expires_at),
              totalRequests: BigInt(doc.total_requests),
              totalTokensUsed: BigInt(doc.total_tokens_used),
              totalCreditsUsed: BigInt(doc.total_credits_used),
              lastRequestAt: doc.last_request_at ? BigInt(doc.last_request_at) : null,
              rpVerified: doc.rp_verified,
              rpVerificationDate: doc.rp_verification_date ? BigInt(doc.rp_verification_date) : null,
              rpBonusTokensExpires: doc.rp_bonus_tokens_expires ? BigInt(doc.rp_bonus_tokens_expires) : null,
              rpDiscountUsed: doc.rp_discount_used
            }
          });
        }
      });
    } catch (error) {
      this.logger.error('Failed to save multiple users', error as Error);
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.prisma.user.delete({
        where: { id }
      });
      return true;
    } catch (error) {
      this.logger.error('Failed to delete user', error as Error);
      return false;
    }
  }

  async count(filters?: UserFilters): Promise<number> {
    try {
      const filter = this.buildFilter(filters);
      return await this.prisma.user.count({
        where: filter
      });
    } catch (error) {
      this.logger.error('Failed to count users', error as Error);
      return 0;
    }
  }

  async updateCredits(id: string, credits: number): Promise<void> {
    try {
      await this.prisma.user.update({
        where: { id },
        data: {
          credits,
          updatedAt: BigInt(Date.now())
        }
      });
    } catch (error) {
      this.logger.error('Failed to update user credits', error as Error);
      throw error;
    }
  }

  async resetCredits(ids: string[], credits: number): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    try {
      const now = Date.now();
      await this.prisma.user.updateMany({
        where: {
          id: { in: ids }
        },
        data: {
          credits,
          creditsLastReset: BigInt(now),
          updatedAt: BigInt(now)
        }
      });
    } catch (error) {
      this.logger.error('Failed to reset credits', error as Error);
      throw error;
    }
  }

  async bulkUpdatePlans(updates: PlanUpdate[]): Promise<void> {
    if (updates.length === 0) {
      return;
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        for (const update of updates) {
          await tx.user.update({
            where: { id: update.id },
            data: {
              plan: update.plan,
              planExpiresAt: BigInt(update.expiresAt),
              updatedAt: BigInt(Date.now())
            }
          });
        }
      });
    } catch (error) {
      this.logger.error('Failed to bulk update plans', error as Error);
      throw error;
    }
  }

  private buildFilter(filters?: UserFilters): any {
    if (!filters) {
      return {};
    }

    const filter: any = {};

    if (filters.plan) {
      filter.plan = filters.plan;
    }
    
    if (filters.enabled !== undefined) {
      filter.enabled = filters.enabled;
    }
    
    if (filters.creditsMin !== undefined) {
      filter.credits = { gte: filters.creditsMin };
    }
    
    if (filters.creditsMax !== undefined) {
      filter.credits = { ...filter.credits, lte: filters.creditsMax };
    }

    if (filters.planExpired !== undefined) {
      const now = BigInt(Date.now());
      filter.planExpiresAt = filters.planExpired ? { lt: now } : { gte: now };
    }

    return filter;
  }

  private buildOrderBy(query?: UserQuery): any {
    if (!query?.sortBy) {
      return { createdAt: 'desc' };
    }

    const sortField = UserRepository.SORT_FIELD_MAPPING[query.sortBy] || 'createdAt';
    const sortOrder = query.sortOrder === 'desc' ? 'desc' : 'asc';
    
    return { [sortField]: sortOrder };
  }

  private mapToUser(prismaUser: any): User {
    const doc: UserDocument = {
      id: prismaUser.id,
      name: prismaUser.name,
      plan: prismaUser.plan,
      enabled: prismaUser.enabled,
      credits: Number(prismaUser.credits),
      credits_last_reset: Number(prismaUser.creditsLastReset),
      created_at: Number(prismaUser.createdAt),
      updated_at: Number(prismaUser.updatedAt),
      ip_whitelist: prismaUser.ipWhitelist || [],
      max_concurrent_requests: prismaUser.maxConcurrentRequests,
      plan_expires_at: Number(prismaUser.planExpiresAt),
      total_requests: BigInt(prismaUser.totalRequests),
      total_tokens_used: BigInt(prismaUser.totalTokensUsed),
      total_credits_used: BigInt(prismaUser.totalCreditsUsed),
      last_request_at: prismaUser.lastRequestAt ? Number(prismaUser.lastRequestAt) : 0,
      rp_verified: prismaUser.rpVerified || false,
      rp_verification_date: prismaUser.rpVerificationDate ? Number(prismaUser.rpVerificationDate) : undefined,
      rp_bonus_tokens_expires: prismaUser.rpBonusTokensExpires ? Number(prismaUser.rpBonusTokensExpires) : undefined,
      rp_discount_used: prismaUser.rpDiscountUsed || false
    };
    return new User(doc);
  }
}
