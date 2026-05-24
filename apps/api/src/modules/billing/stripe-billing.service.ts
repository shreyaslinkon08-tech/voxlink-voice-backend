import { createHash } from "node:crypto";
import { Prisma, SubscriptionStatus, WebhookProcessingStatus } from "@prisma/client";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { isPlanCode, resolveSubscriptionPlan, type PlanCode } from "@altrion/shared";
import { AppError } from "../../errors/app-error.js";
import type { TenantContext } from "@altrion/shared";
import { createStripeCheckoutSession, createStripePortalSession } from "./stripe-client.js";

interface StripeEvent {
  readonly id: string;
  readonly type: string;
  readonly data: {
    readonly object: Record<string, unknown>;
  };
}

interface StripeSessionResult {
  readonly url: string;
}

type StripeBillingPrisma = FastifyInstance["prisma"];
type StripeBillingTransaction = Prisma.TransactionClient;

export async function createBillingCheckoutSession(
  app: FastifyInstance,
  tenant: TenantContext,
  planCode: PlanCode
): Promise<StripeSessionResult> {
  const priceId = stripePriceIdForPlan(app, planCode);
  const plan = resolveSubscriptionPlan(planCode);

  if (plan.monthlyPriceCents === null) {
    throw AppError.badRequest(`${plan.name} is a sales-led plan. Contact support to enable it.`);
  }

  const [company, user, subscription] = await Promise.all([
    app.prisma.company.findUnique({
      where: { id: tenant.companyId },
      select: { id: true, name: true }
    }),
    app.prisma.user.findUnique({
      where: { id: tenant.userId },
      select: { email: true }
    }),
    app.prisma.subscription.findFirst({
      where: {
        companyId: tenant.companyId,
        status: {
          in: [SubscriptionStatus.trialing, SubscriptionStatus.active, SubscriptionStatus.past_due]
        }
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: { providerCustomerId: true }
    })
  ]);

  if (!company || !user) {
    throw AppError.unauthorized();
  }

  const session = await createStripeCheckoutSession(app.config, {
    customerId: subscription?.providerCustomerId,
    customerEmail: user.email,
    companyId: company.id,
    companyName: company.name,
    planCode,
    priceId
  });

  return { url: session.url };
}

export async function createBillingPortalSession(
  app: FastifyInstance,
  tenant: TenantContext
): Promise<StripeSessionResult> {
  const subscription = await app.prisma.subscription.findFirst({
    where: {
      companyId: tenant.companyId,
      providerCustomerId: { not: null }
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: { providerCustomerId: true }
  });

  if (!subscription?.providerCustomerId) {
    throw AppError.badRequest("No Stripe customer is linked to this company yet");
  }

  const session = await createStripePortalSession(app.config, {
    customerId: subscription.providerCustomerId
  });

  return { url: session.url };
}

export async function processStripeWebhook(
  app: FastifyInstance,
  request: FastifyRequest,
  rawBody: string
): Promise<{ readonly duplicate: boolean; readonly eventType?: string }> {
  const event = parseStripeEvent(rawBody);
  const payloadHash = createHash("sha256").update(rawBody).digest("hex");
  let webhookEventId: string;

  try {
    const webhookEvent = await app.prisma.webhookEvent.create({
      data: {
        provider: "stripe",
        providerEventId: event.id,
        payloadHash,
        processingStatus: WebhookProcessingStatus.received,
        rawPayload: event as unknown as Prisma.InputJsonObject
      },
      select: { id: true }
    });
    webhookEventId = webhookEvent.id;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { duplicate: true, eventType: event.type };
    }

    throw error;
  }

  try {
    const companyId = await applyStripeEvent(app, event);
    await app.prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: {
        companyId,
        processingStatus: WebhookProcessingStatus.processed,
        processedAt: new Date()
      }
    });

    return { duplicate: false, eventType: event.type };
  } catch (error) {
    request.log.warn({ error, eventId: event.id, eventType: event.type }, "Stripe webhook failed");
    await app.prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: {
        processingStatus: WebhookProcessingStatus.failed,
        errorMessage: error instanceof Error ? error.message : "Unknown Stripe webhook error"
      }
    });
    throw error;
  }
}

export function stripePriceIdForPlan(app: FastifyInstance, planCode: PlanCode): string {
  const priceIds: Readonly<Record<PlanCode, string>> = {
    starter: app.config.STRIPE_PRICE_ID_STARTER,
    growth: app.config.STRIPE_PRICE_ID_GROWTH,
    scale: app.config.STRIPE_PRICE_ID_SCALE
  };
  const priceId = priceIds[planCode]?.trim();

  if (!priceId) {
    throw AppError.badRequest(`Stripe price ID is not configured for the ${planCode} plan`);
  }

  return priceId;
}

