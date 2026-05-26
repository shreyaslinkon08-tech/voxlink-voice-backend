import { createHash } from "node:crypto";
import { CallStatus, UsageMetric, WebhookProvider, type Prisma } from "@prisma/client";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PlivoTelephonyProvider } from "@voxlink/telephony";
import { AppError } from "../../errors/app-error.js";
import { assertCallStatusUpdate } from "../calls/call-state.js";
import {
  assertAndIncrementUsage,
  assertUsageWithinLimit,
  incrementUsage
} from "../billing/usage-limits.js";

export interface PlivoWebhookProcessingResult {
  readonly callId?: string;
  readonly companyId?: string;
  readonly duplicate: boolean;
  readonly callStatus?: CallStatus;
}

export function verifyPlivoRequest(
  app: FastifyInstance,
  request: FastifyRequest,
  rawBody: string
): void {
  const signature = firstHeader(request.headers["x-plivo-signature-v3"]);
  const nonce = firstHeader(request.headers["x-plivo-signature-v3-nonce"]);

  if (!signature || !nonce) {
    throw AppError.unauthorized("Missing Plivo webhook signature");
  }

  const provider = app.providers.get<PlivoTelephonyProvider>("telephony", "plivo");

  if (!provider) {
    throw AppError.badRequest("Plivo provider is not configured");
  }

  const rawUrl = new URL(request.url, app.config.PLIVO_WEBHOOK_BASE_URL).toString();

  if (!provider.verifyWebhookSignatureV3(rawUrl, rawBody, signature, nonce, "POST")) {
    throw AppError.unauthorized("Invalid Plivo webhook signature");
  }
}

export async function processPlivoVoiceWebhook(
  app: FastifyInstance,
  request: FastifyRequest,
  rawBody: string
): Promise<PlivoWebhookProcessingResult> {
  const body = parseFormBody(rawBody);
  const providerCallId = requirePlivoParam(body, "CallUUID");
  const toNumber = normalizeE164(requirePlivoParam(body, "To"));
  const fromNumber = normalizeE164(requirePlivoParam(body, "From"));
  const status = mapPlivoCallStatus(body.CallStatus);
  const providerEventId = providerEventIdForRequest(request, body, "voice", rawBody);
  const payloadHash = hashPayload(rawBody);

  const phoneNumber = await app.prisma.phoneNumber.findFirst({
    where: {
      e164: toNumber,
      provider: WebhookProvider.plivo,
      status: "active"
    },
    select: {
      id: true,
      companyId: true,
      aiAgentId: true,
      company: {
        select: {
          status: true
        }
      }
    }
  });

  if (!phoneNumber) {
    await recordWebhookEvent(app, {
      providerEventId,
      providerCallId,
      payloadHash,
      rawPayload: body,
      processingStatus: "failed",
      errorMessage: `No active phone number mapping for ${toNumber}`
    });
    throw AppError.notFound("No active phone number mapping for this Plivo number");
  }

  if (phoneNumber.company.status !== "active") {
    await recordWebhookEvent(app, {
      providerEventId,
      providerCallId,
      payloadHash,
      rawPayload: body,
      processingStatus: "failed",
      errorMessage: `Company ${phoneNumber.companyId} is ${phoneNumber.company.status}`
    });
    throw AppError.forbidden("Company is not active");
  }

  const duplicate = await isDuplicateWebhook(
    app,
    providerEventId,
    providerCallId,
    payloadHash,
    body
  );
  const call = await app.prisma
    .$transaction(async (tx) => {
      const existing = await tx.call.findUnique({
        where: {
          provider_providerCallId: {
            provider: WebhookProvider.plivo,
            providerCallId
          }
        },
        select: {
          id: true,
          status: true
        }
      });

      if (existing) {
        assertCallStatusUpdate(existing.status, status);
      } else {
        await assertUsageWithinLimit(tx, phoneNumber.companyId, UsageMetric.call_minutes, 1);
        await assertAndIncrementUsage(tx, phoneNumber.companyId, UsageMetric.calls, 1);
      }

      const upserted = await tx.call.upsert({
        where: {
          provider_providerCallId: {
            provider: WebhookProvider.plivo,
            providerCallId
          }
        },
        create: {
          companyId: phoneNumber.companyId,
          phoneNumberId: phoneNumber.id,
          aiAgentId: phoneNumber.aiAgentId,
          provider: WebhookProvider.plivo,
          providerCallId,
          fromNumber,
          toNumber,
          status,
          startedAt: new Date(),
          metadata: plivoMetadata(body)
        },
        update: {
          status,
          endedAt: ["ended", "failed"].includes(status) ? new Date() : undefined,
          metadata: plivoMetadata(body)
        },
        select: {
          id: true,
          status: true
        }
      });

      await tx.webhookEvent.update({
        where: {
          provider_providerEventId: {
            provider: WebhookProvider.plivo,
            providerEventId
          }
        },
        data: {
          processingStatus: "processed",
          processedAt: new Date(),
          companyId: phoneNumber.companyId,
          callId: upserted.id
        }
      });

      return upserted;
    })
    .catch(async (error: unknown) => {
      if (error instanceof AppError && error.code === "PAYMENT_REQUIRED") {
        await app.prisma.webhookEvent.update({
          where: {
            provider_providerEventId: {
              provider: WebhookProvider.plivo,
              providerEventId
            }
          },
          data: {
            processingStatus: "failed",
            processedAt: new Date(),
            companyId: phoneNumber.companyId,
            errorMessage: error.message
          }
        });
      }

      throw error;
    });

  return {
    callId: call.id,
    companyId: phoneNumber.companyId,
    duplicate,
    callStatus: call.status
  };
}

