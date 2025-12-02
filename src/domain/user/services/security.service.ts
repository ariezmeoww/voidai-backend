import type { IUserRepository } from '../repositories';
import type { ILogger } from '../../../core/logging';
import type { ICacheService } from '../../../core/cache';
import type { ICryptoService } from '../../../core/security';
import type { LoadBalancerService } from '../../provider';
import type { ProviderRegistry } from '../../../infrastructure/providers/services';
import type { ModelRegistryService } from '../../../domain/provider';
import { createHash } from 'crypto';

export interface ContentAnalysisResult {
  readonly isBlocked: boolean;
  readonly riskLevel: 'low' | 'medium' | 'high' | 'critical';
  readonly detectedCategories: ReadonlyArray<string>;
  readonly confidence: number;
  readonly shouldDisableUser: boolean;
}

interface ModerationConfig {
  readonly enableStrictMode: boolean;
  readonly cacheResults: boolean;
  readonly alertWebhookUrl?: string;
}

interface ModerationRequest {
  readonly input: string;
  readonly model: string;
}

interface ModerationResponse {
  readonly results: ReadonlyArray<ModerationResult>;
}

interface ModerationResult {
  readonly category_scores: Record<string, number>;
  readonly flagged: boolean;
}

interface CriticalAlertData {
  readonly userId: string;
  readonly content: string;
  readonly confidence: number;
  readonly threshold: number;
}

export class SecurityService {
  private static readonly THRESHOLDS = {
    USER_CONTENT: 0.85,
    IMAGE_CONTENT: 0.65,
    CACHE_TTL: 86400000
  } as const;

  private static readonly BLACKLISTED_ORIGINS = [
    'janitor', 'spicychat', 'crushon', 'replika', 'chub', 'silly', 'tavern'
  ] as const;

  private static readonly MODERATION_CATEGORIES = [
    'sexual', 'hate', 'harassment', 'self-harm', 'hate/threatening',
    'violence/graphic', 'self-harm/intent', 'self-harm/instructions',
    'harassment/threatening', 'violence'
  ] as const;

  private static readonly MODERATION_MODEL = 'omni-moderation-latest';
  private static readonly CACHE_PREFIX = 'security:';

  private readonly config: ModerationConfig;

  constructor(
    private readonly userRepository: IUserRepository,
    private readonly cacheService: ICacheService,
    private readonly loadBalancer: LoadBalancerService,
    private readonly providerRegistry: ProviderRegistry,
    private readonly cryptoService: ICryptoService,
    private readonly modelRegistry: ModelRegistryService,
    private readonly logger: ILogger
  ) {
    this.config = {
      enableStrictMode: true,
      cacheResults: true,
      alertWebhookUrl: process.env.DISCORD_WEBHOOK_URL
    };
  }

  public async analyzeContent(
    content: string,
    userId: string,
    userPlan: string,
    origin: string,
    model: string
  ): Promise<ContentAnalysisResult> {
    if (model.toLowerCase() === 'lumina') {
      return this.createSafeResult();
    }

    const cachedResult = await this.checkCache(content);
    if (cachedResult) return cachedResult;

    try {
      const user = userId ? await this.userRepository.findById(userId) : null;
      const isRPVerified = user?.isRPVerified || false;
      
      const originCheck = this.checkOriginBlacklist(userPlan, isRPVerified, origin);
      if (originCheck) return originCheck;

      const moderationResult = await this.performModeration(content);
      const analysis = this.analyzeResults(moderationResult, userPlan, isRPVerified, model);

      if (analysis.shouldDisableUser && userId) {
        await this.handleCriticalViolation(userId, content, analysis);
      }

      await this.cacheResult(this.generateHash(content), analysis);
      this.logAnalysis(userId, analysis);

      return analysis;
    } catch (error) {
      this.logger.error('Content analysis failed', error as Error, {
        metadata: { userId, contentLength: content.length }
      });
      return this.createSafeResult();
    }
  }

