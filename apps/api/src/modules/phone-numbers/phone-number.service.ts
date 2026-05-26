import type { FastifyInstance } from "fastify";
import { WebhookProvider, type Prisma } from "@prisma/client";
import type {
  TelephonyAvailablePhoneNumber,
  TelephonyProviderPort,
  TelephonyProvisionNumberResponse
} from "@voxlink/shared";
import { AppError } from "../../errors/app-error.js";
import { assertResourceWithinLimit } from "../billing/usage-limits.js";

export type TelephonyProviderName = "plivo" | "twilio";

export const phoneNumberSelect = {
  id: true,
  e164: true,
  label: true,
  provider: true,
  providerNumberSid: true,
  providerMetadata: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  aiAgent: {
    select: {
      id: true,
      name: true,
      status: true
    }
  },
  _count: {
    select: {
      calls: true
    }
  }
} satisfies Prisma.PhoneNumberSelect;

export interface SearchAvailablePhoneNumbersInput {
  readonly companyId: string;
  readonly requestId: string;
  readonly provider: TelephonyProviderName;
  readonly countryCode: string;
  readonly areaCode?: string;
  readonly contains?: string;
  readonly limit: number;
}

export interface ProvisionPhoneNumberInput {
  readonly companyId: string;
  readonly requestId: string;
  readonly provider: TelephonyProviderName;
  readonly e164: string;
  readonly label?: string;
  readonly aiAgentId?: string;
}

export interface ReleasePhoneNumberInput {
  readonly companyId: string;
  readonly requestId: string;
  readonly phoneNumberId: string;
}

export interface SyncPhoneNumberRoutingInput {
  readonly companyId: string;
  readonly requestId: string;
  readonly phoneNumberId: string;
}

export async function searchAvailablePhoneNumbers(
  app: FastifyInstance,
  input: SearchAvailablePhoneNumbersInput
): Promise<readonly TelephonyAvailablePhoneNumber[]> {
  const provider = requireTelephonyProvider(app, input.provider);

  return provider.searchAvailablePhoneNumbers(
    {
      countryCode: input.countryCode,
      areaCode: input.areaCode,
      contains: input.contains,
      limit: input.limit,
      voiceEnabled: true
    },
    {
      requestId: input.requestId,
      companyId: input.companyId,
      timeoutPolicy: {
        connectTimeoutMs: 3_000,
        requestTimeoutMs: providerTimeoutMs(app, input.provider)
      }
    }
  );
}

export async function provisionPhoneNumber(
  app: FastifyInstance,
  input: ProvisionPhoneNumberInput
): Promise<Prisma.PhoneNumberGetPayload<{ select: typeof phoneNumberSelect }>> {
  if (input.aiAgentId) {
    await assertAgentBelongsToTenant(app, input.aiAgentId, input.companyId);
  }

  await assertPhoneNumberIsNotMapped(app, input.e164);
  await assertResourceWithinLimit(app.prisma, input.companyId, "phone_numbers", 1);

  const provider = requireTelephonyProvider(app, input.provider);
  const webhookUrls = buildTelephonyWebhookUrls(
    input.provider,
    webhookBaseUrlForProvider(app, input.provider)
  );
  const provisioned = await provider.provisionPhoneNumber(
    {
      e164: input.e164,
      label: input.label,
      voiceWebhookUrl: webhookUrls.voiceWebhookUrl,
      statusCallbackUrl: webhookUrls.statusCallbackUrl
    },
    {
      requestId: input.requestId,
      companyId: input.companyId,
      timeoutPolicy: {
        connectTimeoutMs: 3_000,
        requestTimeoutMs: providerTimeoutMs(app, input.provider)
      }
    }
  );

  try {
    return await app.prisma.$transaction(async (tx) => {
      await assertResourceWithinLimit(tx, input.companyId, "phone_numbers", 1);

      return tx.phoneNumber.create({
        data: {
          companyId: input.companyId,
          e164: provisioned.e164,
          label: input.label ?? provisioned.friendlyName,
          aiAgentId: input.aiAgentId,
          provider: input.provider,
          providerNumberSid: provisioned.providerNumberSid,
          providerMetadata: toInputJsonObject(provisioned.providerMetadata),
          status: "active"
        },
        select: phoneNumberSelect
      });
    });
  } catch (error) {
    await compensateProvisionedNumber(app, provisioned, input);
    throw error;
  }
}

