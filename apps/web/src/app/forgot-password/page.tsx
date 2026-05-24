import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset access"
      subtitle="Send a password reset link to the account email."
      footerText="Remembered it?"
      footerHref="/login"
      footerLabel="Sign in"
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
