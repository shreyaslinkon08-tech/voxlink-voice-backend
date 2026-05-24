"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { clientApi } from "@/lib/client-api";

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(event.currentTarget);

    try {
      await clientApi("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: form.get("email") })
      });
      setSent(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-5">
        {sent ? (
          <p className="text-sm text-emerald-700">
            If an account exists, a reset link has been sent.
          </p>
        ) : (
          <form className="space-y-4" onSubmit={(event) => void onSubmit(event)}>
            <label className="grid gap-2 text-sm font-medium">
              Email
              <Input name="email" type="email" autoComplete="email" required />
            </label>
            <Button className="w-full" type="submit" disabled={loading}>
              {loading ? "Sending" : "Send reset link"}
            </Button>
            {error ? <p className="text-sm text-[var(--destructive)]">{error}</p> : null}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
