import { CallStatus, OperatorHandoffStatus, UsageMetric } from "@prisma/client";
import type { FastifyPluginCallback } from "fastify";
import { requirePermission } from "../../security/rbac.js";
import { requireTenantContext } from "../../security/tenant-context.js";
import { currentMonthlyPeriod } from "../../utils/period.js";

const activeCallStatuses = [
  CallStatus.initiated,
  CallStatus.ringing,
  CallStatus.connected,
  CallStatus.listening,
  CallStatus.processing,
  CallStatus.responding,
  CallStatus.transferring
];

export const dashboardRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.get(
    "/summary",
    { preHandler: async (request) => app.authenticate(request) },
    async (request) => {
      requirePermission(request, "dashboard:read");
      const tenant = requireTenantContext(request);
      const { periodStart, periodEnd } = currentMonthlyPeriod();

      const [
        activeCalls,
        totalCalls,
        aiAgents,
        phoneNumbers,
        knowledgeItems,
        transcriptChunks,
        openHandoffs,
        requestedHandoffs,
        callMinutesUsage
      ] = await Promise.all([
        app.prisma.call.count({
          where: {
            companyId: tenant.companyId,
            status: { in: activeCallStatuses }
          }
        }),
        app.prisma.call.count({
          where: { companyId: tenant.companyId }
        }),
        app.prisma.aiAgent.count({
          where: { companyId: tenant.companyId }
        }),
        app.prisma.phoneNumber.count({
          where: { companyId: tenant.companyId }
        }),
        app.prisma.knowledgeBase.count({
          where: { companyId: tenant.companyId }
        }),
        app.prisma.transcriptChunk.count({
          where: { companyId: tenant.companyId }
        }),
        app.prisma.operatorHandoff.count({
          where: {
            companyId: tenant.companyId,
            status: { in: [OperatorHandoffStatus.requested, OperatorHandoffStatus.accepted] }
          }
        }),
        app.prisma.operatorHandoff.count({
          where: {
            companyId: tenant.companyId,
            status: OperatorHandoffStatus.requested
          }
        }),
        app.prisma.usageTracking.findUnique({
          where: {
            companyId_metric_periodStart_periodEnd: {
              companyId: tenant.companyId,
              metric: UsageMetric.call_minutes,
              periodStart,
              periodEnd
            }
          },
          select: { amount: true }
        })
      ]);

      return {
        summary: {
          activeCalls,
          totalCalls,
          aiAgents,
          phoneNumbers,
          knowledgeItems,
          transcriptChunks,
          openHandoffs,
          requestedHandoffs,
          callMinutes: callMinutesUsage?.amount.toString() ?? "0"
        }
      };
    }
  );

  done();
};
