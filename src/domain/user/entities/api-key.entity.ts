export interface ApiKeyDocument {
  id: string;
  name: string;
  encrypted: string;
  salt: string;
  algorithm: string;
  search_hash: string;
  created_at: number;
  last_used_at?: number;
  is_active: boolean;
  user_id: string;
}

export class ApiKey {
  constructor(private options: ApiKeyDocument) {}

  get id(): string {
    return this.options.id;
  }

  get name(): string {
    return this.options.name;
  }

  get encrypted(): string {
    return this.options.encrypted;
  }

  get salt(): string {
    return this.options.salt;
  }

  get algorithm(): string {
    return this.options.algorithm;
  }

  get searchHash(): string {
    return this.options.search_hash;
  }

  get createdAt(): number {
    return this.options.created_at;
  }

  get lastUsedAt(): number | undefined {
    return this.options.last_used_at;
  }

  get isActive(): boolean {
    return this.options.is_active;
  }

  get userId(): string {
    return this.options.user_id;
  }

  updateLastUsed(): void {
    this.options.last_used_at = Date.now();
  }

  activate(): void {
    this.options.is_active = true;
  }

  deactivate(): void {
    this.options.is_active = false;
  }

  updateName(newName: string): void {
    this.options.name = newName;
  }

  toDocument(): ApiKeyDocument {
    return {
      id: this.options.id,
      name: this.options.name,
      encrypted: this.options.encrypted,
      salt: this.options.salt,
      algorithm: this.options.algorithm,
      search_hash: this.options.search_hash,
      created_at: this.options.created_at,
      last_used_at: this.options.last_used_at,
      is_active: this.options.is_active,
      user_id: this.options.user_id
    };
  }
}