export async function processPlivoStatusWebhook(
  app: FastifyInstance,
  request: FastifyRequest,
  rawBody: string
): Promise<PlivoWebhookProcessingResult> {
  const body = parseFormBody(rawBody);
  const providerCallId = requirePlivoParam(body, "CallUUID");
  const status = mapPlivoCallStatus(body.CallStatus ?? body.Event);
  const providerEventId = providerEventIdForRequest(request, body, "status", rawBody);
  const payloadHash = hashPayload(rawBody);
  const duplicate = await isDuplicateWebhook(
    app,
    providerEventId,
    providerCallId,
    payloadHash,
    body
  );

  const call = await app.prisma.call.findUnique({
    where: {
      provider_providerCallId: {
        provider: WebhookProvider.plivo,
        providerCallId
      }
    },
    select: {
      id: true,
      companyId: true,
      status: true,
      startedAt: true,
      endedAt: true
    }
  });

  if (!call) {
    await app.prisma.webhookEvent.update({
      where: {
        provider_providerEventId: {
          provider: WebhookProvider.plivo,
          providerEventId
        }
      },
      data: {
        processingStatus: "failed",
        errorMessage: "Status callback arrived before call creation"
      }
    });
    throw AppError.notFound("Call not found for Plivo status callback");
  }

  assertCallStatusUpdate(call.status, status);

  const updated = await app.prisma.$transaction(async (tx) => {
    const nextCall = await tx.call.update({
      where: { id: call.id },
      data: {
        status,
        endedAt: ["ended", "failed"].includes(status) ? new Date() : undefined,
        failureReason:
          status === "failed"
            ? (body.HangupCause ?? body.DisconnectedBy ?? "Plivo status callback failed")
            : undefined,
        metadata: plivoMetadata(body)
      },
      select: {
        id: true,
        companyId: true,
        status: true
      }
    });

    if (!duplicate && status === CallStatus.ended && !call.endedAt) {
      const minutes = billableCallMinutes(body, call.startedAt);

      if (minutes > 0) {
        await incrementUsage(tx, call.companyId, UsageMetric.call_minutes, minutes);
      }
    }

    await tx.webhookEvent.update({
      where: {
        provider_providerEventId: {
          provider: WebhookProvider.plivo,
          providerEventId
        }
      },
      data: {
        processingStatus: "processed",
        processedAt: new Date(),
        companyId: nextCall.companyId,
        callId: nextCall.id
      }
    });

    return nextCall;
  });

  return {
    callId: updated.id,
    companyId: updated.companyId,
    duplicate,
    callStatus: updated.status
  };
}

