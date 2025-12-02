import type { PrismaClient } from '@prisma/client';
import type { IUserDiscountRepository } from '../../domain/discount/repositories';
import { UserDiscountEntity } from '../../domain/discount/entities';

export class UserDiscountRepository implements IUserDiscountRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<UserDiscountEntity | null> {
    const discount = await this.prisma.userDiscount.findUnique({
      where: { id }
    });

    return discount ? UserDiscountEntity.fromPrisma(discount) : null;
  }

  async findByUserId(userId: string): Promise<UserDiscountEntity[]> {
    const discounts = await this.prisma.userDiscount.findMany({
      where: { userId }
    });

    return discounts.map((d: any) => UserDiscountEntity.fromPrisma(d));
  }

  async findByUserIdAndModelId(userId: string, modelId: string): Promise<UserDiscountEntity | null> {
    const discount = await this.prisma.userDiscount.findUnique({
      where: {
        userId_modelId: {
          userId,
          modelId
        }
      }
    });

    return discount ? UserDiscountEntity.fromPrisma(discount) : null;
  }

  async findActiveByUserId(userId: string): Promise<UserDiscountEntity[]> {
    const now = BigInt(Date.now());
    const discounts = await this.prisma.userDiscount.findMany({
      where: {
        userId,
        expiresAt: {
          gt: now
        }
      }
    });

    return discounts.map((d: any) => UserDiscountEntity.fromPrisma(d));
  }

  async findExpired(): Promise<UserDiscountEntity[]> {
    const now = BigInt(Date.now());
    const discounts = await this.prisma.userDiscount.findMany({
      where: {
        expiresAt: {
          lte: now
        }
      }
    });

    return discounts.map((d: any) => UserDiscountEntity.fromPrisma(d));
  }

  async save(discount: UserDiscountEntity): Promise<void> {
    await this.prisma.userDiscount.upsert({
      where: { id: discount.id },
      update: discount.toPrisma(),
      create: discount.toPrisma()
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.userDiscount.delete({
      where: { id }
    });
  }

  async deleteExpired(): Promise<number> {
    const now = BigInt(Date.now());
    const result = await this.prisma.userDiscount.deleteMany({
      where: {
        expiresAt: {
          lte: now
        }
      }
    });

    return result.count;
  }

  async deleteByUserId(userId: string): Promise<number> {
    const result = await this.prisma.userDiscount.deleteMany({
      where: { userId }
    });

    return result.count;
  }
}