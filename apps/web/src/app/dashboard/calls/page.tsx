import Link from "next/link";
import { Clock3, Headphones, Radio, Search } from "lucide-react";
import { CallHandoffActions } from "@/components/dashboard/call-handoff-actions";
import { EmptyPanel } from "@/components/dashboard/empty-panel";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getCalls } from "@/lib/server-api";
import { formatDateTime, formatDurationFromDates } from "@/lib/format";

const callStatusOptions = [
  "initiated",
  "ringing",
  "connected",
  "listening",
  "processing",
  "responding",
  "transferring",
  "ended",
  "failed"
] as const;

interface CallsPageProps {
  readonly searchParams?: Promise<{
    readonly status?: string;
    readonly search?: string;
  }>;
}

export default async function CallsPage({ searchParams }: CallsPageProps) {
  const filters = await searchParams;
  const status = normalizeStatus(filters?.status);
  const search = filters?.search?.trim();
  const { calls, total, activeCount } = await getCalls({ status, search });

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-3 border-b border-[var(--border)] pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">Call Logs</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {total} call{total === 1 ? "" : "s"} captured. {activeCount} active now.
          </p>
        </div>
        <Badge variant={activeCount > 0 ? "success" : "secondary"}>
          <Radio className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          {activeCount > 0 ? "Live traffic" : "Idle"}
        </Badge>
      </section>

      <form className="grid gap-3 rounded-lg border border-[var(--border)] bg-white p-3 lg:grid-cols-[1fr_14rem_auto_auto]">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--muted-foreground)]"
            aria-hidden="true"
          />
          <Input
            className="pl-9"
            name="search"
            placeholder="Search caller, number, provider ID"
            defaultValue={search}
          />
        </div>
        <select
          name="status"
          className="h-9 rounded-md border border-[var(--border)] bg-white px-3 text-sm"
          defaultValue={status ?? ""}
        >
          <option value="">All statuses</option>
          {callStatusOptions.map((option) => (
            <option key={option} value={option}>
              {option.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        <Button type="submit">Filter</Button>
        <Button asChild variant="outline">
          <Link href="/dashboard/calls">Clear</Link>
        </Button>
      </form>

      <section className="space-y-3">
        {calls.length === 0 ? (
          <EmptyPanel title="No matching calls" actionLabel="Clear filters" icon={Headphones} />
        ) : (
          calls.map((call) => {
            const openHandoff = call.operatorHandoffs[0];

            return (
              <Card key={call.id}>
                <CardHeader className="flex-row items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-base">
                        {call.fromNumber} to {call.toNumber}
                      </CardTitle>
                      {openHandoff ? (
                        <Badge variant="warning">handoff {openHandoff.status}</Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                      {call.aiAgent?.name ?? "No agent"} via {call.provider}
                    </p>
                  </div>
                  <StatusBadge status={call.status} />
                </CardHeader>
                <CardContent className="grid gap-3 text-sm md:grid-cols-[1fr_1fr_1fr_1fr_1fr_auto]">
                  <div>
                    <p className="text-xs text-[var(--muted-foreground)]">Started</p>
                    <p className="mt-1 flex items-center gap-1 font-medium">
                      <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                      {formatDateTime(call.startedAt ?? call.createdAt)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--muted-foreground)]">Duration</p>
                    <p className="mt-1 font-medium">
                      {formatDurationFromDates(call.startedAt, call.endedAt)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--muted-foreground)]">Transcript</p>
                    <p className="mt-1 font-medium">{call._count.transcriptChunks} chunks</p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--muted-foreground)]">Recordings</p>
                    <p className="mt-1 font-medium">{call._count.recordings} files</p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--muted-foreground)]">Provider Call ID</p>
                    <p className="mt-1 max-w-48 truncate font-mono text-xs">
                      {call.providerCallId}
                    </p>
                  </div>
                  <div className="flex items-end md:justify-end">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/dashboard/calls/${call.id}`}>Review</Link>
                    </Button>
                  </div>
                  <div className="md:col-span-6">
                    <CallHandoffActions
                      callId={call.id}
                      callStatus={call.status}
                      handoff={openHandoff}
                    />
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </section>
    </div>
  );
}

function normalizeStatus(value: string | undefined): string | undefined {
  return callStatusOptions.some((option) => option === value) ? value : undefined;
}
