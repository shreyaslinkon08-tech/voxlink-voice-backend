import { z } from "zod";
import { planCodeValues } from "@voxlink/shared";

export const updateSubscriptionPlanSchema = z.object({
  planCode: z.enum(planCodeValues)
});

export const createCheckoutSessionSchema = z.object({
  planCode: z.enum(planCodeValues)
});

export type UpdateSubscriptionPlanInput = z.infer<typeof updateSubscriptionPlanSchema>;
export type CreateCheckoutSessionInput = z.infer<typeof createCheckoutSessionSchema>;
