export interface UserDocument {
  id: string;
  name: string;
  plan: string;
  enabled: boolean;
  credits: number;
  credits_last_reset: number;
  created_at: number;
  updated_at: number;
  ip_whitelist: string[];
  max_concurrent_requests?: number;
  plan_expires_at: number;
  total_requests: bigint;
  total_tokens_used: bigint;
  total_credits_used: bigint;
  last_request_at: number;
  rp_verified?: boolean;
  rp_verification_date?: number;
  rp_bonus_tokens_expires?: number;
  rp_discount_used?: boolean;
}

export class User {
  constructor(private options: UserDocument) {}

  get id(): string {
    return this.options.id;
  }

  get name(): string {
    return this.options.name;
  }

  get plan(): string {
    return this.options.plan;
  }

  get credits(): number {
    return this.options.credits;
  }

  get creditsLastReset(): number {
    return this.options.credits_last_reset;
  }

  get enabled(): boolean {
    return this.options.enabled;
  }

  get isEnabled(): boolean {
    return this.options.enabled;
  }

  get createdAt(): number {
    return this.options.created_at;
  }

  get updated_at(): number {
    return this.options.updated_at;
  }

  get isPlanExpired(): boolean {
    if (!this.options.plan_expires_at) return false;
    return Date.now() > this.options.plan_expires_at;
  }

  get maxConcurrentRequests(): number {
    return this.options.max_concurrent_requests || 10;
  }

  get ip_whitelist(): string[] {
    return [...(this.options.ip_whitelist || [])];
  }

  get totalRequests(): bigint {
    return this.options.total_requests || 0n;
  }

  get totalTokensUsed(): bigint {
    return this.options.total_tokens_used || 0n;
  }

  get totalCreditsUsed(): bigint {
    return this.options.total_credits_used || 0n;
  }

  get lastRequestAt(): number | undefined {
    return this.options.last_request_at;
  }

  get isRPVerified(): boolean {
    return this.options.rp_verified || false;
  }

  get rpVerificationDate(): number | undefined {
    return this.options.rp_verification_date;
  }

  get rpBonusTokensExpires(): number | undefined {
    return this.options.rp_bonus_tokens_expires;
  }

  get isRPBonusActive(): boolean {
    if (!this.options.rp_bonus_tokens_expires) return false;
    return Date.now() < this.options.rp_bonus_tokens_expires * 1000;
  }

  get rpDiscountUsed(): boolean {
    return this.options.rp_discount_used || false;
  }

  authorizeCredits(amount: number): boolean {
    return this.options.enabled && this.hasEnoughCredits(amount);
  }

  authorizeIpAccess(ipAddress: string): boolean {
    return this.isip_whitelistEmpty() || this.isIpInWhitelist(ipAddress);
  }

  debitCredits(amount: number, tokensUsed: number): void {
    if (!this.authorizeCredits(amount)) {
      throw new Error('Authorization failed: insufficient credits');
    }
    
    this.updateCreditsAndUsage(amount, tokensUsed);
    this.options.updated_at = Date.now();
  }

  shouldResetCredits(): boolean {
    const resetInterval = 24 * 60 * 60 * 1000;
    const timeSinceLastReset = Date.now() - this.options.credits_last_reset;
    return timeSinceLastReset >= resetInterval;
  }

  resetCredits(newCredits: number): void {
    this.options.credits = newCredits;
    this.options.credits_last_reset = Date.now();
    this.options.updated_at = Date.now();
  }

  updateName(newName: string): void {
    this.options.name = newName;
    this.options.updated_at = Date.now();
  }

  updatePlan(newPlan: string, expiresAt: number): void {
    this.options.plan = newPlan;
    this.options.plan_expires_at = expiresAt;
    this.options.updated_at = Date.now();
  }

  enable(): void {
    this.options.enabled = true;
    this.options.updated_at = Date.now();
  }

  disable(): void {
    this.options.enabled = false;
    this.options.updated_at = Date.now();
  }

  addIpToWhitelist(ipAddress: string): void {
    if (!this.options.ip_whitelist.includes(ipAddress)) {
      this.options.ip_whitelist.push(ipAddress);
      this.options.updated_at = Date.now();
    }
  }

  removeIpFromWhitelist(ipAddress: string): void {
    this.options.ip_whitelist = this.options.ip_whitelist.filter(ip => ip !== ipAddress);
    this.options.updated_at = Date.now();
  }

  getUsageStats() {
    return {
      totalRequests: this.options.total_requests,
      totalTokensUsed: this.options.total_tokens_used,
      totalCreditsUsed: this.options.total_credits_used,
      lastRequestAt: this.options.last_request_at
    };
  }

  toDocument(): UserDocument {
    return {
      id: this.options.id,
      name: this.options.name,
      plan: this.options.plan,
      enabled: this.options.enabled,
      credits: this.options.credits,
      credits_last_reset: this.options.credits_last_reset,
      created_at: this.options.created_at,
      updated_at: this.options.updated_at,
      ip_whitelist: this.options.ip_whitelist,
      max_concurrent_requests: this.options.max_concurrent_requests,
      plan_expires_at: this.options.plan_expires_at,
      total_requests: this.options.total_requests,
      total_tokens_used: this.options.total_tokens_used,
      total_credits_used: this.options.total_credits_used,
      last_request_at: this.options.last_request_at,
      rp_verified: this.options.rp_verified,
      rp_verification_date: this.options.rp_verification_date,
      rp_bonus_tokens_expires: this.options.rp_bonus_tokens_expires,
      rp_discount_used: this.options.rp_discount_used
    };
  }

  private hasEnoughCredits(amount: number): boolean {
    return this.options.credits >= amount;
  }

  private isip_whitelistEmpty(): boolean {
    return this.options.ip_whitelist.length === 0;
  }

  private isIpInWhitelist(ipAddress: string): boolean {
    return this.options.ip_whitelist.includes(ipAddress);
  }

  private updateCreditsAndUsage(amount: number, tokensUsed: number): void {
    this.options.credits -= amount;
    this.options.total_requests++;
    this.options.total_tokens_used += BigInt(tokensUsed);
    this.options.total_credits_used += BigInt(amount);
    this.options.last_request_at = Date.now();
  }
}