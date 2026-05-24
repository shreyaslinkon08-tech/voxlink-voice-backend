import { Bell, CircleHelp, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function Topbar() {
  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--background)]/95 px-4 backdrop-blur lg:px-6">
      <div className="relative hidden w-full max-w-sm md:block">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]"
          aria-hidden="true"
        />
        <Input className="pl-9" placeholder="Search calls, agents, transcripts" />
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="Help">
          <CircleHelp className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Notifications">
          <Bell className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </header>
  );
}
