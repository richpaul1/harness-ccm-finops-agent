import { describe, it, expect } from "vitest";
import { preprocessCalloutSyntax } from "../../src/report-renderer/plugins/callout-normalize.js";

describe("preprocessCalloutSyntax", () => {
  it("normalizes inline single-line :::callout into canonical block form", () => {
    const input =
      ":::callout info Read the trend. AWS is down 12.8% month-over-month. :::";
    const out = preprocessCalloutSyntax(input);
    expect(out).toContain("::: info");
    expect(out).toContain("Read the trend. AWS is down 12.8% month-over-month.");
    expect(out).toMatch(/:::\s*$/m);
    // No raw `callout` keyword should leak through.
    expect(out).not.toContain(":::callout");
  });

  it("handles inline form with a leading space after :::", () => {
    const input = "::: callout success Benchmark met — RI utilisation 95.1%. :::";
    const out = preprocessCalloutSyntax(input);
    expect(out).toContain("::: success");
    expect(out).toContain("Benchmark met");
  });

  it("strips the `callout` keyword from a multi-line block opener", () => {
    const input = [
      ":::callout warning RDS waste",
      "8,420 unused hours all in us-east-1.",
      ":::",
    ].join("\n");
    const out = preprocessCalloutSyntax(input);
    expect(out).toContain("::: warning RDS waste");
    expect(out).toContain("8,420 unused hours all in us-east-1.");
    expect(out).not.toContain(":::callout");
  });

  it("handles every known callout type", () => {
    for (const type of ["critical", "risk", "warning", "success", "info", "action", "quote"]) {
      const input = `:::callout ${type} hello :::`;
      const out = preprocessCalloutSyntax(input);
      expect(out, `type=${type}`).toContain(`::: ${type}`);
    }
  });

  it("leaves unknown callout types untouched (so typos don't silently render)", () => {
    const input = ":::callout bogusType hello :::";
    const out = preprocessCalloutSyntax(input);
    expect(out).toContain(":::callout bogusType hello :::");
  });

  it("leaves canonical syntax untouched", () => {
    const input = "::: info Already canonical\nbody\n:::";
    const out = preprocessCalloutSyntax(input);
    expect(out).toBe(input);
  });

  it("does NOT rewrite :::callout examples inside fenced code blocks", () => {
    const input = [
      "## Examples of bad syntax we tolerate",
      "",
      "```markdown",
      ":::callout info do not normalise me :::",
      "```",
      "",
      ":::callout success but normalise me :::",
    ].join("\n");
    const out = preprocessCalloutSyntax(input);
    // Fenced example preserved verbatim.
    expect(out).toContain(":::callout info do not normalise me :::");
    // Real callout outside the fence got normalised.
    expect(out).toContain("::: success");
    expect(out).toContain("but normalise me");
  });

  it("does NOT rewrite :::callout inside an inline code span", () => {
    const out = preprocessCalloutSyntax(
      "Authors sometimes write `:::callout info x :::` by mistake.",
    );
    expect(out).toContain("`:::callout info x :::`");
  });

  it("preserves the inline body's punctuation and em-dashes", () => {
    const body =
      "AWS is down 12.8% month-over-month and Azure is down 45% — a clear signal.";
    const out = preprocessCalloutSyntax(`:::callout info ${body} :::`);
    expect(out).toContain(body);
  });
});
