"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { clientApi } from "@/lib/client-api";

interface AgentOption {
  readonly id: string;
  readonly name: string;
}

interface CreatePhoneNumberFormProps {
  readonly agents: readonly AgentOption[];
}

export function CreatePhoneNumberForm({ agents }: CreatePhoneNumberFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const form = new FormData(event.currentTarget);
    const aiAgentId = formValueAsString(form.get("aiAgentId"));
    const provider = formValueAsString(form.get("provider")) || "plivo";

    try {
      await clientApi("/phone-numbers", {
        method: "POST",
        body: JSON.stringify({
          e164: form.get("e164"),
          label: form.get("label") || undefined,
          provider,
          aiAgentId: aiAgentId || undefined,
          providerNumberSid: form.get("providerNumberSid") || undefined,
          status: "active"
        })
      });
      event.currentTarget.reset();
      router.refresh();
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Phone number assignment failed"
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3">
        <Phone className="h-5 w-5 text-[var(--muted-foreground)]" aria-hidden="true" />
        <CardTitle>Link Existing Voice Number</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 lg:grid-cols-[0.75fr_1fr_1fr_1fr_1fr_auto]"
          onSubmit={(event) => {
            void onSubmit(event);
          }}
        >
          <select
            name="provider"
            className="h-9 rounded-md border border-[var(--border)] bg-transparent px-3 text-sm"
            defaultValue="plivo"
          >
            <option value="plivo">Plivo India</option>
            <option value="twilio">Twilio</option>
          </select>
          <Input name="e164" placeholder="+15551234567" required />
          <Input name="label" placeholder="Main line" />
          <Input name="providerNumberSid" placeholder="Provider number ID" />
          <select
            name="aiAgentId"
            className="h-9 rounded-md border border-[var(--border)] bg-transparent px-3 text-sm"
            defaultValue=""
          >
            <option value="">No agent</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
          <div className="flex items-start lg:justify-end">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Assigning" : "Assign"}
            </Button>
          </div>
          {error ? <p className="text-sm text-red-600 lg:col-span-6">{error}</p> : null}
        </form>
      </CardContent>
    </Card>
  );
}

function formValueAsString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}
