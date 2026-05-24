import Link from "next/link";
import { Building2, Search, Shield } from "lucide-react";
import { AdminCompanyActions } from "@/components/dashboard/admin-company-actions";
import { EmptyPanel } from "@/components/dashboard/empty-panel";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getAdminCompanies, getSession } from "@/lib/server-api";
import { formatDateTime } from "@/lib/format";

const companyStatusOptions = ["active", "suspended", "archived"] as const;

interface AdminPageProps {
  readonly searchParams?: Promise<{
    readonly status?: string;
    readonly search?: string;
  }>;
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const session = await getSession();

  if (session.role !== "super_admin") {
    return (
      <EmptyPanel title="Admin access required" actionLabel="Open dashboard" icon={Shield} />
    );
  }

  const filters = await searchParams;
  const status = normalizeStatus(filters?.status);
  const search = filters?.search?.trim();
  const { companies, total } = await getAdminCompanies({ status, search });

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-3 border-b border-[var(--border)] pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-normal">Platform Admin</h1>
            <Badge variant="outline">Super admin</Badge>
          </div>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {total} compan{total === 1 ? "y" : "ies"} available for operational management.
          </p>
        </div>
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
            placeholder="Search company or slug"
            defaultValue={search}
          />
        </div>
        <select
          name="status"
          className="h-9 rounded-md border border-[var(--border)] bg-white px-3 text-sm"
          defaultValue={status ?? ""}
        >
          <option value="">All statuses</option>
          {companyStatusOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <Button type="submit">Filter</Button>
        <Button asChild variant="outline">
          <Link href="/dashboard/admin">Clear</Link>
        </Button>
      </form>

      <section className="space-y-3">
        {companies.length === 0 ? (
          <EmptyPanel title="No matching companies" actionLabel="Clear filters" icon={Building2} />
        ) : (
          companies.map((company) => {
            const subscription = company.subscriptions[0];

            return (
              <Card key={company.id}>
                <CardHeader className="flex-row items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{company.name}</CardTitle>
                    <p className="mt-1 font-mono text-xs text-[var(--muted-foreground)]">
                      {company.slug}
                    </p>
                  </div>
                  <StatusBadge status={company.status} />
                </CardHeader>
                <CardContent className="grid gap-4 text-sm xl:grid-cols-[1fr_1fr_1.4fr]">
                  <div className="grid gap-2">
                    <DetailRow label="Created" value={formatDateTime(company.createdAt)} />
                    <DetailRow label="Members" value={company._count.memberships.toString()} />
                    <DetailRow label="Calls" value={company._count.calls.toString()} />
                  </div>
                  <div className="grid gap-2">
                    <DetailRow label="Agents" value={company._count.aiAgents.toString()} />
                    <DetailRow label="Numbers" value={company._count.phoneNumbers.toString()} />
                    <DetailRow label="Knowledge" value={company._count.knowledgeBase.toString()} />
                  </div>
                  <AdminCompanyActions
                    companyId={company.id}
                    companyStatus={company.status}
                    planCode={subscription?.planCode ?? "starter"}
                    subscriptionStatus={subscription?.status ?? "trialing"}
                  />
                </CardContent>
              </Card>
            );
          })
        )}
      </section>
    </div>
  );
}

function DetailRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[var(--muted-foreground)]">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function normalizeStatus(value: string | undefined): string | undefined {
  return companyStatusOptions.some((option) => option === value) ? value : undefined;
}
