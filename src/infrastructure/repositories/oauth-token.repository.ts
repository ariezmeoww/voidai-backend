import { PrismaClient } from '@prisma/client';
import type { ILogger } from '../../core/logging';

export interface OAuthTokenRecord {
  id: string;
  tokenHash: string;
  clientId: string;
  userId: string;
  scope: string | null;
  expiresAt: bigint;
  createdAt: bigint;
}

export interface IOAuthTokenRepository {
  findByTokenHash(tokenHash: string): Promise<OAuthTokenRecord | null>;
}

export class OAuthTokenRepository implements IOAuthTokenRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: ILogger
  ) {}

  async findByTokenHash(tokenHash: string): Promise<OAuthTokenRecord | null> {
    try {
      const token = await this.prisma.oAuthAccessToken.findUnique({
        where: { tokenHash },
      });

      if (!token) {
        return null;
      }

      return {
        id: token.id,
        tokenHash: token.tokenHash,
        clientId: token.clientId,
        userId: token.userId,
        scope: token.scope,
        expiresAt: token.expiresAt,
        createdAt: token.createdAt,
      };
    } catch (error) {
      this.logger.error('Error finding OAuth token by hash', {
        metadata: { error: (error as Error).message },
      });
      return null;
    }
  }
}
