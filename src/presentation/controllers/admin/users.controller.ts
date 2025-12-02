import { Hono } from 'hono';
import { BaseController } from '../base.controller';
import { UserService, CreditService, CreateUserRequest, UpdateUserRequest } from '../../../domain/user';
import { DiscountService } from '../../../domain/discount/services';
import type { ILogger } from '../../../core/logging';
import type { UserPlan } from '../../../domain/shared';

export interface AddCreditsRequest {
  readonly amount: number;
  readonly reason?: string;
}

export interface UserQueryParams {
  readonly page?: string;
  readonly limit?: string;
  readonly plan?: string;
}

export class UsersController extends BaseController {
  static readonly DEFAULT_CONFIG = {
    PAGE: 1,
    LIMIT: 50,
    DEFAULT_PLAN: 'free' as UserPlan,
    DEFAULT_MAX_CONCURRENT: 5,
    ONE_YEAR_MS: 365 * 24 * 60 * 60 * 1000,
    DEFAULT_CREDIT_REASON: 'Admin credit adjustment'
  } as const;

  constructor(
    private readonly userService: UserService,
    private readonly creditService: CreditService,
    private readonly discountService: DiscountService,
    logger: ILogger
  ) {
    super(logger);
  }

  public registerRoutes(): Hono {
    const app = this.createApplication();

    app.get('/admin/users', this.listUsers.bind(this));
    app.post('/admin/users', this.createUser.bind(this));
    app.get('/admin/users/:id', this.getUser.bind(this));
    app.patch('/admin/users/:id', this.updateUser.bind(this));
    app.post('/admin/users/:id/credits', this.addCredits.bind(this));
    app.post('/admin/users/:id/api-keys', this.createApiKey.bind(this));
    app.delete('/admin/users/:id/api-keys/:keyId', this.deleteApiKeyById.bind(this));
    app.delete('/admin/users/:id/api-keys/name/:keyName', this.deleteApiKeyByName.bind(this));
    app.delete('/admin/users/:id', this.deleteUser.bind(this));
    app.get('/admin/users/stats', this.getUserStats.bind(this));
    app.post('/admin/users/apply-discount', this.applyDiscountByUsername.bind(this));
    app.post('/admin/users/rotate-all-discounts', this.rotateAllDiscounts.bind(this));

    return app;
  }

  private async listUsers(c: any) {
    return this.handleRequest(c, async () => {
      const UserQueryParams = this.parseUserQueryParams(c);
      const query = this.buildUserQuery(UserQueryParams);

      const [users, stats] = await Promise.all([
        this.userService.getUsers(query),
        this.userService.getUserStats()
      ]);

      return this.formatUserListResponse(users, stats, UserQueryParams);
    }, 'List users');
  }

  private async createUser(c: any) {
    return this.handleRequest(c, async () => {
      const requestData = await c.req.json() as CreateUserRequest;
      const domainRequest = this.buildDomainCreateRequest(requestData);
      
      const result = await this.userService.createUser(domainRequest);
      return this.formatCreateUserResponse(result);
    }, 'Create user');
  }

  private async getUser(c: any) {
    return this.handleRequest(c, async () => {
      const userId = c.req.param('id');
      const user = await this.userService.getUserById(userId);
      
      if (!user) {
        throw new Error('User not found');
      }

      return this.formatDetailedUserResponse(user);
    }, 'Get user details');
  }

  private async updateUser(c: any) {
    return this.handleRequest(c, async () => {
      const userId = c.req.param('id');
      const updates = await c.req.json() as UpdateUserRequest;
      
      const result = await this.userService.updateUser(userId, updates);
      
      if (!result.success || !result.data) {
        throw new Error(result.error || 'User not found');
      }

      return this.formatUpdateUserResponse(result.data);
    }, 'Update user');
  }

