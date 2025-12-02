import type { User } from '../entities';

export interface UserFilters {
  plan?: string;
  enabled?: boolean;
  creditsMin?: number;
  creditsMax?: number;
  planExpired?: boolean;
}

export interface UserQuery {
  filters?: UserFilters;
  sortBy?: 'name' | 'createdAt' | 'lastRequestAt' | 'credits';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByName(name: string): Promise<User | null>;
  findByApiKeyHash(keyHash: string): Promise<User | null>;
  findMany(query?: UserQuery): Promise<User[]>;
  findExpiredPlans(): Promise<User[]>;
  findLowCredits(threshold: number): Promise<User[]>;
  exists(id: string): Promise<boolean>;
  save(user: User): Promise<User>;
  saveMany(users: User[]): Promise<void>;
  delete(id: string): Promise<boolean>;
  count(filters?: UserFilters): Promise<number>;
  updateCredits(id: string, credits: number): Promise<void>;
  resetCredits(ids: string[], credits: number): Promise<void>;
  bulkUpdatePlans(updates: Array<{ id: string; plan: string; expiresAt: number }>): Promise<void>;
}