export async function releasePhoneNumber(
  app: FastifyInstance,
  input: ReleasePhoneNumberInput
): Promise<Prisma.PhoneNumberGetPayload<{ select: typeof phoneNumberSelect }>> {
  const phoneNumber = await app.prisma.phoneNumber.findFirst({
    where: { id: input.phoneNumberId, companyId: input.companyId },
    select: {
      id: true,
      provider: true,
      providerNumberSid: true,
      providerMetadata: true,
      status: true
    }
  });

  if (!phoneNumber) {
    throw AppError.notFound("Phone number not found");
  }

  if (
    phoneNumber.status !== "released" &&
    isTelephonyProviderName(phoneNumber.provider) &&
    phoneNumber.providerNumberSid
  ) {
    const provider = requireTelephonyProvider(app, phoneNumber.provider);
    await provider.releasePhoneNumber(
      {
        providerNumberSid: phoneNumber.providerNumberSid,
        providerMetadata: asRecord(phoneNumber.providerMetadata)
      },
      {
        requestId: input.requestId,
        companyId: input.companyId,
        timeoutPolicy: {
          connectTimeoutMs: 3_000,
          requestTimeoutMs: providerTimeoutMs(app, phoneNumber.provider)
        }
      }
    );
  }

  return app.prisma.phoneNumber.update({
    where: { id: phoneNumber.id },
    data: {
      status: "released",
      aiAgentId: null
    },
    select: phoneNumberSelect
  });
}

export async function syncPhoneNumberRouting(
  app: FastifyInstance,
  input: SyncPhoneNumberRoutingInput
): Promise<Prisma.PhoneNumberGetPayload<{ select: typeof phoneNumberSelect }>> {
  const phoneNumber = await app.prisma.phoneNumber.findFirst({
    where: {
      id: input.phoneNumberId,
      companyId: input.companyId,
      status: { not: "released" }
    },
    select: {
      id: true,
      e164: true,
      provider: true,
      aiAgentId: true,
      providerNumberSid: true,
      providerMetadata: true
    }
  });

  if (!phoneNumber) {
    throw AppError.notFound("Phone number not found");
  }

  if (!isTelephonyProviderName(phoneNumber.provider)) {
    throw AppError.badRequest("Phone number provider is not a voice telephony provider");
  }

  const providerNumberSid =
    phoneNumber.providerNumberSid ??
    (phoneNumber.provider === "plivo" ? normalizePlivoNumber(phoneNumber.e164) : undefined);

  if (!providerNumberSid) {
    throw AppError.badRequest("This phone number does not have a provider number ID to sync");
  }

  if (!phoneNumber.aiAgentId) {
    throw AppError.badRequest("Assign an AI agent before syncing phone routing");
  }

  if (phoneNumber.provider === "twilio" && !isTwilioIncomingPhoneNumberSid(providerNumberSid)) {
    throw AppError.badRequest(
      "Enter a valid Twilio Incoming Phone Number SID before syncing routing"
    );
  }

  const provider = requireTelephonyProvider(app, phoneNumber.provider);
  const webhookUrls = buildTelephonyWebhookUrls(
    phoneNumber.provider,
    webhookBaseUrlForProvider(app, phoneNumber.provider)
  );

  const updatedRouting = await provider.updatePhoneNumberRouting(
    {
      providerNumberSid,
      providerMetadata: asRecord(phoneNumber.providerMetadata),
      voiceWebhookUrl: webhookUrls.voiceWebhookUrl,
      statusCallbackUrl: webhookUrls.statusCallbackUrl
    },
    {
      requestId: input.requestId,
      companyId: input.companyId,
      timeoutPolicy: {
        connectTimeoutMs: 3_000,
        requestTimeoutMs: providerTimeoutMs(app, phoneNumber.provider)
      }
    }
  );

  return app.prisma.phoneNumber.update({
    where: { id: phoneNumber.id },
    data: {
      providerNumberSid: updatedRouting.providerNumberSid,
      providerMetadata: updatedRouting.providerMetadata
        ? toInputJsonObject(updatedRouting.providerMetadata)
        : undefined,
      updatedAt: new Date()
    },
    select: phoneNumberSelect
  });
}

