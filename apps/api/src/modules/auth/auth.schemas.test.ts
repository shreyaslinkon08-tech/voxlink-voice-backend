import { describe, expect, it } from "vitest";
import { googleOAuthCallbackQuerySchema, googleOAuthStartQuerySchema } from "./auth.schemas.js";

describe("auth schemas", () => {
  it("accepts internal Google OAuth return paths", () => {
    const parsed = googleOAuthStartQuerySchema.parse({
      mode: "login",
      next: "/dashboard"
    });

    expect(parsed.next).toBe("/dashboard");
  });

  it("rejects protocol-relative Google OAuth return paths", () => {
    expect(() =>
      googleOAuthStartQuerySchema.parse({
        mode: "login",
        next: "//evil.example"
      })
    ).toThrow(/relative application path/);
  });

  it("accepts Google cancellation callbacks for graceful redirect handling", () => {
    const parsed = googleOAuthCallbackQuerySchema.parse({
      error: "access_denied"
    });

    expect(parsed.error).toBe("access_denied");
  });
});
