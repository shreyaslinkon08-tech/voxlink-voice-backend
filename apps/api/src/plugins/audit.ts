import fp from "fastify-plugin";
import type { Prisma } from "@prisma/client";

const auditedMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const skippedPrefixes = ["/health", "/ready"];

export const auditPlugin = fp((app, _options, done) => {
  app.addHook("onResponse", async (request, reply) => {
    if (!auditedMethods.has(request.method)) {
      return;
    }

    if (skippedPrefixes.some((prefix) => request.url.startsWith(prefix))) {
      return;
    }

    const tenant = request.tenantContext;
    const routePath = request.routeOptions.url ?? request.url;
    const resourceType = routePath.split("/").filter(Boolean)[0] ?? "unknown";
    const rawParams: unknown = request.params;
    const params =
      rawParams && typeof rawParams === "object" ? (rawParams as Record<string, unknown>) : {};
    const jsonParams = Object.fromEntries(
      Object.entries(params).map(([key, value]) => [
        key,
        ["string", "number", "boolean"].includes(typeof value) || value === null
          ? value
          : (JSON.stringify(value) ?? null)
      ])
    ) as Prisma.InputJsonObject;
    const resourceId = Object.entries(params).find(([key]) => key.endsWith("Id"))?.[1];
    const userAgent = request.headers["user-agent"];

    try {
      await app.prisma.auditEvent.create({
        data: {
          companyId: tenant?.companyId,
          actorUserId: tenant?.userId,
          action: `${request.method} ${routePath}`,
          resourceType,
          resourceId: typeof resourceId === "string" ? resourceId : undefined,
          requestId: request.id,
          ipAddress: request.ip,
          userAgent: Array.isArray(userAgent) ? userAgent.join(", ") : userAgent,
          metadata: {
            statusCode: reply.statusCode,
            params: jsonParams
          }
        }
      });
    } catch (error) {
      request.log.warn({ error }, "Failed to write audit event");
    }
  });

  done();
});
