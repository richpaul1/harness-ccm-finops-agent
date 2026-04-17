import { describe, it, expect } from "vitest";
import { computeTwoPeriodWindowsBeforeExcludedTail } from "../../src/utils/ccm-period-windows.js";

describe("computeTwoPeriodWindowsBeforeExcludedTail", () => {
  it("excludes last 2 UTC days and builds two 14-day windows", () => {
    const now = new Date(Date.UTC(2026, 3, 8, 12, 0, 0));
    const w = computeTwoPeriodWindowsBeforeExcludedTail(now, { excludeLastDays: 2, periodDays: 14 });

    expect(w.currentLegend).toContain("2026-03-24");
    expect(w.currentLegend).toContain("2026-04-06");
    expect(w.previousLegend).toContain("2026-03-10");
    expect(w.previousLegend).toContain("2026-03-23");

    expect(w.current.endMs).toBeGreaterThan(w.current.startMs);
    expect(w.previous.endMs).toBeGreaterThan(w.previous.startMs);
    expect(w.previous.endMs).toBeLessThan(w.current.startMs);
  });
});
