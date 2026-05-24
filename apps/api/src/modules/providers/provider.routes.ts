import type { FastifyPluginCallback } from "fastify";
import { requirePermission } from "../../security/rbac.js";

export const providerRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.get(
    "/health",
    { preHandler: async (request) => app.authenticate(request) },
    async (request) => {
      requirePermission(request, "dashboard:read");

      const providers = await Promise.all(
        app.providers.list().map(async (provider) => ({
          ...(await provider.health()),
          configured: true
        }))
      );

      return { providers };
    }
  );

  done();
};
