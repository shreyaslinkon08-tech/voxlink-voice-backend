"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BookOpenText,
  Bot,
  Building2,
  FileClock,
  Headphones,
  LayoutDashboard,
  Shield,
  Phone,
  Settings
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const navigationItems = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/calls", label: "Calls", icon: Headphones },
  { href: "/dashboard/agents", label: "AI Agents", icon: Bot },
  { href: "/dashboard/phone-numbers", label: "Numbers", icon: Phone },
  { href: "/dashboard/knowledge-base", label: "Knowledge", icon: BookOpenText },
  { href: "/dashboard/settings", label: "Settings", icon: Settings }
] as const;

const adminNavigationItems = [{ href: "/dashboard/admin", label: "Admin", icon: Shield }] as const;

const auditNavigationItem = { href: "/dashboard/audit", label: "Audit", icon: FileClock } as const;

interface AppSidebarProps {
  readonly companyName: string;
  readonly role: string;
}

export function AppSidebar({ companyName, role }: AppSidebarProps) {
  const pathname = usePathname();
  const items =
    role === "super_admin"
      ? [...navigationItems, auditNavigationItem, ...adminNavigationItems]
      : role === "company_admin"
        ? [...navigationItems, auditNavigationItem]
        : navigationItems;

  return (
    <aside className="flex min-h-screen w-full flex-col border-r border-[var(--border)] bg-white lg:w-64">
      <div className="flex h-16 items-center gap-3 border-b border-[var(--border)] px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--primary)] text-white">
          <Building2 className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">Altrion Voice</p>
          <p className="truncate text-xs text-[var(--muted-foreground)]">Company console</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {items.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)]",
                active && "bg-[var(--accent)] text-[var(--accent-foreground)]"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-[var(--border)] p-4">
        <div className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-slate-900">{companyName}</p>
            <p className="truncate text-xs text-[var(--muted-foreground)]">{role}</p>
          </div>
          <Badge variant="success">Live</Badge>
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
          <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />
          <span>0 calls this period</span>
        </div>
      </div>
    </aside>
  );
}
