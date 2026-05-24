"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Ban, CheckCircle2, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clientApi } from "@/lib/client-api";

const companyStatusOptions = ["active", "suspended", "archived"] as const;
const planOptions = ["starter", "growth", "scale"] as const;
const subscriptionStatusOptions = ["trialing", "active", "past_due", "canceled"] as const;

interface AdminCompanyActionsProps {
  readonly companyId: string;
  readonly companyStatus: string;
  readonly planCode: string;
  readonly subscriptionStatus: string;
}

export function AdminCompanyActions({
  companyId,
  companyStatus,
  planCode,
  subscriptionStatus
}: AdminCompanyActionsProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState(companyStatus);
  const [plan, setPlan] = useState(planCode);
  const [subStatus, setSubStatus] = useState(subscriptionStatus);
  const [pendingAction, setPendingAction] = useState<"status" | "subscription" | null>(null);

  async function updateStatus(nextStatus: string) {
    setError(null);
    setPendingAction("status");

    try {
      await clientApi(`/admin/companies/${companyId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus })
      });
      setStatus(nextStatus);
      router.refresh();
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "Company status update failed");
    } finally {
      setPendingAction(null);
    }
  }

  async function updateSubscription() {
    setError(null);
    setPendingAction("subscription");

    try {
      await clientApi(`/admin/companies/${companyId}/subscription`, {
        method: "PATCH",
        body: JSON.stringify({
          planCode: plan,
          status: subStatus
        })
      });
      router.refresh();
    } catch (subscriptionError) {
      setError(
        subscriptionError instanceof Error
          ? subscriptionError.message
          : "Subscription update failed"
      );
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={status}
          onChange={(event) => {
            void updateStatus(event.target.value);
          }}
          disabled={pendingAction !== null}
          className="h-9 rounded-md border border-[var(--border)] bg-white px-3 text-sm"
        >
          {companyStatusOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            void updateStatus(status === "active" ? "suspended" : "active");
          }}
          disabled={pendingAction !== null}
        >
          {status === "active" ? (
            <Ban className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {status === "active" ? "Suspend" : "Activate"}
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <select
          value={plan}
          onChange={(event) => setPlan(event.target.value)}
          className="h-9 rounded-md border border-[var(--border)] bg-white px-3 text-sm"
        >
          {planOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <select
          value={subStatus}
          onChange={(event) => setSubStatus(event.target.value)}
          className="h-9 rounded-md border border-[var(--border)] bg-white px-3 text-sm"
        >
          {subscriptionStatusOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            void updateSubscription();
          }}
          disabled={pendingAction !== null}
        >
          <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
          {pendingAction === "subscription" ? "Saving" : "Save plan"}
        </Button>
      </div>

      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
