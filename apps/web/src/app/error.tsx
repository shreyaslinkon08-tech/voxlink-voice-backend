"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  reset
}: Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-4 py-10">
      <section className="w-full max-w-md">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-[var(--primary)] text-sm font-semibold text-white">
          VL
        </div>
        <h1 className="text-2xl font-semibold tracking-normal">Service temporarily unavailable</h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          VoxLink could not reach the backend service. Check the API deployment and try again.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button type="button" onClick={reset}>
            Try again
          </Button>
          <Button asChild variant="secondary">
            <Link href="/login">Go to sign in</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
