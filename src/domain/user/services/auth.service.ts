import { User } from '../entities';
import type { IUserRepository, IApiKeyRepository } from '../repositories';
import type { IOAuthTokenRepository } from '../../../infrastructure/repositories/oauth-token.repository';
import type { ILogger } from '../../../core/logging';
import type { ICryptoService } from '../../../core/security';
import { ModelRegistryService } from '../../../domain/provider/services';

export interface AuthenticationResult {
  readonly user: User | null;
  readonly isAuthenticated: boolean;
  readonly reason?: string;
  readonly isOAuthToken?: boolean;
}

export interface AuthorizationContext {
  readonly userId: string;
  readonly ipAddress: string;
  readonly endpoint: string;
  readonly model?: string;
  readonly estimatedCredits: number;
}

export interface AuthorizationResult {
  readonly isAuthorized: boolean;
  readonly user?: User;
  readonly reason?: string;
  readonly remainingCredits?: number;
  readonly rateLimitInfo?: RateLimitInfo;
}

export interface RateLimitInfo {
  readonly maxConcurrentRequests: number;
  readonly currentRequests: number;
}

export class AuthService {
  static readonly AUTH_ERRORS = {
    API_KEY_REQUIRED: 'API key is required',
    INVALID_API_KEY: 'Invalid API key',
    INVALID_OAUTH_TOKEN: 'Invalid or expired OAuth token',
    USER_NOT_FOUND: 'User not found',
    USER_DISABLED: 'User account is disabled',
    IP_NOT_AUTHORIZED: 'IP address not authorized',
    INSUFFICIENT_CREDITS: 'Insufficient credits'
  } as const;

  private oauthTokenRepository: IOAuthTokenRepository | null = null;

  constructor(
    private readonly userRepository: IUserRepository,
    private readonly apiKeyRepository: IApiKeyRepository,
    private readonly logger: ILogger,
    private readonly cryptoService: ICryptoService,
    private readonly modelRegistry: ModelRegistryService
  ) {}

  public setOAuthTokenRepository(repository: IOAuthTokenRepository): void {
    this.oauthTokenRepository = repository;
  }

  public async authenticateApiKey(apiKey: string): Promise<AuthenticationResult> {
    if (!this.isValidApiKeyFormat(apiKey)) {
      return AuthenticationResult.failure(null, AuthService.AUTH_ERRORS.API_KEY_REQUIRED);
    }

    const user = await this.findUserByApiKey(apiKey);
    if (!user) {
      this.logAuthenticationFailure('user not found', { apiKey: this.maskApiKey(apiKey) });
      return AuthenticationResult.failure(null, AuthService.AUTH_ERRORS.INVALID_API_KEY);
    }

    const statusValidation = UserValidator.validateStatus(user);
    if (statusValidation.isFailure()) {
      const reason = statusValidation.error ?? AuthService.AUTH_ERRORS.USER_DISABLED;
      this.logAuthenticationFailure(reason, { userId: user.id, plan: user.plan });
      return AuthenticationResult.failure(user, reason);
    }

    const keyValidation = await this.validateApiKeyForUser(user, apiKey);
    if (!keyValidation) {
      this.logAuthenticationFailure('invalid key', { userId: user.id });
      return AuthenticationResult.failure(user, AuthService.AUTH_ERRORS.INVALID_API_KEY);
    }

    this.logAuthenticationSuccess(user);
    return AuthenticationResult.success(user);
  }

  public async authenticateOAuthToken(token: string): Promise<AuthenticationResult> {
    if (!this.oauthTokenRepository) {
      this.logger.error('OAuth token repository not configured');
      return AuthenticationResult.failure(null, AuthService.AUTH_ERRORS.INVALID_OAUTH_TOKEN);
    }

    if (!token?.trim()) {
      return AuthenticationResult.failure(null, AuthService.AUTH_ERRORS.INVALID_OAUTH_TOKEN);
    }

    // Hash the token to look it up (SHA256 hash, matching the dashboard)
    const crypto = await import('crypto');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const tokenRecord = await this.oauthTokenRepository.findByTokenHash(tokenHash);
    if (!tokenRecord) {
      this.logAuthenticationFailure('OAuth token not found', { tokenHash: this.maskHash(tokenHash) });
      return AuthenticationResult.failure(null, AuthService.AUTH_ERRORS.INVALID_OAUTH_TOKEN);
    }

    // Check if token is expired
    const now = Date.now();
    if (Number(tokenRecord.expiresAt) < now) {
      this.logAuthenticationFailure('OAuth token expired', { userId: tokenRecord.userId });
      return AuthenticationResult.failure(null, AuthService.AUTH_ERRORS.INVALID_OAUTH_TOKEN);
    }

    // Find the user
    const user = await this.userRepository.findById(tokenRecord.userId);
    if (!user) {
      this.logAuthenticationFailure('OAuth token user not found', { userId: tokenRecord.userId });
      return AuthenticationResult.failure(null, AuthService.AUTH_ERRORS.USER_NOT_FOUND);
    }

    // Validate user status
    const statusValidation = UserValidator.validateStatus(user);
    if (statusValidation.isFailure()) {
      const reason = statusValidation.error ?? AuthService.AUTH_ERRORS.USER_DISABLED;
      this.logAuthenticationFailure(reason, { userId: user.id, plan: user.plan });
      return AuthenticationResult.failure(user, reason);
    }

    this.logger.debug('OAuth token authentication successful', {
      metadata: { userId: user.id, plan: user.plan }
    });

    return AuthenticationResult.successWithOAuth(user);
  }

