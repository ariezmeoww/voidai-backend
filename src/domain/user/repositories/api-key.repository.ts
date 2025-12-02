import type { ApiKey } from '../entities/api-key.entity';

export interface IApiKeyRepository {
  findById(id: string): Promise<ApiKey | null>;
  findBySearchHash(searchHash: string): Promise<ApiKey | null>;
  findByUserId(userId: string): Promise<ApiKey[]>;
  findByUserIdAndName(userId: string, name: string): Promise<ApiKey | null>;
  save(apiKey: ApiKey): Promise<ApiKey>;
  delete(id: string): Promise<boolean>;
  deleteByUserId(userId: string): Promise<number>;
  updateLastUsed(id: string): Promise<void>;
  activate(id: string): Promise<void>;
  deactivate(id: string): Promise<void>;
  count(userId?: string): Promise<number>;
}