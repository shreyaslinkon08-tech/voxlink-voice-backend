import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password utilities", () => {
  it("hashes and verifies passwords with Argon2id", async () => {
    const hash = await hashPassword("a-very-strong-password");

    expect(hash).toContain("argon2id");
    await expect(verifyPassword(hash, "a-very-strong-password")).resolves.toBe(true);
    await expect(verifyPassword(hash, "wrong-password")).resolves.toBe(false);
  });
});
