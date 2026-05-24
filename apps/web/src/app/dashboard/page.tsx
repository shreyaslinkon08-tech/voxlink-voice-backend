import Link from "next/link";
import { Bot, Clock3, Headphones, Phone, Radio, ShieldCheck, UserCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyPanel } from "@/components/dashboard/empty-panel";
import { MetricCard } from "@/components/dashboard/metric-card";
import { getCurrentCompany, getDashboardSummary, getOpenOperatorHandoffs } from "@/lib/server-api";
import { formatDateTime } from "@/lib/format";

export default async function DashboardPage() {
  const [{ company }, { summary }, { handoffs }] = await Promise.all([
    getCurrentCompany(),
    getDashboardSummary(),
    getOpenOperatorHandoffs()
  ]);
  const metrics = [
    {
      title: "Active Calls",
      value: summary.activeCalls.toString(),
      label: summary.activeCalls === 0 ? "Realtime idle" : "Live now",
      icon: Radio,
      tone: "default" as const
    },
    {
      title: "Call Minutes",
      value: summary.callMinutes,
      label: "Current period",
      icon: Clock3,
      tone: "default" as const
    },
    {
      title: "AI Agents",
      value: summary.aiAgents.toString(),
      label: summary.aiAgents === 0 ? "Needs setup" : "Configured",
      icon: Bot,
      tone: summary.aiAgents === 0 ? ("warning" as const) : ("success" as const)
    },
    {
      title: "Handoffs",
      value: summary.openHandoffs.toString(),
      label: summary.requestedHandoffs === 0 ? "Queue clear" : `${summary.requestedHandoffs} waiting`,
      icon: UserCheck,
      tone: summary.requestedHandoffs === 0 ? ("success" as const) : ("warning" as const)
    },
    {
      title: "Numbers",
      value: summary.phoneNumbers.toString(),
      label: summary.phoneNumbers === 0 ? "Unassigned" : "Assigned",
      icon: Phone,
      tone: summary.phoneNumbers === 0 ? ("warning" as const) : ("success" as const)
    }
  ];

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 border-b border-[var(--border)] pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-normal">Dashboard</h1>
            <Badge variant="outline">Foundation checkpoint</Badge>
          </div>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {company.name} is connected to authenticated, tenant-scoped data.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Review setup
          </Button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {metrics.map((metric) => (
          <MetricCard key={metric.title} {...metric} />
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        {handoffs.length === 0 ? (
          <EmptyPanel title="No operator handoffs" actionLabel="Open calls" icon={Headphones} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Operator Queue</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {handoffs.slice(0, 5).map((handoff) => (
                <div
                  key={handoff.id}
                  className="flex flex-col gap-3 rounded-md border border-[var(--border)] p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium">
                        {handoff.call.fromNumber} to {handoff.call.toNumber}
                      </p>
                      <Badge variant={handoff.status === "requested" ? "warning" : "success"}>
                        {handoff.status}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                      {handoff.call.aiAgent?.name ?? "No agent"} - {formatDateTime(handoff.requestedAt)}
                    </p>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/dashboard/calls/${handoff.call.id}`}>Review</Link>
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle>System Readiness</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--muted-foreground)]">Backend runtime</span>
              <Badge variant="success">Single API</Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--muted-foreground)]">Provider modules</span>
              <Badge variant="secondary">Internal</Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--muted-foreground)]">Auth</span>
              <Badge variant="success">Enabled</Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--muted-foreground)]">Transcript chunks</span>
              <Badge variant="secondary">{summary.transcriptChunks}</Badge>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