function billableCallMinutes(
  body: Readonly<Record<string, string>>,
  startedAt: Date | null
): number {
  const durationSeconds = Number(body.BillDuration ?? body.Duration);

  if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
    return Math.max(1, Math.ceil(durationSeconds / 60));
  }

  if (!startedAt) {
    return 0;
  }

  const elapsedSeconds = Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 1_000));
  return elapsedSeconds > 0 ? Math.max(1, Math.ceil(elapsedSeconds / 60)) : 0;
}

async function isDuplicateWebhook(
  app: FastifyInstance,
  providerEventId: string,
  providerCallId: string,
  payloadHash: string,
  rawPayload: Readonly<Record<string, string>>
): Promise<boolean> {
  try {
    await recordWebhookEvent(app, {
      providerEventId,
      providerCallId,
      payloadHash,
      rawPayload,
      processingStatus: "received"
    });
    return false;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return true;
    }

    throw error;
  }
}

async function recordWebhookEvent(
  app: FastifyInstance,
  data: {
    readonly providerEventId: string;
    readonly providerCallId?: string;
    readonly payloadHash: string;
    readonly rawPayload: Readonly<Record<string, string>>;
    readonly processingStatus: "received" | "processed" | "duplicate" | "failed";
    readonly errorMessage?: string;
  }
): Promise<void> {
  await app.prisma.webhookEvent.create({
    data: {
      provider: WebhookProvider.plivo,
      providerEventId: data.providerEventId,
      providerCallId: data.providerCallId,
      payloadHash: data.payloadHash,
      rawPayload: data.rawPayload,
      processingStatus: data.processingStatus,
      errorMessage: data.errorMessage
    }
  });
}

function providerEventIdForRequest(
  request: FastifyRequest,
  body: Readonly<Record<string, string>>,
  eventType: string,
  rawBody: string
): string {
  const idempotencyHeader = request.headers["x-plivo-request-uuid"];
  const idempotencyToken = firstHeader(idempotencyHeader);

  if (idempotencyToken) {
    return idempotencyToken;
  }

  return `${body.CallUUID ?? "unknown"}:${eventType}:${
    body.CallStatus ?? body.Event ?? "unknown"
  }:${hashPayload(rawBody)}`;
}

function mapPlivoCallStatus(status: string | undefined): CallStatus {
  switch (status?.toLowerCase()) {
    case "ringing":
    case "queued":
      return CallStatus.ringing;
    case "in-progress":
    case "inprogress":
    case "answered":
      return CallStatus.connected;
    case "completed":
    case "completedxml":
    case "hangup":
      return CallStatus.ended;
    case "busy":
    case "failed":
    case "cancel":
    case "canceled":
    case "no-answer":
    case "timeout":
      return CallStatus.failed;
    default:
      return CallStatus.initiated;
  }
}

function plivoMetadata(body: Readonly<Record<string, string>>): Prisma.InputJsonObject {
  return {
    accountId: body.AccountID,
    callStatus: body.CallStatus,
    direction: body.Direction,
    event: body.Event,
    hangupCause: body.HangupCause,
    disconnectedBy: body.DisconnectedBy,
    billDuration: body.BillDuration,
    duration: body.Duration,
    apiId: body.ApiID
  };
}

function parseFormBody(rawBody: string): Record<string, string> {
  const params = new URLSearchParams(rawBody);
  const parsed: Record<string, string> = {};

  for (const [key, value] of params.entries()) {
    parsed[key] = value;
  }

  return parsed;
}

function requirePlivoParam(body: Readonly<Record<string, string>>, name: string): string {
  const value = body[name];

  if (!value) {
    throw AppError.badRequest(`Plivo webhook is missing ${name}`);
  }

  return value;
}

function normalizeE164(value: string): string {
  const digits = value.replace(/[^\d]/g, "");
  return `+${digits}`;
}

function hashPayload(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "P2002"
  );
}
