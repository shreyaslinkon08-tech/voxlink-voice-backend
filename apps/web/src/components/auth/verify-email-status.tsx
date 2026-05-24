"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { clientApi } from "@/lib/client-api";

export function VerifyEmailStatus() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Verifying your email.");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("Verification token is missing.");
      return;
    }

    clientApi(`/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then(() => {
        setStatus("success");
        setMessage("Email verified. You can now sign in.");
      })
      .catch((caught: unknown) => {
        setStatus("error");
        setMessage(caught instanceof Error ? caught.message : "Verification failed");
      });
  }, [token]);

  return (
    <Card>
      <CardContent className="p-5">
        <p
          className={
            status === "success"
              ? "text-sm text-emerald-700"
              : status === "error"
                ? "text-sm text-[var(--destructive)]"
                : "text-sm text-[var(--muted-foreground)]"
          }
        >
          {message}
        </p>
      </CardContent>
    </Card>
  );
}
