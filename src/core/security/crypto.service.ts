import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import type { ICryptoService } from './types';

export class CryptoService implements ICryptoService {
  private static readonly SALT_ROUNDS = 12;
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly TOKEN_LENGTH = 32;
  private static readonly API_KEY_LENGTH = 100;
  private static readonly SALT = 'salt';
  private static readonly AAD = Buffer.from('additional-data');
  private static readonly API_KEY_PREFIX = 'sk-voidai-';
  private static readonly HMAC_ALGORITHM = 'sha256';
  private static readonly AUTH_TAG_LENGTH = 16;

  async hash(data: string): Promise<string> {
    const salt = await bcrypt.genSalt(CryptoService.SALT_ROUNDS);
    const hash = await bcrypt.hash(data, salt);
    return `${hash}:${salt}`;
  }

  async hashWithSalt(data: string, salt: string): Promise<string> {
    return bcrypt.hash(data, salt);
  }

  async compare(data: string, hash: string): Promise<boolean> {
    return bcrypt.compare(data, hash);
  }

  encrypt(data: string, key: string): string {
    const keyBuffer = crypto.scryptSync(key, CryptoService.SALT, 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(CryptoService.ALGORITHM, keyBuffer, iv);
    
    cipher.setAAD(CryptoService.AAD);
    
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  decrypt(encryptedHex: string, ivHex: string, masterKey: string, authTagHex?: string): string {
    const keyBuffer = crypto.scryptSync(masterKey, CryptoService.SALT, 32);
    const iv = Buffer.from(ivHex, 'hex');
    
    if (authTagHex) {
      return this.decryptWithSeparateAuthTag(encryptedHex, iv, keyBuffer, authTagHex);
    }
    
    return this.decryptWithEmbeddedAuthTag(encryptedHex, iv, keyBuffer);
  }

  generateToken(length: number = CryptoService.TOKEN_LENGTH): string {
    return crypto.randomBytes(length).toString('hex');
  }

  generateApiKey(): string {
    const randomPart = crypto.randomBytes(CryptoService.API_KEY_LENGTH).toString('base64url');
    return CryptoService.API_KEY_PREFIX + randomPart;
  }

  createHmac(data: string, secret: string): string {
    return crypto.createHmac(CryptoService.HMAC_ALGORITHM, secret).update(data).digest('hex');
  }

  verifyHmac(data: string, signature: string, secret: string): boolean {
    const expectedSignature = this.createHmac(data, secret);
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  }

  private decryptWithSeparateAuthTag(encryptedHex: string, iv: Buffer, keyBuffer: Buffer, authTagHex: string): string {
    const authTag = Buffer.from(authTagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    
    const decipher = crypto.createDecipheriv(CryptoService.ALGORITHM, keyBuffer, iv);
    decipher.setAAD(CryptoService.AAD);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, undefined, 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  private decryptWithEmbeddedAuthTag(encryptedHex: string, iv: Buffer, keyBuffer: Buffer): string {
    const encryptedData = Buffer.from(encryptedHex, 'hex');
    
    if (encryptedData.length < CryptoService.AUTH_TAG_LENGTH) {
      throw new Error('Encrypted data too short for old format');
    }
    
    const authTag = encryptedData.slice(-CryptoService.AUTH_TAG_LENGTH);
    const encrypted = encryptedData.slice(0, -CryptoService.AUTH_TAG_LENGTH);
    
    const decipher = crypto.createDecipheriv(CryptoService.ALGORITHM, keyBuffer, iv);
    decipher.setAAD(CryptoService.AAD);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, undefined, 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
}