import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface EmptyPanelProps {
  readonly title: string;
  readonly actionLabel: string;
  readonly icon: LucideIcon;
}

export function EmptyPanel({ title, actionLabel, icon: Icon }: EmptyPanelProps) {
  return (
    <Card>
      <CardContent className="flex min-h-40 flex-col items-start justify-between gap-5 p-5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-100 text-slate-700">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </div>
          <h2 className="text-base font-semibold">{title}</h2>
        </div>
        <Button variant="secondary">{actionLabel}</Button>
      </CardContent>
    </Card>
  );
}
