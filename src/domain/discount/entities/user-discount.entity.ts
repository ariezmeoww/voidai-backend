export interface UserDiscountProps {
  readonly id: string;
  readonly userId: string;
  readonly modelId: string;
  readonly discountMultiplier: number;
  readonly expiresAt: number;
  readonly createdAt: number;
}

export class UserDiscountEntity {
  private constructor(private readonly props: UserDiscountProps) {}

  public static create(props: UserDiscountProps): UserDiscountEntity {
    return new UserDiscountEntity(props);
  }

  public static fromPrisma(data: any): UserDiscountEntity {
    return new UserDiscountEntity({
      id: data.id,
      userId: data.userId,
      modelId: data.modelId,
      discountMultiplier: data.discountMultiplier,
      expiresAt: Number(data.expiresAt),
      createdAt: Number(data.createdAt)
    });
  }

  public toPrisma(): any {
    return {
      id: this.props.id,
      userId: this.props.userId,
      modelId: this.props.modelId,
      discountMultiplier: this.props.discountMultiplier,
      expiresAt: BigInt(this.props.expiresAt),
      createdAt: BigInt(this.props.createdAt)
    };
  }

  public get id(): string {
    return this.props.id;
  }

  public get userId(): string {
    return this.props.userId;
  }

  public get modelId(): string {
    return this.props.modelId;
  }

  public get discountMultiplier(): number {
    return this.props.discountMultiplier;
  }

  public get expiresAt(): number {
    return this.props.expiresAt;
  }

  public get createdAt(): number {
    return this.props.createdAt;
  }

  public isExpired(): boolean {
    return Date.now() > this.props.expiresAt;
  }

  public isActive(): boolean {
    return !this.isExpired();
  }
}