import { describe, expect, it } from "vitest";
import {
  listAdminCompaniesQuerySchema,
  updateAdminCompanyStatusSchema,
  updateAdminSubscriptionSchema
} from "./admin.schemas.js";

describe("admin schemas", () => {
  it("parses company list filters with pagination defaults", () => {
    expect(
      listAdminCompaniesQuerySchema.parse({
        status: "active",
        search: "acme"
      })
    ).toMatchObject({
      status: "active",
      search: "acme",
      limit: 25,
      offset: 0
    });
  });

  it("rejects invalid company status updates", () => {
    expect(() => updateAdminCompanyStatusSchema.parse({ status: "deleted" })).toThrow();
  });

  it("accepts launch placeholder subscription controls", () => {
    expect(
      updateAdminSubscriptionSchema.parse({
        planCode: "growth",
        status: "past_due",
        providerCustomerId: "cus_123"
      })
    ).toMatchObject({
      planCode: "growth",
      status: "past_due",
      providerCustomerId: "cus_123"
    });
  });
});
