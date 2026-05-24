"use client";

import { useRouter } from "next/navigation";
import type { FormEvent, ReactNode } from "react";
import { useState } from "react";
import { Bot, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { clientApi } from "@/lib/client-api";

interface EditableAgent {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly systemPrompt: string;
  readonly personality: string | null;
  readonly voiceSettings: unknown;
  readonly businessHours: unknown;
  readonly escalationRules: unknown;
}

interface EditAgentFormProps {
  readonly agent: EditableAgent;
}

export function EditAgentForm({ agent }: EditAgentFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const voiceSettings = objectRecord(agent.voiceSettings);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const form = new FormData(event.currentTarget);

    try {
      const businessHours = parseJsonObject(formValue(form.get("businessHours")), "Business hours");
      const escalationRules = parseJsonObject(
        formValue(form.get("escalationRules")),
        "Escalation rules"
      );

      await clientApi(`/agents/${agent.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: form.get("name"),
          status: form.get("status"),
          systemPrompt: form.get("systemPrompt"),
          personality: form.get("personality"),
          voiceSettings: {
            voiceId: form.get("voiceId"),
            model: form.get("voiceModel"),
            language: form.get("voiceLanguage")
          },
          businessHours,
          escalationRules
        })
      });

      router.refresh();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Agent update failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3">
        <Bot className="h-5 w-5 text-[var(--muted-foreground)]" aria-hidden="true" />
        <CardTitle>Agent Configuration</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            void onSubmit(event);
          }}
        >
          <div className="grid gap-3 lg:grid-cols-[1fr_12rem]">
            <Field label="Name">
              <Input name="name" defaultValue={agent.name} required />
            </Field>
            <Field label="Status">
              <select
                name="status"
                className="h-9 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm"
                defaultValue={agent.status}
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
            </Field>
          </div>

          <Field label="System prompt">
            <textarea
              name="systemPrompt"
              className="min-h-56 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
              defaultValue={agent.systemPrompt}
              required
            />
          </Field>

          <Field label="Personality">
            <textarea
              name="personality"
              className="min-h-24 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
              defaultValue={agent.personality ?? ""}
            />
          </Field>

          <div className="grid gap-3 lg:grid-cols-3">
            <Field label="Voice ID">
              <Input name="voiceId" defaultValue={stringSetting(voiceSettings, "voiceId", "autumn")} />
            </Field>
            <Field label="Voice model">
              <Input
                name="voiceModel"
                defaultValue={stringSetting(
                  voiceSettings,
                  "model",
                  "canopylabs/orpheus-v1-english"
                )}
              />
            </Field>
            <Field label="Language">
              <Input name="voiceLanguage" defaultValue={stringSetting(voiceSettings, "language", "en")} />
            </Field>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Field label="Business hours JSON">
              <textarea
                name="businessHours"
                className="min-h-44 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 font-mono text-xs"
                defaultValue={prettyJson(agent.businessHours)}
              />
            </Field>
            <Field label="Escalation rules JSON">
              <textarea
                name="escalationRules"
                className="min-h-44 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 font-mono text-xs"
                defaultValue={prettyJson(agent.escalationRules)}
              />
            </Field>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {error ? <p className="text-sm text-red-600">{error}</p> : <span />}
            <Button type="submit" disabled={isSubmitting}>
              <Save className="h-4 w-4" aria-hidden="true" />
              {isSubmitting ? "Saving" : "Save changes"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  children
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

function objectRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringSetting(
  settings: Record<string, unknown>,
  key: string,
  fallback: string
): string {
  const value = settings[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}

function prettyJson(value: unknown): string {
  return JSON.stringify(objectRecord(value), null, 2);
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  if (!value.trim()) {
    return {};
  }

  const parsed = JSON.parse(value) as unknown;

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }

  return parsed as Record<string, unknown>;
}

function formValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}