  public async analyzeImageContent(content: string, userId?: string): Promise<ContentAnalysisResult> {
    const cachedResult = await this.checkCache(`image:${content}`);
    if (cachedResult) return cachedResult;

    try {
      const moderationResult = await this.performModeration(content);
      const analysis = this.analyzeImageResults(moderationResult);

      if (analysis.shouldDisableUser && userId) {
        await this.handleCriticalViolation(userId, content, analysis);
      }

      await this.cacheResult(this.generateHash(`image:${content}`), analysis);
      this.logAnalysis(userId, analysis);

      return analysis;
    } catch (error) {
      this.logger.error('Image moderation failed - blocking request as safety precaution', error as Error, {
        metadata: { userId, contentLength: content.length }
      });
      
      return {
        isBlocked: true,
        riskLevel: 'high',
        detectedCategories: ['moderation_unavailable'],
        confidence: 1.0,
        shouldDisableUser: false
      };
    }
  }

  private async checkCache(content: string): Promise<ContentAnalysisResult | null> {
    if (!this.config.cacheResults) return null;
    return await this.cacheService.get<ContentAnalysisResult>(this.generateHash(content));
  }

  private async cacheResult(key: string, result: ContentAnalysisResult): Promise<void> {
    if (this.config.cacheResults) {
      await this.cacheService.set(key, result, SecurityService.THRESHOLDS.CACHE_TTL);
    }
  }

  private checkOriginBlacklist(userPlan: string, isRPVerified: boolean, origin?: string): ContentAnalysisResult | null {
    if (userPlan !== 'free' || isRPVerified || !origin) return null;
    
    const isBlacklisted = SecurityService.BLACKLISTED_ORIGINS.some(bl =>
      origin.includes(bl) || bl.includes(origin)
    );

    return isBlacklisted ? {
      isBlocked: true,
      riskLevel: 'medium',
      detectedCategories: ['blacklisted_origin'],
      confidence: 1.0,
      shouldDisableUser: false
    } : null;
  }

  private analyzeResults(
    moderationResult: ModerationResponse | null,
    userPlan: string,
    isRPVerified: boolean,
    model: string
  ): ContentAnalysisResult {
    if (!moderationResult?.results?.[0]) return this.createSafeResult();

    const result = moderationResult.results[0];
    const minorScore = this.getMinorScore(result.category_scores);
    const isCritical = minorScore >= SecurityService.THRESHOLDS.USER_CONTENT;

    if (model.toLowerCase() === 'lumina') {
      return isCritical ? {
        isBlocked: true,
        riskLevel: 'critical',
        detectedCategories: ['sexual/minors'],
        confidence: minorScore,
        shouldDisableUser: true
      } : this.createSafeResult();
    }

    if (isRPVerified) {
      const anyHigh = Object.values(result.category_scores).some(
        score => score >= SecurityService.THRESHOLDS.USER_CONTENT
      );

      if (anyHigh && !isCritical) {
        return this.createSafeResult();
      }

      return isCritical ? {
        isBlocked: true,
        riskLevel: 'critical',
        detectedCategories: ['sexual/minors'],
        confidence: minorScore,
        shouldDisableUser: true
      } : this.createSafeResult();
    }

    const modelClass = this.modelRegistry.getById(model);
    const shouldCheckViolations = userPlan === 'free' || 
      !modelClass?.endpoints?.some(ep => ['/v1/chat/completions', '/v1/responses'].includes(ep));

    const violations = shouldCheckViolations
      ? this.checkViolations(result.category_scores, SecurityService.MODERATION_CATEGORIES)
      : { hasViolation: false, categories: [], maxScore: 0 };

    const blocked = isCritical || violations.hasViolation;
    const categories = [
      ...(isCritical ? ['sexual/minors'] : []),
      ...violations.categories
    ];

    return {
      isBlocked: blocked,
      riskLevel: isCritical ? 'critical' : (violations.hasViolation ? 'medium' : 'low'),
      detectedCategories: categories,
      confidence: Math.max(minorScore, violations.maxScore),
      shouldDisableUser: isCritical
    };
  }

