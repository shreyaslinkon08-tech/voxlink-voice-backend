import { describe, expect, it } from "vitest";
import { assertValidCallTransition, canTransitionCallStatus } from "./call-state.js";

describe("call state transitions", () => {
  it("allows expected realtime call transitions", () => {
    expect(canTransitionCallStatus("initiated", "ringing")).toBe(true);
    expect(canTransitionCallStatus("listening", "processing")).toBe(true);
    expect(canTransitionCallStatus("processing", "responding")).toBe(true);
    expect(canTransitionCallStatus("responding", "listening")).toBe(true);
    expect(canTransitionCallStatus("transferring", "ended")).toBe(true);
  });

  it("blocks transitions out of terminal states", () => {
    expect(canTransitionCallStatus("ended", "listening")).toBe(false);
    expect(() => assertValidCallTransition("failed", "responding")).toThrow(
      "Invalid call state transition"
    );
  });
});
