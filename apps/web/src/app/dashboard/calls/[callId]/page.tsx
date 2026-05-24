import Link from "next/link";
import {
  ArrowLeft,
  Clock3,
  Download,
  ExternalLink,
  FileAudio,
  FileText,
  Hash,
  MessageSquareText,
  Phone,
  UserCheck,
  UserRound
} from "lucide-react";
import { CallHandoffActions } from "@/components/dashboard/call-handoff-actions";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatDurationFromDates, formatMilliseconds } from "@/lib/format";
import { getCall } from "@/lib/server-api";

interface CallDetailPageProps {
  readonly params: Promise<{
    readonly callId: string;
  }>;
}

export default async function CallDetailPage({ params }: CallDetailPageProps) {
  const { callId } = await params;
  const { call } = await getCall(callId);
  const openHandoff = call.operatorHandoffs.find((handoff) => handoff.status !== "resolved");
  const publicApiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  const exportUrl = new URL(`/calls/${call.id}/export`, publicApiUrl).toString();

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-3 border-b border-[var(--border)] pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
            <Link href="/dashboard/calls">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Calls
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-normal">
            {call.fromNumber} to {call.toNumber}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {call.aiAgent?.name ?? "No agent"} via {call.provider}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={exportUrl} target="_blank" rel="noreferrer">
              <Download className="h-4 w-4" aria-hidden="true" />
              Export
            </a>
          </Button>
          <StatusBadge status={call.status} />
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-5">
        <SummaryCard
          icon={Clock3}
          label="Started"
          value={formatDateTime(call.startedAt ?? call.createdAt)}
        />
        <SummaryCard
          icon={Clock3}
          label="Duration"
          value={formatDurationFromDates(call.startedAt, call.endedAt)}
        />
        <SummaryCard
          icon={MessageSquareText}
          label="Transcript"
          value={`${call.transcriptChunks.length} chunks`}
        />
        <SummaryCard
          icon={FileAudio}
          label="Recordings"
          value={`${call.recordings.length} file${call.recordings.length === 1 ? "" : "s"}`}
        />
        <SummaryCard icon={Hash} label="Provider ID" value={call.providerCallId} mono />
      </section>

      {call.failureReason ? (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4 text-sm text-red-800">{call.failureReason}</CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <UserCheck className="h-5 w-5 text-[var(--muted-foreground)]" aria-hidden="true" />
            <CardTitle>Operator Handoff</CardTitle>
          </div>
          {openHandoff ? <Badge variant="warning">{openHandoff.status}</Badge> : null}
        </CardHeader>
        <CardContent className="space-y-4">
          <CallHandoffActions
            callId={call.id}
            callStatus={call.status}
            handoff={openHandoff}
            size="default"
          />
          {call.operatorHandoffs.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">
              No operator handoff has been requested for this call.
            </p>
          ) : (
            <div className="grid gap-3 text-sm">
              {call.operatorHandoffs.map((handoff) => (
                <div key={handoff.id} className="rounded-md border border-[var(--border)] p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge variant={handoff.status === "resolved" ? "secondary" : "warning"}>
                      {handoff.status}
                    </Badge>
                    <span className="text-xs text-[var(--muted-foreground)]">
                      requested {formatDateTime(handoff.requestedAt)}
                    </span>
                  </div>
                  {handoff.reason ? <p className="text-sm">{handoff.reason}</p> : null}
                  {handoff.notes ? (
                    <p className="mt-2 text-sm text-[var(--muted-foreground)]">{handoff.notes}</p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader className="flex-row items-center gap-3">
            <FileText className="h-5 w-5 text-[var(--muted-foreground)]" aria-hidden="true" />
            <CardTitle>Transcript</CardTitle>
          </CardHeader>
          <CardContent>
            {call.transcriptChunks.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">
                No transcript chunks have been captured for this call.
              </p>
            ) : (
              <ol className="space-y-3">
                {call.transcriptChunks.map((chunk) => (
                  <li
                    key={chunk.id}
                    className="rounded-md border border-[var(--border)] bg-white p-3"
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <SpeakerBadge role={chunk.speakerRole} />
                      <span className="font-mono text-xs text-[var(--muted-foreground)]">
                        #{chunk.sequence}
                      </span>
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {formatChunkTiming(chunk.startedAtMs, chunk.endedAtMs)}
                      </span>
                      {chunk.confidence ? (
                        <span className="text-xs text-[var(--muted-foreground)]">
                          confidence {formatConfidence(chunk.confidence)}
                        </span>
                      ) : null}
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-6">{chunk.text}</p>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <aside className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center gap-3">
              <FileAudio className="h-5 w-5 text-[var(--muted-foreground)]" aria-hidden="true" />
              <CardTitle>Recordings</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              {call.recordings.length === 0 ? (
                <p className="text-[var(--muted-foreground)]">
                  No recording metadata has been received for this call.
                </p>
              ) : (
                call.recordings.map((recording) => (
                  <div
                    key={recording.id}
                    className="grid gap-2 rounded-md border border-[var(--border)] p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <StatusBadge status={recording.status} />
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {formatRecordingDuration(recording.durationSeconds)}
                      </span>
                    </div>
                    <p className="truncate font-mono text-xs">{recording.providerRecordingId}</p>
                    <DetailRow
                      label="Channels"
                      value={recording.channels?.toString() ?? "Not set"}
                    />
                    <DetailRow label="Source" value={recording.source ?? "Provider"} />
                    {recording.recordingUrl ? (
                      <Button asChild variant="outline" size="sm">
                        <a href={recording.recordingUrl} target="_blank" rel="noreferrer">
                          <ExternalLink className="h-4 w-4" aria-hidden="true" />
                          Provider file
                        </a>
                      </Button>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center gap-3">
              <Phone className="h-5 w-5 text-[var(--muted-foreground)]" aria-hidden="true" />
              <CardTitle>Call Metadata</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <DetailRow label="From" value={call.fromNumber} />
              <DetailRow label="To" value={call.toNumber} />
              <DetailRow label="Started" value={formatDateTime(call.startedAt)} />
              <DetailRow label="Ended" value={formatDateTime(call.endedAt)} />
              <DetailRow label="Phone Number" value={call.phoneNumber?.label ?? call.toNumber} />
              <DetailRow label="Agent" value={call.aiAgent?.name ?? "Unassigned"} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center gap-3">
              <UserRound className="h-5 w-5 text-[var(--muted-foreground)]" aria-hidden="true" />
              <CardTitle>Provider Payload</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="max-h-96 overflow-auto rounded-md bg-slate-950 p-3 text-xs leading-5 text-slate-100">
                {safeJson(call.metadata)}
              </pre>
            </CardContent>
          </Card>
        </aside>
      </section>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  mono = false
}: {
  readonly icon: typeof Clock3;
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-4">
        <Icon
          className="mt-0.5 h-4 w-4 shrink-0 text-[var(--muted-foreground)]"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
          <p
            className={
              mono ? "mt-1 truncate font-mono text-xs" : "mt-1 truncate text-sm font-medium"
            }
          >
            {value}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function DetailRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[var(--muted-foreground)]">{label}</span>
      <span className="min-w-0 truncate font-medium">{value}</span>
    </div>
  );
}

function SpeakerBadge({ role }: { readonly role: string }) {
  const variant =
    role === "assistant"
      ? "success"
      : role === "system"
        ? "warning"
        : role === "operator"
          ? "secondary"
          : "outline";

  return <Badge variant={variant}>{role}</Badge>;
}

function formatChunkTiming(startedAtMs: number | null, endedAtMs: number | null): string {
  if (startedAtMs === null && endedAtMs === null) {
    return "No timing";
  }

  return `${formatMilliseconds(startedAtMs)} - ${formatMilliseconds(endedAtMs)}`;
}

function formatConfidence(value: string | number): string {
  const numeric = typeof value === "string" ? Number(value) : value;

  if (!Number.isFinite(numeric)) {
    return String(value);
  }

  return `${Math.round(numeric * 100)}%`;
}

function formatRecordingDuration(value: number | null): string {
  return value === null ? "No duration" : formatMilliseconds(value * 1_000);
}

function safeJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}
