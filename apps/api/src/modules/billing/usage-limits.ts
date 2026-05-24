import { SubscriptionStatus, UsageMetric, type Prisma, type PrismaClient } from "@prisma/client";
import {
  billableUsageMetricValues,
  calculateUsageLimitStatus,
  resolveSubscriptionPlan,
  type BillableUsageMetric,
  type ResourceLimitMetric,
  type SubscriptionPlan,
  type UsageLimitStatus
} from "@altrion/shared";
import { AppError } from "../../errors/app-error.js";
import { currentMonthlyPeriod } from "../../utils/period.js";

export const activeSubscriptionStatuses = [
  SubscriptionStatus.trialing,
  SubscriptionStatus.active,
  SubscriptionStatus.past_due
] as const;

export interface BillingSubscriptionSummary {
  readonly id: string;
  readonly status: SubscriptionStatus;
  readonly planCode: string;
  readonly providerCustomerId: string | null;
  readonly providerSubscriptionId: string | null;
  readonly currentPeriodStart: Date | null;
  readonly currentPeriodEnd: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface BillingUsageStatus extends UsageLimitStatus {
  readonly periodStart: Date;
  readonly periodEnd: Date;
}

export interface BillingSummary {
  readonly subscription: BillingSubscriptionSummary | null;
  readonly plan: SubscriptionPlan;
  readonly usage: readonly BillingUsageStatus[];
}

type UsageLimitPrismaClient = {
  readonly subscription: PrismaClient["subscription"];
  readonly usageTracking: PrismaClient["usageTracking"];
};

type ResourceLimitPrismaClient = UsageLimitPrismaClient & {
  readonly aiAgent: PrismaClient["aiAgent"];
  readonly phoneNumber: PrismaClient["phoneNumber"];
};

const usageMetricByName: Readonly<Record<BillableUsageMetric, UsageMetric>> = {
  calls: UsageMetric.calls,
  call_minutes: UsageMetric.call_minutes,
  transcript_chunks: UsageMetric.transcript_chunks,
  knowledge_items: UsageMetric.knowledge_items,
  llm_tokens: UsageMetric.llm_tokens
};

const subscriptionSummarySelect = {
  id: true,
  status: true,
  planCode: true,
  providerCustomerId: true,
  providerSubscriptionId: true,
  currentPeriodStart: true,
  currentPeriodEnd: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.SubscriptionSelect;

export async function getBillingSummary(
  prisma: UsageLimitPrismaClient,
  companyId: string,
  now = new Date()
): Promise<BillingSummary> {
  const { periodStart, periodEnd } = currentMonthlyPeriod(now);
  const [subscription, usageRows] = await Promise.all([
    findCurrentSubscription(prisma, companyId),
    prisma.usageTracking.findMany({
      where: {
        companyId,
        metric: { in: Object.values(usageMetricByName) },
        periodStart,
        periodEnd
      },
      select: {
        metric: true,
        amount: true
      }
    })
  ]);
  const plan = resolveSubscriptionPlan(subscription?.planCode);
  const usageByMetric = new Map<BillableUsageMetric, number>();

  for (const row of usageRows) {
    usageByMetric.set(toBillableUsageMetric(row.metric), decimalToNumber(row.amount));
  }

  return {
    subscription,
    plan,
    usage: billableUsageMetricValues.map((metric) => ({
      ...calculateUsageLimitStatus(
        metric,
        usageByMetric.get(metric) ?? 0,
        plan.usageLimits[metric]
      ),
      periodStart,
      periodEnd
    }))
  };
}

export async function assertUsageWithinLimit(
  prisma: UsageLimitPrismaClient,
  companyId: string,
  metric: UsageMetric,
  incrementAmount: number,
  now = new Date()
): Promise<void> {
  const billableMetric = toBillableUsageMetric(metric);
  const summary = await getBillingSummary(prisma, companyId, now);
  const usage = summary.usage.find((row) => row.metric === billableMetric);
  const amount = usage?.amount ?? 0;
  const limit = summary.plan.usageLimits[billableMetric];

  if (limit !== null && amount + incrementAmount > limit) {
    throw AppError.paymentRequired(
      `Monthly ${formatMetricLabel(billableMetric)} limit exceeded for the ${summary.plan.name} plan`
    );
  }
}

export async function assertResourceWithinLimit(
  prisma: ResourceLimitPrismaClient,
  companyId: string,
  metric: ResourceLimitMetric,
  incrementAmount: number
): Promise<void> {
  const summary = await getBillingSummary(prisma, companyId);
  const limit = summary.plan.resourceLimits[metric];

  if (limit === null) {
    return;
  }

  const amount = await currentResourceAmount(prisma, companyId, metric);

  if (amount + incrementAmount > limit) {
    throw AppError.paymentRequired(
      `${formatResourceLabel(metric)} limit exceeded for the ${summary.plan.name} plan`
    );
  }
}

export async function incrementUsage(
  prisma: UsageLimitPrismaClient,
  companyId: string,
  metric: UsageMetric,
  amount: number,
  now = new Date()
): Promise<void> {
  const { periodStart, periodEnd } = currentMonthlyPeriod(now);

  await prisma.usageTracking.upsert({
    where: {
      companyId_metric_periodStart_periodEnd: {
        companyId,
        metric,
        periodStart,
        periodEnd
      }
    },
    create: {
      companyId,
      metric,
      amount,
      periodStart,
      periodEnd
    },
    update: {
      amount: {
        increment: amount
      }
    }
  });
}

export async function assertAndIncrementUsage(
  prisma: UsageLimitPrismaClient,
  companyId: string,
  metric: UsageMetric,
  amount: number,
  now = new Date()
): Promise<void> {
  await assertUsageWithinLimit(prisma, companyId, metric, amount, now);
  await incrementUsage(prisma, companyId, metric, amount, now);
}

export async function findCurrentSubscription(
  prisma: Pick<UsageLimitPrismaClient, "subscription">,
  companyId: string
): Promise<BillingSubscriptionSummary | null> {
  return prisma.subscription.findFirst({
    where: {
      companyId,
      status: { in: [...activeSubscriptionStatuses] }
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: subscriptionSummarySelect
  });
}

function toBillableUsageMetric(metric: UsageMetric): BillableUsageMetric {
  switch (metric) {
    case UsageMetric.calls:
      return "calls";
    case UsageMetric.call_minutes:
      return "call_minutes";
    case UsageMetric.transcript_chunks:
      return "transcript_chunks";
    case UsageMetric.knowledge_items:
      return "knowledge_items";
    case UsageMetric.llm_tokens:
      return "llm_tokens";
  }
}

function decimalToNumber(value: Prisma.Decimal | number | string): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return Number(value);
  }

  return value.toNumber();
}

function formatMetricLabel(metric: BillableUsageMetric): string {
  return metric.replaceAll("_", " ");
}

async function currentResourceAmount(
  prisma: Pick<ResourceLimitPrismaClient, "aiAgent" | "phoneNumber">,
  companyId: string,
  metric: ResourceLimitMetric
): Promise<number> {
  switch (metric) {
    case "ai_agents":
      return prisma.aiAgent.count({ where: { companyId } });
    case "phone_numbers":
      return prisma.phoneNumber.count({ where: { companyId } });
  }
}

function formatResourceLabel(metric: ResourceLimitMetric): string {
  return metric.replaceAll("_", " ");
}
