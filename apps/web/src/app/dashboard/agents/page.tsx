import Link from "next/link";
import { Bot, Phone } from "lucide-react";
import { CreateAgentForm } from "@/components/dashboard/create-agent-form";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { EmptyPanel } from "@/components/dashboard/empty-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAgents } from "@/lib/server-api";
import { formatDateTime } from "@/lib/format";

export default async function AgentsPage() {
  const { agents, total } = await getAgents();

  return (
    <div className="space-y-5">
      <section className="border-b border-[var(--border)] pb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">AI Agents</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {total} tenant-scoped assistant{total === 1 ? "" : "s"} configured.
          </p>
        </div>
      </section>

      <CreateAgentForm />

      {agents.length === 0 ? (
        <EmptyPanel title="No AI agents configured" actionLabel="Create agent" icon={Bot} />
      ) : (
        <section className="grid gap-4 xl:grid-cols-2">
          {agents.map((agent) => (
            <Card key={agent.id}>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div className="space-y-2">
                  <CardTitle className="text-base">{agent.name}</CardTitle>
                  <StatusBadge status={agent.status} />
                </div>
                <Badge variant="secondary">{agent._count.calls} calls</Badge>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <p className="line-clamp-3 text-[var(--muted-foreground)]">{agent.systemPrompt}</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-[var(--muted-foreground)]">Numbers</p>
                    <p className="mt-1 flex items-center gap-1 font-medium">
                      <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                      {agent._count.phoneNumbers}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--muted-foreground)]">Created</p>
                    <p className="mt-1 font-medium">{formatDateTime(agent.createdAt)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--muted-foreground)]">Updated</p>
                    <p className="mt-1 font-medium">{formatDateTime(agent.updatedAt)}</p>
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/dashboard/agents/${agent.id}`}>Configure</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}
