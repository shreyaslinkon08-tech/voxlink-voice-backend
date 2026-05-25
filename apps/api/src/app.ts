import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import type { AppConfig } from "./config/env.js";
import { registerErrorHandler } from "./plugins/errors.js";
import { prismaPlugin } from "./plugins/prisma.js";
import { redisPlugin } from "./plugins/redis.js";
import { emailPlugin } from "./plugins/email.js";
import { authPlugin } from "./plugins/auth.js";
import { auditPlugin } from "./plugins/audit.js";
import { providersPlugin } from "./plugins/providers.js";
import { voicePipelinePlugin } from "./plugins/voice-pipeline.js";
import { healthRoutes } from "./routes/health.js";
import { adminRoutes } from "./modules/admin/admin.routes.js";
import { auditRoutes } from "./modules/audit/audit.routes.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { agentRoutes } from "./modules/agents/agent.routes.js";
import { billingRoutes } from "./modules/billing/billing.routes.js";
import { callRoutes } from "./modules/calls/call.routes.js";
import { companyRoutes } from "./modules/company/company.routes.js";
import { dashboardRoutes } from "./modules/dashboard/dashboard.routes.js";
import { knowledgeBaseRoutes } from "./modules/knowledge-base/knowledge-base.routes.js";
import { phoneNumberRoutes } from "./modules/phone-numbers/phone-number.routes.js";
import { providerRoutes } from "./modules/providers/provider.routes.js";
import { stripeWebhookRoutes } from "./modules/webhooks/stripe.routes.js";
import { twilioWebhookRoutes } from "./modules/webhooks/twilio.routes.js";

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: config.TRUST_PROXY,
    logger: {
      level: config.LOG_LEVEL,
      redact: {
        censor: "[redacted]",
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.headers['x-twilio-signature']",
          "req.headers['i-twilio-idempotency-token']",
          "req.headers['stripe-signature']",
          "headers.authorization",
          "headers.cookie",
          "headers['x-twilio-signature']",
          "headers['stripe-signature']",
          "body.password",
          "body.newPassword",
          "body.currentPassword",
          "body.token",
          "body.accessToken",
          "body.refreshToken",
          "body.stripeSecretKey",
          "body.stripeWebhookSecret",
          "*.password",
          "*.passwordHash",
          "*.tokenHash",
          "*.stripeSecretKey",
          "*.stripeWebhookSecret",
          "*.authorization",
          "*.cookie"
        ]
      }
    },
    genReqId: (request) => {
      const requestId = request.headers["x-request-id"];
      return Array.isArray(requestId)
        ? (requestId[0] ?? crypto.randomUUID())
        : (requestId ?? crypto.randomUUID());
    }
  });

  app.decorate("config", config);

  registerErrorHandler(app);

  await app.register(helmet);
  await app.register(cors, {
    credentials: true,
    origin: config.WEB_ORIGIN
  });
  await app.register(cookie, {
    secret: config.COOKIE_SECRET
  });
  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024,
      files: 1,
      fields: 3,
      parts: 4
    }
  });
  await app.register(websocket, {
    options: {
      maxPayload: 1024 * 1024
    }
  });
  await app.register(prismaPlugin);
  await app.register(redisPlugin);
  await app.register(emailPlugin);
  await app.register(providersPlugin);
  await app.register(voicePipelinePlugin);
  await app.register(authPlugin);
  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW,
    redis: app.redis,
    skipOnError: true
  });
  await app.register(auditPlugin);
  await app.register(healthRoutes);
  await app.register(adminRoutes, { prefix: "/admin" });
  await app.register(auditRoutes, { prefix: "/audit-events" });
  await app.register(authRoutes, { prefix: "/auth" });
  await app.register(agentRoutes, { prefix: "/agents" });
  await app.register(billingRoutes, { prefix: "/billing" });
  await app.register(callRoutes, { prefix: "/calls" });
  await app.register(companyRoutes, { prefix: "/companies" });
  await app.register(dashboardRoutes, { prefix: "/dashboard" });
  await app.register(knowledgeBaseRoutes, { prefix: "/knowledge-base" });
  await app.register(phoneNumberRoutes, { prefix: "/phone-numbers" });
  await app.register(providerRoutes, { prefix: "/providers" });
  await app.register(stripeWebhookRoutes, { prefix: "/webhooks/stripe" });
  await app.register(twilioWebhookRoutes, { prefix: "/webhooks/twilio" });

  return app;
}
