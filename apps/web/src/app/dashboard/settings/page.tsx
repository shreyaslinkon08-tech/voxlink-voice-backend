import { Activity, Building2, CreditCard, Gauge, ShieldCheck, Users } from "lucide-react";
import { BillingActions } from "@/components/dashboard/billing-actions";
import { InviteMemberForm } from "@/components/dashboard/invite-member-form";
import { MemberActions } from "@/components/dashboard/member-actions";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getBillingSummary,
  getCompanyTeam,
  getCurrentCompany,
  getProviderHealth,
  getSession
} from "@/lib/server-api";
import { formatDateTime } from "@/lib/format";

export default async function SettingsPage() {
  const [session, { company }, { providers }, { summary: billing }] = await Promise.all([
    getSession(),
    getCurrentCompany(),
    getProviderHealth(),
    getBillingSummary()
  ]);
  const canManageTeam = session.role === "company_admin" || session.role === "super_admin";
  const team = canManageTeam ? await getCompanyTeam() : null;

  return (
    <div className="space-y-5">
      <section className="border-b border-[var(--border)] pb-5">
        <h1 className="text-2xl font-semibold tracking-normal">Settings</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Company profile, provider health, and security posture.
        </p>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-center gap-3">
            <Building2 className="h-5 w-5 text-[var(--muted-foreground)]" aria-hidden="true" />
            <CardTitle>Company</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--muted-foreground)]">Name</span>
              <span className="font-medium">{company.name}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--muted-foreground)]">Slug</span>
              <span className="font-mono text-xs">{company.slug}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--muted-foreground)]">Status</span>
              <StatusBadge status={company.status} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-3">
            <CreditCard className="h-5 w-5 text-[var(--muted-foreground)]" aria-hidden="true" />
            <CardTitle>Subscription</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--muted-foreground)]">Plan</span>
              <span className="font-medium">{billing.plan.name}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--muted-foreground)]">Status</span>
              <StatusBadge status={billing.subscription?.status ?? "trialing"} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--muted-foreground)]">Price</span>
              <span className="font-medium">{formatPrice(billing.plan.monthlyPriceCents)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--muted-foreground)]">AI agents</span>
              <span className="font-medium">
                {formatLimit(billing.plan.resourceLimits.ai_agents)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--muted-foreground)]">Phone numbers</span>
              <span className="font-medium">
                {formatLimit(billing.plan.resourceLimits.phone_numbers)}
              </span>
            </div>
            <BillingActions
              currentPlanCode={billing.plan.code}
              canManageBilling={canManageTeam}
              hasStripeCustomer={Boolean(billing.subscription?.providerCustomerId)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-[var(--muted-foreground)]" aria-hidden="true" />
            <CardTitle>Security</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--muted-foreground)]">Tenant enforcement</span>
              <Badge variant="success">Enabled</Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--muted-foreground)]">Audit logging</span>
              <Badge variant="success">Automatic</Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--muted-foreground)]">Webhook verification</span>
              <Badge variant="success">Twilio signed</Badge>
            </div>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className="flex-row items-center gap-3">
          <Gauge className="h-5 w-5 text-[var(--muted-foreground)]" aria-hidden="true" />
          <CardTitle>Usage This Period</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {billing.usage.map((usage) => (
            <div key={usage.metric} className="rounded-md border border-[var(--border)] p-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">{formatMetricLabel(usage.metric)}</span>
                <Badge
                  variant={usage.isExceeded ? "warning" : usage.isNearLimit ? "warning" : "outline"}
                >
                  {formatUsageValue(usage.amount)} / {formatLimit(usage.limit)}
                </Badge>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--secondary)]">
                <div
                  className="h-full rounded-full bg-[var(--primary)]"
                  style={{ width: `${usage.percentUsed ?? 0}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                {usage.remaining === null
                  ? "Unlimited usage"
                  : `${formatUsageValue(usage.remaining)} remaining`}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      {team ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 text-[var(--muted-foreground)]" aria-hidden="true" />
              <CardTitle>Team Access</CardTitle>
            </div>
            <Badge variant="outline">{team.members.length} members</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <InviteMemberForm />

            <div className="grid gap-3">
              {team.members.map((member) => (
                <div
                  key={member.id}
                  className="grid gap-3 rounded-md border border-[var(--border)] p-3 lg:grid-cols-[1fr_18rem]"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{member.user.name}</p>
                      <StatusBadge status={member.role} />
                      {member.user.emailVerifiedAt ? (
                        <Badge variant="success">Verified</Badge>
                      ) : (
                        <Badge variant="warning">Unverified</Badge>
                      )}
                    </div>
                    <p className="mt-1 truncate text-sm text-[var(--muted-foreground)]">
                      {member.user.email}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                      Added {formatDateTime(member.createdAt)}
                    </p>
                  </div>
                  <MemberActions membershipId={member.id} role={member.role} />
                </div>
              ))}
            </div>

            {team.invitations.length ? (
              <div className="grid gap-2 border-t border-[var(--border)] pt-4">
                <p className="text-sm font-medium">Pending invitations</p>
                {team.invitations.map((invitation) => (
                  <div
                    key={invitation.id}
                    className="flex flex-col gap-1 rounded-md bg-slate-50 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-medium">{invitation.email}</p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        Expires {formatDateTime(invitation.expiresAt)}
                      </p>
                    </div>
                    <StatusBadge status={invitation.role} />
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex-row items-center gap-3">
          <Activity className="h-5 w-5 text-[var(--muted-foreground)]" aria-hidden="true" />
          <CardTitle>Provider Health</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {providers.length === 0 ? (
            <p className="text-[var(--muted-foreground)]">No external providers configured.</p>
          ) : (
            providers.map((provider) => (
              <div
                key={`${provider.providerKind}:${provider.providerName}`}
                className="grid gap-2 rounded-md border border-[var(--border)] p-3 sm:grid-cols-4"
              >
                <span className="font-medium">{provider.providerName}</span>
                <span className="text-[var(--muted-foreground)]">{provider.providerKind}</span>
                <StatusBadge status={provider.circuitState} />
                <span className="text-[var(--muted-foreground)]">
                  {provider.consecutiveFailures} failures
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatMetricLabel(metric: string): string {
  return metric
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatUsageValue(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatLimit(value: number | null): string {
  return value === null ? "Unlimited" : formatUsageValue(value);
}

function formatPrice(value: number | null): string {
  if (value === null) {
    return "Custom";
  }

  return `${new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value / 100)} / month`;
}
