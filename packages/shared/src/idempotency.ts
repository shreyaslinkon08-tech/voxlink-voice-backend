import { z } from "zod";

export const webhookProviderValues = ["twilio"] as const;
export const webhookProviderSchema = z.enum(webhookProviderValues);
export type WebhookProvider = z.infer<typeof webhookProviderSchema>;

export const webhookProcessingStatusValues = [
  "received",
  "processed",
  "duplicate",
  "failed"
] as const;
export const webhookProcessingStatusSchema = z.enum(webhookProcessingStatusValues);
export type WebhookProcessingStatus = z.infer<typeof webhookProcessingStatusSchema>;

export const webhookEventIdentitySchema = z.object({
  provider: webhookProviderSchema,
  providerEventId: z.string().min(1),
  payloadHash: z.string().min(32)
});

export type WebhookEventIdentity = z.infer<typeof webhookEventIdentitySchema>;
