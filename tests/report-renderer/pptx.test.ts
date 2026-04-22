import { describe, it, expect } from "vitest";

/**
 * The full `renderPptx` pipeline needs a running report server + Chromium,
 * which is out of scope for a unit test. What we *can* smoke-test here is
 * the pptxgenjs interop: the same import + construct + addSlide + addImage +
 * write-to-buffer path that `renderPptx` drives. If this works end-to-end,
 * the Paged.js capture loop on top is the only thing standing between us
 * and a real deck — and that's already tested by the video path.
 */
describe("pptxgenjs interop smoke test", () => {
  it("constructs a PptxGenJS instance, adds a slide, and writes a buffer", async () => {
    const mod = await import("pptxgenjs");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = mod.default as unknown as new () => any;
    const pptx = new Ctor();

    pptx.layout = "LAYOUT_WIDE";
    pptx.author = "test";
    pptx.title = "smoke";

    const slide = pptx.addSlide();
    slide.background = { color: "FFFFFF" };
    // pptxgenjs accepts a 1×1 transparent PNG inline as a quick stand-in for
    // a real captured page screenshot.
    const onePx =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==";
    slide.addImage({ data: onePx, x: 0, y: 0, w: 1, h: 1 });

    const buf = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
    expect(Buffer.isBuffer(buf) || buf instanceof Uint8Array).toBe(true);
    expect(buf.length).toBeGreaterThan(500);
    // .pptx is a ZIP archive.
    const sig = Buffer.from(buf).subarray(0, 4);
    expect(sig[0]).toBe(0x50); // 'P'
    expect(sig[1]).toBe(0x4b); // 'K'
    expect(sig[2]).toBe(0x03);
    expect(sig[3]).toBe(0x04);
  });
});
