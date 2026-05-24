"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, Headphones, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clientApi } from "@/lib/client-api";
import type { OperatorHandoff } from "@/lib/server-api";

const requestableStatuses = new Set([
  "connected",
  "listening",
  "processing",
  "responding",
  "transferring"
]);

interface CallHandoffActionsProps {
  readonly callId: string;
  readonly callStatus: string;
  readonly handoff?: OperatorHandoff;
  readonly size?: "sm" | "default";
}

export function CallHandoffActions({
  callId,
  callStatus,
  handoff,
  size = "sm"
}: CallHandoffActionsProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"request" | "accept" | "resolve" | null>(
    null
  );

  const canRequest = !handoff && requestableStatuses.has(callStatus);

  async function postAction(
    action: "request" | "accept" | "resolve",
    body: Record<string, unknown> = {}
  ) {
    setError(null);
    setPendingAction(action);

    try {
      await clientApi(`/calls/${callId}/handoff/${action}`, {
        method: "POST",
        body: JSON.stringify(body)
      });
      router.refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Handoff update failed");
    } finally {
      setPendingAction(null);
    }
  }

  async function requestHandoff() {
    const reason = window.prompt("Reason for operator handoff");

    if (reason === null) {
      return;
    }

    await postAction("request", reason?.trim() ? { reason: reason.trim() } : {});
  }

  async function resolveHandoff() {
    const notes = window.prompt("Resolution notes");

    if (notes === null) {
      return;
    }

    await postAction("resolve", notes?.trim() ? { notes: notes.trim() } : {});
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {canRequest ? (
          <Button
            type="button"
            size={size}
            variant="outline"
            onClick={() => {
              void requestHandoff();
            }}
            disabled={pendingAction !== null}
          >
            <Headphones className="h-3.5 w-3.5" aria-hidden="true" />
            {pendingAction === "request" ? "Requesting" : "Request handoff"}
          </Button>
        ) : null}

        {handoff?.status === "requested" ? (
          <Button
            type="button"
            size={size}
            variant="outline"
            onClick={() => {
              void postAction("accept");
            }}
            disabled={pendingAction !== null}
          >
            <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {pendingAction === "accept" ? "Accepting" : "Accept"}
          </Button>
        ) : null}

        {handoff && handoff.status !== "resolved" ? (
          <Button
            type="button"
            size={size}
            variant="outline"
            onClick={() => {
              void resolveHandoff();
            }}
            disabled={pendingAction !== null}
          >
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            {pendingAction === "resolve" ? "Resolving" : "Resolve"}
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
