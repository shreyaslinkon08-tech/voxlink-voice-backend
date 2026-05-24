import { AuthShell } from "@/components/auth/auth-shell";
import { SignupForm } from "@/components/auth/signup-form";

interface SignupPageProps {
  readonly searchParams?: Promise<{
    readonly invite?: string;
    readonly error?: string;
  }>;
}

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const params = await searchParams;
  const invitationToken = params?.invite?.trim();
  const initialError =
    params?.error === "google_sign_in_failed"
      ? "Google sign-in failed. Please try again."
      : undefined;

  return (
    <AuthShell
      title={invitationToken ? "Join your company" : "Create your company"}
      subtitle={
        invitationToken
          ? "Create your account to accept the team invitation."
          : "Start with one verified company admin account."
      }
      footerText="Already have an account?"
      footerHref="/login"
      footerLabel="Sign in"
    >
      <SignupForm invitationToken={invitationToken} initialError={initialError} />
    </AuthShell>
  );
}
