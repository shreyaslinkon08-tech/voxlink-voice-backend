import { CallStatus, OperatorHandoffStatus, type Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { AppError } from "../../errors/app-error.js";
import { assertCallStatusUpdate } from "./call-state.js";

export const openOperatorHandoffStatuses = [
  OperatorHandoffStatus.requested,
  OperatorHandoffStatus.accepted
] as const;

export const operatorHandoffSelect = {
  id: true,
  status: true,
  reason: true,
  notes: true,
  requestedAt: true,
  acceptedAt: true,
  resolvedAt: true,
  requestedBy: {
    select: {
      id: true,
      name: true,
      email: true
    }
  },
  acceptedBy: {
    select: {
      id: true,
      name: true,
      email: true
    }
  },
  resolvedBy: {
    select: {
      id: true,
      name: true,
      email: true
    }
  }
} satisfies Prisma.OperatorHandoffSelect;

export const operatorHandoffListSelect = {
  ...operatorHandoffSelect,
  call: {
    select: {
      id: true,
      providerCallId: true,
      fromNumber: true,
      toNumber: true,
      status: true,
      startedAt: true,
      createdAt: true,
      aiAgent: {
        select: {
          id: true,
          name: true
        }
      },
      phoneNumber: {
        select: {
          id: true,
          e164: true,
          label: true
        }
      }
    }
  }
} satisfies Prisma.OperatorHandoffSelect;

type OperatorHandoffPayload = Prisma.OperatorHandoffGetPayload<{
  select: typeof operatorHandoffSelect;
}>;

type OperatorHandoffListPayload = Prisma.OperatorHandoffGetPayload<{
  select: typeof operatorHandoffListSelect;
}>;

export interface RequestOperatorHandoffInput {
  readonly companyId: string;
  readonly callId: string;
  readonly userId: string;
  readonly reason?: string;
}

export interface AcceptOperatorHandoffInput {
  readonly companyId: string;
  readonly callId: string;
  readonly userId: string;
  readonly notes?: string;
}

export interface ResolveOperatorHandoffInput {
  readonly companyId: string;
  readonly callId: string;
  readonly userId: string;
  readonly notes?: string;
}

export async function listOpenOperatorHandoffs(
  app: FastifyInstance,
  companyId: string
): Promise<readonly OperatorHandoffListPayload[]> {
  return app.prisma.operatorHandoff.findMany({
    where: {
      companyId,
      status: { in: [...openOperatorHandoffStatuses] }
    },
    orderBy: [{ status: "asc" }, { requestedAt: "asc" }],
    select: operatorHandoffListSelect
  });
}

export async function requestOperatorHandoff(
  app: FastifyInstance,
  input: RequestOperatorHandoffInput
): Promise<OperatorHandoffPayload> {
  return app.prisma.$transaction(async (tx) => {
    const call = await tx.call.findFirst({
      where: { id: input.callId, companyId: input.companyId },
      select: { id: true, status: true }
    });

    if (!call) {
      throw AppError.notFound("Call not found");
    }

    if (!canRequestOperatorHandoff(call.status)) {
      throw AppError.badRequest(`Call status ${call.status} cannot request operator handoff`);
    }

    const openHandoff = await tx.operatorHandoff.findFirst({
      where: {
        callId: call.id,
        companyId: input.companyId,
        status: { in: [...openOperatorHandoffStatuses] }
      },
      select: { id: true }
    });

    if (openHandoff) {
      throw AppError.conflict("Call already has an open operator handoff");
    }

    if (call.status !== CallStatus.transferring) {
      assertCallStatusUpdate(call.status, CallStatus.transferring);
      await tx.call.update({
        where: { id: call.id },
        data: { status: CallStatus.transferring }
      });
    }

    return tx.operatorHandoff.create({
      data: {
        companyId: input.companyId,
        callId: call.id,
        status: OperatorHandoffStatus.requested,
        reason: input.reason,
        requestedByUserId: input.userId
      },
      select: operatorHandoffSelect
    });
  });
}

export async function acceptOperatorHandoff(
  app: FastifyInstance,
  input: AcceptOperatorHandoffInput
): Promise<OperatorHandoffPayload> {
  return app.prisma.$transaction(async (tx) => {
    const handoff = await tx.operatorHandoff.findFirst({
      where: {
        callId: input.callId,
        companyId: input.companyId,
        status: OperatorHandoffStatus.requested
      },
      select: {
        id: true,
        call: {
          select: {
            status: true
          }
        }
      },
      orderBy: { requestedAt: "desc" }
    });

    if (!handoff) {
      throw AppError.notFound("No requested operator handoff is open for this call");
    }

    if (handoff.call.status === CallStatus.ended || handoff.call.status === CallStatus.failed) {
      throw AppError.badRequest("Cannot accept handoff for a terminal call");
    }

    return tx.operatorHandoff.update({
      where: { id: handoff.id },
      data: {
        status: OperatorHandoffStatus.accepted,
        acceptedByUserId: input.userId,
        acceptedAt: new Date(),
        notes: input.notes
      },
      select: operatorHandoffSelect
    });
  });
}

export async function resolveOperatorHandoff(
  app: FastifyInstance,
  input: ResolveOperatorHandoffInput
): Promise<OperatorHandoffPayload> {
  return app.prisma.$transaction(async (tx) => {
    const handoff = await tx.operatorHandoff.findFirst({
      where: {
        callId: input.callId,
        companyId: input.companyId,
        status: { in: [...openOperatorHandoffStatuses] }
      },
      select: {
        id: true,
        notes: true,
        call: {
          select: {
            id: true,
            status: true
          }
        }
      },
      orderBy: { requestedAt: "desc" }
    });

    if (!handoff) {
      throw AppError.notFound("No open operator handoff exists for this call");
    }

    if (handoff.call.status !== CallStatus.ended && handoff.call.status !== CallStatus.failed) {
      assertCallStatusUpdate(handoff.call.status, CallStatus.ended);
      await tx.call.update({
        where: { id: handoff.call.id },
        data: {
          status: CallStatus.ended,
          endedAt: new Date()
        }
      });
    }

    return tx.operatorHandoff.update({
      where: { id: handoff.id },
      data: {
        status: OperatorHandoffStatus.resolved,
        resolvedByUserId: input.userId,
        resolvedAt: new Date(),
        notes: input.notes ?? handoff.notes
      },
      select: operatorHandoffSelect
    });
  });
}

export function canRequestOperatorHandoff(status: CallStatus): boolean {
  switch (status) {
    case CallStatus.connected:
    case CallStatus.listening:
    case CallStatus.processing:
    case CallStatus.responding:
    case CallStatus.transferring:
      return true;
    case CallStatus.initiated:
    case CallStatus.ringing:
    case CallStatus.ended:
    case CallStatus.failed:
      return false;
  }
}
