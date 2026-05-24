import type { FastifyPluginCallback } from "fastify";

export const healthRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.get("/health", () => ({
    status: "ok",
    service: "api",
    uptimeSeconds: Math.round(process.uptime())
  }));

  app.get("/ready", async (_request, reply) => {
    const checks = {
      database: false,
      redis: false,
      providers: providerReadiness(app)
    };

    try {
      await app.prisma.$queryRaw`SELECT 1`;
      checks.database = true;
    } catch (error) {
      app.log.warn({ error }, "Database readiness check failed");
    }

    try {
      checks.redis = (await app.redis.ping()) === "PONG";
    } catch (error) {
      app.log.warn({ error }, "Redis readiness check failed");
    }

    const ready = checks.database && checks.redis && checks.providers.ready;

    if (!ready) {
      reply.status(503);
}

function providerReadiness(app: Parameters<FastifyPluginCallback>[0]): {
  readonly ready: boolean;
  readonly required: readonly string[];
  readonly configured: readonly string[];
} {
  const required =
    app.config.NODE_ENV === "production"
      ? ["telephony:twilio", "llm:groq", "stt:groq", "tts:groq"]
      : ["telephony:twilio"];
  const configured = app.providers
    .list()
    .map((provider) => `${provider.providerKind}:${provider.providerName}`);
  const configuredSet = new Set(configured);

  return {
    ready: required.every((provider) => configuredSet.has(provider)),
    required,
    configured
  };
}

    return {
      status: ready ? "ready" : "not_ready",
      checks
    };
  });

  done();
};
