import { SubProvider, Provider, type ErrorType } from '../entities';
import type { ISubProviderRepository, IProviderRepository } from '../repositories';
import type { ILogger } from '../../../core/logging';
import { SubProviderService } from './sub-provider.service';
import type { ModelRegistryService } from './model-registry.service';

export interface LoadBalancingRequest {
  readonly model: string;
  readonly estimatedTokens?: number;
  readonly excludeIds?: ReadonlyArray<string>;
  readonly requireHealthy?: boolean;
  readonly capability?: string;
}

export interface LoadBalancingResult {
  readonly provider: Provider;
  readonly subProvider: SubProvider | null;
  readonly totalAvailable: number;
  readonly selectedReason: string;
  readonly selectionScore: number;
}

export interface SelectionTracker {
  requestCounter: number;
  readonly selectionHistory: Map<string, number>;
  readonly avoidanceThreshold: number;
}

export interface LoadBalancingStats {
  readonly totalProviders: number;
  readonly availableProviders: number;
  readonly totalSubProviders: number;
  readonly availableSubProviders: number;
  readonly healthySubProviders: number;
  readonly requestCounter: number;
  readonly trackedSelections: number;
}

export interface SubProviderSelection {
  readonly subProvider: SubProvider;
  readonly selectedReason: string;
  readonly selectionScore: number;
}

export class LoadBalancerService {
  static readonly CONFIG = {
    CLEANUP_INTERVAL: 60000,
    EXPLORATION_PROBABILITY: 0.15,
    NEW_PROVIDER_REQUEST_THRESHOLD: 5,
    USAGE_PENALTY_THRESHOLD: 20,
    CLEANUP_THRESHOLD: 100,
    AVOIDANCE_THRESHOLD: 5
  } as const;

  static readonly SCORING_WEIGHTS = {
    SUCCESS_RATE: 0.2,
    LATENCY: 0.15,
    HEALTH: 0.15,
    AVAILABILITY: 0.1,
    CAPACITY: 0.1,
    USAGE_BALANCE: 0.3
  } as const;

  private readonly selectionTracker: SelectionTracker;

  constructor(
    private readonly subProviderRepository: ISubProviderRepository,
    private readonly logger: ILogger,
    private readonly providerRepository: IProviderRepository,
    private readonly subProviderService: SubProviderService,
    private readonly modelRegistry: ModelRegistryService
  ) {
    this.selectionTracker = {
      requestCounter: 0,
      selectionHistory: new Map(),
      avoidanceThreshold: LoadBalancerService.CONFIG.AVOIDANCE_THRESHOLD
    };
    
    this.initializeCleanupTimer();
  }

  public async select(request: LoadBalancingRequest): Promise<LoadBalancingResult | null> {
    const eligibleProviders = await this.findEligibleProviders(request);
    
    if (eligibleProviders.length === 0) {
      this.logNoEligibleProviders(request);
      return null;
    }

    const selectedResult = this.selectBestOption(eligibleProviders);
    this.recordProviderSelection(selectedResult);
    this.logProviderSelection(selectedResult, request, eligibleProviders.length);

    return this.createLoadBalancingResult(selectedResult, eligibleProviders.length);
  }

  public async recordRequestStart(subProviderId?: string, estimatedTokens: number = 0): Promise<boolean> {
    if (!subProviderId) return true;

    const subProvider = await this.subProviderRepository.findById(subProviderId);
    if (!subProvider) return false;

    const reserved = subProvider.reserveCapacity(estimatedTokens);
    if (reserved) {
      await this.subProviderRepository.save(subProvider);
    }

    return reserved;
  }

  public async recordRequestComplete(
    providerId: string,
    success: boolean,
    latency: number,
    tokensUsed: number = 0,
    errorType?: ErrorType,
    subProviderId?: string,
    errorMessage?: string
  ): Promise<void> {
    if (subProviderId) {
      await this.subProviderService.releaseSubProviderCapacity(subProviderId);
    }
    
    await this.recordSubProviderResult(subProviderId, success, latency, tokensUsed, errorType, errorMessage);
    await this.recordProviderResult(providerId, success, latency, tokensUsed, errorType);
  }

  public async getLoadBalancingStats(): Promise<LoadBalancingStats> {
    const allProviders = await this.providerRepository.findMany();
    const allSubProviders = await this.subProviderRepository.findMany();
    
    const statsCalculator = new LoadBalancingStatsCalculator(
      allProviders,
      allSubProviders,
      this.subProviderRepository,
      this.selectionTracker
    );
    
    return statsCalculator.calculate();
  }

