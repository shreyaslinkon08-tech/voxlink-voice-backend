"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { clientApi, publicApiUrl } from "@/lib/client-api";

interface SignupFormProps {
  readonly invitationToken?: string;
  readonly initialError?: string;
}

export function SignupForm({ invitationToken, initialError }: SignupFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(event.currentTarget);

    try {
      await clientApi("/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          companyName: invitationToken ? undefined : form.get("companyName"),
          email: form.get("email"),
          password: form.get("password"),
          invitationToken
        })
      });
      setSuccess(true);
      event.currentTarget.reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  }

  function startGoogleSignup() {
    setError(null);
    const params = new URLSearchParams({ mode: "signup" });

    if (invitationToken) {
      params.set("invitationToken", invitationToken);
    } else {
      const form = new FormData(formRef.current ?? undefined);
      const rawCompanyName = form.get("companyName");
      const companyName = typeof rawCompanyName === "string" ? rawCompanyName.trim() : "";

      if (!companyName) {
        setError("Company is required for Google signup");
        return;
      }

      params.set("companyName", companyName);
    }

    window.location.assign(`${publicApiUrl}/auth/google/start?${params.toString()}`);
  }

  return (
    <Card>
      <CardContent className="p-5">
        {success ? (
          <p className="text-sm text-emerald-700">
            Account created. Check Mailpit or your SMTP inbox for the verification link before
            logging in.
          </p>
        ) : (
          <form ref={formRef} className="space-y-4" onSubmit={(event) => void onSubmit(event)}>
            <Button className="w-full" type="button" variant="outline" onClick={startGoogleSignup}>
              Continue with Google
            </Button>
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-[var(--border)]" />
              <span className="text-xs text-[var(--muted-foreground)]">or</span>
              <div className="h-px flex-1 bg-[var(--border)]" />
            </div>
            <label className="grid gap-2 text-sm font-medium">
              Name
              <Input name="name" autoComplete="name" required />
            </label>
            {invitationToken ? null : (
              <label className="grid gap-2 text-sm font-medium">
                Company
                <Input name="companyName" autoComplete="organization" required />
              </label>
            )}
            <label className="grid gap-2 text-sm font-medium">
              Email
              <Input name="email" type="email" autoComplete="email" required />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Password
              <Input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
              />
            </label>
            <Button className="w-full" type="submit" disabled={loading}>
              {loading ? "Creating account" : "Create account"}
            </Button>
            {error ? <p className="text-sm text-[var(--destructive)]">{error}</p> : null}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
