import type { FastifyPluginCallback } from "fastify";
import { CallStatus, UsageMetric, type Prisma, type PrismaClient } from "@prisma/client";
import { AppError } from "../../errors/app-error.js";
import { requirePermission } from "../../security/rbac.js";
import { requireTenantContext } from "../../security/tenant-context.js";
import { assertAndIncrementUsage } from "../billing/usage-limits.js";
import {
  acceptCallHandoffSchema,
  createTranscriptChunkSchema,
  listCallsQuerySchema,
  requestCallHandoffSchema,
  resolveCallHandoffSchema,
  updateCallStatusSchema
} from "./call.schemas.js";
import { assertCallStatusUpdate } from "./call-state.js";
import {
  acceptOperatorHandoff,
  listOpenOperatorHandoffs,
  openOperatorHandoffStatuses,
  operatorHandoffSelect,
  requestOperatorHandoff,
  resolveOperatorHandoff
} from "./call-handoff.service.js";

const activeCallStatuses = [
  CallStatus.initiated,
  CallStatus.ringing,
  CallStatus.connected,
  CallStatus.listening,
  CallStatus.processing,
  CallStatus.responding,
  CallStatus.transferring
];

const callListSelect = {
  id: true,
  provider: true,
  providerCallId: true,
  fromNumber: true,
  toNumber: true,
  status: true,
  startedAt: true,
  endedAt: true,
  failureReason: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
  phoneNumber: {
    select: {
      id: true,
      e164: true,
      label: true
    }
  },
  aiAgent: {
    select: {
      id: true,
      name: true
    }
  },
  operatorHandoffs: {
    where: {
      status: { in: [...openOperatorHandoffStatuses] }
    },
    orderBy: { requestedAt: "desc" },
    take: 1,
    select: operatorHandoffSelect
  },
  recordings: {
    orderBy: { createdAt: "desc" },
    take: 3,
    select: {
      id: true,
      provider: true,
      providerRecordingId: true,
      status: true,
      recordingUrl: true,
      durationSeconds: true,
      channels: true,
      source: true,
      createdAt: true,
      updatedAt: true
    }
  },
  _count: {
    select: {
      transcriptChunks: true,
      recordings: true
    }
  }
} satisfies Prisma.CallSelect;

