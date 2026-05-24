import { Badge } from "@/components/ui/badge";

interface StatusBadgeProps {
  readonly status: string;
}

const successStatuses = new Set(["active", "ready", "connected", "listening", "responding"]);
const warningStatuses = new Set(["draft", "pending", "processing", "ringing", "initiated"]);

export function StatusBadge({ status }: StatusBadgeProps) {
  const variant = successStatuses.has(status)
    ? "success"
    : warningStatuses.has(status)
      ? "warning"
      : "outline";

  return <Badge variant={variant}>{status.replaceAll("_", " ")}</Badge>;
}
