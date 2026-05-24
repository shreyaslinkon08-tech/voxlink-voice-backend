"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RefreshCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clientApi } from "@/lib/client-api";

interface PhoneNumberActionsProps {
  readonly phoneNumberId: string;
  readonly e164: string;
  readonly canSyncRouting: boolean;
  readonly isReleased: boolean;
}

export function PhoneNumberActions({
  phoneNumberId,
  e164,
  canSyncRouting,
  isReleased
}: PhoneNumberActionsProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"sync" | "release" | null>(null);

  async function syncRouting() {
    setError(null);
    setPendingAction("sync");

    try {
      await clientApi(`/phone-numbers/${phoneNumberId}/sync-routing`, { method: "POST" });
      router.refresh();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Routing sync failed");
    } finally {
      setPendingAction(null);
    }
  }

  async function releaseNumber() {
    if (!window.confirm(`Release ${e164} from Twilio and disable inbound routing?`)) {
      return;
    }

    setError(null);
    setPendingAction("release");

    try {
      await clientApi(`/phone-numbers/${phoneNumberId}/release`, { method: "POST" });
      router.refresh();
    } catch (releaseError) {
      setError(releaseError instanceof Error ? releaseError.message : "Phone number release failed");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            void syncRouting();
          }}
          disabled={!canSyncRouting || isReleased || pendingAction !== null}
          title={canSyncRouting ? "Sync Twilio webhook URLs" : "Twilio number SID is required"}
        >
          <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" />
          {pendingAction === "sync" ? "Syncing" : "Sync routing"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="border-red-200 text-red-700 hover:bg-red-50"
          onClick={() => {
            void releaseNumber();
          }}
          disabled={isReleased || pendingAction !== null}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          {pendingAction === "release" ? "Releasing" : "Release"}
        </Button>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
