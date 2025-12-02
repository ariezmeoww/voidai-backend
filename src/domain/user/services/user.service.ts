import { User, ApiKey } from '../entities';
import { PLAN_CONFIGS, type UserPlan } from '../../shared/config';
import type { IUserRepository, IApiKeyRepository, UserQuery } from '../repositories';
import type { ILogger } from '../../../core/logging';
import type { ICryptoService } from '../../../core/security';

export interface CreateUserRequest {
  readonly name: string;
  readonly plan: UserPlan;
  readonly planExpiresAt: number;
  readonly initialCredits?: number;
  readonly ipWhitelist?: ReadonlyArray<string>;
  readonly maxConcurrentRequests?: number;
}

export interface UpdateUserRequest {
  readonly name?: string;
  readonly plan?: UserPlan;
  readonly planExpiresAt?: number;
  readonly enabled?: boolean;
  readonly ipWhitelist?: ReadonlyArray<string>;
  readonly maxConcurrentRequests?: number;
}

export interface UserStats {
  readonly totalUsers: number;
  readonly activeUsers: number;
  readonly usersByPlan: Record<string, number>;
  readonly totalCreditsUsed: number;
  readonly totalTokensUsed: number;
  readonly totalRequests: number;
  readonly avgCreditsPerUser: number;
}

export interface UserApiKeyResult {
  readonly user: User;
  readonly apiKey: string;
}

export interface UserOperationResult<T = User> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
}

export class UserService {
  static readonly DEFAULT_MAX_CONCURRENT_REQUESTS = 5;
  static readonly DEFAULT_LOW_CREDITS_THRESHOLD = 100;

  constructor(
    private readonly userRepository: IUserRepository,
    private readonly apiKeyRepository: IApiKeyRepository,
    private readonly logger: ILogger,
    private readonly cryptoService: ICryptoService
  ) {}

  public async createUser(request: CreateUserRequest): Promise<UserApiKeyResult> {
    const validation = this.validateCreateRequest(request);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    const apiKeyData = await this.generateApiKeyData();
    const userData = this.buildUserData(request);
    const user = new User(userData);

    const savedUser = await this.userRepository.save(user);
    
    const apiKeyEntity = this.buildApiKeyEntity(apiKeyData, savedUser.id, 'Default Key');
    await this.apiKeyRepository.save(apiKeyEntity);

    this.logUserCreation(savedUser);

    return { user: savedUser, apiKey: apiKeyData.plainKey };
  }

  public async getUserById(id: string): Promise<User | null> {
    this.validateRequiredString(id, 'User ID');
    return this.userRepository.findById(id);
  }

  public async getUserByName(name: string): Promise<User | null> {
    this.validateRequiredString(name, 'User name');
    return this.userRepository.findByName(name);
  }

  public async authenticateUser(apiKeyHash: string): Promise<User | null> {
    this.validateRequiredString(apiKeyHash, 'API key hash');

    const user = await this.userRepository.findByApiKeyHash(apiKeyHash);
    if (!user) return null;

    const apiKey = await this.apiKeyRepository.findBySearchHash(apiKeyHash);
    if (!apiKey || !apiKey.isActive) {
      return null;
    }

    return user;
  }

  public async getUsers(query?: UserQuery): Promise<User[]> {
    return this.userRepository.findMany(query);
  }

  public async getUsersWithExpiredPlans(): Promise<User[]> {
    return this.userRepository.findExpiredPlans();
  }

  public async getUsersWithLowCredits(threshold: number = UserService.DEFAULT_LOW_CREDITS_THRESHOLD): Promise<User[]> {
    return this.userRepository.findLowCredits(threshold);
  }

  public async updateUser(id: string, request: UpdateUserRequest): Promise<UserOperationResult> {
    const user = await this.userRepository.findById(id);
    if (!user) {
      return UserOperationResult.failure('User not found');
    }

    const updater = new UserUpdater(user);
    updater.applyUpdates(request);

    const savedUser = await this.userRepository.save(user);
    this.logUserUpdate(savedUser);

    return UserOperationResult.success(savedUser);
  }

  public async addCredits(id: string, amount: number): Promise<UserOperationResult<boolean>> {
    const validation = this.validateCreditAmount(amount);
    if (!validation.isValid) {
      return UserOperationResult.failure(validation.error!);
    }

    const user = await this.userRepository.findById(id);
    if (!user) {
      return UserOperationResult.failure('User not found');
    }

    const newCredits = user.credits + amount;
    await this.userRepository.updateCredits(id, newCredits);

    this.logCreditAddition(id, amount, newCredits);
    return UserOperationResult.success(true);
  }

