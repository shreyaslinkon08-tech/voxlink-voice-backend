"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clientApi } from "@/lib/client-api";

export function InviteMemberForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    const form = new FormData(event.currentTarget);

    try {
      await clientApi("/companies/current/invitations", {
        method: "POST",
        body: JSON.stringify({
          email: form.get("email"),
          role: form.get("role")
        })
      });
      setSuccess("Invitation sent");
      event.currentTarget.reset();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Invitation failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      className="grid gap-3 rounded-md border border-[var(--border)] p-3 lg:grid-cols-[1fr_12rem_auto]"
      onSubmit={(event) => void onSubmit(event)}
    >
      <Input name="email" type="email" placeholder="teammate@example.com" required />
      <select
        name="role"
        className="h-9 rounded-md border border-[var(--border)] bg-white px-3 text-sm"
        defaultValue="operator"
      >
        <option value="operator">Operator</option>
        <option value="company_admin">Company admin</option>
      </select>
      <Button type="submit" disabled={loading}>
        <UserPlus className="h-4 w-4" aria-hidden="true" />
        {loading ? "Sending" : "Invite"}
      </Button>
      {error ? <p className="text-sm text-[var(--destructive)] lg:col-span-3">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-700 lg:col-span-3">{success}</p> : null}
    </form>
  );
}
