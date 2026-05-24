import { describe, expect, it } from "vitest";
import { hasPermission } from "./rbac.js";

describe("rbac permission matrix", () => {
  it("allows company admins to manage company-owned resources", () => {
    expect(hasPermission("company_admin", "company:update")).toBe(true);
    expect(hasPermission("company_admin", "agent:write")).toBe(true);
    expect(hasPermission("company_admin", "knowledge_base:write")).toBe(true);
  });

  it("keeps operators read-oriented", () => {
    expect(hasPermission("operator", "dashboard:read")).toBe(true);
    expect(hasPermission("operator", "company:update")).toBe(false);
    expect(hasPermission("operator", "phone_number:write")).toBe(false);
  });
});