async function applyStripeEvent(
  app: FastifyInstance,
  event: StripeEvent
): Promise<string | undefined> {
  switch (event.type) {
    case "checkout.session.completed":
      return applyCheckoutCompleted(app.prisma, event.data.object);
    case "customer.subscription.created":
    case "customer.subscription.updated":
      return applySubscriptionChanged(app, event.data.object);
    case "customer.subscription.deleted":
      return applySubscriptionChanged(app, event.data.object, SubscriptionStatus.canceled);
    case "invoice.payment_failed":
      return applyInvoiceSubscriptionStatus(
        app.prisma,
        event.data.object,
        SubscriptionStatus.past_due
      );
    case "invoice.payment_succeeded":
      return applyInvoiceSubscriptionStatus(
        app.prisma,
        event.data.object,
        SubscriptionStatus.active
      );
    default:
      return undefined;
  }
}

async function applyCheckoutCompleted(
  prisma: StripeBillingPrisma,
  object: Record<string, unknown>
): Promise<string | undefined> {
  const metadata = readMetadata(object);
  const companyId = metadata.companyId;
  const planCode = normalizePlanCode(metadata.planCode);
  const providerCustomerId = readString(object, "customer");
  const providerSubscriptionId = readString(object, "subscription");

  if (!companyId || !planCode || !providerCustomerId || !providerSubscriptionId) {
    return undefined;
  }

  await syncStripeSubscription(prisma, {
    companyId,
    planCode,
    providerCustomerId,
    providerSubscriptionId,
    status: SubscriptionStatus.active
  });

  return companyId;
}

async function applySubscriptionChanged(
  app: FastifyInstance,
  object: Record<string, unknown>,
  forcedStatus?: SubscriptionStatus
): Promise<string | undefined> {
  const providerSubscriptionId = readString(object, "id");
  const providerCustomerId = readString(object, "customer");

  if (!providerSubscriptionId || !providerCustomerId) {
    return undefined;
  }

  const metadata = readMetadata(object);
  const existing = await findExistingStripeSubscription(
    app.prisma,
    providerSubscriptionId,
    providerCustomerId
  );
  const companyId = metadata.companyId ?? existing?.companyId;
  const inferredPlanCode =
    normalizePlanCode(metadata.planCode) ??
    inferPlanCodeFromPriceId(app, readNestedPriceId(object)) ??
    normalizePlanCode(existing?.planCode);

  if (!companyId || !inferredPlanCode) {
    return undefined;
  }

  await syncStripeSubscription(app.prisma, {
    companyId,
    planCode: inferredPlanCode,
    providerCustomerId,
    providerSubscriptionId,
    status: forcedStatus ?? mapStripeSubscriptionStatus(readString(object, "status")),
    currentPeriodStart: epochSecondsToDate(readNumber(object, "current_period_start")),
    currentPeriodEnd: epochSecondsToDate(readNumber(object, "current_period_end"))
  });

  return companyId;
}

async function applyInvoiceSubscriptionStatus(
  prisma: StripeBillingPrisma,
  object: Record<string, unknown>,
  status: SubscriptionStatus
): Promise<string | undefined> {
  const providerSubscriptionId = readString(object, "subscription");
  const providerCustomerId = readString(object, "customer");

  if (!providerSubscriptionId && !providerCustomerId) {
    return undefined;
  }

  const existing = await findExistingStripeSubscription(
    prisma,
    providerSubscriptionId,
    providerCustomerId
  );

  if (!existing) {
    return undefined;
  }

  await prisma.subscription.update({
    where: { id: existing.id },
    data: { status }
  });

  return existing.companyId;
}

async function syncStripeSubscription(
  prisma: StripeBillingPrisma,
  input: {
    readonly companyId: string;
    readonly planCode: PlanCode;
    readonly providerCustomerId: string;
    readonly providerSubscriptionId: string;
    readonly status: SubscriptionStatus;
    readonly currentPeriodStart?: Date;
    readonly currentPeriodEnd?: Date;
  }
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const subscription = await upsertStripeSubscription(tx, input);

    if (isSubscriptionActiveish(input.status)) {
      await tx.subscription.updateMany({
        where: {
          companyId: input.companyId,
          id: { not: subscription.id },
          status: {
            in: [
              SubscriptionStatus.trialing,
              SubscriptionStatus.active,
              SubscriptionStatus.past_due
            ]
          }
        },
        data: {
          status: SubscriptionStatus.canceled
        }
      });
    }
  });
}

