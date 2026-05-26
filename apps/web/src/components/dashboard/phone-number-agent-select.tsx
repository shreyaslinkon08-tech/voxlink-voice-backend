"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clientApi } from "@/lib/client-api";

interface AgentOption {
  readonly id: string;
  readonly name: string;
}

interface PhoneNumberAgentSelectProps {
  readonly phoneNumberId: string;
  readonly currentAgentId: string | null;
  readonly agents: readonly AgentOption[];
  readonly isReleased: boolean;
}

export function PhoneNumberAgentSelect({
  phoneNumberId,
  currentAgentId,
  agents,
  isReleased
}: PhoneNumberAgentSelectProps) {
  const router = useRouter();
  const [selectedAgentId, setSelectedAgentId] = useState(currentAgentId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const hasChanged = selectedAgentId !== (currentAgentId ?? "");

  async function saveAgent() {
    setError(null);
    setIsSaving(true);

    try {
      await clientApi(`/phone-numbers/${phoneNumberId}`, {
        method: "PATCH",
        body: JSON.stringify({
          aiAgentId: selectedAgentId || null
        })
      });
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Agent assignment failed");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-[var(--muted-foreground)]">Agent</p>
      <div className="flex gap-2">
        <select
          className="h-9 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-transparent px-2 text-sm font-medium"
          value={selectedAgentId}
          disabled={isReleased || isSaving}
          onChange={(event) => {
            setSelectedAgentId(event.target.value);
          }}
        >
          <option value="">Unassigned</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isReleased || isSaving || !hasChanged}
          onClick={() => {
            void saveAgent();
          }}
          title="Save agent routing"
        >
          <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
          {isSaving ? "Saving" : "Save"}
        </Button>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