  public async resetUserCredits(): Promise<void> {
    const users = await this.userRepository.findMany();
    const usersToReset = users.filter(user => user.shouldResetCredits());

    if (usersToReset.length === 0) return;

    const resetProcessor = new CreditResetProcessor(this.userRepository, this.logger);
    await resetProcessor.resetUsers(usersToReset);
  }

  public async deleteUser(id: string): Promise<boolean> {
    const exists = await this.userRepository.exists(id);
    if (!exists) return false;

    const success = await this.userRepository.delete(id);
    if (success) {
      this.logger.info('User deleted successfully', {
        metadata: { userId: id }
      });
    }

    return success;
  }

  public async getUserStats(): Promise<UserStats> {
    const users = await this.userRepository.findMany();
    const statsCalculator = new UserStatsCalculator(users);
    return statsCalculator.calculate();
  }

  public async createApiKeyForUser(userId: string): Promise<UserApiKeyResult | null> {
    const user = await this.userRepository.findById(userId);
    if (!user) return null;

    const apiKeyData = await this.generateApiKeyData();
    const userApiKeys = await this.apiKeyRepository.findByUserId(userId);
    const keyName = userApiKeys.length === 0 ? 'Default Key' : `API Key ${userApiKeys.length + 1}`;
    
    const apiKeyEntity = this.buildApiKeyEntity(apiKeyData, userId, keyName);
    await this.apiKeyRepository.save(apiKeyEntity);

    this.logApiKeyCreation(user, userApiKeys.length + 1);
    return { user, apiKey: apiKeyData.plainKey };
  }

  public async deleteApiKeyById(userId: string, keyId: string): Promise<boolean> {
    const user = await this.userRepository.findById(userId);
    if (!user) return false;

    const removed = await this.apiKeyRepository.delete(keyId);
    if (removed) {
      const remainingKeys = await this.apiKeyRepository.findByUserId(userId);
      this.logApiKeyDeletion(user, 'ID', keyId, remainingKeys.length);
    }

    return removed;
  }

  public async deleteApiKeyByName(userId: string, keyName: string): Promise<boolean> {
    const user = await this.userRepository.findById(userId);
    if (!user) return false;

    const apiKey = await this.apiKeyRepository.findByUserIdAndName(userId, keyName);
    if (!apiKey) return false;

    const removed = await this.apiKeyRepository.delete(apiKey.id);
    if (removed) {
      const remainingKeys = await this.apiKeyRepository.findByUserId(userId);
      this.logApiKeyDeletion(user, 'name', keyName, remainingKeys.length);
    }

    return removed;
  }

  private async generateApiKeyData(): Promise<ApiKeyData> {
    const plainKey = this.cryptoService.generateApiKey();
    const hashResult = await this.cryptoService.hash(plainKey);
    const [hashedKey, salt] = hashResult.split(':');
    const searchHash = this.cryptoService.createHmac('search-hash', plainKey);

    return { plainKey, hashedKey, salt, searchHash };
  }

  private buildUserData(request: CreateUserRequest): any {
    const now = Date.now();
    const userId = crypto.randomUUID();

    return {
      id: userId,
      name: request.name,
      plan: request.plan,
      enabled: true,
      credits: request.initialCredits ?? PLAN_CONFIGS[request.plan].credits,
      credits_last_reset: now,
      created_at: now,
      updated_at: now,
      ip_whitelist: [...(request.ipWhitelist ?? [])],
      max_concurrent_requests: request.maxConcurrentRequests ?? UserService.DEFAULT_MAX_CONCURRENT_REQUESTS,
      plan_expires_at: request.planExpiresAt,
      total_requests: 0n,
      total_tokens_used: 0n,
      total_credits_used: 0n,
      last_request_at: 0
    };
  }

  private buildApiKeyEntity(apiKeyData: ApiKeyData, userId: string, keyName: string): ApiKey {
    const doc = {
      id: crypto.randomUUID(),
      name: keyName,
      encrypted: apiKeyData.hashedKey,
      salt: apiKeyData.salt,
      algorithm: 'bcrypt',
      search_hash: apiKeyData.searchHash,
      created_at: Date.now(),
      last_used_at: undefined,
      is_active: true,
      user_id: userId
    };
    return new ApiKey(doc);
  }

  private validateCreateRequest(request: CreateUserRequest): ValidationResult {
    if (!request.name?.trim()) {
      return ValidationResult.failure('User name is required');
    }

    if (!request.plan) {
      return ValidationResult.failure('User plan is required');
    }

    if (request.planExpiresAt <= Date.now()) {
      return ValidationResult.failure('Plan expiration date must be in the future');
    }

    if (request.initialCredits !== undefined && request.initialCredits < 0) {
      return ValidationResult.failure('Initial credits cannot be negative');
    }

    return ValidationResult.success();
  }

