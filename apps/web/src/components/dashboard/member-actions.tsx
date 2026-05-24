"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clientApi } from "@/lib/client-api";

interface MemberActionsProps {
  readonly membershipId: string;
  readonly role: string;
}

export function MemberActions({ membershipId, role }: MemberActionsProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function updateRole(nextRole: string) {
    setError(null);
    setLoading(true);

    try {
      await clientApi(`/companies/current/members/${membershipId}`, {
        method: "PATCH",
        body: JSON.stringify({ role: nextRole })
      });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Role update failed");
    } finally {
      setLoading(false);
    }
  }

  async function removeMember() {
    if (!window.confirm("Remove this team member from the company?")) {
      return;
    }

    setError(null);
    setLoading(true);

    try {
      await clientApi(`/companies/current/members/${membershipId}`, {
        method: "DELETE"
      });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Remove failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-2 sm:grid-cols-[12rem_auto]">
      <select
        className="h-9 rounded-md border border-[var(--border)] bg-white px-3 text-sm"
        value={role}
        disabled={loading || role === "super_admin"}
        onChange={(event) => void updateRole(event.target.value)}
      >
        {role === "super_admin" ? <option value="super_admin">Super admin</option> : null}
        <option value="company_admin">Company admin</option>
        <option value="operator">Operator</option>
      </select>
      <Button
        type="button"
        variant="outline"
        disabled={loading || role === "super_admin"}
        onClick={() => void removeMember()}
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
        Remove
      </Button>
      {error ? <p className="text-sm text-[var(--destructive)] sm:col-span-2">{error}</p> : null}
    </div>
  );
}
