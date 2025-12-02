import type { ApiRequest, RequestState } from '../entities';

export interface RequestFilters {
  userId?: string;
  endpoint?: string;
  model?: string;
  providerId?: string;
  status?: RequestState;
  dateFrom?: number;
  dateTo?: number;
  minLatency?: number;
  maxLatency?: number;
}

export interface RequestQuery {
  filters?: RequestFilters;
  sortBy?: 'createdAt' | 'completedAt' | 'latency' | 'tokensUsed' | 'creditsUsed';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface IApiRequestRepository {
  findById(id: string): Promise<ApiRequest | null>;
  findByUser(userId: string, query?: RequestQuery): Promise<ApiRequest[]>;
  findMany(query?: RequestQuery): Promise<ApiRequest[]>;
  findCompleted(): Promise<ApiRequest[]>;
  findFailed(): Promise<ApiRequest[]>;
  findByModel(model: string): Promise<ApiRequest[]>;
  findByProvider(providerId: string): Promise<ApiRequest[]>;
  findByDateRange(from: number, to: number): Promise<ApiRequest[]>;
  exists(id: string): Promise<boolean>;
  save(request: ApiRequest): Promise<ApiRequest>;
  saveMany(requests: ApiRequest[]): Promise<void>;
  delete(id: string): Promise<boolean>;
  count(filters?: RequestFilters): Promise<number>;
  getUsageStats(userId?: string): Promise<{
    totalRequests: number;
    totalTokens: number;
    totalCredits: number;
    avgLatency: number;
    successRate: number;
  }>;
}