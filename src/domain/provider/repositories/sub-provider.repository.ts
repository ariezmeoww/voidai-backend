import type { SubProvider } from '../entities';

export interface SubProviderFilters {
  providerId?: string;
  enabled?: boolean;
  healthScore?: { min?: number; max?: number };
  circuitBreakerState?: 'closed' | 'open' | 'half-open';
  supportsModel?: string;
  hasCapacity?: boolean;
}

export interface SubProviderQuery {
  filters?: SubProviderFilters;
  sortBy?: 'priority' | 'weight' | 'healthScore' | 'lastUsedAt' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface ISubProviderRepository {
  findById(id: string): Promise<SubProvider | null>;
  findByProvider(providerId: string): Promise<SubProvider[]>;
  findMany(query?: SubProviderQuery): Promise<SubProvider[]>;
  findAvailable(model?: string): Promise<SubProvider[]>;
  findHealthy(): Promise<SubProvider[]>;
  findByCircuitState(state: 'closed' | 'open' | 'half-open'): Promise<SubProvider[]>;
  exists(id: string): Promise<boolean>;
  save(subProvider: SubProvider): Promise<SubProvider>;
  saveMany(subProviders: SubProvider[]): Promise<void>;
  delete(id: string): Promise<boolean>;
  count(filters?: SubProviderFilters): Promise<number>;
  updateMetrics(id: string, metrics: any): Promise<void>;
  updateLimits(id: string, limits: any): Promise<void>;
  updateCircuitBreaker(id: string, state: 'closed' | 'open' | 'half-open'): Promise<void>;
  resetCapacityCounters(ids: string[]): Promise<void>;
  bulkUpdateHealthScores(updates: Array<{ id: string; healthScore: number }>): Promise<void>;
}