  private async findEligibleProviders(request: LoadBalancingRequest): Promise<EligibleProvider[]> {
    const allProviders = await this.providerRepository.findMany();
    this.logger.debug('Load balancer found providers', {
      metadata: {
        totalProviders: allProviders.length,
        requestedModel: request.model
      }
    });
    
    const eligibleProviders: EligibleProvider[] = [];
    const excluded = new Set(request.excludeIds || []);

    for (const provider of allProviders) {
      // Respect excluded provider IDs
      if (excluded.has(provider.id)) {
        this.logger.debug('Provider excluded from selection', {
          metadata: {
            providerId: provider.id,
            providerName: provider.name
          }
        });
        continue;
      }

      if (!provider.supportsModel(request.model)) {
        this.logger.debug('Provider does not support model', {
          metadata: {
            providerId: provider.id,
            providerName: provider.name,
            requestedModel: request.model,
            supportedModels: provider.supportedModels.slice(0, 5)
          }
        });
        continue;
      }

      const eligibleProvider = await this.evaluateProvider(provider, request);
      if (eligibleProvider) {
        eligibleProviders.push(eligibleProvider);
        this.logger.debug('Provider is eligible', {
          metadata: {
            providerId: provider.id,
            providerName: provider.name,
            needsSubProviders: provider.needsSubProviders
          }
        });
      }
    }

    this.logger.debug('Eligible providers found', {
      metadata: {
        eligibleCount: eligibleProviders.length,
        totalProviders: allProviders.length
      }
    });

    return eligibleProviders;
  }

  private async evaluateProvider(provider: Provider, request: LoadBalancingRequest): Promise<EligibleProvider | null> {
    if (provider.needsSubProviders) {
      return this.evaluateProviderWithSubProviders(provider, request);
    } else {
      return this.evaluateStandaloneProvider(provider, request);
    }
  }

  private async evaluateProviderWithSubProviders(
    provider: Provider, 
    request: LoadBalancingRequest
  ): Promise<EligibleProvider | null> {
    const subProviders = await this.subProviderRepository.findByProvider(provider.id);
    const availableSubProviders = this.filterAvailableSubProviders(subProviders, request);

    if (availableSubProviders.length === 0) {
      this.logNoAvailableSubProviders(provider);
      return null;
    }

    const selectedSubProvider = this.selectBestSubProvider(availableSubProviders, request.estimatedTokens ?? 0);
    
    return {
      provider,
      subProvider: selectedSubProvider.subProvider,
      score: selectedSubProvider.selectionScore,
      reason: selectedSubProvider.selectedReason
    };
  }

  private evaluateStandaloneProvider(provider: Provider, request: LoadBalancingRequest): EligibleProvider | null {
    if (request.requireHealthy && !provider.isHealthy()) {
      return null;
    }

    return {
      provider,
      subProvider: null,
      score: this.calculateProviderScore(provider),
      reason: 'static_api_key_provider'
    };
  }

  private filterAvailableSubProviders(subProviders: SubProvider[], request: LoadBalancingRequest): SubProvider[] {
    const { estimatedTokens = 0, excludeIds = [], requireHealthy = false, capability } = request;
    
    const relaxConcurrency = capability === 'images';
    
    let availableSubProviders = subProviders.filter(sp => {
      const isEnabled = sp.isEnabled;
      const isHealthy = !requireHealthy || sp.isHealthy();
      const notExcluded = !excludeIds.includes(sp.id) && !excludeIds.includes(sp.providerId);
      const hasActiveKey = sp.hasActiveApiKey();
      const notRateLimited = !sp.isRateLimited();
      
      const canHandle = relaxConcurrency ?
        (isEnabled && isHealthy && notRateLimited && hasActiveKey) :
        sp.canHandleRequest(estimatedTokens);
      
      return isEnabled && isHealthy && canHandle && notExcluded && hasActiveKey;
    });

    if (capability === 'images') {
      availableSubProviders = this.filterForImageCapability(availableSubProviders, request.model);
    }

    return availableSubProviders;
  }

  private filterForImageCapability(subProviders: SubProvider[], model: string): SubProvider[] {
    const modelInfo = this.modelRegistry.getById(model);
    
    if (!modelInfo) {
      return subProviders;
    }
    
    const isOpenAIModel = modelInfo.ownedBy === 'openai';
    
    if (isOpenAIModel) {
      return subProviders.filter(sp => {
        const metadata = sp.toDocument().metadata || {};
        return metadata.isVerified === true;
      });
    }
    
    return subProviders;
  }

