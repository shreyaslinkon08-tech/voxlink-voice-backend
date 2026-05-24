"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  BookOpenText,
  FileClock,
  Headphones,
  LayoutDashboard,
  Phone,
  Settings,
  Shield
} from "lucide-react";
import { cn } from "@/lib/utils";

const mobileItems = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/dashboard/calls", label: "Calls", icon: Headphones },
  { href: "/dashboard/agents", label: "Agents", icon: Bot },
  { href: "/dashboard/phone-numbers", label: "Numbers", icon: Phone },
  { href: "/dashboard/knowledge-base", label: "Knowledge", icon: BookOpenText },
  { href: "/dashboard/settings", label: "Settings", icon: Settings }
] as const;

const adminMobileItems = [{ href: "/dashboard/admin", label: "Admin", icon: Shield }] as const;
const auditMobileItem = { href: "/dashboard/audit", label: "Audit", icon: FileClock } as const;

export function MobileNav({ role }: { readonly role: string }) {
  const pathname = usePathname();
  const items =
    role === "super_admin"
      ? [...mobileItems, auditMobileItem, ...adminMobileItems]
      : role === "company_admin"
        ? [...mobileItems, auditMobileItem]
        : mobileItems;

  return (
    <nav className="flex gap-2 overflow-x-auto border-b border-[var(--border)] bg-white px-4 py-2 lg:hidden">
      {items.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm text-slate-700",
              active && "bg-[var(--accent)] text-[var(--accent-foreground)]"
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