  private async addCredits(c: any) {
    return this.handleRequest(c, async () => {
      const userId = c.req.param('id');
      const { amount, reason } = await c.req.json() as AddCreditsRequest;
      
      const creditReason = reason || UsersController.DEFAULT_CONFIG.DEFAULT_CREDIT_REASON;
      const result = await this.creditService.addCredits(userId, amount, creditReason);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to add credits');
      }

      return {
        success: true,
        new_balance: result.newBalance || 0,
        amount_added: amount
      };
    }, 'Add user credits');
  }

  private async createApiKey(c: any) {
    return this.handleRequest(c, async () => {
      const userId = c.req.param('id');
      const result = await this.userService.createApiKeyForUser(userId);
      
      if (!result) {
        throw new Error('User not found');
      }

      return {
        success: true,
        user_id: result.user.id,
        api_key: result.apiKey,
        created_at: Date.now()
      };
    }, 'Create API key for user');
  }

  private async deleteApiKeyById(c: any) {
    return this.handleRequest(c, async () => {
      const userId = c.req.param('id');
      const keyId = c.req.param('keyId');
      
      const success = await this.userService.deleteApiKeyById(userId, keyId);
      
      if (!success) {
        throw new Error('User or API key not found');
      }

      return {
        success: true,
        message: 'API key deleted successfully'
      };
    }, 'Delete API key by ID');
  }

  private async deleteApiKeyByName(c: any) {
    return this.handleRequest(c, async () => {
      const userId = c.req.param('id');
      const keyName = c.req.param('keyName');
      
      const success = await this.userService.deleteApiKeyByName(userId, keyName);
      
      if (!success) {
        throw new Error('User or API key not found');
      }

      return {
        success: true,
        message: 'API key deleted successfully'
      };
    }, 'Delete API key by name');
  }

  private async deleteUser(c: any) {
    return this.handleRequest(c, async () => {
      const userId = c.req.param('id');
      const success = await this.userService.deleteUser(userId);
      
      if (!success) {
        throw new Error('User not found or could not be deleted');
      }

      return { success: true };
    }, 'Delete user');
  }

  private async getUserStats(c: any) {
    return this.handleRequest(c, async () => {
      const [userStats, creditStats] = await Promise.all([
        this.userService.getUserStats(),
        this.creditService.getCreditStats()
      ]);

      return {
        user_stats: userStats,
        credit_stats: creditStats
      };
    }, 'Get user stats');
  }

  private async applyDiscountByUsername(c: any) {
    return this.handleRequest(c, async () => {
      const { username } = await c.req.json();
      
      if (!username) {
        throw new Error('Username is required');
      }

      // Find user by username
      const user = await this.userService.getUserByName(username);
      
      if (!user) {
        throw new Error(`User not found: ${username}`);
      }

      // Apply discount to the user
      const discount = await this.discountService.applyDiscountToUser(user.id);

      return {
        success: true,
        user: {
          id: user.id,
          username: user.name
        },
        discount: {
          model_id: discount.modelId,
          discount_multiplier: discount.discountMultiplier,
          expires_at: discount.expiresAt,
          expires_at_formatted: new Date(discount.expiresAt).toISOString()
        },
        message: `Discount applied successfully for ${username}`
      };
    }, 'Apply discount to user');
  }

  private async rotateAllDiscounts(c: any) {
    return this.handleRequest(c, async () => {
      this.logger.info('Manually triggering discount rotation for all users');
      
      // This calls the same method that runs at 6 PM CET daily
      await this.discountService.checkAndApplyDailyDiscount();
      
      return {
        success: true,
        message: 'Discounts rotated successfully for all users',
        timestamp: new Date().toISOString()
      };
    }, 'Rotate all user discounts');
  }

  private parseUserQueryParams(c: any): ParsedUserQueryParams {
    const page = parseInt(c.req.query('page') || UsersController.DEFAULT_CONFIG.PAGE.toString());
    const limit = parseInt(c.req.query('limit') || UsersController.DEFAULT_CONFIG.LIMIT.toString());
    const plan = c.req.query('plan') as UserPlan | undefined;

    return { page, limit, plan };
  }

  private buildUserQuery(params: ParsedUserQueryParams) {
    return {
      filters: params.plan ? { plan: params.plan } : undefined,
      limit: params.limit,
      offset: (params.page - 1) * params.limit,
      sortBy: 'createdAt' as const,
      sortOrder: 'desc' as const
    };
  }

  private buildDomainCreateRequest(requestData: any): CreateUserRequest {
    const now = Date.now();
    
    return {
      name: requestData.name,
      plan: requestData.plan || UsersController.DEFAULT_CONFIG.DEFAULT_PLAN,
      ipWhitelist: requestData.ip_whitelist ? [...requestData.ip_whitelist] : [],
      planExpiresAt: requestData.plan_expires_at || (now + UsersController.DEFAULT_CONFIG.ONE_YEAR_MS),
      maxConcurrentRequests: requestData.max_concurrent_requests || UsersController.DEFAULT_CONFIG.DEFAULT_MAX_CONCURRENT
    };
  }

  private formatUserListResponse(users: any[], stats: any, params: ParsedUserQueryParams) {
    return {
      users: users.map(user => this.formatUserSummary(user)),
      pagination: {
        page: params.page,
        limit: params.limit,
        total: stats.totalUsers
      }
    };
  }

  private formatUserSummary(user: any) {
    return {
      id: user.id,
      name: user.name,
      plan: user.plan,
      credits: user.credits,
      enabled: user.isEnabled,
      created_at: user.createdAt,
      last_request_at: user.lastRequestAt
    };
  }

  private formatCreateUserResponse(result: any) {
    return {
      id: result.user.id,
      name: result.user.name,
      plan: result.user.plan,
      credits: result.user.credits,
      enabled: result.user.isEnabled,
      api_key: result.apiKey,
      created_at: result.user.createdAt
    };
  }

  private formatDetailedUserResponse(user: any) {
    return {
      id: user.id,
      name: user.name,
      plan: user.plan,
      credits: user.credits,
      enabled: user.isEnabled,
      ip_whitelist: user.ip_whitelist,
      max_concurrent_requests: user.maxConcurrentRequests,
      usage_stats: user.getUsageStats(),
      created_at: user.createdAt,
      updated_at: user.updated_at
    };
  }

  private formatUpdateUserResponse(user: any) {
    return {
      id: user.id,
      name: user.name,
      plan: user.plan,
      credits: user.credits,
      enabled: user.isEnabled,
      updated_at: user.updated_at
    };
  }
}

interface ParsedUserQueryParams {
  readonly page: number;
  readonly limit: number;
  readonly plan?: UserPlan;
}