  private selectBestSubProvider(subProviders: SubProvider[], estimatedTokens: number): SubProviderSelection {
    const explorationResult = this.tryExplorationSelection(subProviders);
    if (explorationResult) return explorationResult;

    return this.performWeightedSelection(subProviders, estimatedTokens);
  }

  private tryExplorationSelection(subProviders: SubProvider[]): SubProviderSelection | null {
    const newSubProviders = subProviders.filter(sp => {
      const metrics = sp.getMetrics();
      return (metrics.totalRequests || 0) < LoadBalancerService.CONFIG.NEW_PROVIDER_REQUEST_THRESHOLD;
    });

    if (newSubProviders.length > 0 && Math.random() < LoadBalancerService.CONFIG.EXPLORATION_PROBABILITY) {
      const selected = newSubProviders[Math.floor(Math.random() * newSubProviders.length)];
      return {
        subProvider: selected,
        selectedReason: 'exploration_of_new_sub_provider',
        selectionScore: 0.6
      };
    }

    return null;
  }

  private performWeightedSelection(subProviders: SubProvider[], estimatedTokens: number): SubProviderSelection {
    const scoredSubProviders = this.scoreSubProviders(subProviders, estimatedTokens);
    const normalizedScores = this.normalizeScores(scoredSubProviders);
    
    const selectedProvider = this.weightedRandomSelection(normalizedScores);
    
    return {
      subProvider: selectedProvider.subProvider,
      selectedReason: 'balanced_weighted_selection',
      selectionScore: selectedProvider.score
    };
  }

  private scoreSubProviders(subProviders: SubProvider[], estimatedTokens: number): ScoredSubProvider[] {
    return subProviders.map(subProvider => {
      let score = this.calculateSubProviderScore(subProvider, estimatedTokens);
      const avoidanceScore = this.getAvoidanceScore(subProvider.id);
      const usagePenalty = this.calculateUsagePenalty(subProvider);
      
      score = Math.max(0.1, score + avoidanceScore - usagePenalty);
      
      return { subProvider, score };
    });
  }

  private normalizeScores(scoredSubProviders: ScoredSubProvider[]): ScoredSubProvider[] {
    return scoredSubProviders.map(({ subProvider, score }) => ({
      subProvider,
      score: Math.max(0.3, Math.min(0.7, score))
    }));
  }

  private weightedRandomSelection(normalizedScores: ScoredSubProvider[]): ScoredSubProvider {
    const totalScore = normalizedScores.reduce((sum, { score }) => sum + score, 0);
    const random = Math.random();
    let cumulativeWeight = 0;
    
    for (const item of normalizedScores) {
      cumulativeWeight += item.score / totalScore;
      if (random <= cumulativeWeight) {
        return item;
      }
    }
    
    return normalizedScores[0];
  }

  private calculateUsagePenalty(subProvider: SubProvider): number {
    const metrics = subProvider.getMetrics();
    const totalRequests = metrics.totalRequests || 0;
    
    return totalRequests > LoadBalancerService.CONFIG.USAGE_PENALTY_THRESHOLD 
      ? Math.min(0.2, totalRequests / 200) 
      : 0;
  }

  private selectBestOption(eligibleProviders: EligibleProvider[]): EligibleProvider {
    const scoredWithAvoidance = this.applyAvoidanceScoring(eligibleProviders);
    const normalizedScores = this.normalizeProviderScores(scoredWithAvoidance);
    
    return this.weightedRandomProviderSelection(normalizedScores);
  }

  private applyAvoidanceScoring(eligibleProviders: EligibleProvider[]): EligibleProvider[] {
    return eligibleProviders.map(provider => {
      const avoidanceScore = this.getAvoidanceScore(provider.provider.id);
      const adjustedScore = Math.max(0.1, provider.score + avoidanceScore);
      
      return { ...provider, score: adjustedScore };
    });
  }

  private normalizeProviderScores(providers: EligibleProvider[]): EligibleProvider[] {
    return providers.map(provider => ({
      ...provider,
      score: Math.max(0.3, Math.min(0.7, provider.score))
    }));
  }

  private weightedRandomProviderSelection(normalizedScores: EligibleProvider[]): EligibleProvider {
    const totalScore = normalizedScores.reduce((sum, provider) => sum + provider.score, 0);
    const random = Math.random();
    let cumulativeWeight = 0;
    
    for (const provider of normalizedScores) {
      cumulativeWeight += provider.score / totalScore;
      if (random <= cumulativeWeight) {
        return provider;
      }
    }
    
    return normalizedScores[0];
  }

