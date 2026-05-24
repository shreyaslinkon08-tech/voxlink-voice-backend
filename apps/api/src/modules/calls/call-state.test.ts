import { describe, expect, it } from "vitest";
import { AppError } from "../../errors/app-error.js";
import { assertCallStatusUpdate } from "./call-state.js";

describe("API call state guard", () => {
  it("allows valid call transitions", () => {
    expect(() => assertCallStatusUpdate("connected", "listening")).not.toThrow();
  });

  it("turns invalid transitions into request errors", () => {
    expect(() => assertCallStatusUpdate("ended", "responding")).toThrow(AppError);
  });
});
