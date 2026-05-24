import Link from "next/link";
import { FileClock, Search, ShieldCheck } from "lucide-react";
import { EmptyPanel } from "@/components/dashboard/empty-panel";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/format";
import { getAuditEvents, getSession } from "@/lib/server-api";

interface AuditPageProps {
  readonly searchParams?: Promise<{
    readonly companyId?: string;
    readonly resourceType?: string;
    readonly action?: string;
    readonly search?: string;
  }>;
}

export default async function AuditPage({ searchParams }: AuditPageProps) {
  const session = await getSession();

  if (session.role === "operator") {
    return (
      <EmptyPanel title="Audit access required" actionLabel="Open dashboard" icon={ShieldCheck} />
    );
  }

  const filters = await searchParams;
  const companyId = session.role === "super_admin" ? filters?.companyId?.trim() : undefined;
  const resourceType = filters?.resourceType?.trim();
  const action = filters?.action?.trim();
  const search = filters?.search?.trim();
  const { auditEvents, total } = await getAuditEvents({
    companyId,
    resourceType,
    action,
    search
  });

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-3 border-b border-[var(--border)] pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-normal">Audit Log</h1>
            <Badge variant="outline">{total} events</Badge>
          </div>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Security-relevant changes across API routes, tenants, and operators.
          </p>
        </div>
      </section>

      <form className="grid gap-3 rounded-lg border border-[var(--border)] bg-white p-3 xl:grid-cols-[1fr_12rem_12rem_13rem_auto_auto]">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--muted-foreground)]"
            aria-hidden="true"
          />
          <Input
            className="pl-9"
            name="search"
            placeholder="Search action, resource, or request"
            defaultValue={search}
          />
        </div>
        <Input name="resourceType" placeholder="Resource" defaultValue={resourceType} />
        <Input name="action" placeholder="Action" defaultValue={action} />
        {session.role === "super_admin" ? (
          <Input name="companyId" placeholder="Company ID or all" defaultValue={companyId} />
        ) : (
          <input type="hidden" name="companyId" value="" />
        )}
        <Button type="submit">Filter</Button>
        <Button asChild variant="outline">
          <Link href="/dashboard/audit">Clear</Link>
        </Button>
      </form>

      <section className="space-y-3">
        {auditEvents.length === 0 ? (
          <EmptyPanel title="No audit events found" actionLabel="Clear filters" icon={FileClock} />
        ) : (
          auditEvents.map((event) => (
            <Card key={event.id}>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="truncate text-base">{event.action}</CardTitle>
                  <p className="mt-1 font-mono text-xs text-[var(--muted-foreground)]">
                    {event.requestId ?? event.id}
                  </p>
                </div>
                <StatusBadge status={event.resourceType} />
              </CardHeader>
              <CardContent className="grid gap-4 text-sm lg:grid-cols-[1.1fr_1fr_1fr]">
                <div className="grid gap-2">
                  <DetailRow label="Created" value={formatDateTime(event.createdAt)} />
                  <DetailRow label="Resource ID" value={event.resourceId ?? "Not set"} />
                  <DetailRow label="IP" value={event.ipAddress ?? "Not captured"} />
                </div>
                <div className="grid gap-2">
                  <DetailRow label="Actor" value={event.actor?.email ?? "System"} />
                  <DetailRow label="Company" value={event.company?.name ?? "Platform"} />
                  <DetailRow label="Status" value={metadataStatus(event.metadata)} />
                </div>
                <div className="min-w-0 rounded-md bg-slate-50 p-3">
                  <p className="mb-2 text-xs font-medium uppercase tracking-normal text-[var(--muted-foreground)]">
                    User Agent
                  </p>
                  <p className="break-words font-mono text-xs text-slate-700">
                    {event.userAgent ?? "Not captured"}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </section>
    </div>
  );
}

function DetailRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[var(--muted-foreground)]">{label}</span>
      <span className="truncate text-right font-medium">{value}</span>
    </div>
  );
}

function metadataStatus(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object" || !("statusCode" in metadata)) {
    return "Not set";
  }

  const statusCode = (metadata as { readonly statusCode?: unknown }).statusCode;
  return typeof statusCode === "number" ? statusCode.toString() : "Not set";
}