async function upsertStripeSubscription(
  tx: StripeBillingTransaction,
  input: {
    readonly companyId: string;
    readonly planCode: PlanCode;
    readonly providerCustomerId: string;
    readonly providerSubscriptionId: string;
    readonly status: SubscriptionStatus;
    readonly currentPeriodStart?: Date;
    readonly currentPeriodEnd?: Date;
  }
): Promise<{ readonly id: string }> {
  return tx.subscription.upsert({
    where: { providerSubscriptionId: input.providerSubscriptionId },
    create: {
      companyId: input.companyId,
      planCode: input.planCode,
      providerCustomerId: input.providerCustomerId,
      providerSubscriptionId: input.providerSubscriptionId,
      status: input.status,
      currentPeriodStart: input.currentPeriodStart,
      currentPeriodEnd: input.currentPeriodEnd
    },
    update: {
      planCode: input.planCode,
      providerCustomerId: input.providerCustomerId,
      status: input.status,
      currentPeriodStart: input.currentPeriodStart,
      currentPeriodEnd: input.currentPeriodEnd
    },
    select: { id: true }
  });
}

async function findExistingStripeSubscription(
  prisma: StripeBillingPrisma,
  providerSubscriptionId: string | undefined,
  providerCustomerId: string | undefined
): Promise<{ readonly id: string; readonly companyId: string; readonly planCode: string } | null> {
  if (providerSubscriptionId) {
    const subscription = await prisma.subscription.findUnique({
      where: { providerSubscriptionId },
      select: { id: true, companyId: true, planCode: true }
    });

    if (subscription) {
      return subscription;
    }
  }

  if (!providerCustomerId) {
    return null;
  }

  return prisma.subscription.findFirst({
    where: { providerCustomerId },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, companyId: true, planCode: true }
  });
}

function parseStripeEvent(rawBody: string): StripeEvent {
  const parsed = JSON.parse(rawBody) as Partial<StripeEvent>;

  if (
    !parsed ||
    typeof parsed.id !== "string" ||
    typeof parsed.type !== "string" ||
    !parsed.data ||
    typeof parsed.data !== "object" ||
    !parsed.data.object ||
    typeof parsed.data.object !== "object"
  ) {
    throw AppError.badRequest("Stripe webhook payload is invalid");
  }

  return parsed as StripeEvent;
}

function readMetadata(object: Record<string, unknown>): Record<string, string> {
  const metadata = object.metadata;

  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(metadata).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
}

function readString(object: Record<string, unknown>, key: string): string | undefined {
  const value = object[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(object: Record<string, unknown>, key: string): number | undefined {
  const value = object[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readNestedPriceId(object: Record<string, unknown>): string | undefined {
  const items = object.items;

  if (!items || typeof items !== "object" || Array.isArray(items)) {
    return undefined;
  }

  const data: unknown = (items as Record<string, unknown>).data;

  if (!Array.isArray(data)) {
    return undefined;
  }

  const first: unknown = data[0];

  if (!first || typeof first !== "object" || Array.isArray(first)) {
    return undefined;
  }

  const price = (first as Record<string, unknown>).price;

  if (!price || typeof price !== "object" || Array.isArray(price)) {
    return undefined;
  }

  return readString(price as Record<string, unknown>, "id");
}

function inferPlanCodeFromPriceId(
  app: FastifyInstance,
  priceId: string | undefined
): PlanCode | undefined {
  if (!priceId) {
    return undefined;
  }

  const priceIds: Readonly<Record<PlanCode, string>> = {
    starter: app.config.STRIPE_PRICE_ID_STARTER,
    growth: app.config.STRIPE_PRICE_ID_GROWTH,
    scale: app.config.STRIPE_PRICE_ID_SCALE
  };

  for (const [planCode, configuredPriceId] of Object.entries(priceIds)) {
    if (configuredPriceId && configuredPriceId === priceId && isPlanCode(planCode)) {
      return planCode;
    }
  }

  return undefined;
}

function normalizePlanCode(value: string | undefined): PlanCode | undefined {
  return value && isPlanCode(value) ? value : undefined;
}

function mapStripeSubscriptionStatus(status: string | undefined): SubscriptionStatus {
  switch (status) {
    case "trialing":
      return SubscriptionStatus.trialing;
    case "active":
      return SubscriptionStatus.active;
    case "canceled":
    case "incomplete_expired":
      return SubscriptionStatus.canceled;
    default:
      return SubscriptionStatus.past_due;
  }
}

function isSubscriptionActiveish(status: SubscriptionStatus): boolean {
  return (
    status === SubscriptionStatus.trialing ||
    status === SubscriptionStatus.active ||
    status === SubscriptionStatus.past_due
  );
}

function epochSecondsToDate(value: number | undefined): Date | undefined {
  return value ? new Date(value * 1000) : undefined;
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
