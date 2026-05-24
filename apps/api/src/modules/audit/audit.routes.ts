import type { FastifyPluginCallback } from "fastify";
import type { Prisma } from "@prisma/client";
import { requirePermission } from "../../security/rbac.js";
import { requireTenantContext } from "../../security/tenant-context.js";
import { listAuditEventsQuerySchema } from "./audit.schemas.js";

const auditEventSelect = {
  id: true,
  companyId: true,
  actorUserId: true,
  action: true,
  resourceType: true,
  resourceId: true,
  requestId: true,
  ipAddress: true,
  userAgent: true,
  metadata: true,
  createdAt: true,
  company: {
    select: {
      id: true,
      name: true,
      slug: true,
      status: true
    }
  },
  actor: {
    select: {
      id: true,
      name: true,
      email: true
    }
  }
} satisfies Prisma.AuditEventSelect;

export const auditRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.get("/", { preHandler: async (request) => app.authenticate(request) }, async (request) => {
    requirePermission(request, "audit:read");
    const tenant = requireTenantContext(request);
    const query = listAuditEventsQuerySchema.parse(request.query);
    const where: Prisma.AuditEventWhereInput = {};

    if (tenant.role === "super_admin") {
      if (query.companyId && query.companyId !== "all") {
        where.companyId = query.companyId;
      } else if (query.companyId !== "all") {
        where.companyId = tenant.companyId;
      }
    } else {
      where.companyId = tenant.companyId;
    }

    if (query.resourceType) {
      where.resourceType = query.resourceType;
    }

    if (query.action) {
      where.action = {
        contains: query.action,
        mode: "insensitive"
      };
    }

    if (query.search) {
      where.OR = [
        { action: { contains: query.search, mode: "insensitive" } },
        { resourceType: { contains: query.search, mode: "insensitive" } },
        { resourceId: { contains: query.search, mode: "insensitive" } },
        { requestId: { contains: query.search, mode: "insensitive" } }
      ];
    }

    const [auditEvents, total] = await Promise.all([
      app.prisma.auditEvent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        select: auditEventSelect,
        take: query.limit,
        skip: query.offset
      }),
      app.prisma.auditEvent.count({ where })
    ]);

    return { auditEvents, total, limit: query.limit, offset: query.offset };
  });

  done();
};
