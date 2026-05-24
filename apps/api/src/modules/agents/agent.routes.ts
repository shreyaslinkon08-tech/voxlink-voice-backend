import type { FastifyPluginCallback } from "fastify";
import type { Prisma } from "@prisma/client";
import { AppError } from "../../errors/app-error.js";
import { requirePermission } from "../../security/rbac.js";
import { requireTenantContext } from "../../security/tenant-context.js";
import { assertResourceWithinLimit } from "../billing/usage-limits.js";
import { createAgentSchema, listAgentsQuerySchema, updateAgentSchema } from "./agent.schemas.js";

const agentSelect = {
  id: true,
  name: true,
  status: true,
  systemPrompt: true,
  personality: true,
  voiceSettings: true,
  businessHours: true,
  escalationRules: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      phoneNumbers: true,
      calls: true
    }
  }
} satisfies Prisma.AiAgentSelect;

export const agentRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.get("/", { preHandler: async (request) => app.authenticate(request) }, async (request) => {
    requirePermission(request, "agent:read");
    const tenant = requireTenantContext(request);
    const query = listAgentsQuerySchema.parse(request.query);

    const [agents, total] = await Promise.all([
      app.prisma.aiAgent.findMany({
        where: {
          companyId: tenant.companyId,
          ...(query.status ? { status: query.status } : {})
        },
        orderBy: { createdAt: "desc" },
        select: agentSelect,
        take: query.limit,
        skip: query.offset
      }),
      app.prisma.aiAgent.count({
        where: {
          companyId: tenant.companyId,
          ...(query.status ? { status: query.status } : {})
        }
      })
    ]);

    return { agents, total, limit: query.limit, offset: query.offset };
  });

  app.post(
    "/",
    { preHandler: async (request) => app.authenticate(request) },
    async (request, reply) => {
      requirePermission(request, "agent:write");
      const tenant = requireTenantContext(request);
      const input = createAgentSchema.parse(request.body);

      const agent = await app.prisma.$transaction(async (tx) => {
        await assertResourceWithinLimit(tx, tenant.companyId, "ai_agents", 1);

        return tx.aiAgent.create({
          data: {
            companyId: tenant.companyId,
            name: input.name,
            status: input.status,
            systemPrompt: input.systemPrompt,
            personality: input.personality,
            voiceSettings: jsonObject(input.voiceSettings),
            businessHours: jsonObject(input.businessHours),
            escalationRules: jsonObject(input.escalationRules)
          },
          select: agentSelect
        });
      });

      reply.status(201);
      return { agent };
    }
  );

  app.get(
    "/:agentId",
    { preHandler: async (request) => app.authenticate(request) },
    async (request) => {
      requirePermission(request, "agent:read");
      const tenant = requireTenantContext(request);
      const { agentId } = request.params as { readonly agentId: string };

      const agent = await app.prisma.aiAgent.findFirst({
        where: { id: agentId, companyId: tenant.companyId },
        select: agentSelect
      });

      if (!agent) {
        throw AppError.notFound("AI agent not found");
      }

      return { agent };
    }
  );

  app.patch(
    "/:agentId",
    { preHandler: async (request) => app.authenticate(request) },
    async (request) => {
      requirePermission(request, "agent:write");
      const tenant = requireTenantContext(request);
      const { agentId } = request.params as { readonly agentId: string };
      const input = updateAgentSchema.parse(request.body);

      const existing = await app.prisma.aiAgent.findFirst({
        where: { id: agentId, companyId: tenant.companyId },
        select: { id: true }
      });

      if (!existing) {
        throw AppError.notFound("AI agent not found");
      }

      const agent = await app.prisma.aiAgent.update({
        where: { id: agentId },
        data: {
          name: input.name,
          status: input.status,
          systemPrompt: input.systemPrompt,
          personality: input.personality,
          voiceSettings:
            input.voiceSettings === undefined ? undefined : jsonObject(input.voiceSettings),
          businessHours:
            input.businessHours === undefined ? undefined : jsonObject(input.businessHours),
          escalationRules:
            input.escalationRules === undefined ? undefined : jsonObject(input.escalationRules)
        },
        select: agentSelect
      });

      return { agent };
    }
  );

  done();
};

function jsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  return value as Prisma.InputJsonObject;
}
