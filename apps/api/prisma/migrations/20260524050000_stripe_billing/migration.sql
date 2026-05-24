-- Add Stripe as a webhook provider for billing webhooks.
ALTER TYPE "webhook_provider" ADD VALUE IF NOT EXISTS 'stripe';

-- Make Stripe subscription synchronization idempotent and queryable.
CREATE UNIQUE INDEX "subscriptions_provider_subscription_id_key"
  ON "subscriptions"("provider_subscription_id");

CREATE INDEX "subscriptions_provider_customer_id_idx"
  ON "subscriptions"("provider_customer_id");
