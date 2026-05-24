import { CallStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { canRequestOperatorHandoff } from "./call-handoff.service.js";

describe("operator handoff rules", () => {
  it("allows handoff only after a call is connected to the live voice loop", () => {
    expect(canRequestOperatorHandoff(CallStatus.initiated)).toBe(false);
    expect(canRequestOperatorHandoff(CallStatus.ringing)).toBe(false);
    expect(canRequestOperatorHandoff(CallStatus.connected)).toBe(true);
    expect(canRequestOperatorHandoff(CallStatus.listening)).toBe(true);
    expect(canRequestOperatorHandoff(CallStatus.processing)).toBe(true);
    expect(canRequestOperatorHandoff(CallStatus.responding)).toBe(true);
    expect(canRequestOperatorHandoff(CallStatus.transferring)).toBe(true);
    expect(canRequestOperatorHandoff(CallStatus.ended)).toBe(false);
    expect(canRequestOperatorHandoff(CallStatus.failed)).toBe(false);
  });
});
