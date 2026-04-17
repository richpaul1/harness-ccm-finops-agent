/**
 * Normalize CCM API JSON (or hand-authored chart JSON) into a small chart spec
 * for local PNG rendering.
 */

import * as z from "zod/v4";
import { isRecord } from "./type-guards.js";
import { clampPoints, sanitizeLabel, sanitizeTitle, sanitizeValue } from "./ccm-chart-sanitize.js";

export type ChartKind = "bar" | "line" | "grouped_bar";

export interface ChartPoint {
  label: string;
  value: number;
}

export interface GroupedBarSeriesDef {
  key: string;
  label: string;
  color?: string;
}

export interface GroupedBarPoint {
  label: string;
  /** Per-series values; must include every series key. */
  values: Record<string, number>;
}

export type CcmChartSpec =
  | { kind: "bar" | "line"; title?: string; y_label?: string; points: ChartPoint[] }
  | {
      kind: "grouped_bar";
      title?: string;
      y_label?: string;
      series: GroupedBarSeriesDef[];
      points: GroupedBarPoint[];
    };

const PointSchema = z.object({
  label: z.string(),
  value: z.coerce.number().finite(),
});

const SpecSchema = z.object({
  kind: z.enum(["bar", "line"]),
  title: z.string().optional(),
  y_label: z.string().optional(),
  points: z.array(PointSchema).min(1),
});

const SeriesSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  color: z.string().optional(),
});

const GroupedPointSchema = z.object({
  label: z.string(),
  values: z.record(z.string(), z.coerce.number().finite()),
});

const GroupedBarSpecSchema = z.object({
  kind: z.literal("grouped_bar"),
  title: z.string().optional(),
  y_label: z.string().optional(),
  series: z.array(SeriesSchema).min(1).max(8),
  points: z.array(GroupedPointSchema).min(1),
});

function formatTimeLabel(ms: number): string {
  try {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return String(ms);
    return d.toISOString().slice(0, 10);
  } catch {
    return String(ms);
  }
}

function extractGridPoints(data: unknown): ChartPoint[] | null {
  if (!isRecord(data)) return null;
  const pg = data.perspectiveGrid;
  if (!isRecord(pg)) return null;
  const rows = pg.data;
  if (!Array.isArray(rows)) return null;
  const out: ChartPoint[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const name = row.name ?? row.id;
    const cost = sanitizeValue(row.cost ?? row.value ?? row.amount);
    if (name === undefined || cost === null) continue;
    out.push({ label: sanitizeLabel(String(name)), value: cost });
  }
  return out.length > 0 ? out : null;
}

function extractTimeSeriesPoints(data: unknown): ChartPoint[] | null {
  if (!isRecord(data)) return null;
  const ts = data.perspectiveTimeSeriesStats;
  if (!isRecord(ts)) return null;
  const stats = ts.stats;
  if (!Array.isArray(stats)) return null;
  const out: ChartPoint[] = [];
  for (const bucket of stats) {
    if (!isRecord(bucket)) continue;
    const time = bucket.time;
    const values = bucket.values;
    if (typeof time !== "number" || !Array.isArray(values)) continue;
    let sum = 0;
    for (const v of values) {
      if (!isRecord(v)) continue;
      const val = sanitizeValue(v.value);
      if (val !== null) sum += val;
    }
    out.push({ label: formatTimeLabel(time), value: sum });
  }
  return out.length > 0 ? out : null;
}

function extractItemsPoints(data: unknown): ChartPoint[] | null {
  if (!isRecord(data)) return null;
  const items = data.items;
  if (!Array.isArray(items)) return null;
  const out: ChartPoint[] = [];
  for (const row of items) {
    if (!isRecord(row)) continue;
    const name = row.name ?? row.id ?? row.label ?? row.key;
    const cost = sanitizeValue(row.cost ?? row.value ?? row.amount);
    if (cost === null) continue;
    const label =
      typeof name === "string" || typeof name === "number"
        ? String(name)
        : isRecord(name) && name.name !== undefined
          ? String(name.name)
          : "item";
    out.push({ label: sanitizeLabel(label), value: cost });
  }
  return out.length > 0 ? out : null;
}

