import Link from "next/link";

interface AuthShellProps {
  readonly title: string;
  readonly subtitle: string;
  readonly children: React.ReactNode;
  readonly footerText: string;
  readonly footerHref: string;
  readonly footerLabel: string;
}

export function AuthShell({
  title,
  subtitle,
  children,
  footerText,
  footerHref,
  footerLabel
}: AuthShellProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-4 py-10">
      <section className="w-full max-w-md">
        <div className="mb-8">
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-[var(--primary)] text-sm font-semibold text-white">
            AV
          </div>
          <h1 className="text-2xl font-semibold tracking-normal">{title}</h1>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">{subtitle}</p>
        </div>
        {children}
        <p className="mt-6 text-sm text-[var(--muted-foreground)]">
          {footerText}{" "}
          <Link className="font-medium text-[var(--primary)] hover:underline" href={footerHref}>
            {footerLabel}
          </Link>
        </p>
      </section>
    </main>
  );
}
