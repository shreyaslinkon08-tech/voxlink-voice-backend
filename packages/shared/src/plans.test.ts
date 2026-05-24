import { describe, expect, it } from "vitest";
import {
  calculateUsageLimitStatus,
  resolveSubscriptionPlan,
  subscriptionPlans
} from "./plans.js";

describe("subscription plans", () => {
  it("falls back to starter when a stored plan code is unknown", () => {
    expect(resolveSubscriptionPlan("legacy-plan")).toBe(subscriptionPlans.starter);
    expect(resolveSubscriptionPlan(null)).toBe(subscriptionPlans.starter);
  });

  it("calculates limited usage status", () => {
    expect(calculateUsageLimitStatus("calls", 80, 100)).toEqual({
      metric: "calls",
      amount: 80,
      limit: 100,
      remaining: 20,
      percentUsed: 80,
      isLimited: true,
      isNearLimit: true,
      isExceeded: false
    });
  });

  it("keeps unlimited usage separate from exhausted limits", () => {
    expect(calculateUsageLimitStatus("llm_tokens", 500_000, null)).toEqual({
      metric: "llm_tokens",
      amount: 500_000,
      limit: null,
      remaining: null,
      percentUsed: null,
      isLimited: false,
      isNearLimit: false,
      isExceeded: false
    });
  });
});
