"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { clientApi } from "@/lib/client-api";

export function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(event.currentTarget);

    try {
      await clientApi("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({
          token,
          password: form.get("password")
        })
      });
      setSuccess(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Reset failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-5">
        {!token ? (
          <p className="text-sm text-[var(--destructive)]">Reset token is missing.</p>
        ) : null}
        {success ? (
          <p className="text-sm text-emerald-700">Password reset. You can now sign in.</p>
        ) : (
          <form className="space-y-4" onSubmit={(event) => void onSubmit(event)}>
            <label className="grid gap-2 text-sm font-medium">
              New password
              <Input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
                disabled={!token}
              />
            </label>
            <Button className="w-full" type="submit" disabled={loading || !token}>
              {loading ? "Resetting" : "Reset password"}
            </Button>
            {error ? <p className="text-sm text-[var(--destructive)]">{error}</p> : null}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
