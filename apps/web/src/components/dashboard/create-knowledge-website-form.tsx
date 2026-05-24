"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { Globe2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { clientApi } from "@/lib/client-api";

export function CreateKnowledgeWebsiteForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const form = new FormData(event.currentTarget);

    try {
      await clientApi("/knowledge-base/websites", {
        method: "POST",
        body: JSON.stringify({
          title: form.get("title"),
          sourceUri: form.get("sourceUri")
        })
      });
      event.currentTarget.reset();
      router.refresh();
    } catch (submissionError) {
      setError(
        submissionError instanceof Error ? submissionError.message : "Website ingestion failed"
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3">
        <Globe2 className="h-5 w-5 text-[var(--muted-foreground)]" aria-hidden="true" />
        <CardTitle>Add Website Source</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 lg:grid-cols-[1fr_1.5fr_auto]"
          onSubmit={(event) => {
            void onSubmit(event);
          }}
        >
          <Input name="title" placeholder="Pricing page" required />
          <Input name="sourceUri" placeholder="https://example.com/pricing" type="url" required />
          <div className="flex items-start lg:justify-end">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Ingesting" : "Ingest"}
            </Button>
          </div>
          {error ? <p className="text-sm text-red-600 lg:col-span-3">{error}</p> : null}
        </form>
      </CardContent>
    </Card>
  );
}
