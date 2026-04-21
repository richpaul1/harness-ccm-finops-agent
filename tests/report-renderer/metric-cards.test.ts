import { describe, it, expect } from "vitest";
import { preprocessMetricCards } from "../../src/report-renderer/plugins/metric-cards.js";

describe("preprocessMetricCards", () => {
  it("expands a plain ::: metrics block into a metric-grid div", () => {
    const input = [
      "::: metrics",
      "- label: Spend",
      "  value: $1.2M",
      "  tone: success",
      ":::",
    ].join("\n");
    const out = preprocessMetricCards(input);
    expect(out).toContain('<div class="metric-grid">');
    expect(out).toContain('<div class="metric-card metric-success">');
    expect(out).toContain("<div class=\"metric-label\">Spend</div>");
    expect(out).toContain("<div class=\"metric-value\">$1.2M</div>");
  });

  it("does NOT expand ::: metrics that appears inside a fenced code block", () => {
    const input = [
      "## Intro",
      "",
      "```markdown",
      "::: metrics",
      "- label: Example",
      "  value: 100",
      ":::",
      "```",
      "",
      "Body.",
    ].join("\n");
    const out = preprocessMetricCards(input);
    // The fence body must survive intact — authors demonstrating the
    // pattern should see raw text.
    expect(out).toContain("::: metrics");
    expect(out).toContain("- label: Example");
    expect(out).not.toContain("metric-grid");
    expect(out).not.toContain("metric-card");
  });

  it("does NOT consume a fence's closing delimiter when ::: metrics is inside", () => {
    // Regression: before the fix, the non-greedy regex would look for the
    // NEXT `:::` line, find one later in the document, and swallow the
    // fence's closing ``` plus everything between. This test locks that in.
    const input = [
      "```markdown",
      "::: metrics",
      "- label: Coverage",
      "  value: 62%",
      "```",
      "",
      "::: info Note",
      "This is a real info callout.",
      ":::",
    ].join("\n");
    const out = preprocessMetricCards(input);
    // Fence must still have its closing ``` intact.
    expect(out.match(/```/g)?.length).toBe(2);
    // The real ::: info block outside the fence must be untouched (callouts
    // plugin handles it later).
    expect(out).toContain("::: info Note");
  });

  it("expands real ::: metrics outside a fence, even when a fake one is inside", () => {
    const input = [
      "::: metrics",
      "- label: Real",
      "  value: 1",
      ":::",
      "",
      "```",
      "::: metrics",
      "- label: Fake",
      "  value: 0",
      ":::",
      "```",
    ].join("\n");
    const out = preprocessMetricCards(input);
    const expanded = out.match(/metric-grid/g) ?? [];
    expect(expanded.length).toBe(1);
    expect(out).toContain("- label: Fake"); // fenced example preserved
  });
});
