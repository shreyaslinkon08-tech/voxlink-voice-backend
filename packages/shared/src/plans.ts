export const planCodeValues = ["starter", "growth", "scale"] as const;

export type PlanCode = (typeof planCodeValues)[number];

export const billableUsageMetricValues = [
  "calls",
  "call_minutes",
  "transcript_chunks",
  "knowledge_items",
  "llm_tokens"
] as const;

export type BillableUsageMetric = (typeof billableUsageMetricValues)[number];

export const resourceLimitMetricValues = ["ai_agents", "phone_numbers"] as const;

export type ResourceLimitMetric = (typeof resourceLimitMetricValues)[number];

export interface SubscriptionPlan {
  readonly code: PlanCode;
  readonly name: string;
  readonly description: string;
  readonly monthlyPriceCents: number | null;
  readonly usageLimits: Readonly<Record<BillableUsageMetric, number | null>>;
  readonly resourceLimits: Readonly<Record<ResourceLimitMetric, number | null>>;
}

export interface UsageLimitStatus {
  readonly metric: BillableUsageMetric;
  readonly amount: number;
  readonly limit: number | null;
  readonly remaining: number | null;
  readonly percentUsed: number | null;
  readonly isLimited: boolean;
  readonly isNearLimit: boolean;
  readonly isExceeded: boolean;
}

export const subscriptionPlans = {
  starter: {
    code: "starter",
    name: "Starter",
    description: "Pilot-ready limits for validating one company assistant.",
    monthlyPriceCents: 9_900,
    usageLimits: {
      calls: 250,
      call_minutes: 1_000,
      transcript_chunks: 10_000,
      knowledge_items: 500,
      llm_tokens: 500_000
    },
    resourceLimits: {
      ai_agents: 2,
      phone_numbers: 2
    }
  },
  growth: {
    code: "growth",
    name: "Growth",
    description: "Higher limits for live customer traffic and larger knowledge bases.",
    monthlyPriceCents: 29_900,
    usageLimits: {
      calls: 2_000,
      call_minutes: 10_000,
      transcript_chunks: 100_000,
      knowledge_items: 5_000,
      llm_tokens: 5_000_000
    },
    resourceLimits: {
      ai_agents: 10,
      phone_numbers: 10
    }
  },
  scale: {
    code: "scale",
    name: "Scale",
    description: "Sales-led plan for high-volume phone automation.",
    monthlyPriceCents: null,
    usageLimits: {
      calls: null,
      call_minutes: null,
      transcript_chunks: null,
      knowledge_items: null,
      llm_tokens: null
    },
    resourceLimits: {
      ai_agents: null,
      phone_numbers: null
    }
  }
} as const satisfies Readonly<Record<PlanCode, SubscriptionPlan>>;

export function isPlanCode(value: string): value is PlanCode {
  return planCodeValues.includes(value as PlanCode);
}

export function resolveSubscriptionPlan(planCode: string | null | undefined): SubscriptionPlan {
  if (planCode && isPlanCode(planCode)) {
    return subscriptionPlans[planCode];
  }

  return subscriptionPlans.starter;
}

export function calculateUsageLimitStatus(
  metric: BillableUsageMetric,
  amount: number,
  limit: number | null
): UsageLimitStatus {
  if (limit === null) {
    return {
      metric,
      amount,
      limit,
      remaining: null,
      percentUsed: null,
      isLimited: false,
      isNearLimit: false,
      isExceeded: false
    };
  }

  const percentUsed = limit === 0 ? 100 : Math.min(100, Math.round((amount / limit) * 100));

  return {
    metric,
    amount,
    limit,
    remaining: Math.max(0, limit - amount),
    percentUsed,
    isLimited: true,
    isNearLimit: percentUsed >= 80,
    isExceeded: amount > limit
  };
}
