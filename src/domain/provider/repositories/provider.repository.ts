import type { Provider } from '../entities';

export interface ProviderFilters {
  isActive?: boolean;
  supportedModel?: string;
  minPriority?: number;
  healthStatus?: 'healthy' | 'degraded' | 'unhealthy';
}

export interface ProviderQuery {
  filters?: ProviderFilters;
  sortBy?: 'priority' | 'name' | 'createdAt' | 'lastUsedAt';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface IProviderRepository {
  findById(id: string): Promise<Provider | null>;
  findByName(name: string): Promise<Provider | null>;
  findMany(query?: ProviderQuery): Promise<Provider[]>;
  findAvailable(): Promise<Provider[]>;
  findByModel(model: string): Promise<Provider[]>;
  findHealthy(): Promise<Provider[]>;
  exists(id: string): Promise<boolean>;
  save(provider: Provider): Promise<Provider>;
  saveMany(providers: Provider[]): Promise<void>;
  delete(id: string): Promise<boolean>;
  count(filters?: ProviderFilters): Promise<number>;
  updateHealthStatus(id: string, status: 'healthy' | 'degraded' | 'unhealthy'): Promise<void>;
  updateMetrics(id: string, metrics: Partial<Provider['getMetrics']>): Promise<void>;
}