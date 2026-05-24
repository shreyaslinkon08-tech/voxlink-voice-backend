"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { clientApi } from "@/lib/client-api";

export function CreateKnowledgeTextForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const form = new FormData(event.currentTarget);

    try {
      await clientApi("/knowledge-base/text", {
        method: "POST",
        body: JSON.stringify({
          title: form.get("title"),
          content: form.get("content")
        })
      });
      event.currentTarget.reset();
      router.refresh();
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Knowledge source creation failed"
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3">
        <FileText className="h-5 w-5 text-[var(--muted-foreground)]" aria-hidden="true" />
        <CardTitle>Add Text Source</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            void onSubmit(event);
          }}
        >
          <Input name="title" placeholder="Refund policy" required />
          <textarea
            name="content"
            className="min-h-32 rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
            placeholder="Paste business facts, policies, FAQs, or operating instructions."
            required
          />
          <div className="flex justify-end">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Adding" : "Add source"}
            </Button>
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </form>
      </CardContent>
    </Card>
  );
}
