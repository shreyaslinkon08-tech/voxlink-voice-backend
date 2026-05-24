import { Suspense } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { VerifyEmailStatus } from "@/components/auth/verify-email-status";

export default function VerifyEmailPage() {
  return (
    <AuthShell
      title="Verify email"
      subtitle="Confirm your account before signing in."
      footerText="Already verified?"
      footerHref="/login"
      footerLabel="Sign in"
    >
      <Suspense fallback={null}>
        <VerifyEmailStatus />
      </Suspense>
    </AuthShell>
  );
}
