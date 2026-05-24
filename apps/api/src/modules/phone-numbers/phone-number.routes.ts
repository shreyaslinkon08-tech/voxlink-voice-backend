import type { FastifyPluginCallback } from "fastify";
import type { Prisma } from "@prisma/client";
import { AppError } from "../../errors/app-error.js";
import { requirePermission } from "../../security/rbac.js";
import { requireTenantContext } from "../../security/tenant-context.js";
import { assertResourceWithinLimit } from "../billing/usage-limits.js";
import {
  createPhoneNumberSchema,
  listPhoneNumbersQuerySchema,
  provisionPhoneNumberSchema,
  searchAvailablePhoneNumbersQuerySchema,
  updatePhoneNumberSchema
} from "./phone-number.schemas.js";
import {
  phoneNumberSelect,
  provisionPhoneNumber,
  releasePhoneNumber,
  searchAvailablePhoneNumbers,
  syncPhoneNumberRouting
} from "./phone-number.service.js";

export const phoneNumberRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.get("/", { preHandler: async (request) => app.authenticate(request) }, async (request) => {
    requirePermission(request, "phone_number:read");
    const tenant = requireTenantContext(request);
    const query = listPhoneNumbersQuerySchema.parse(request.query);

    const where = {
      companyId: tenant.companyId,
      ...(query.status ? { status: query.status } : {})
    } satisfies Prisma.PhoneNumberWhereInput;

    const [phoneNumbers, total] = await Promise.all([
      app.prisma.phoneNumber.findMany({
        where,
        orderBy: { createdAt: "desc" },
        select: phoneNumberSelect,
        take: query.limit,
        skip: query.offset
      }),
      app.prisma.phoneNumber.count({ where })
    ]);

    return { phoneNumbers, total, limit: query.limit, offset: query.offset };
  });

  app.get(
    "/available",
    { preHandler: async (request) => app.authenticate(request) },
    async (request) => {
      requirePermission(request, "phone_number:write");
      const tenant = requireTenantContext(request);
      const input = searchAvailablePhoneNumbersQuerySchema.parse(request.query);

      const phoneNumbers = await searchAvailablePhoneNumbers(app, {
        companyId: tenant.companyId,
        requestId: request.id,
        countryCode: input.countryCode,
        areaCode: input.areaCode,
        contains: input.contains,
        limit: input.limit
      });

      return { phoneNumbers };
    }
  );

  app.post(
    "/",
    { preHandler: async (request) => app.authenticate(request) },
    async (request, reply) => {
      requirePermission(request, "phone_number:write");
      const tenant = requireTenantContext(request);
      const input = createPhoneNumberSchema.parse(request.body);

      if (input.aiAgentId) {
        await assertAgentBelongsToTenant(app, input.aiAgentId, tenant.companyId);
      }

      const phoneNumber = await app.prisma.$transaction(async (tx) => {
        await assertResourceWithinLimit(tx, tenant.companyId, "phone_numbers", 1);

        return tx.phoneNumber.create({
          data: {
            companyId: tenant.companyId,
            e164: input.e164,
            label: input.label,
            aiAgentId: input.aiAgentId,
            providerNumberSid: input.providerNumberSid,
            status: input.status
          },
          select: phoneNumberSelect
        });
      });

      reply.status(201);
      return { phoneNumber };
    }
  );

  app.post(
    "/provision",
    { preHandler: async (request) => app.authenticate(request) },
    async (request, reply) => {
      requirePermission(request, "phone_number:write");
      const tenant = requireTenantContext(request);
      const input = provisionPhoneNumberSchema.parse(request.body);

      const phoneNumber = await provisionPhoneNumber(app, {
        companyId: tenant.companyId,
        requestId: request.id,
        e164: input.e164,
        label: input.label,
        aiAgentId: input.aiAgentId
      });

      reply.status(201);
      return { phoneNumber };
    }
  );

  app.patch(
    "/:phoneNumberId",
    { preHandler: async (request) => app.authenticate(request) },
    async (request) => {
      requirePermission(request, "phone_number:write");
      const tenant = requireTenantContext(request);
      const { phoneNumberId } = request.params as { readonly phoneNumberId: string };
      const input = updatePhoneNumberSchema.parse(request.body);

      const existing = await app.prisma.phoneNumber.findFirst({
        where: { id: phoneNumberId, companyId: tenant.companyId },
        select: { id: true }
      });

      if (!existing) {
        throw AppError.notFound("Phone number not found");
      }

      if (input.aiAgentId) {
        await assertAgentBelongsToTenant(app, input.aiAgentId, tenant.companyId);
      }

      const phoneNumber = await app.prisma.phoneNumber.update({
        where: { id: phoneNumberId },
        data: {
          label: input.label,
          aiAgentId: input.aiAgentId,
          status: input.status
        },
        select: phoneNumberSelect
      });

      return { phoneNumber };
    }
  );

  app.post(
    "/:phoneNumberId/sync-routing",
    { preHandler: async (request) => app.authenticate(request) },
    async (request) => {
      requirePermission(request, "phone_number:write");
      const tenant = requireTenantContext(request);
      const { phoneNumberId } = request.params as { readonly phoneNumberId: string };

      const phoneNumber = await syncPhoneNumberRouting(app, {
        companyId: tenant.companyId,
        requestId: request.id,
        phoneNumberId
      });

      return { phoneNumber };
    }
  );

  app.post(
    "/:phoneNumberId/release",
    { preHandler: async (request) => app.authenticate(request) },
    async (request) => {
      requirePermission(request, "phone_number:write");
      const tenant = requireTenantContext(request);
      const { phoneNumberId } = request.params as { readonly phoneNumberId: string };

      const phoneNumber = await releasePhoneNumber(app, {
        companyId: tenant.companyId,
        requestId: request.id,
        phoneNumberId
      });

      return { phoneNumber };
    }
  );

  done();
};

async function assertAgentBelongsToTenant(
  app: Parameters<FastifyPluginCallback>[0],
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
