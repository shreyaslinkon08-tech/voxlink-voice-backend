-- CreateTable
CREATE TABLE "call_recordings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "call_id" UUID NOT NULL,
    "provider" "webhook_provider" NOT NULL DEFAULT 'twilio',
    "provider_recording_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "recording_url" TEXT,
    "duration_seconds" INTEGER,
    "channels" INTEGER,
    "source" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_recordings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "call_recordings_provider_provider_recording_id_key" ON "call_recordings"("provider", "provider_recording_id");

-- CreateIndex
CREATE INDEX "call_recordings_company_id_created_at_idx" ON "call_recordings"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "call_recordings_call_id_created_at_idx" ON "call_recordings"("call_id", "created_at");

-- AddForeignKey
ALTER TABLE "call_recordings" ADD CONSTRAINT "call_recordings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_recordings" ADD CONSTRAINT "call_recordings_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

