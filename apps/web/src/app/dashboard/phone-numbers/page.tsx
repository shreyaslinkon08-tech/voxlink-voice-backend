import { Link2, Phone } from "lucide-react";
import { CreatePhoneNumberForm } from "@/components/dashboard/create-phone-number-form";
import { EmptyPanel } from "@/components/dashboard/empty-panel";
import { PhoneNumberActions } from "@/components/dashboard/phone-number-actions";
import { ProvisionPhoneNumberForm } from "@/components/dashboard/provision-phone-number-form";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAgents, getPhoneNumbers } from "@/lib/server-api";

export default async function PhoneNumbersPage() {
  const [{ phoneNumbers, total }, { agents }] = await Promise.all([getPhoneNumbers(), getAgents()]);

  return (
    <div className="space-y-5">
      <section className="border-b border-[var(--border)] pb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">Phone Numbers</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {total} Twilio number mapping{total === 1 ? "" : "s"} for this company.
          </p>
        </div>
      </section>

      <section className="grid gap-4">
        <ProvisionPhoneNumberForm agents={agents} />
        <CreatePhoneNumberForm agents={agents} />
      </section>

      {phoneNumbers.length === 0 ? (
        <EmptyPanel title="No phone numbers assigned" actionLabel="Assign number" icon={Phone} />
      ) : (
        <section className="grid gap-4 xl:grid-cols-2">
          {phoneNumbers.map((number) => (
            <Card key={number.id}>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{number.e164}</CardTitle>
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                    {number.label ?? "Unlabeled number"}
                  </p>
                </div>
                <StatusBadge status={number.status} />
              </CardHeader>
              <CardContent className="grid gap-4 text-sm sm:grid-cols-3">
                <div>
                  <p className="text-xs text-[var(--muted-foreground)]">Agent</p>
                  <p className="mt-1 flex items-center gap-1 font-medium">
                    <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                    {number.aiAgent?.name ?? "Unassigned"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--muted-foreground)]">Provider</p>
                  <p className="mt-1 font-medium">{number.provider}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--muted-foreground)]">Calls</p>
                  <p className="mt-1 font-medium">{number._count.calls}</p>
                </div>
                <div className="sm:col-span-3">
                  <PhoneNumberActions
                    phoneNumberId={number.id}
                    e164={number.e164}
                    canSyncRouting={Boolean(number.providerNumberSid)}
                    isReleased={number.status === "released"}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}