export function buildTwilioWebhookUrls(baseUrl: string): {
  readonly voiceWebhookUrl: string;
  readonly statusCallbackUrl: string;
} {
  return buildTelephonyWebhookUrls("twilio", baseUrl);
}

export function buildPlivoWebhookUrls(baseUrl: string): {
  readonly voiceWebhookUrl: string;
  readonly statusCallbackUrl: string;
} {
  return buildTelephonyWebhookUrls("plivo", baseUrl);
}

function buildTelephonyWebhookUrls(
  provider: TelephonyProviderName,
  baseUrl: string
): {
  readonly voiceWebhookUrl: string;
  readonly statusCallbackUrl: string;
} {
  return {
    voiceWebhookUrl: new URL(`/webhooks/${provider}/voice`, baseUrl).toString(),
    statusCallbackUrl: new URL(`/webhooks/${provider}/status`, baseUrl).toString()
  };
}

async function compensateProvisionedNumber(
  app: FastifyInstance,
  provisioned: TelephonyProvisionNumberResponse,
  input: ProvisionPhoneNumberInput
): Promise<void> {
  const provider = requireTelephonyProvider(app, input.provider);

  try {
    await provider.releasePhoneNumber(
      {
        providerNumberSid: provisioned.providerNumberSid,
        providerMetadata: provisioned.providerMetadata
      },
      {
        requestId: input.requestId,
        companyId: input.companyId,
        timeoutPolicy: {
          connectTimeoutMs: 3_000,
          requestTimeoutMs: providerTimeoutMs(app, input.provider)
        }
      }
    );
  } catch (compensationError) {
    app.log.error(
      {
        error: compensationError,
        companyId: input.companyId,
        e164: provisioned.e164,
        providerNumberSid: provisioned.providerNumberSid
      },
      "Failed to release provider number after database provisioning failed"
    );
  }
}

function requireTelephonyProvider(
  app: FastifyInstance,
  providerName: TelephonyProviderName
): TelephonyProviderPort {
  const provider = app.providers.get<TelephonyProviderPort>("telephony", providerName);

  if (!provider) {
    throw AppError.badRequest(`${providerName} provider is not configured`);
  }

  return provider;
}

function webhookBaseUrlForProvider(
  app: FastifyInstance,
  providerName: TelephonyProviderName
): string {
  return providerName === "plivo"
    ? app.config.PLIVO_WEBHOOK_BASE_URL
    : app.config.TWILIO_WEBHOOK_BASE_URL;
}

function providerTimeoutMs(app: FastifyInstance, providerName: TelephonyProviderName): number {
  return providerName === "plivo"
    ? app.config.PLIVO_PROVIDER_TIMEOUT_MS
    : app.config.TWILIO_PROVIDER_TIMEOUT_MS;
}

async function assertAgentBelongsToTenant(
  app: FastifyInstance,
  agentId: string,
  companyId: string
): Promise<void> {
  const agent = await app.prisma.aiAgent.findFirst({
    where: { id: agentId, companyId },
    select: { id: true }
  });

  if (!agent) {
    throw AppError.badRequest("AI agent is not available for this company");
  }
}

async function assertPhoneNumberIsNotMapped(app: FastifyInstance, e164: string): Promise<void> {
  const existing = await app.prisma.phoneNumber.findUnique({
    where: { e164 },
    select: { id: true }
  });

  if (existing) {
    throw AppError.conflict("Phone number is already mapped in VoxLink");
  }
}

function isTwilioIncomingPhoneNumberSid(value: string): boolean {
  return /^PN[0-9a-fA-F]{32}$/.test(value.trim());
}

function isTelephonyProviderName(value: WebhookProvider): value is TelephonyProviderName {
  return value === WebhookProvider.plivo || value === WebhookProvider.twilio;
}

function asRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function toInputJsonObject(value: Record<string, unknown> | undefined): Prisma.InputJsonObject {
  return (value ?? {}) as Prisma.InputJsonObject;
}

function normalizePlivoNumber(value: string): string {
  return value.replace(/[^\d]/g, "");
}
