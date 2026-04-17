import { describe, it, expect } from "vitest";
import { jsonResult, errorResult, chartResult } from "../../src/utils/response-formatter.js";

describe("jsonResult", () => {
  it("wraps data as text content", () => {
    const result = jsonResult({ count: 42 });
    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify({ count: 42 }) }],
    });
  });

  it("handles arrays", () => {
    const result = jsonResult([1, 2, 3]);
    expect(result.content[0].text).toBe(JSON.stringify([1, 2, 3]));
  });

  it("handles null", () => {
    const result = jsonResult(null);
    expect(result.content[0].text).toBe("null");
  });

  it("handles strings", () => {
    const result = jsonResult("hello");
    expect(result.content[0].text).toBe('"hello"');
  });

  it("does not set isError", () => {
    const result = jsonResult({ ok: true });
    expect(result.isError).toBeUndefined();
  });
});

describe("errorResult", () => {
  it("wraps error message with isError flag", () => {
    const result = errorResult("something broke");
    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify({ error: "something broke" }) }],
      isError: true,
    });
  });

  it("serializes error as JSON object", () => {
    const result = errorResult("not found");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({ error: "not found" });
  });
});

describe("chartResult", () => {
  it("returns text summary and base64 PNG", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const result = chartResult({ ok: true, point_count: 2 }, png);
    expect(result.content).toHaveLength(2);
    expect(result.content[0].type).toBe("text");
    expect(result.content[1]).toEqual({
      type: "image",
      data: png.toString("base64"),
      mimeType: "image/png",
    });
  });
});
