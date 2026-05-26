"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { clientApi } from "@/lib/client-api";

interface LoginFormProps {
  readonly initialError?: string;
}

export function LoginForm({ initialError }: LoginFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [verificationEmail, setVerificationEmail] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [loading, setLoading] = useState(false);
  const googleLoginUrl = "/api/auth/google/start?mode=login";

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setVerificationEmail(null);
    setResendMessage(null);
    setLoading(true);

    const form = new FormData(event.currentTarget);
    const email = form.get("email");

    try {
      await clientApi("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email,
          password: form.get("password")
        })
      });
      router.push("/dashboard");
      router.refresh();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Login failed";
      setError(message);

      if (
        message.toLowerCase().includes("email verification") &&
        typeof email === "string" &&
        email.trim()
      ) {
        setVerificationEmail(email.trim());
      }
    } finally {
      setLoading(false);
    }
  }

  async function resendVerificationEmail() {
    if (!verificationEmail) {
      return;
    }

    setResending(true);
    setResendMessage(null);

    try {
      const result = await clientApi<{ emailDeliveryStatus?: "sent" | "failed" }>(
        "/auth/resend-verification-email",
        {
          method: "POST",
          body: JSON.stringify({ email: verificationEmail })
        }
      );

      setResendMessage(
        result.emailDeliveryStatus === "failed"
          ? "Verification email could not be delivered. Please check email settings and try again."
          : "Verification email sent. Check your inbox."
      );
    } catch (caught) {
      setResendMessage(caught instanceof Error ? caught.message : "Could not resend email");
    } finally {
      setResending(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-5">
        <div className="space-y-4">
          <Button asChild className="w-full" variant="outline">
            <a href={googleLoginUrl}>Continue with Google</a>
          </Button>
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-[var(--border)]" />
            <span className="text-xs text-[var(--muted-foreground)]">or</span>
            <div className="h-px flex-1 bg-[var(--border)]" />
          </div>
        </div>
        <form className="mt-4 space-y-4" onSubmit={(event) => void onSubmit(event)}>
          <label className="grid gap-2 text-sm font-medium">
            Email
            <Input name="email" type="email" autoComplete="email" required />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Password
            <Input name="password" type="password" autoComplete="current-password" required />
          </label>
          <div className="flex items-center justify-between gap-3">
            <Link className="text-sm text-[var(--primary)] hover:underline" href="/forgot-password">
              Forgot password?
            </Link>
            <Button type="submit" disabled={loading}>
              {loading ? "Signing in" : "Sign in"}
            </Button>
          </div>
          {error ? <p className="text-sm text-[var(--destructive)]">{error}</p> : null}
          {verificationEmail ? (
            <div className="flex flex-col gap-2 text-sm">
              <Button
                className="w-fit"
                type="button"
                variant="outline"
                disabled={resending}
                onClick={() => void resendVerificationEmail()}
              >
                {resending ? "Sending verification" : "Resend verification email"}
              </Button>
              {resendMessage ? (
                <p className="text-[var(--muted-foreground)]">{resendMessage}</p>
              ) : null}
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
