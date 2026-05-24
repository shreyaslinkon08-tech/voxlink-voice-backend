import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import type { TenantContext } from "@voxlink/shared";
import type { AppConfig } from "../config/env.js";
import type { EmailJobPort } from "../jobs/email-job-port.js";
import type { AccessTokenPayload } from "../modules/auth/auth.types.js";
import type { RedisVoiceSessionStore } from "../modules/realtime/voice-session-store.js";
import type { VoicePipelineService } from "../modules/realtime/voice-pipeline.js";
import type { VoiceTurnService } from "../modules/realtime/voice-turn-service.js";
import type { ProviderRegistry } from "../providers/provider-registry.js";

declare module "fastify" {
  interface FastifyInstance {
    config: AppConfig;
    prisma: PrismaClient;
    redis: Redis;
    emailJobs: EmailJobPort;
    providers: ProviderRegistry;
    voiceSessions: RedisVoiceSessionStore;
    voiceTurns: VoiceTurnService;
    voicePipeline: VoicePipelineService;
    authenticate(request: FastifyRequest): Promise<void>;
  }

  interface FastifyRequest {
    tenantContext?: TenantContext;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AccessTokenPayload;
    user: AccessTokenPayload;
  }
}
