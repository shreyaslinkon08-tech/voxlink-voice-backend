import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface MetricCardProps {
  readonly title: string;
  readonly value: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly tone?: "default" | "success" | "warning";
}

export function MetricCard({ title, value, label, icon: Icon, tone = "default" }: MetricCardProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle>{title}</CardTitle>
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-slate-700">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tracking-normal">{value}</div>
        <div className="mt-3">
          <Badge variant={tone === "default" ? "secondary" : tone}>{label}</Badge>
        </div>
      </CardContent>
    </Card>
  );
}