  private calculateProviderScore(provider: Provider): number {
    if (provider.isHealthy()) return 0.9;
    if (provider.isDegraded()) return 0.1;
    return 0.05;
  }

  private calculateSubProviderScore(subProvider: SubProvider, estimatedTokens: number): number {
    const metrics = subProvider.getMetrics();
    const totalRequests = metrics.totalRequests || 0;
    const isNewProvider = totalRequests < LoadBalancerService.CONFIG.NEW_PROVIDER_REQUEST_THRESHOLD;
    
    if (!subProvider.isHealthy()) return 0.05;

    const scoreComponents = this.calculateScoreComponents(subProvider, estimatedTokens, isNewProvider);
    const consecutiveErrorsPenalty = Math.min(0.4, subProvider.consecutiveErrors * 0.1);
    
    const baseScore = this.combineScoreComponents(scoreComponents);
    return Math.max(0.1, Math.min(1.0, baseScore - consecutiveErrorsPenalty));
  }

  private calculateScoreComponents(subProvider: SubProvider, estimatedTokens: number, isNewProvider: boolean) {
    let successRate = subProvider.successRate;
    let latencyScore = Math.max(0, 1 - (subProvider.avgLatency / 8000));
    let healthScore = subProvider.healthScore;
    
    if (isNewProvider) {
      successRate = Math.max(successRate, 0.7);
      latencyScore = Math.max(latencyScore, 0.6);
      healthScore = Math.max(healthScore, 0.7);
    }
    
    const availabilityScore = subProvider.isAvailable() ? 1 : 0;
    const capacityScore = this.calculateCapacityScore(subProvider, estimatedTokens);
    const usageBalanceScore = this.calculateUsageBalanceScore(subProvider);
    
    return {
      successRate,
      latencyScore,
      healthScore,
      availabilityScore,
      capacityScore,
      usageBalanceScore
    };
  }

  private calculateCapacityScore(subProvider: SubProvider, estimatedTokens: number): number {
    const currentRPM = subProvider.getCurrentRequestsPerMinute();
    const currentTPM = subProvider.getCurrentTokensPerMinute();
    const limits = subProvider.getLimits();
    
    const rpmUtilization = limits.maxRequestsPerMinute > 0 ? currentRPM / limits.maxRequestsPerMinute : 0;
    const tpmUtilization = limits.maxTokensPerMinute > 0 ? (currentTPM + estimatedTokens) / limits.maxTokensPerMinute : 0;
    const concurrencyUtilization = limits.maxConcurrentRequests > 0 ? limits.currentConcurrentRequests / limits.maxConcurrentRequests : 0;
    
    return Math.max(0, 1 - Math.max(rpmUtilization, tpmUtilization, concurrencyUtilization));
  }

  private calculateUsageBalanceScore(subProvider: SubProvider): number {
    const metrics = subProvider.getMetrics();
    const totalRequests = metrics.totalRequests || 0;
    return totalRequests > 0 ? Math.max(0.3, 1 - (totalRequests / 50)) : 0.9;
  }

  private combineScoreComponents(components: any): number {
    const weights = LoadBalancerService.SCORING_WEIGHTS;
    
    return (components.successRate * weights.SUCCESS_RATE) +
           (components.latencyScore * weights.LATENCY) +
           (components.healthScore * weights.HEALTH) +
           (components.availabilityScore * weights.AVAILABILITY) +
           (components.capacityScore * weights.CAPACITY) +
           (components.usageBalanceScore * weights.USAGE_BALANCE);
  }

  private async recordSubProviderResult(
    subProviderId: string | undefined,
    success: boolean,
    latency: number,
    tokensUsed: number,
    errorType?: ErrorType,
    errorMessage?: string
  ): Promise<void> {
    if (!subProviderId) return;

    if (success) {
      await this.subProviderService.recordSubProviderSuccess(subProviderId, latency, tokensUsed);
    } else {
      await this.subProviderService.recordSubProviderError(
        subProviderId,
        errorType || 'other',
        latency,
        errorMessage
      );
    }
  }

  private async recordProviderResult(
    providerId: string,
    success: boolean,
    latency: number,
    tokensUsed: number,
    errorType?: ErrorType
  ): Promise<void> {
    const provider = await this.providerRepository.findById(providerId);
    if (!provider) return;

    if (success) {
      provider.recordSuccess(latency, tokensUsed);
    } else {
      provider.recordError(errorType || 'other');
    }

    await this.providerRepository.save(provider);
  }