  private validateRequiredString(value: string, fieldName: string): void {
    if (!value?.trim()) {
      throw new Error(`${fieldName} is required`);
    }
  }

  private validateCreditAmount(amount: number): ValidationResult {
    if (amount <= 0) {
      return ValidationResult.failure('Credit amount must be positive');
    }
    return ValidationResult.success();
  }

  private logUserCreation(user: User): void {
    this.logger.info('User created successfully', {
      metadata: {
        userId: user.id,
        userName: user.name,
        plan: user.plan
      }
    });
  }

  private logUserUpdate(user: User): void {
    this.logger.info('User updated successfully', {
      metadata: {
        userId: user.id,
        userName: user.name
      }
    });
  }

  private logCreditAddition(userId: string, amount: number, newTotal: number): void {
    this.logger.info('Credits added to user', {
      metadata: {
        userId,
        addedCredits: amount,
        newTotal
      }
    });
  }

  private logApiKeyCreation(user: User, totalKeys: number): void {
    this.logger.info('API key created for user', {
      metadata: {
        userId: user.id,
        userName: user.name,
        totalKeys
      }
    });
  }

  private logApiKeyDeletion(user: User, deleteType: string, identifier: string, remainingKeys: number): void {
    this.logger.info(`API key deleted by ${deleteType}`, {
      metadata: {
        userId: user.id,
        [deleteType === 'ID' ? 'keyId' : 'keyName']: identifier,
        remainingKeys
      }
    });
  }
}

class UserUpdater {
  constructor(private readonly user: User) {}

  public applyUpdates(request: UpdateUserRequest): void {
    if (request.name) {
      this.user.updateName(request.name);
    }

    if (request.plan && request.planExpiresAt) {
      this.user.updatePlan(request.plan, request.planExpiresAt);
    }

    if (request.enabled !== undefined) {
      request.enabled ? this.user.enable() : this.user.disable();
    }

    if (request.ipWhitelist) {
      this.updateIpWhitelist(request.ipWhitelist);
    }
  }

  private updateIpWhitelist(newIps: ReadonlyArray<string>): void {
    const currentIps = [...this.user.ip_whitelist];
    currentIps.forEach(ip => this.user.removeIpFromWhitelist(ip));
    newIps.forEach(ip => this.user.addIpToWhitelist(ip));
  }
}

class CreditResetProcessor {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly logger: ILogger
  ) {}

  public async resetUsers(users: User[]): Promise<void> {
    const resetData = users.map(user => ({
      id: user.id,
      credits: PLAN_CONFIGS[user.plan as UserPlan].credits
    }));

    await this.userRepository.resetCredits(
      resetData.map(d => d.id),
      resetData[0].credits
    );

    this.logger.info('User credits reset completed', {
      metadata: {
        usersReset: users.length,
        totalUsers: users.length
      }
    });
  }
}

class UserStatsCalculator {
  constructor(private readonly users: User[]) {}

  public calculate(): UserStats {
    const activeUsers = this.users.filter(u => u.isEnabled).length;
    const usersByPlan: Record<string, number> = {};
    
    let totalCreditsUsed = 0n;
    let totalTokensUsed = 0n;
    let totalRequests = 0n;

    for (const user of this.users) {
      this.processUserStats(user, usersByPlan);
      const stats = user.getUsageStats();
      totalCreditsUsed += stats.totalCreditsUsed;
      totalTokensUsed += stats.totalTokensUsed;
      totalRequests += stats.totalRequests;
    }

    return {
      totalUsers: this.users.length,
      activeUsers,
      usersByPlan,
      totalCreditsUsed: Number(totalCreditsUsed),
      totalTokensUsed: Number(totalTokensUsed),
      totalRequests: Number(totalRequests),
      avgCreditsPerUser: this.calculateAverage(Number(totalCreditsUsed))
    };
  }

  private processUserStats(user: User, usersByPlan: Record<string, number>): void {
    const plan = user.plan;
    usersByPlan[plan] = (usersByPlan[plan] || 0) + 1;
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

namespace UserOperationResult {
  export function success<T>(data: T): UserOperationResult<T> {
    return { success: true, data };
  }

  export function failure<T>(error: string): UserOperationResult<T> {
    return { success: false, error };
  }
}

interface ApiKeyData {
  readonly plainKey: string;
  readonly hashedKey: string;
  readonly salt: string;
  readonly searchHash: string;
}