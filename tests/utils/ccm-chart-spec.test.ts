import { describe, it, expect } from "vitest";
import { normalizeCcmJsonToChartSpec } from "../../src/utils/ccm-chart-spec.js";

describe("normalizeCcmJsonToChartSpec", () => {
  const max = 120;

  it("accepts explicit spec", () => {
    const r = normalizeCcmJsonToChartSpec(
      {
        kind: "bar",
        title: "Test",
        points: [
          { label: "a", value: 1 },
          { label: "b", value: 2 },
        ],
      },
      max,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.spec.kind).toBe("bar");
      expect(r.spec.points).toHaveLength(2);
    }
  });

  it("extracts perspectiveGrid.data", () => {
    const r = normalizeCcmJsonToChartSpec(
      {
        data: {
          perspectiveGrid: {
            data: [
              { name: "GIS", cost: 100 },
              { name: "GPS", cost: 50 },
            ],
          },
        },
      },
      max,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.spec.kind).toBe("bar");
      expect(r.spec.points[0]).toEqual({ label: "GIS", value: 100 });
    }
  });

  it("extracts perspectiveTimeSeriesStats as line", () => {
    const r = normalizeCcmJsonToChartSpec(
      {
        data: {
          perspectiveTimeSeriesStats: {
            stats: [
              {
                time: 1772841600000,
                values: [{ value: 10 }, { value: 20 }],
              },
              {
                time: 1772928000000,
                values: [{ value: 5 }],
              },
            ],
          },
        },
      },
      max,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.spec.kind).toBe("line");
      expect(r.spec.points).toHaveLength(2);
      expect(r.spec.points[0].value).toBe(30);
    }
  });

  it("rejects empty input", () => {
    const r = normalizeCcmJsonToChartSpec({}, max);
    expect(r.ok).toBe(false);
  });

  it("accepts grouped_bar spec", () => {
    const r = normalizeCcmJsonToChartSpec(
      {
        kind: "grouped_bar",
        title: "Compare",
        series: [
          { key: "current", label: "Current" },
          { key: "previous", label: "Previous" },
        ],
        points: [
          { label: "A", values: { current: 10, previous: 8 } },
          { label: "B", values: { current: 5, previous: 7 } },
        ],
      },
      max,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.spec.kind).toBe("grouped_bar");
      expect(r.spec.points).toHaveLength(2);
    }
  });
});
