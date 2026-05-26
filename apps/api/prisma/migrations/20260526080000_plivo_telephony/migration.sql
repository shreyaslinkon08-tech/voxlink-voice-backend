ALTER TYPE "webhook_provider" ADD VALUE IF NOT EXISTS 'plivo';

ALTER TABLE "phone_numbers"
  ADD COLUMN "provider_metadata" JSONB NOT NULL DEFAULT '{}';
