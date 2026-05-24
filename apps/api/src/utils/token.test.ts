import { describe, expect, it } from "vitest";
import { createOpaqueToken, hashToken } from "./token.js";

describe("token utilities", () => {
  it("creates opaque URL-safe tokens", () => {
    const token = createOpaqueToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(40);
  });

  it("hashes tokens deterministically without storing raw token values", () => {
    const token = createOpaqueToken();
    const hash = hashToken(token);

    expect(hash).toHaveLength(64);
    expect(hash).toBe(hashToken(token));
    expect(hash).not.toBe(token);
  });
});