function extractLabelsValues(data: unknown): ChartPoint[] | null {
  if (!isRecord(data)) return null;
  const labels = data.labels;
  const values = data.values;
  if (!Array.isArray(labels) || !Array.isArray(values) || labels.length !== values.length) return null;
  const out: ChartPoint[] = [];
  const n = Math.min(labels.length, values.length);
  for (let i = 0; i < n; i++) {
    const v = sanitizeValue(values[i]);
    if (v === null) continue;
    out.push({ label: sanitizeLabel(String(labels[i])), value: v });
  }
  return out.length > 0 ? out : null;
}

/**
 * Try to build a chart spec from arbitrary JSON (CCM tool output or hand-authored).
 */
export function normalizeCcmJsonToChartSpec(
  raw: unknown,
  maxPoints: number,
  preferredKind?: ChartKind,
): { ok: true; spec: CcmChartSpec } | { ok: false; error: string } {
  if (raw === null || raw === undefined) {
    return { ok: false, error: "JSON is empty" };
  }

  const groupedTry = GroupedBarSpecSchema.safeParse(raw);
  if (groupedTry.success) {
    const keys = new Set(groupedTry.data.series.map((s) => s.key));
    const sanitizedPoints: GroupedBarPoint[] = [];
    for (const p of groupedTry.data.points) {
      const values: Record<string, number> = {};
      for (const k of keys) {
        const v = p.values[k];
        values[k] = typeof v === "number" && Number.isFinite(v) ? v : 0;
      }
      sanitizedPoints.push({ label: sanitizeLabel(p.label), values });
    }
    const clamped = sanitizedPoints.slice(0, maxPoints);
    const spec: CcmChartSpec = {
      kind: "grouped_bar",
      title: sanitizeTitle(groupedTry.data.title),
      y_label: sanitizeTitle(groupedTry.data.y_label),
      series: groupedTry.data.series.map((s) => ({
        key: s.key,
        label: s.label,
        color: s.color,
      })),
      points: clamped,
    };
    return { ok: true, spec };
  }

  // Direct spec: { kind, points, ... }
  const parsed = SpecSchema.safeParse(raw);
  if (parsed.success) {
    const spec: CcmChartSpec = {
      kind: parsed.data.kind,
      title: sanitizeTitle(parsed.data.title),
      y_label: sanitizeTitle(parsed.data.y_label),
      points: clampPoints(
        parsed.data.points.map((p) => ({
          label: sanitizeLabel(p.label),
          value: p.value,
        })),
        maxPoints,
      ),
    };
    return { ok: true, spec };
  }

  // Wrapped in { data: graphql envelope }
  let root: unknown = raw;
  if (isRecord(raw) && "data" in raw && isRecord((raw as { data: unknown }).data)) {
    root = (raw as { data: unknown }).data;
  }

  let points: ChartPoint[] | null = null;
  let kind: "bar" | "line" = preferredKind === "line" ? "line" : "bar";

  points = extractGridPoints(root);
  if (points) kind = "bar";

  if (!points) {
    const ts = extractTimeSeriesPoints(root);
    if (ts) {
      points = ts;
      kind = "line";
    }
  }

  if (!points) {
    points = extractItemsPoints(root);
    if (points) kind = preferredKind === "line" ? "line" : "bar";
  }

  if (!points) {
    points = extractLabelsValues(root);
    if (points) kind = preferredKind === "line" ? "line" : "bar";
  }

  if (!points || points.length === 0) {
    return {
      ok: false,
      error:
        "Could not extract chart points. Pass { kind, points: [{ label, value }] }, or CCM JSON with data.perspectiveGrid.data, data.perspectiveTimeSeriesStats.stats, or items / labels+values.",
    };
  }

  points = clampPoints(
    points.map((p) => ({ label: sanitizeLabel(p.label), value: p.value })),
    maxPoints,
  );

  const title = isRecord(raw) && typeof raw.title === "string" ? sanitizeTitle(raw.title) : undefined;

  return {
    ok: true,
    spec: {
      kind,
      title,
      y_label: sanitizeTitle(isRecord(raw) && typeof raw.y_label === "string" ? raw.y_label : undefined),
      points,
    },
  };
}
