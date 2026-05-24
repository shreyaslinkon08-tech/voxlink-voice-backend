import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";

interface LoginPageProps {
  readonly searchParams?: Promise<{
    readonly error?: string;
  }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const error = (await searchParams)?.error;
  const initialError =
    error === "google_sign_in_failed" ? "Google sign-in failed. Please try again." : undefined;

  return (
    <AuthShell
      title="Sign in"
      subtitle="Access your company voice assistant console."
      footerText="New to Altrion?"
      footerHref="/signup"
      footerLabel="Create an account"
    >
      <LoginForm initialError={initialError} />
    </AuthShell>
  );
}
