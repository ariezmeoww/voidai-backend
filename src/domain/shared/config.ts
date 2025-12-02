export type UserPlan =
  | 'free'
  | 'economy'
  | 'basic'
  | 'premium'
  | 'contributor'
  | 'pro'
  | 'ultra'
  | 'enterprise'
  | 'admin';

export interface PlanConfig {
  readonly credits: number;
}

export const PLAN_CONFIGS: Record<UserPlan, PlanConfig> = {
  free: { credits: 125_000 },
  economy: { credits: 650_000 },
  basic: { credits: 1_000_000 },
  premium: { credits: 4_250_000 },
  contributor: { credits: 5_000_000 },
  pro: { credits: 8_500_000 },
  ultra: { credits: 12_500_000 },
  enterprise: { credits: 80_000_000 },
  admin: { credits: 1_000_000_000_000_000 }
};