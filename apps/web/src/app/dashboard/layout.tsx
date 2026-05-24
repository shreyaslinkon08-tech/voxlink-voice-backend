import { AppSidebar } from "@/components/shell/app-sidebar";
import { MobileNav } from "@/components/shell/mobile-nav";
import { Topbar } from "@/components/shell/topbar";
import { getSession } from "@/lib/server-api";

export default async function DashboardLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSession();
  const currentMembership =
    session.user.memberships.find(
      (membership) => membership.companyId === session.currentCompanyId
    ) ?? session.user.memberships[0];
  const companyName = currentMembership?.companyName ?? "Company";

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_1fr]">
      <div className="hidden lg:block">
        <AppSidebar companyName={companyName} role={session.role} />
      </div>
      <div className="flex min-w-0 flex-col">
        <Topbar />
        <MobileNav role={session.role} />
        <main className="w-full px-4 py-5 lg:px-6">{children}</main>
      </div>
    </div>
  );
}
