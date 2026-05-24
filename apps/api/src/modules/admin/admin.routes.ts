import { SubscriptionStatus, UsageMetric, type Prisma } from "@prisma/client";
import type { FastifyPluginCallback, FastifyRequest } from "fastify";
import { AppError } from "../../errors/app-error.js";
import { requireTenantContext } from "../../security/tenant-context.js";
import { currentMonthlyPeriod } from "../../utils/period.js";
import {
  activeSubscriptionStatuses,
  findCurrentSubscription,
  getBillingSummary
} from "../billing/usage-limits.js";
import {
  listAdminCompaniesQuerySchema,
  updateAdminCompanyStatusSchema,
  updateAdminSubscriptionSchema
} from "./admin.schemas.js";

const adminCompanySelect = {
  id: true,
  name: true,
  slug: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  memberships: {
    select: {
      role: true
    }
  },
  subscriptions: {
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: 1,
    select: {
      id: true,
      status: true,
      planCode: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      providerCustomerId: true,
      providerSubscriptionId: true,
      createdAt: true,
      updatedAt: true
    }
  },
  _count: {
    select: {
      memberships: true,
      aiAgents: true,
      phoneNumbers: true,
      calls: true,
      knowledgeBase: true
    }
  }
} satisfies Prisma.CompanySelect;

export const adminRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.addHook("preHandler", async (request) => {
    await app.authenticate(request);
    requireSuperAdmin(request);
  });

  app.get("/companies", async (request) => {
    const query = listAdminCompaniesQuerySchema.parse(request.query);
    const searchFilter = query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" as const } },
            { slug: { contains: query.search, mode: "insensitive" as const } }
          ]
        }
      : {};
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...searchFilter
    } satisfies Prisma.CompanyWhereInput;

    const [companies, total] = await Promise.all([
      app.prisma.company.findMany({
        where,
        orderBy: { createdAt: "desc" },
        select: adminCompanySelect,
        take: query.limit,
        skip: query.offset
      }),
      app.prisma.company.count({ where })
    ]);

    return { companies, total, limit: query.limit, offset: query.offset };
  });

  app.get("/companies/:companyId", async (request) => {
    const { companyId } = request.params as { readonly companyId: string };
    const [company, billing] = await Promise.all([
      app.prisma.company.findUnique({
        where: { id: companyId },
        select: adminCompanySelect
      }),
      getBillingSummary(app.prisma, companyId)
    ]);

    if (!company) {
      throw AppError.notFound("Company not found");
    }

    return { company, billing };
  });

  app.get("/companies/:companyId/usage", async (request) => {
    const { companyId } = request.params as { readonly companyId: string };
    const company = await app.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true }
    });

    if (!company) {
      throw AppError.notFound("Company not found");
    }

    const { periodStart, periodEnd } = currentMonthlyPeriod();
    const usage = await app.prisma.usageTracking.findMany({
      where: {
        companyId,
        periodStart,
        periodEnd,
        metric: {
          in: [
            UsageMetric.calls,
            UsageMetric.call_minutes,
            UsageMetric.transcript_chunks,
            UsageMetric.knowledge_items,
            UsageMetric.llm_tokens
          ]
        }
      },
      orderBy: { metric: "asc" },
      select: {
        metric: true,
        amount: true,
        periodStart: true,
        periodEnd: true,
        updatedAt: true
      }
    });

    return { usage };
  });

  app.patch("/companies/:companyId/status", async (request) => {
    const { companyId } = request.params as { readonly companyId: string };
    const input = updateAdminCompanyStatusSchema.parse(request.body);

    const company = await app.prisma.company.update({
      where: { id: companyId },
      data: { status: input.status },
      select: adminCompanySelect
    });

    return { company };
  });

  app.patch("/companies/:companyId/subscription", async (request) => {
    const { companyId } = request.params as { readonly companyId: string };
    const input = updateAdminSubscriptionSchema.parse(request.body);
    const { periodStart, periodEnd } = currentMonthlyPeriod();

    const subscription = await app.prisma.$transaction(async (tx) => {
      const existing = await findCurrentSubscription(tx, companyId);

      if (existing) {
        const updated = await tx.subscription.update({
          where: { id: existing.id },
          data: {
            planCode: input.planCode,
            status: input.status,
            providerCustomerId: input.providerCustomerId,
            providerSubscriptionId: input.providerSubscriptionId,
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd
          }
        });

        await tx.subscription.updateMany({
          where: {
            companyId,
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
          companyId,
          status: input.status,
          planCode: input.planCode,
          providerCustomerId: input.providerCustomerId,
          providerSubscriptionId: input.providerSubscriptionId,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd
        }
      });
    });

    return { subscription, billing: await getBillingSummary(app.prisma, companyId) };
  });

  done();
};

function requireSuperAdmin(request: FastifyRequest): void {
  const tenant = requireTenantContext(request);

  if (tenant.role !== "super_admin") {
    throw AppError.forbidden();
  }
}
