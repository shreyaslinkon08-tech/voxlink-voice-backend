"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { clientApi } from "@/lib/client-api";

export function CreateAgentForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const form = new FormData(event.currentTarget);

    try {
      await clientApi("/agents", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          status: form.get("status"),
          systemPrompt: form.get("systemPrompt"),
          personality: form.get("personality") || undefined,
          voiceSettings: {
            voiceId: form.get("voiceId") || "autumn",
            model: "canopylabs/orpheus-v1-english"
          }
        })
      });
      event.currentTarget.reset();
      router.refresh();
    } catch (submissionError) {
      setError(
        submissionError instanceof Error ? submissionError.message : "Agent creation failed"
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3">
        <Bot className="h-5 w-5 text-[var(--muted-foreground)]" aria-hidden="true" />
        <CardTitle>Create AI Agent</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 lg:grid-cols-[1fr_1fr_auto]"
          onSubmit={(event) => {
            void onSubmit(event);
          }}
        >
          <Input name="name" placeholder="Reception assistant" required />
          <Input name="voiceId" placeholder="Voice ID: autumn" />
          <select
            name="status"
            className="h-9 rounded-md border border-[var(--border)] bg-transparent px-3 text-sm"
            defaultValue="draft"
          >
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
          <textarea
            name="systemPrompt"
            className="min-h-24 rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm lg:col-span-2"
            placeholder="You are a helpful phone assistant for this business..."
            required
          />
          <textarea
            name="personality"
            className="min-h-24 rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
            placeholder="Warm, concise, calm under pressure"
          />
          <div className="flex items-start lg:justify-end">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating" : "Create"}
            </Button>
          </div>
          {error ? <p className="text-sm text-red-600 lg:col-span-3">{error}</p> : null}
        </form>
      </CardContent>
    </Card>
  );
}
