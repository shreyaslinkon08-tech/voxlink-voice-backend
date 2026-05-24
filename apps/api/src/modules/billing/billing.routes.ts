import { SubscriptionStatus, type Prisma } from "@prisma/client";
import type { FastifyPluginCallback } from "fastify";
import { requirePermission } from "../../security/rbac.js";
import { requireTenantContext } from "../../security/tenant-context.js";
import { currentMonthlyPeriod } from "../../utils/period.js";
import { createCheckoutSessionSchema, updateSubscriptionPlanSchema } from "./billing.schemas.js";
import {
  createBillingCheckoutSession,
  createBillingPortalSession
} from "./stripe-billing.service.js";
import {
  activeSubscriptionStatuses,
  findCurrentSubscription,
  getBillingSummary
} from "./usage-limits.js";

const subscriptionSummarySelect = {
  id: true,
  status: true,
  planCode: true,
  providerCustomerId: true,
  providerSubscriptionId: true,
  currentPeriodStart: true,
  currentPeriodEnd: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.SubscriptionSelect;

export const billingRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.get(
    "/summary",
    { preHandler: async (request) => app.authenticate(request) },
    async (request) => {
      requirePermission(request, "dashboard:read");
      const tenant = requireTenantContext(request);
      const summary = await getBillingSummary(app.prisma, tenant.companyId);

      return { summary };
    }
  );

  app.post(
    "/checkout-session",
    { preHandler: async (request) => app.authenticate(request) },
    async (request) => {
      requirePermission(request, "company:update");
      const tenant = requireTenantContext(request);
      const input = createCheckoutSessionSchema.parse(request.body);
      return createBillingCheckoutSession(app, tenant, input.planCode);
    }
  );

  app.post(
    "/portal-session",
    { preHandler: async (request) => app.authenticate(request) },
    async (request) => {
      requirePermission(request, "company:update");
      const tenant = requireTenantContext(request);
      return createBillingPortalSession(app, tenant);
    }
  );

  app.patch(
    "/subscription",
    { preHandler: async (request) => app.authenticate(request) },
    async (request) => {
      requirePermission(request, "company:update");
      const tenant = requireTenantContext(request);
      const input = updateSubscriptionPlanSchema.parse(request.body);
      const { periodStart, periodEnd } = currentMonthlyPeriod();

      const subscription = await app.prisma.$transaction(async (tx) => {
        const existing = await findCurrentSubscription(tx, tenant.companyId);

        if (existing) {
          const updated = await tx.subscription.update({
            where: { id: existing.id },
            data: {
              planCode: input.planCode,
              currentPeriodStart: periodStart,
              currentPeriodEnd: periodEnd
            },
            select: subscriptionSummarySelect
          });

          await tx.subscription.updateMany({
            where: {
              companyId: tenant.companyId,
              id: { not: existing.id },
              status: { in: [...activeSubscriptionStatuses] }
            },
            data: {
              status: SubscriptionStatus.canceled
            }
          });

          return updated;
        }

        return tx.subscription.create({
          data: {
            companyId: tenant.companyId,
            status: SubscriptionStatus.trialing,
            planCode: input.planCode,
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd
          },
          select: subscriptionSummarySelect
        });
      });

      return { subscription, summary: await getBillingSummary(app.prisma, tenant.companyId) };
    }
  );

  done();
};
