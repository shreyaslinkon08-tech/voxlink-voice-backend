import { SubscriptionStatus, UsageMetric } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { assertUsageWithinLimit } from "./usage-limits.js";

describe("usage limit enforcement", () => {
  it("rejects usage that exceeds the current plan limit", async () => {
    const prisma = fakeUsageClient({
      planCode: "starter",
      metric: UsageMetric.calls,
      amount: 250
    });

    await expect(assertUsageWithinLimit(prisma, "company-1", UsageMetric.calls, 1)).rejects.toMatchObject({
      code: "PAYMENT_REQUIRED",
      statusCode: 402
    });
  });

  it("allows usage on unlimited plans", async () => {
    const prisma = fakeUsageClient({
      planCode: "scale",
      metric: UsageMetric.calls,
      amount: 1_000_000
    });

    await expect(assertUsageWithinLimit(prisma, "company-1", UsageMetric.calls, 1)).resolves.toBeUndefined();
  });
});

function fakeUsageClient(input: {
  readonly planCode: string;
  readonly metric: UsageMetric;
  readonly amount: number;
}): Parameters<typeof assertUsageWithinLimit>[0] {
  return {
    subscription: {
      findFirst: vi.fn().mockResolvedValue({
        id: "subscription-1",
        status: SubscriptionStatus.active,
        planCode: input.planCode,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        updatedAt: new Date("2026-05-01T00:00:00.000Z")
      })
    },
    usageTracking: {
      findMany: vi.fn().mockResolvedValue([
        {
          metric: input.metric,
          amount: {
            toNumber: () => input.amount
          }
        }
      ])
    }
  } as unknown as Parameters<typeof assertUsageWithinLimit>[0];
}
