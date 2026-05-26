import { Phone } from "lucide-react";
import { CreatePhoneNumberForm } from "@/components/dashboard/create-phone-number-form";
import { EmptyPanel } from "@/components/dashboard/empty-panel";
import { PhoneNumberAgentSelect } from "@/components/dashboard/phone-number-agent-select";
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
                <div className="sm:col-span-3 lg:col-span-1">
                  <PhoneNumberAgentSelect
                    phoneNumberId={number.id}
                    currentAgentId={number.aiAgent?.id ?? null}
                    agents={agents}
                    isReleased={number.status === "released"}
                  />
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
                    syncDisabledReason={syncRoutingDisabledReason(number)}
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

function syncRoutingDisabledReason(
  number: Awaited<ReturnType<typeof getPhoneNumbers>>["phoneNumbers"][number]
): string | undefined {
  if (!number.providerNumberSid) {
    return "Add the Twilio Incoming Phone Number SID before syncing routing.";
  }

  if (!number.aiAgent) {
    return "Assign an AI agent before syncing routing.";
  }

  return undefined;
}
