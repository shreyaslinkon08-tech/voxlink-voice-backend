import { describe, expect, it } from "vitest";
import { inviteCompanyMemberSchema, updateCompanyMemberRoleSchema } from "./company.schemas.js";

describe("company team schemas", () => {
  it("normalizes invitation email and accepts manageable roles", () => {
    const parsed = inviteCompanyMemberSchema.parse({
      email: "Operator@Example.COM",
      role: "operator"
    });

    expect(parsed.email).toBe("operator@example.com");
    expect(parsed.role).toBe("operator");
  });

  it("does not allow tenant invitations to create super admins", () => {
    expect(() => updateCompanyMemberRoleSchema.parse({ role: "super_admin" })).toThrow();
  });
});