  public async authorizeRequest(context: AuthorizationContext): Promise<AuthorizationResult> {
    const user = await this.userRepository.findById(context.userId);
    if (!user) {
      return AuthorizationResult.failure(AuthService.AUTH_ERRORS.USER_NOT_FOUND);
    }

    const validationChain = [
      () => UserValidator.validateStatus(user),
      () => UserValidator.validateIpAccess(user, context.ipAddress),
      () => UserValidator.validateCredits(user, context.estimatedCredits)
    ];

    for (const validator of validationChain) {
      const result = validator();
      if (result.isFailure()) {
        const reason = result.error ?? AuthService.AUTH_ERRORS.USER_DISABLED;
        if (reason === AuthService.AUTH_ERRORS.IP_NOT_AUTHORIZED) {
          this.logIpAuthorizationFailure(context, user);
        }
        return AuthorizationResult.failure(reason, user, user.credits);
      }
    }

    this.logAuthorizationSuccess(context);
    return AuthorizationResult.success(user);
  }

  public async validateModelAccess(userId: string, model: string): Promise<boolean> {
    const user = await this.userRepository.findById(userId);
    if (!user) return false;

    return this.modelRegistry
      .getModelsByPlan(user.plan)
      .some(availableModel => availableModel.id === model);
  }

  private async findUserByApiKey(apiKey: string): Promise<User | null> {
    const searchHash = this.cryptoService.createHmac('search-hash', apiKey);
    return this.userRepository.findByApiKeyHash(searchHash);
  }

  private isValidApiKeyFormat(apiKey: string): boolean {
    return Boolean(apiKey?.trim());
  }

  private async validateApiKeyForUser(user: User, apiKey: string): Promise<boolean> {
    const userApiKeys = await this.apiKeyRepository.findByUserId(user.id);
    
    for (const apiKeyEntity of userApiKeys) {
      if (await this.compareApiKeyHash(apiKey, apiKeyEntity, user.id)) {
        await this.apiKeyRepository.updateLastUsed(apiKeyEntity.id);
        return true;
      }
    }
    return false;
  }

  private async compareApiKeyHash(apiKey: string, apiKeyEntity: any, userId: string): Promise<boolean> {
    try {
      const testHash = await this.cryptoService.hashWithSalt(apiKey, apiKeyEntity.salt);
      const isMatch = testHash === apiKeyEntity.encrypted;
      
      if (!isMatch) {
        this.logger.warn('API key hash mismatch', {
          metadata: { userId, testHash: this.maskHash(testHash) }
        });
      }
      
      return isMatch;
    } catch (error) {
      this.logger.warn('Error validating API key hash', {
        metadata: { userId, error: (error as Error).message }
      });
      return false;
    }
  }

  private logAuthenticationFailure(reason: string, metadata: Record<string, any>): void {
    this.logger.warn(`Authentication failed: ${reason}`, { metadata });
  }

  private logAuthenticationSuccess(user: User): void {
    this.logger.debug('User authenticated successfully', {
      metadata: { userId: user.id, plan: user.plan }
    });
  }

  private logAuthorizationSuccess(context: AuthorizationContext): void {
    this.logger.debug('Request authorized successfully', {
      metadata: {
        userId: context.userId,
        endpoint: context.endpoint,
        estimatedCredits: context.estimatedCredits
      }
    });
  }

  private logIpAuthorizationFailure(context: AuthorizationContext, user: User): void {
    this.logger.warn('Authorization failed: IP not whitelisted', {
      metadata: {
        userId: context.userId,
        ipAddress: context.ipAddress,
        whitelist: user.ip_whitelist
      }
    });
  }

  private maskApiKey(apiKey: string): string {
    return apiKey.length > 8 ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : '***';
  }

  private maskHash(hash: string): string {
    return hash.length > 16 ? `${hash.slice(0, 8)}...${hash.slice(-8)}` : '***';
  }
}

class UserValidator {
  public static validateStatus(user: User): ValidationResult {
    if (!user.isEnabled) {
      return ValidationResult.failure(AuthService.AUTH_ERRORS.USER_DISABLED);
    }

    return ValidationResult.success();
  }

  public static validateIpAccess(user: User, ipAddress: string): ValidationResult {
    return user.authorizeIpAccess(ipAddress)
      ? ValidationResult.success()
      : ValidationResult.failure(AuthService.AUTH_ERRORS.IP_NOT_AUTHORIZED);
  }

  public static validateCredits(user: User, estimatedCredits: number): ValidationResult {
    return user.authorizeCredits(estimatedCredits)
      ? ValidationResult.success()
      : ValidationResult.failure(AuthService.AUTH_ERRORS.INSUFFICIENT_CREDITS);
  }
}

class ValidationResult {
  private constructor(
    private readonly success: boolean,
    public readonly error?: string
  ) {}

  public static success(): ValidationResult {
    return new ValidationResult(true);
  }

  public static failure(error: string): ValidationResult {
    return new ValidationResult(false, error);
  }

  public isSuccess(): boolean {
    return this.success;
  }

  public isFailure(): boolean {
    return !this.success;
  }
}

namespace AuthenticationResult {
  export function success(user: User): AuthenticationResult {
    return { user, isAuthenticated: true };
  }

  export function successWithOAuth(user: User): AuthenticationResult {
    return { user, isAuthenticated: true, isOAuthToken: true };
  }

  export function failure(user: User | null, reason: string): AuthenticationResult {
    return { user, isAuthenticated: false, reason };
  }
}

namespace AuthorizationResult {
  export function success(user: User): AuthorizationResult {
    return {
      isAuthorized: true,
      user,
      remainingCredits: user.credits,
      rateLimitInfo: {
        maxConcurrentRequests: user.maxConcurrentRequests,
        currentRequests: 0
      }
    };
  }

  export function failure(reason: string, user?: User, remainingCredits?: number): AuthorizationResult {
    return {
      isAuthorized: false,
      user,
      reason,
      remainingCredits
    };
  }
}