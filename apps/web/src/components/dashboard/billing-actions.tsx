"use client";

import { useState } from "react";
import { CreditCard, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clientApi } from "@/lib/client-api";

interface BillingActionsProps {
  readonly currentPlanCode: string;
  readonly canManageBilling: boolean;
  readonly hasStripeCustomer: boolean;
}

interface BillingSessionResponse {
  readonly url: string;
}

const paidPlans = [
  { code: "starter", label: "Starter" },
  { code: "growth", label: "Growth" }
] as const;

export function BillingActions({
  currentPlanCode,
  canManageBilling,
  hasStripeCustomer
}: BillingActionsProps) {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function openCheckout(planCode: string) {
    setError(null);
    setLoadingAction(planCode);

    try {
      const response = await clientApi<BillingSessionResponse>("/billing/checkout-session", {
        method: "POST",
        body: JSON.stringify({ planCode })
      });
      window.location.assign(response.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start checkout");
      setLoadingAction(null);
    }
  }

  async function openPortal() {
    setError(null);
    setLoadingAction("portal");

    try {
      const response = await clientApi<BillingSessionResponse>("/billing/portal-session", {
        method: "POST"
      });
      window.location.assign(response.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open billing portal");
      setLoadingAction(null);
    }
  }

  if (!canManageBilling) {
    return null;
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {paidPlans.map((plan) => (
          <Button
            key={plan.code}
            type="button"
            variant={plan.code === currentPlanCode ? "secondary" : "default"}
            disabled={Boolean(loadingAction)}
            onClick={() => void openCheckout(plan.code)}
          >
            <CreditCard className="h-4 w-4" aria-hidden="true" />
            {loadingAction === plan.code
              ? "Opening"
              : plan.code === currentPlanCode
                ? `${plan.label} active`
                : `Choose ${plan.label}`}
          </Button>
        ))}
        {hasStripeCustomer ? (
          <Button
            type="button"
            variant="outline"
            disabled={Boolean(loadingAction)}
            onClick={() => void openPortal()}
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            {loadingAction === "portal" ? "Opening" : "Manage billing"}
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-sm text-[var(--destructive)]">{error}</p> : null}
    </div>
  );
}