export const callRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.get("/", { preHandler: async (request) => app.authenticate(request) }, async (request) => {
    requirePermission(request, "call:read");
    const tenant = requireTenantContext(request);
    const query = listCallsQuerySchema.parse(request.query);
    const searchFilter = query.search
      ? {
          OR: [
            { fromNumber: { contains: query.search, mode: "insensitive" as const } },
            { toNumber: { contains: query.search, mode: "insensitive" as const } },
            { providerCallId: { contains: query.search, mode: "insensitive" as const } }
          ]
        }
      : {};
    const where = {
      companyId: tenant.companyId,
      ...(query.status ? { status: query.status } : {}),
      ...searchFilter
    } satisfies Prisma.CallWhereInput;

    const [calls, total, activeCount] = await Promise.all([
      app.prisma.call.findMany({
        where,
        orderBy: { createdAt: "desc" },
        select: callListSelect,
        take: query.limit,
        skip: query.offset
      }),
      app.prisma.call.count({ where }),
      app.prisma.call.count({
        where: {
          companyId: tenant.companyId,
          status: { in: activeCallStatuses }
        }
      })
    ]);

    return { calls, total, activeCount, limit: query.limit, offset: query.offset };
  });

  app.get(
    "/handoffs",
    { preHandler: async (request) => app.authenticate(request) },
    async (request) => {
      requirePermission(request, "call:read");
      const tenant = requireTenantContext(request);
      const handoffs = await listOpenOperatorHandoffs(app, tenant.companyId);

      return { handoffs };
    }
  );

  app.get(
    "/:callId",
    { preHandler: async (request) => app.authenticate(request) },
    async (request) => {
      requirePermission(request, "call:read");
      const tenant = requireTenantContext(request);
      const { callId } = request.params as { readonly callId: string };

      const call = await app.prisma.call.findFirst({
        where: { id: callId, companyId: tenant.companyId },
        select: {
          ...callListSelect,
          transcriptChunks: {
            orderBy: { sequence: "asc" },
            select: {
              id: true,
              sequence: true,
              speakerRole: true,
              text: true,
              startedAtMs: true,
              endedAtMs: true,
              confidence: true,
              metadata: true,
              createdAt: true
            }
          },
          recordings: {
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              provider: true,
              providerRecordingId: true,
              status: true,
              recordingUrl: true,
              durationSeconds: true,
              channels: true,
              source: true,
              metadata: true,
              createdAt: true,
              updatedAt: true
            }
          },
          operatorHandoffs: {
            orderBy: { requestedAt: "desc" },
            take: 10,
            select: operatorHandoffSelect
          }
        }
      });

      if (!call) {
        throw AppError.notFound("Call not found");
      }

      return { call };
    }
  );

  app.get(
    "/:callId/export",
    { preHandler: async (request) => app.authenticate(request) },
    async (request) => {
      requirePermission(request, "call:read");
      const tenant = requireTenantContext(request);
      const { callId } = request.params as { readonly callId: string };

      const call = await app.prisma.call.findFirst({
        where: { id: callId, companyId: tenant.companyId },
        select: {
          id: true,
          provider: true,
          providerCallId: true,
          fromNumber: true,
          toNumber: true,
          status: true,
          startedAt: true,
          endedAt: true,
          failureReason: true,
          metadata: true,
          createdAt: true,
          updatedAt: true,
          phoneNumber: {
            select: {
              e164: true,
              label: true
            }
          },
          aiAgent: {
            select: {
              id: true,
              name: true
            }
          },
          recordings: {
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              providerRecordingId: true,
              status: true,
              recordingUrl: true,
              durationSeconds: true,
              channels: true,
              source: true,
              createdAt: true
            }
          },
          transcriptChunks: {
            orderBy: { sequence: "asc" },
            select: {
              sequence: true,
              speakerRole: true,
              text: true,
              startedAtMs: true,
              endedAtMs: true,
              confidence: true,
              createdAt: true
            }
          }
        }
      });

      if (!call) {
        throw AppError.notFound("Call not found");
      }

      return {
        call,
        transcriptText: call.transcriptChunks
          .map((chunk) => `[${chunk.speakerRole}] ${chunk.text}`)
          .join("\n\n")
      };
    }
  );

  app.patch(
    "/:callId/status",
    { preHandler: async (request) => app.authenticate(request) },
    async (request) => {
      requirePermission(request, "call:write");
      const tenant = requireTenantContext(request);
      const { callId } = request.params as { readonly callId: string };
      const input = updateCallStatusSchema.parse(request.body);

      const call = await app.prisma.call.findFirst({
        where: { id: callId, companyId: tenant.companyId },
        select: { id: true, status: true }
      });

      if (!call) {
        throw AppError.notFound("Call not found");
      }

      assertCallStatusUpdate(call.status, input.status);

      const updated = await app.prisma.call.update({
        where: { id: callId },
        data: {
          status: input.status,
          failureReason: input.failureReason,
          endedAt: ["ended", "failed"].includes(input.status) ? new Date() : undefined
        },
        select: callListSelect
      });

      return { call: updated };
    }
  );

  app.post(
    "/:callId/handoff/request",
    { preHandler: async (request) => app.authenticate(request) },
    async (request, reply) => {
      requirePermission(request, "call:write");
      const tenant = requireTenantContext(request);
      const { callId } = request.params as { readonly callId: string };
      const input = requestCallHandoffSchema.parse(request.body);

      const handoff = await requestOperatorHandoff(app, {
        companyId: tenant.companyId,
        callId,
        userId: tenant.userId,
        reason: input.reason
      });

      reply.status(201);
      return { handoff };
    }
  );

  app.post(
    "/:callId/handoff/accept",
    { preHandler: async (request) => app.authenticate(request) },
    async (request) => {
      requirePermission(request, "call:write");
      const tenant = requireTenantContext(request);
      const { callId } = request.params as { readonly callId: string };
      const input = acceptCallHandoffSchema.parse(request.body);

      const handoff = await acceptOperatorHandoff(app, {
        companyId: tenant.companyId,
        callId,
        userId: tenant.userId,
        notes: input.notes
      });

      return { handoff };
    }
  );

  app.post(
    "/:callId/handoff/resolve",
    { preHandler: async (request) => app.authenticate(request) },
    async (request) => {
      requirePermission(request, "call:write");
      const tenant = requireTenantContext(request);
      const { callId } = request.params as { readonly callId: string };
      const input = resolveCallHandoffSchema.parse(request.body);

      const handoff = await resolveOperatorHandoff(app, {
        companyId: tenant.companyId,
        callId,
        userId: tenant.userId,
        notes: input.notes
      });

      return { handoff };
    }
  );

  app.post(
    "/:callId/transcript-chunks",
    { preHandler: async (request) => app.authenticate(request) },
    async (request, reply) => {
      requirePermission(request, "call:write");
      const tenant = requireTenantContext(request);
      const { callId } = request.params as { readonly callId: string };
      const input = createTranscriptChunkSchema.parse(request.body);

      const call = await app.prisma.call.findFirst({
        where: { id: callId, companyId: tenant.companyId },
        select: { id: true }
      });

      if (!call) {
        throw AppError.notFound("Call not found");
      }

      const transcriptChunk = await app.prisma.$transaction(async (tx) => {
        const nextSequence = await nextTranscriptSequence(tx, callId);
        const created = await tx.transcriptChunk.create({
          data: {
            companyId: tenant.companyId,
            callId,
            sequence: nextSequence,
            speakerRole: input.speakerRole,
            text: input.text,
            startedAtMs: input.startedAtMs,
            endedAtMs: input.endedAtMs,
            confidence: input.confidence,
            metadata: jsonObject(input.metadata)
          }
        });

        await assertAndIncrementUsage(tx, tenant.companyId, UsageMetric.transcript_chunks, 1);
        return created;
      });

      reply.status(201);
      return { transcriptChunk };
    }
  );

  done();
};

async function nextTranscriptSequence(
  tx: Prisma.TransactionClient | PrismaClient,
  callId: string
): Promise<number> {
  const latest = await tx.transcriptChunk.findFirst({
    where: { callId },
    orderBy: { sequence: "desc" },
    select: { sequence: true }
  });

  return (latest?.sequence ?? 0) + 1;
}

function jsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  return value as Prisma.InputJsonObject;
}
