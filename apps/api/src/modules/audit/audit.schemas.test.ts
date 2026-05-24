import { describe, expect, it } from "vitest";
import { listAuditEventsQuerySchema } from "./audit.schemas.js";

describe("audit schemas", () => {
  it("accepts super admin all-company scope", () => {
    const parsed = listAuditEventsQuerySchema.parse({
      companyId: "all",
      limit: "50",
      search: "POST"
    });

    expect(parsed.companyId).toBe("all");
    expect(parsed.limit).toBe(50);
    expect(parsed.search).toBe("POST");
  });

  it("rejects invalid company filters", () => {
    expect(() => listAuditEventsQuerySchema.parse({ companyId: "not-a-company-id" })).toThrow();
  });
});
