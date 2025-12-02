import type { UserDiscountEntity } from '../entities';

export interface IUserDiscountRepository {
  findById(id: string): Promise<UserDiscountEntity | null>;
  findByUserId(userId: string): Promise<UserDiscountEntity[]>;
  findByUserIdAndModelId(userId: string, modelId: string): Promise<UserDiscountEntity | null>;
  findActiveByUserId(userId: string): Promise<UserDiscountEntity[]>;
  findExpired(): Promise<UserDiscountEntity[]>;
  save(discount: UserDiscountEntity): Promise<void>;
  delete(id: string): Promise<void>;
  deleteExpired(): Promise<number>;
  deleteByUserId(userId: string): Promise<number>;
}