  private analyzeImageResults(moderationResult: ModerationResponse | null): ContentAnalysisResult {
    if (!moderationResult?.results?.[0]) return this.createSafeResult();

    const result = moderationResult.results[0];
    const minorScore = this.getMinorScore(result.category_scores);
    const isCritical = minorScore >= SecurityService.THRESHOLDS.USER_CONTENT;
    
    // Use stricter threshold for images since OpenAI's image generation API is more strict than moderation API
    const violations = this.checkImageViolations(result.category_scores);
    const blocked = isCritical || violations.hasViolation;
    const categories = [
      ...(isCritical ? ['sexual/minors'] : []),
      ...violations.categories
    ];

    return {
      isBlocked: blocked,
      riskLevel: isCritical ? 'critical' : (violations.hasViolation ? 'high' : 'low'),
      detectedCategories: categories,
      confidence: Math.max(minorScore, violations.maxScore),
      shouldDisableUser: isCritical
    };
  }

  private checkImageViolations(scores: Record<string, number>) {
    const detected: string[] = [];
    let maxScore = 0;

    for (const [category, score] of Object.entries(scores)) {
      if (score >= SecurityService.THRESHOLDS.IMAGE_CONTENT) {
        detected.push(category);
        maxScore = Math.max(maxScore, score);
      }
    }

    return { hasViolation: detected.length > 0, categories: detected, maxScore };
  }

  private getMinorScore(scores: Record<string, number>): number {
    return scores['sexual/minors'] ?? scores['sexual-minors'] ?? 0;
  }

  private checkViolations(scores: Record<string, number>, categories: readonly string[]) {
    const detected: string[] = [];
    let maxScore = 0;

    for (const category of categories) {
      const score = scores[category] ?? 0;
      if (score >= SecurityService.THRESHOLDS.USER_CONTENT) {
        detected.push(category);
        maxScore = Math.max(maxScore, score);
      }
    }

    return { hasViolation: detected.length > 0, categories: detected, maxScore };
  }

  private async handleCriticalViolation(userId: string, content: string, analysis: ContentAnalysisResult): Promise<void> {
    await Promise.all([
      this.disableUser(userId, analysis),
      this.sendAlert(userId, content, analysis.confidence)
    ]);
  }

  private async performModeration(content: string): Promise<ModerationResponse | null> {
    const maxRetries = 5;
    const excluded: string[] = [];

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const selection = await this.loadBalancer.select({
          model: SecurityService.MODERATION_MODEL,
          estimatedTokens: Math.ceil(content.length / 4),
          excludeIds: excluded,
          requireHealthy: false
        });

        if (!selection) {
          if (attempt < maxRetries) continue;
          return null;
        }

        const provider = await this.getProvider(selection);
        if (!provider) {
          excluded.push(selection.provider.id);
          continue;
        }

        return await this.executeModeration(provider, content, selection);
      } catch (error) {
        this.logger.warn('Moderation attempt failed', {
          metadata: { attempt, error: (error as Error).message }
        });
        if (attempt >= maxRetries) throw error;
      }
    }

    return null;
  }

  private async getProvider(selection: any) {
    if (selection.subProvider) {
      try {
        const key = selection.subProvider.getDecryptedApiKey(this.cryptoService);
        return this.providerRegistry.createAdapterWithApiKey(
          selection.provider.name,
          key,
          selection.subProvider
        );
      } catch (error) {
        this.logger.error('Failed to create sub-provider adapter', error as Error);
        return null;
      }
    }
    return this.providerRegistry.getAdapter(selection.provider.name);
  }

  private async executeModeration(provider: any, content: string, selection: any): Promise<ModerationResponse | null> {
    const reserved = await this.loadBalancer.recordRequestStart(
      selection.subProvider?.id,
      Math.ceil(content.length / 4)
    );

    if (!reserved) {
      this.logger.warn('Could not reserve capacity');
      return null;
    }

    const tracker = new RequestTracker(this.loadBalancer, selection);

    try {
      const request: ModerationRequest = { 
        input: content, 
        model: SecurityService.MODERATION_MODEL 
      };
      
      const result = await provider.moderateContent(request);
      await tracker.recordSuccess();
      return result;
    } catch (error) {
      await tracker.recordFailure();
      throw error;
    }
  }

  private async disableUser(userId: string, analysis: ContentAnalysisResult): Promise<void> {
    try {
      const user = await this.userRepository.findById(userId);
      if (!user) return;

      user.disable();
      await this.userRepository.save(user);

      this.logger.error('User disabled', undefined, {
        metadata: {
          userId,
          confidence: analysis.confidence,
          threshold: SecurityService.THRESHOLDS.USER_CONTENT,
          categories: analysis.detectedCategories
        }
      });
    } catch (error) {
      this.logger.error('Failed to disable user', error as Error, { metadata: { userId } });
    }
  }

  private async sendAlert(userId: string, content: string, confidence: number): Promise<void> {
    if (!this.config.alertWebhookUrl) return;

    try {
      const sender = new AlertSender(this.config.alertWebhookUrl, this.logger);
      await sender.send({
        userId,
        content,
        confidence,
        threshold: SecurityService.THRESHOLDS.USER_CONTENT
      });
    } catch (error) {
      this.logger.error('Failed to send alert', error as Error, { metadata: { userId } });
    }
  }

  private generateHash(content: string): string {
    return `${SecurityService.CACHE_PREFIX}${createHash('sha256').update(content).digest('hex')}`;
  }

  private createSafeResult(): ContentAnalysisResult {
    return {
      isBlocked: false,
      riskLevel: 'low',
      detectedCategories: [],
      confidence: 0,
      shouldDisableUser: false
    };
  }

  private logAnalysis(userId: string | undefined, analysis: ContentAnalysisResult): void {
    this.logger.info('Analysis completed', {
      metadata: {
        userId,
        isBlocked: analysis.isBlocked,
        confidence: analysis.confidence,
        riskLevel: analysis.riskLevel
      }
    });
  }
}

