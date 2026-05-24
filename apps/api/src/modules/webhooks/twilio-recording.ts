import type { Prisma } from "@prisma/client";

export interface TwilioRecordingPayload {
  readonly providerRecordingId: string;
  readonly status: string;
  readonly recordingUrl?: string;
  readonly durationSeconds?: number;
  readonly channels?: number;
  readonly source?: string;
  readonly metadata: Prisma.InputJsonObject;
}

export function extractTwilioRecording(
  body: Readonly<Record<string, string>>
): TwilioRecordingPayload | null {
  const providerRecordingId = body.RecordingSid;

  if (!providerRecordingId) {
    return null;
  }

  return {
    providerRecordingId,
    status: normalizeRecordingStatus(body.RecordingStatus),
    recordingUrl: body.RecordingUrl,
    durationSeconds: parsePositiveInteger(body.RecordingDuration),
    channels: parsePositiveInteger(body.RecordingChannels),
    source: body.RecordingSource,
    metadata: {
      recordingSid: body.RecordingSid,
      recordingStatus: body.RecordingStatus,
      recordingUrl: body.RecordingUrl,
      recordingDuration: body.RecordingDuration,
      recordingChannels: body.RecordingChannels,
      recordingSource: body.RecordingSource
    }
  };
}

function normalizeRecordingStatus(status: string | undefined): string {
  return status?.trim().toLowerCase().replaceAll("-", "_") || "received";
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}