  private recordProviderSelection(selectedResult: EligibleProvider): void {
    const trackingId = selectedResult.subProvider?.id ?? selectedResult.provider.id;
    this.recordSelection(trackingId);
  }

  private recordSelection(providerId: string): void {
    this.selectionTracker.requestCounter++;
    this.selectionTracker.selectionHistory.set(providerId, this.selectionTracker.requestCounter);
  }

  private getAvoidanceScore(providerId: string): number {
    const lastSelected = this.selectionTracker.selectionHistory.get(providerId);
    if (!lastSelected) return 0.2;
    
    const requestsSinceSelection = this.selectionTracker.requestCounter - lastSelected;
    
    if (requestsSinceSelection >= this.selectionTracker.avoidanceThreshold) {
      return Math.min(0.3, requestsSinceSelection * 0.02);
    }
    
    return Math.max(-0.6, -(this.selectionTracker.avoidanceThreshold - requestsSinceSelection) * 0.12);
  }

  private initializeCleanupTimer(): void {
    setInterval(() => this.cleanupSelectionHistory(), LoadBalancerService.CONFIG.CLEANUP_INTERVAL);
  }

  private cleanupSelectionHistory(): void {
    const currentCounter = this.selectionTracker.requestCounter;
    const cleanupThreshold = LoadBalancerService.CONFIG.CLEANUP_THRESHOLD;
    
    for (const [providerId, lastSelected] of this.selectionTracker.selectionHistory.entries()) {
      if (currentCounter - lastSelected > cleanupThreshold) {
        this.selectionTracker.selectionHistory.delete(providerId);
      }
    }
  }

  private createLoadBalancingResult(selectedResult: EligibleProvider, totalAvailable: number): LoadBalancingResult {
    return {
      provider: selectedResult.provider,
      subProvider: selectedResult.subProvider,
      totalAvailable,
      selectedReason: selectedResult.reason,
      selectionScore: selectedResult.score
    };
  }

  private logNoEligibleProviders(request: LoadBalancingRequest): void {
    this.logger.warn('No eligible providers found for request', {
      metadata: { 
        model: request.model, 
        estimatedTokens: request.estimatedTokens 
      }
    });
  }

  private logNoAvailableSubProviders(provider: Provider): void {
    this.logger.debug('Provider needs sub-providers but has none available', {
      metadata: { 
        providerId: provider.id, 
        providerName: provider.name 
      }
    });
  }

  private logProviderSelection(
    selectedResult: EligibleProvider,
    request: LoadBalancingRequest,
    totalAvailable: number
  ): void {
    this.logger.debug('Provider selected by load balancer', {
      metadata: {
        providerId: selectedResult.provider.id,
        subProviderId: selectedResult.subProvider?.id,
        model: request.model,
        totalAvailable,
        reason: selectedResult.reason,
        score: selectedResult.score
      }
    });
  }
}

class LoadBalancingStatsCalculator {
  constructor(
    private readonly providers: Provider[],
    private readonly subProviders: SubProvider[],
    private readonly subProviderRepository: ISubProviderRepository,
    private readonly selectionTracker: SelectionTracker
  ) {}

  public async calculate(): Promise<LoadBalancingStats> {
    const availableProviderCount = await this.calculateAvailableProviders();
    const availableSubProviders = this.subProviders.filter(sp => sp.isAvailable());
    const healthySubProviders = this.subProviders.filter(sp => sp.isHealthy());

    return {
      totalProviders: this.providers.length,
      availableProviders: availableProviderCount,
      totalSubProviders: this.subProviders.length,
      availableSubProviders: availableSubProviders.length,
      healthySubProviders: healthySubProviders.length,
      requestCounter: this.selectionTracker.requestCounter,
      trackedSelections: this.selectionTracker.selectionHistory.size
    };
  }

  private async calculateAvailableProviders(): Promise<number> {
    let count = 0;

    for (const provider of this.providers) {
      if (provider.needsSubProviders) {
        const subProviders = await this.subProviderRepository.findByProvider(provider.id);
        if (subProviders.some(sp => sp.isAvailable())) {
          count++;
        }
      } else if (provider.isHealthy()) {
        count++;
      }
    }

    return count;
  }
}

interface EligibleProvider {
  readonly provider: Provider;
  readonly subProvider: SubProvider | null;
  score: number;
  readonly reason: string;
}

interface ScoredSubProvider {
  readonly subProvider: SubProvider;
  readonly score: number;
}