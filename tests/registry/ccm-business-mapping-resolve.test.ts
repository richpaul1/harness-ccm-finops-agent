import { describe, it, expect, vi } from "vitest";
import { resolveBusinessMappingForGroupBy } from "../../src/registry/ccm-business-mapping-resolve.js";
import type { HarnessClient } from "../../src/client/harness-client.js";

describe("resolveBusinessMappingForGroupBy", () => {
  it("finds exact name match and returns uuid as fieldId", async () => {
    const client = {
      request: vi.fn().mockResolvedValue({
        data: {
          content: [
            { uuid: "other-uuid", name: "Other" },
            { uuid: "_Ahbf0HGSsuDh4LnyCYlVw", name: "Business Domains" },
          ],
          totalElements: 2,
        },
      }),
    } as unknown as HarnessClient;

    const r = await resolveBusinessMappingForGroupBy(client, "acct1", "Business Domains");
    expect(r).toEqual({ fieldId: "_Ahbf0HGSsuDh4LnyCYlVw", fieldName: "Business Domains" });
    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/ccm/api/business-mapping",
        params: expect.objectContaining({
          searchKey: "Business Domains",
          routingId: "acct1",
        }),
      }),
    );
  });

  it("throws when no matching name", async () => {
    const client = {
      request: vi.fn().mockResolvedValue({
        data: { content: [{ uuid: "x", name: "Only One" }], totalElements: 1 },
      }),
    } as unknown as HarnessClient;

    await expect(resolveBusinessMappingForGroupBy(client, "acct1", "Missing")).rejects.toThrow(
      /No cost category named "Missing"/,
    );
  });
});
