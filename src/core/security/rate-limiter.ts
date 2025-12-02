import type { IRateLimiter } from './types';
import type { ICacheService } from '../cache';

interface RateLimitData {
  count: number;
  timestamp: number;
}

export class RateLimiter implements IRateLimiter {
  private static readonly CACHE_KEY_PREFIX = 'rate_limit:';
  private cacheService: ICacheService;

  constructor(cacheService: ICacheService) {
    this.cacheService = cacheService;
  }

  async isAllowed(key: string, limit: number, windowMs: number): Promise<boolean> {
    const currentCount = await this.getCurrentCount(key, windowMs);
    return currentCount < limit;
  }

  async getRemainingRequests(key: string, limit: number, windowMs: number): Promise<number> {
    const currentCount = await this.getCurrentCount(key, windowMs);
    return Math.max(0, limit - currentCount);
  }

  async reset(key: string): Promise<void> {
    const cacheKey = this.buildCacheKey(key);
    await this.cacheService.delete(cacheKey);
  }

  private async getCurrentCount(key: string, windowMs: number): Promise<number> {
    const cacheKey = this.buildCacheKey(key);
    const data = await this.cacheService.get<RateLimitData>(cacheKey);
    const now = Date.now();
    
    if (!data || this.isWindowExpired(data.timestamp, now, windowMs)) {
      await this.setRateLimitData(cacheKey, 1, now, windowMs);
      return 1;
    }

    const newCount = data.count + 1;
    await this.setRateLimitData(cacheKey, newCount, data.timestamp, windowMs);
    return newCount;
  }

  private buildCacheKey(key: string): string {
    return `${RateLimiter.CACHE_KEY_PREFIX}${key}`;
  }

  private isWindowExpired(timestamp: number, now: number, windowMs: number): boolean {
    return now - timestamp > windowMs;
  }

  private async setRateLimitData(cacheKey: string, count: number, timestamp: number, ttl: number): Promise<void> {
    const data: RateLimitData = { count, timestamp };
    await this.cacheService.set(cacheKey, data, ttl);
  }
}