class RequestTracker {
  private readonly startTime = Date.now();

  constructor(
    private readonly loadBalancer: LoadBalancerService,
    private readonly selection: any
  ) {}

  async recordSuccess(): Promise<void> {
    await this.loadBalancer.recordRequestComplete(
      this.selection.provider.id,
      true,
      Date.now() - this.startTime,
      1,
      undefined,
      this.selection.subProvider?.id
    );
  }

  async recordFailure(): Promise<void> {
    await this.loadBalancer.recordRequestComplete(
      this.selection.provider.id,
      false,
      Date.now() - this.startTime,
      0,
      'moderation_error',
      this.selection.subProvider?.id
    );
  }
}

class AlertSender {
  private static readonly MAX_LENGTH = 1000;

  constructor(
    private readonly webhookUrl: string,
    private readonly logger: ILogger
  ) {}

  async send(data: CriticalAlertData): Promise<void> {
    const useFile = data.content.length > AlertSender.MAX_LENGTH;
    
    if (useFile) {
      await this.sendWithFile(data);
    } else {
      await this.sendWithEmbed(data);
    }

    this.logger.info('Alert sent', {
      metadata: { userId: data.userId, confidence: data.confidence, useFile }
    });
  }

  private async sendWithEmbed(data: CriticalAlertData): Promise<void> {
    const embed = {
      title: '🚨 Critical Security Alert - User Disabled',
      description: 'Sexual content involving minors detected',
      color: 0xFF0000,
      timestamp: new Date().toISOString(),
      fields: [
        { name: 'User ID', value: data.userId, inline: true },
        { name: 'Confidence', value: `${(data.confidence * 100).toFixed(2)}%`, inline: true },
        { name: 'Content', value: `\`\`\`${this.truncate(data.content)}\`\`\``, inline: false }
      ]
    };
    
    await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] })
    });
  }

  private async sendWithFile(data: CriticalAlertData): Promise<void> {
    const embed = {
      title: '🚨 Critical Security Alert - User Disabled',
      description: 'Sexual content involving minors detected',
      color: 0xFF0000,
      timestamp: new Date().toISOString(),
      fields: [
        { name: 'User ID', value: data.userId, inline: true },
        { name: 'Confidence', value: `${(data.confidence * 100).toFixed(2)}%`, inline: true },
        { name: 'Length', value: `${data.content.length} chars (attached)`, inline: true }
      ]
    };
    
    const formData = new FormData();
    const file = new Blob([data.content], { type: 'text/plain' });
    formData.append('files[0]', file, `flagged_${data.userId}_${Date.now()}.txt`);
    formData.append('payload_json', JSON.stringify({ embeds: [embed] }));

    await fetch(this.webhookUrl, { method: 'POST', body: formData });
  }

  private truncate(content: string): string {
    return content.length <= AlertSender.MAX_LENGTH 
      ? content 
      : content.substring(0, AlertSender.MAX_LENGTH - 3) + '...';
  }
}