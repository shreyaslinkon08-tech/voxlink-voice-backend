import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import type {
  TelephonyAvailablePhoneNumber,
  TelephonyProviderPort,
  TelephonyProvisionNumberResponse
} from "@voxlink/shared";
import { AppError } from "../../errors/app-error.js";
import { assertResourceWithinLimit } from "../billing/usage-limits.js";

export const phoneNumberSelect = {
  id: true,
  e164: true,
  label: true,
  provider: true,
  providerNumberSid: true,
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
  readonly countryCode: string;
  readonly areaCode?: string;
  readonly contains?: string;
  readonly limit: number;
}

export interface ProvisionPhoneNumberInput {
  readonly companyId: string;
  readonly requestId: string;
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
  const provider = requireTwilioProvider(app);

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
        requestTimeoutMs: app.config.TWILIO_PROVIDER_TIMEOUT_MS
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

  const provider = requireTwilioProvider(app);
  const webhookUrls = buildTwilioWebhookUrls(app.config.TWILIO_WEBHOOK_BASE_URL);
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
        requestTimeoutMs: app.config.TWILIO_PROVIDER_TIMEOUT_MS
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
          provider: "twilio",
          providerNumberSid: provisioned.providerNumberSid,
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
      providerNumberSid: true,
      status: true
    }
  });

  if (!phoneNumber) {
    throw AppError.notFound("Phone number not found");
  }

  if (phoneNumber.status !== "released" && phoneNumber.providerNumberSid) {
    const provider = requireTwilioProvider(app);
    await provider.releasePhoneNumber(
      { providerNumberSid: phoneNumber.providerNumberSid },
      {
        requestId: input.requestId,
        companyId: input.companyId,
        timeoutPolicy: {
          connectTimeoutMs: 3_000,
          requestTimeoutMs: app.config.TWILIO_PROVIDER_TIMEOUT_MS
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
      providerNumberSid: true
    }
  });

  if (!phoneNumber) {
    throw AppError.notFound("Phone number not found");
  }

  if (!phoneNumber.providerNumberSid) {
    throw AppError.badRequest("This phone number does not have a Twilio number SID to sync");
  }

  const provider = requireTwilioProvider(app);
  const webhookUrls = buildTwilioWebhookUrls(app.config.TWILIO_WEBHOOK_BASE_URL);

  await provider.updatePhoneNumberRouting(
    {
      providerNumberSid: phoneNumber.providerNumberSid,
      voiceWebhookUrl: webhookUrls.voiceWebhookUrl,
      statusCallbackUrl: webhookUrls.statusCallbackUrl
    },
    {
      requestId: input.requestId,
      companyId: input.companyId,
      timeoutPolicy: {
        connectTimeoutMs: 3_000,
        requestTimeoutMs: app.config.TWILIO_PROVIDER_TIMEOUT_MS
      }
    }
  );

  return app.prisma.phoneNumber.update({
    where: { id: phoneNumber.id },
    data: { updatedAt: new Date() },
    select: phoneNumberSelect
  });
}

export function buildTwilioWebhookUrls(baseUrl: string): {
  readonly voiceWebhookUrl: string;
  readonly statusCallbackUrl: string;
} {
  return {
    voiceWebhookUrl: new URL("/webhooks/twilio/voice", baseUrl).toString(),
    statusCallbackUrl: new URL("/webhooks/twilio/status", baseUrl).toString()
  };
}

async function compensateProvisionedNumber(
  app: FastifyInstance,
  provisioned: TelephonyProvisionNumberResponse,
  input: ProvisionPhoneNumberInput
): Promise<void> {
  const provider = requireTwilioProvider(app);

  try {
    await provider.releasePhoneNumber(
      { providerNumberSid: provisioned.providerNumberSid },
      {
        requestId: input.requestId,
        companyId: input.companyId,
        timeoutPolicy: {
          connectTimeoutMs: 3_000,
          requestTimeoutMs: app.config.TWILIO_PROVIDER_TIMEOUT_MS
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
      "Failed to release Twilio number after database provisioning failed"
    );
  }
}

function requireTwilioProvider(app: FastifyInstance): TelephonyProviderPort {
  const provider = app.providers.get<TelephonyProviderPort>("telephony", "twilio");

  if (!provider) {
    throw AppError.badRequest("Twilio provider is not configured");
  }

  return provider;
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
