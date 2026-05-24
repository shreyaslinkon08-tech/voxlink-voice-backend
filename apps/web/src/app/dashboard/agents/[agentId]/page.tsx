import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, Bot, Clock3, MessageSquareText, Phone, Settings2 } from "lucide-react";
import { EditAgentForm } from "@/components/dashboard/edit-agent-form";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { getAgent } from "@/lib/server-api";

interface AgentDetailPageProps {
  readonly params: Promise<{
    readonly agentId: string;
  }>;
}

export default async function AgentDetailPage({ params }: AgentDetailPageProps) {
  const { agentId } = await params;
  const { agent } = await getAgent(agentId);

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-3 border-b border-[var(--border)] pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
            <Link href="/dashboard/agents">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Agents
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-normal">{agent.name}</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Configure prompt, voice, hours, and escalation behavior.
          </p>
        </div>
        <StatusBadge status={agent.status} />
      </section>

      <section className="grid gap-4 xl:grid-cols-4">
        <SummaryCard icon={Phone} label="Phone numbers" value={agent._count.phoneNumbers.toString()} />
        <SummaryCard icon={MessageSquareText} label="Calls handled" value={agent._count.calls.toString()} />
        <SummaryCard icon={Clock3} label="Created" value={formatDateTime(agent.createdAt)} />
        <SummaryCard icon={Clock3} label="Updated" value={formatDateTime(agent.updatedAt)} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <EditAgentForm agent={agent} />

        <aside className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center gap-3">
              <Bot className="h-5 w-5 text-[var(--muted-foreground)]" aria-hidden="true" />
              <CardTitle>Prompt Preview</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="max-h-80 overflow-auto whitespace-pre-wrap text-sm leading-6 text-[var(--muted-foreground)]">
                {agent.systemPrompt}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center gap-3">
              <Settings2 className="h-5 w-5 text-[var(--muted-foreground)]" aria-hidden="true" />
              <CardTitle>Raw Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="max-h-96 overflow-auto rounded-md bg-slate-950 p-3 text-xs leading-5 text-slate-100">
                {safeJson({
                  voiceSettings: agent.voiceSettings,
                  businessHours: agent.businessHours,
                  escalationRules: agent.escalationRules
                })}
              </pre>
            </CardContent>
          </Card>
        </aside>
      </section>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value
}: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-4">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--muted-foreground)]" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
          <p className="mt-1 truncate text-sm font-medium">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function safeJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}
