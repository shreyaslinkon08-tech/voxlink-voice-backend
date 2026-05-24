import { assertValidCallTransition, type CallStatus as SharedCallStatus } from "@altrion/shared";
import { AppError } from "../../errors/app-error.js";

export function assertCallStatusUpdate(from: string, to: string): void {
  try {
    assertValidCallTransition(from as SharedCallStatus, to as SharedCallStatus);
  } catch {
    throw AppError.badRequest(`Invalid call state transition from ${from} to ${to}`);
  }
}
