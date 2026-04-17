import { describe, it, expect } from "vitest";
import { ccmBusinessMappingListExtract } from "../src/registry/extractors.js";

describe("ccmBusinessMappingListExtract", () => {
  it("uses data.content + totalElements", () => {
    const raw = {
      data: {
        content: [{ uuid: "a" }, { uuid: "b" }],
        totalElements: 42,
      },
    };
    expect(ccmBusinessMappingListExtract(raw)).toEqual({
      items: [{ uuid: "a" }, { uuid: "b" }],
      total: 42,
    });
  });

  it("uses resource.businessMappingDTOList", () => {
    const raw = {
      resource: {
        businessMappingDTOList: [{ name: "Domains" }],
        totalRecords: 7,
      },
    };
    expect(ccmBusinessMappingListExtract(raw)).toEqual({
      items: [{ name: "Domains" }],
      total: 7,
    });
  });

  it("uses bare data array", () => {
    const raw = { data: [{ id: "1" }] };
    expect(ccmBusinessMappingListExtract(raw)).toEqual({
      items: [{ id: "1" }],
      total: 1,
    });
  });
});
