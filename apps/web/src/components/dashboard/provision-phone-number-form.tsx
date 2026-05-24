"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { Loader2, PhoneForwarded, Search, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { clientApi } from "@/lib/client-api";

interface AgentOption {
  readonly id: string;
  readonly name: string;
}

interface AvailablePhoneNumber {
  readonly e164: string;
  readonly friendlyName?: string;
  readonly locality?: string;
  readonly region?: string;
  readonly countryCode?: string;
  readonly capabilities: {
    readonly voice: boolean;
    readonly sms: boolean;
    readonly mms: boolean;
  };
}

interface AvailablePhoneNumbersResponse {
  readonly phoneNumbers: readonly AvailablePhoneNumber[];
}

interface ProvisionPhoneNumberFormProps {
  readonly agents: readonly AgentOption[];
}

export function ProvisionPhoneNumberForm({ agents }: ProvisionPhoneNumberFormProps) {
  const router = useRouter();
  const [numbers, setNumbers] = useState<readonly AvailablePhoneNumber[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [provisioningE164, setProvisioningE164] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState("");

  async function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSearching(true);

    const form = new FormData(event.currentTarget);
    const searchParams = new URLSearchParams();
    searchParams.set("countryCode", formValueAsString(form.get("countryCode")) || "US");
    searchParams.set("limit", formValueAsString(form.get("limit")) || "10");
    appendOptional(searchParams, "areaCode", form.get("areaCode"));
    appendOptional(searchParams, "contains", form.get("contains"));

    try {
      const response = await clientApi<AvailablePhoneNumbersResponse>(
        `/phone-numbers/available?${searchParams.toString()}`
      );
      setNumbers(response.phoneNumbers);
    } catch (searchError) {
      setError(
        searchError instanceof Error ? searchError.message : "Available number search failed"
      );
    } finally {
      setIsSearching(false);
    }
  }

  async function provision(number: AvailablePhoneNumber) {
    setError(null);
    setProvisioningE164(number.e164);

    try {
      await clientApi("/phone-numbers/provision", {
        method: "POST",
        body: JSON.stringify({
          e164: number.e164,
          label: number.friendlyName ?? "Twilio voice number",
          aiAgentId: selectedAgentId || undefined
        })
      });
      setNumbers((current) => current.filter((candidate) => candidate.e164 !== number.e164));
      router.refresh();
    } catch (provisionError) {
      setError(
        provisionError instanceof Error ? provisionError.message : "Phone number provisioning failed"
      );
    } finally {
      setProvisioningE164(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3">
        <PhoneForwarded className="h-5 w-5 text-[var(--muted-foreground)]" aria-hidden="true" />
        <CardTitle>Buy Twilio Number</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="grid gap-3 lg:grid-cols-[0.65fr_0.8fr_1fr_0.7fr_1.2fr_auto]"
          onSubmit={(event) => {
            void onSearch(event);
          }}
        >
          <Input name="countryCode" placeholder="US" defaultValue="US" maxLength={2} required />
          <Input name="areaCode" placeholder="Area code" inputMode="numeric" />
          <Input name="contains" placeholder="Contains digits" />
          <Input name="limit" placeholder="10" defaultValue="10" inputMode="numeric" />
          <select
            className="h-9 rounded-md border border-[var(--border)] bg-transparent px-3 text-sm"
            value={selectedAgentId}
            onChange={(event) => setSelectedAgentId(event.target.value)}
          >
            <option value="">No agent</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
          <Button type="submit" disabled={isSearching}>
            {isSearching ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Search className="h-4 w-4" aria-hidden="true" />
            )}
            Search
          </Button>
        </form>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        {numbers.length > 0 ? (
          <div className="divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
            {numbers.map((number) => (
              <div
                key={number.e164}
                className="grid gap-3 p-3 text-sm md:grid-cols-[1.2fr_1fr_1fr_auto] md:items-center"
              >
                <div>
                  <p className="font-semibold">{number.e164}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {number.friendlyName ?? "Twilio available number"}
                  </p>
                </div>
                <p className="text-[var(--muted-foreground)]">
                  {[number.locality, number.region, number.countryCode].filter(Boolean).join(", ")}
                </p>
                <p className="text-[var(--muted-foreground)]">
                  Voice {number.capabilities.voice ? "ready" : "unavailable"}
                  {number.capabilities.sms ? " / SMS" : ""}
                </p>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    void provision(number);
                  }}
                  disabled={provisioningE164 !== null}
                >
                  {provisioningE164 === number.e164 ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <ShoppingCart className="h-4 w-4" aria-hidden="true" />
                  )}
                  Buy
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function appendOptional(
  searchParams: URLSearchParams,
  key: string,
  value: FormDataEntryValue | null
): void {
  const text = formValueAsString(value);

  if (text) {
    searchParams.set(key, text);
  }
}

function formValueAsString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}
