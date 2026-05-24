import { z } from "zod";

export const callStatusValues = [
  "initiated",
  "ringing",
  "connected",
  "listening",
  "processing",
  "responding",
  "transferring",
  "ended",
  "failed"
] as const;

export const callStatusSchema = z.enum(callStatusValues);

export type CallStatus = z.infer<typeof callStatusSchema>;

export const terminalCallStatuses = ["ended", "failed"] as const satisfies readonly CallStatus[];

const transitionEntries = {
  initiated: ["ringing", "connected", "failed"],
  ringing: ["connected", "ended", "failed"],
  connected: ["listening", "transferring", "ended", "failed"],
  listening: ["processing", "transferring", "ended", "failed"],
  processing: ["responding", "listening", "transferring", "ended", "failed"],
  responding: ["listening", "transferring", "ended", "failed"],
  transferring: ["ended", "failed"],
  ended: [],
  failed: []
} as const satisfies Readonly<Record<CallStatus, readonly CallStatus[]>>;

export const callStatusTransitions: Readonly<Record<CallStatus, readonly CallStatus[]>> =
  transitionEntries;

export function canTransitionCallStatus(from: CallStatus, to: CallStatus): boolean {
  return from === to || callStatusTransitions[from].includes(to);
}

export function assertValidCallTransition(from: CallStatus, to: CallStatus): void {
  if (!canTransitionCallStatus(from, to)) {
    throw new Error(`Invalid call state transition from ${from} to ${to}`);
  }
}
