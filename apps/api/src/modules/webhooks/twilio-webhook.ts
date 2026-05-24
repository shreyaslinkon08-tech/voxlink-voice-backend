import { CallStatus, UsageMetric, type Prisma } from "@prisma/client";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { parseFormBody, type TwilioTelephonyProvider } from "@voxlink/telephony";
import { AppError } from "../../errors/app-error.js";
import { assertCallStatusUpdate } from "../calls/call-state.js";
import {
  assertAndIncrementUsage,
  assertUsageWithinLimit,
  incrementUsage
} from "../billing/usage-limits.js";
import { createTwilioProviderEventId, hashTwilioPayload } from "./twilio-idempotency.js";
import { extractTwilioRecording } from "./twilio-recording.js";

export interface TwilioWebhookProcessingResult {
  readonly callId?: string;
  readonly companyId?: string;
  readonly duplicate: boolean;
  readonly callStatus?: CallStatus;
}

export async function verifyTwilioRequest(
  app: FastifyInstance,
  request: FastifyRequest,
  rawBody: string
): Promise<void> {
  const signatureHeader = request.headers["x-twilio-signature"];
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

  if (!signature) {
    throw AppError.unauthorized("Missing Twilio webhook signature");
  }

  const provider = app.providers.get<TwilioTelephonyProvider>("telephony", "twilio");

  if (!provider) {
    throw AppError.badRequest("Twilio provider is not configured");
  }

  const rawUrl = new URL(request.url, app.config.TWILIO_WEBHOOK_BASE_URL).toString();
  const verified = await provider.verifyWebhookSignature(rawUrl, rawBody, signature);

  if (!verified) {
    throw AppError.unauthorized("Invalid Twilio webhook signature");
  }
}

export async function processTwilioVoiceWebhook(
  app: FastifyInstance,
  request: FastifyRequest,
  rawBody: string
): Promise<TwilioWebhookProcessingResult> {
  const body = parseFormBody(rawBody);
  const providerCallId = requireTwilioParam(body, "CallSid");
  const toNumber = requireTwilioParam(body, "To");
  const fromNumber = requireTwilioParam(body, "From");
  const status = mapTwilioCallStatus(body.CallStatus);
  const providerEventId = providerEventIdForRequest(request, body, "voice", rawBody);
  const payloadHash = hashTwilioPayload(rawBody);

  const phoneNumber = await app.prisma.phoneNumber.findFirst({
    where: {
      e164: toNumber,
      provider: "twilio",
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
    throw AppError.notFound("No active phone number mapping for this Twilio number");
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
            provider: "twilio",
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
            provider: "twilio",
            providerCallId
          }
        },
        create: {
          companyId: phoneNumber.companyId,
          phoneNumberId: phoneNumber.id,
          aiAgentId: phoneNumber.aiAgentId,
          provider: "twilio",
          providerCallId,
          fromNumber,
          toNumber,
          status,
          startedAt: new Date(),
          metadata: twilioMetadata(body)
        },
        update: {
          status,
          endedAt: ["ended", "failed"].includes(status) ? new Date() : undefined,
          metadata: twilioMetadata(body)
        },
        select: {
          id: true,
          status: true
        }
      });

      await tx.webhookEvent.update({
        where: {
          provider_providerEventId: {
            provider: "twilio",
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
              provider: "twilio",
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

export async function processTwilioStatusWebhook(
  app: FastifyInstance,
  request: FastifyRequest,
  rawBody: string
): Promise<TwilioWebhookProcessingResult> {
  const body = parseFormBody(rawBody);
  const providerCallId = requireTwilioParam(body, "CallSid");
  const status = body.CallStatus ? mapTwilioCallStatus(body.CallStatus) : undefined;
  const providerEventId = providerEventIdForRequest(request, body, "status", rawBody);
  const payloadHash = hashTwilioPayload(rawBody);
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
        provider: "twilio",
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
          provider: "twilio",
          providerEventId
        }
      },
      data: {
        processingStatus: "failed",
        errorMessage: "Status callback arrived before call creation"
      }
    });
    throw AppError.notFound("Call not found for Twilio status callback");
  }

  if (status) {
    assertCallStatusUpdate(call.status, status);
  }

  const updated = await app.prisma.$transaction(async (tx) => {
    const nextCall = await tx.call.update({
      where: { id: call.id },
      data: {
        status,
        endedAt: status && ["ended", "failed"].includes(status) ? new Date() : undefined,
        failureReason:
          status === "failed" ? (body.ErrorCode ?? "Twilio status callback failed") : undefined,
        metadata: twilioMetadata(body)
      },
      select: {
        id: true,
        companyId: true,
        status: true
      }
    });

    const recording = extractTwilioRecording(body);

    if (recording) {
      await tx.callRecording.upsert({
        where: {
          provider_providerRecordingId: {
            provider: "twilio",
            providerRecordingId: recording.providerRecordingId
          }
        },
        create: {
          companyId: call.companyId,
          callId: call.id,
          provider: "twilio",
          providerRecordingId: recording.providerRecordingId,
          status: recording.status,
          recordingUrl: recording.recordingUrl,
          durationSeconds: recording.durationSeconds,
          channels: recording.channels,
          source: recording.source,
          metadata: recording.metadata
        },
        update: {
          status: recording.status,
          recordingUrl: recording.recordingUrl,
          durationSeconds: recording.durationSeconds,
          channels: recording.channels,
          source: recording.source,
          metadata: recording.metadata
        }
      });
    }

    if (!duplicate && status === CallStatus.ended && !call.endedAt) {
      const minutes = billableCallMinutes(body, call.startedAt);

      if (minutes > 0) {
        await incrementUsage(tx, call.companyId, UsageMetric.call_minutes, minutes);
      }
    }

    await tx.webhookEvent.update({
      where: {
        provider_providerEventId: {
          provider: "twilio",
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
  const durationSeconds = Number(body.CallDuration);

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
      provider: "twilio",
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
  const idempotencyHeader = request.headers["i-twilio-idempotency-token"];
  const idempotencyToken = Array.isArray(idempotencyHeader)
    ? idempotencyHeader[0]
    : idempotencyHeader;

  if (idempotencyToken) {
    return idempotencyToken;
  }

  return createTwilioProviderEventId({
    callSid: body.CallSid,
    eventType,
    callStatus: body.CallStatus,
    rawBody,
    idempotencyToken
  });
}

function mapTwilioCallStatus(status: string | undefined): CallStatus {
  switch (status) {
    case "queued":
    case "ringing":
      return CallStatus.ringing;
    case "in-progress":
      return CallStatus.connected;
    case "completed":
      return CallStatus.ended;
    case "busy":
    case "failed":
    case "canceled":
    case "no-answer":
      return CallStatus.failed;
    default:
      return CallStatus.initiated;
  }
}

function twilioMetadata(body: Readonly<Record<string, string>>): Prisma.InputJsonObject {
  return {
    accountSid: body.AccountSid,
    callStatus: body.CallStatus,
    direction: body.Direction,
    forwardedFrom: body.ForwardedFrom,
    callerName: body.CallerName,
    apiVersion: body.ApiVersion,
    recordingSid: body.RecordingSid,
    recordingStatus: body.RecordingStatus,
    recordingUrl: body.RecordingUrl,
    recordingDuration: body.RecordingDuration
  };
}

function requireTwilioParam(body: Readonly<Record<string, string>>, name: string): string {
  const value = body[name];

  if (!value) {
    throw AppError.badRequest(`Twilio webhook is missing ${name}`);
  }

  return value;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "P2002"
  );
}
