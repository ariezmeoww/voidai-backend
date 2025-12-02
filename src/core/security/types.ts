export interface ICryptoService {
  hash(data: string): Promise<string>;
  hashWithSalt(data: string, salt: string): Promise<string>;
  compare(data: string, hash: string): Promise<boolean>;
  encrypt(data: string, key: string): string;
  decrypt(encryptedHex: string, ivHex: string, masterKey: string, authTagHex?: string): string;
  generateToken(length?: number): string;
  generateApiKey(): string;
  createHmac(data: string, secret: string): string;
  verifyHmac(data: string, signature: string, secret: string): boolean;
}

export interface IRateLimiter {
  isAllowed(key: string, limit: number, windowMs: number): Promise<boolean>;
  getRemainingRequests(key: string, limit: number, windowMs: number): Promise<number>;
  reset(key: string): Promise<void>;
}

export interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}