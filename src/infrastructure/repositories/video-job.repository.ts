import { PrismaClient } from '@prisma/client';
import type { IDatabaseService } from '../../core/database';
import type { ILogger } from '../../core/logging';

export interface VideoJob {
  id: string;
  created_at: number;
  updated_at: number;
  user_id?: string;
  model: string;
  provider_name: string;
  sub_provider_id?: string | null;
  status: string;
  seconds?: string;
  size?: string;
}

export class VideoJobRepository {
  private prisma: PrismaClient;
  private logger: ILogger;

  constructor(databaseService: IDatabaseService, logger: ILogger) {
    this.prisma = databaseService.getPrisma();
    this.logger = logger;
  }

  async upsert(job: VideoJob): Promise<void> {
    await this.prisma.videoJob.upsert({
      where: { id: job.id },
      update: {
        userId: job.user_id || null,
        model: job.model,
        providerName: job.provider_name,
        subProviderId: job.sub_provider_id || null,
        status: job.status,
        seconds: job.seconds,
        size: job.size,
        updatedAt: BigInt(Date.now())
      },
      create: {
        id: job.id,
        createdAt: BigInt(job.created_at || Date.now()),
        updatedAt: BigInt(job.updated_at || Date.now()),
        userId: job.user_id || null,
        model: job.model,
        providerName: job.provider_name,
        subProviderId: job.sub_provider_id || null,
        status: job.status,
        seconds: job.seconds,
        size: job.size
      }
    });
  }

  async findById(id: string): Promise<VideoJob | null> {
    const row = await this.prisma.videoJob.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id,
      created_at: Number(row.createdAt),
      updated_at: Number(row.updatedAt),
      user_id: row.userId || undefined,
      model: row.model,
      provider_name: row.providerName,
      sub_provider_id: row.subProviderId || undefined,
      status: row.status,
      seconds: row.seconds || undefined,
      size: row.size || undefined
    };
  }
}


