/**
 * Local PNG chart rendering (no network) — bar and line charts for CCM summaries.
 * Modern Premium Dark Theme enabled.
 */

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import type { CcmChartSpec } from "./ccm-chart-spec.js";

// Modern Dark Theme Colors
const BG = "#09090b"; // Zinc 950
const AXIS = "#27272a"; // Zinc 800
const GRID = "#27272a"; // Zinc 800
const TEXT_PRIMARY = "#f4f4f5"; // Zinc 100
const TEXT_SECONDARY = "#a1a1aa"; // Zinc 400

// Pastel palette — soft tones that read clearly on dark backgrounds
const BAR_TOP = "#93c5fd"; // Blue 300
const BAR_BOTTOM = "#60a5fa"; // Blue 400
const LINE_COLOR = "#93c5fd"; // Blue 300
const LINE_FILL_TOP = "rgba(147, 197, 253, 0.35)";
const LINE_FILL_BOTTOM = "rgba(147, 197, 253, 0.0)";

const GROUPED_COLORS = [
  { top: "#93c5fd", bottom: "#60a5fa" }, // Pastel Blue
  { top: "#fca5a5", bottom: "#f87171" }, // Pastel Red
  { top: "#fdba74", bottom: "#fb923c" }, // Pastel Orange
  { top: "#86efac", bottom: "#4ade80" }, // Pastel Green
  { top: "#d8b4fe", bottom: "#c084fc" }, // Pastel Purple
  { top: "#fde68a", bottom: "#fbbf24" }, // Pastel Yellow
  { top: "#67e8f9", bottom: "#22d3ee" }, // Pastel Cyan
];

export type ChartSize = "medium" | "large";

export const CHART_SIZE_PRESETS: Record<ChartSize, { width: number; height: number; scale: number }> = {
  medium: { width: 960, height: 540, scale: 1 },
  large: { width: 1920, height: 1080, scale: 2 },
};

export interface ChartRenderOptions {
  width: number;
  height: number;
  /** Scaling factor for fonts, padding, line widths, etc. Default: 1 */
  scale?: number;
}

export function renderCcmChartPng(spec: CcmChartSpec, opts: ChartRenderOptions): Buffer {
  const s = opts.scale ?? 1;

  if (spec.kind === "grouped_bar") {
    return renderGroupedBarPng(spec, opts);
  }

  const { width: W, height: H } = opts;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // Layout Padding
  const pad = { l: 72 * s, r: 36 * s, t: (spec.title ? 60 : 40) * s, b: 88 * s };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;

  // Title
  if (spec.title) {
    ctx.fillStyle = TEXT_PRIMARY;
    ctx.font = `bold ${18 * s}px sans-serif`;
    ctx.fillText(spec.title, pad.l, 32 * s);
  }

  const points = spec.points;
  const values = points.map((p) => p.value);
  let vmin = Math.min(...values);
  let vmax = Math.max(...values);
  if (vmin === vmax) {
    vmin = vmin === 0 ? -1 : vmin * 0.9;
    vmax = vmax === 0 ? 1 : vmax * 1.1;
  }
  const padY = (vmax - vmin) * 0.08 || 1;
  if (vmin > 0) vmin = 0;
  else vmin -= padY;
  vmax += padY;

  const x0 = pad.l;
  const y0 = pad.t + plotH;
  const x1 = pad.l + plotW;
  const y1 = pad.t;

  // Horizontal grid lines
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1 * s;
  const gridN = 5;

  ctx.setLineDash([4 * s, 4 * s]);

  for (let g = 0; g <= gridN; g++) {
    const t = g / gridN;
    const y = y0 - t * plotH;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    const v = vmin + t * (vmax - vmin);
    ctx.fillStyle = TEXT_SECONDARY;
    ctx.font = `${12 * s}px sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText(formatTick(v), x0 - 12 * s, y + 4 * s);
  }
  ctx.setLineDash([]);

  // Axis Lines
  ctx.strokeStyle = AXIS;
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y0);
  ctx.moveTo(x0, y0);
  ctx.lineTo(x0, y1);
  ctx.stroke();

  // Y Label
  if (spec.y_label) {
    ctx.save();
    ctx.translate(18 * s, pad.t + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = TEXT_SECONDARY;
    ctx.font = `${12 * s}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(spec.y_label, 0, 0);
    ctx.restore();
  }

  const n = points.length;
  const mapY = (v: number) => y0 - ((v - vmin) / (vmax - vmin)) * plotH;

  if (spec.kind === "bar" && n > 0) {
    const gap = 8 * s;
    const bw = Math.max(4 * s, (plotW - gap * (n + 1)) / n);

    points.forEach((p, i) => {
      const x = x0 + gap + i * (bw + gap);
      const y = mapY(p.value);
      const h = y0 - y;

      const grad = ctx.createLinearGradient(0, y, 0, y0);
      grad.addColorStop(0, BAR_TOP);
      grad.addColorStop(1, BAR_BOTTOM);
      ctx.fillStyle = grad;

      ctx.beginPath();
      ctx.roundRect(x, y, bw, h, [4 * s, 4 * s, 0, 0]);
      ctx.fill();
    });
    drawBarLabels(ctx, points, x0, y0, gap, bw, W, s);

  } else if (spec.kind === "line" && n > 0) {
    const step = n > 1 ? plotW / (n - 1) : plotW;

    // Fill Area under line
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = n === 1 ? x0 + plotW / 2 : x0 + i * step;
      const y = mapY(p.value);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    const lastX = n === 1 ? x0 + plotW / 2 : x0 + (n - 1) * step;
    ctx.lineTo(lastX, y0);
    ctx.lineTo(x0, y0);
    ctx.closePath();

    const fillGrad = ctx.createLinearGradient(0, y1, 0, y0);
    fillGrad.addColorStop(0, LINE_FILL_TOP);
    fillGrad.addColorStop(1, LINE_FILL_BOTTOM);
    ctx.fillStyle = fillGrad;
    ctx.fill();

    // Main Line with Glow
    ctx.save();
    ctx.shadowColor = LINE_COLOR;
    ctx.shadowBlur = 8 * s;
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = 3 * s;
    ctx.lineJoin = "round";
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = n === 1 ? x0 + plotW / 2 : x0 + i * step;
      const y = mapY(p.value);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#93c5fd";
    ctx.lineWidth = 1.5 * s;
    ctx.stroke();
    ctx.restore();

    // Data points (Dots)
    points.forEach((p, i) => {
      const x = n === 1 ? x0 + plotW / 2 : x0 + i * step;
      const y = mapY(p.value);
      ctx.beginPath();
      ctx.arc(x, y, 4 * s, 0, Math.PI * 2);
      ctx.fillStyle = BG;
      ctx.fill();
      ctx.lineWidth = 2 * s;
      ctx.strokeStyle = LINE_COLOR;
      ctx.stroke();
    });

    drawLineLabels(ctx, points, x0, y0, step, n, plotW, s);
  }

  return canvas.toBuffer("image/png");
}

function renderGroupedBarPng(
  spec: Extract<CcmChartSpec, { kind: "grouped_bar" }>,
  opts: ChartRenderOptions,
): Buffer {
  const s = opts.scale ?? 1;
  const { width: W, height: H } = opts;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  const legendH = spec.series.length > 0 ? 32 * s : 0;
  const topBase = (spec.title ? 60 : 40) * s;
  const pad = { l: 72 * s, r: 36 * s, t: topBase + legendH + 8 * s, b: 88 * s };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;

  // Title
  if (spec.title) {
    ctx.fillStyle = TEXT_PRIMARY;
    ctx.font = `bold ${18 * s}px sans-serif`;
    ctx.fillText(spec.title, pad.l, 32 * s);
  }

  // Legend (top, left under title)
  let lx = pad.l;
  const legY = (spec.title ? 48 : 28) * s;
  spec.series.forEach((sr, si) => {
    const colSet = GROUPED_COLORS[si % GROUPED_COLORS.length]!;
    const customCol = sr.color ? { top: sr.color, bottom: sr.color } : colSet;
    const grad = ctx.createLinearGradient(lx, legY, lx, legY + 12 * s);
    grad.addColorStop(0, customCol.top);
    grad.addColorStop(1, customCol.bottom);

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(lx, legY, 12 * s, 12 * s, 2 * s);
    ctx.fill();

    ctx.fillStyle = TEXT_SECONDARY;
    ctx.font = `${13 * s}px sans-serif`;
    ctx.textAlign = "left";
    const lab = sr.label.length > 42 ? `${sr.label.slice(0, 40)}…` : sr.label;
    ctx.fillText(lab, lx + 20 * s, legY + 11 * s);
    lx += ctx.measureText(lab).width + 48 * s;
  });

  const points = spec.points;
  const series = spec.series;
  const k = series.length;
  const allVals: number[] = [];
  for (const p of points) {
    for (const sr of series) {
      const v = p.values[sr.key];
      if (typeof v === "number" && Number.isFinite(v)) allVals.push(v);
    }
  }
  let vmin = allVals.length ? Math.min(...allVals) : 0;
  let vmax = allVals.length ? Math.max(...allVals) : 1;
  if (vmin > 0) vmin = 0;
  if (vmin === vmax) {
    vmin = 0;
    vmax = vmax === 0 ? 1 : vmax * 1.1;
  }
  const padY = (vmax - vmin) * 0.08 || 1;
  if (vmin > 0) vmin = 0;
  else vmin -= padY;
  vmax += padY;

  const x0 = pad.l;
  const y0 = pad.t + plotH;
  const x1 = pad.l + plotW;
  const y1 = pad.t;

  // Grid
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1 * s;
  ctx.setLineDash([4 * s, 4 * s]);
  const gridN = 5;
  for (let g = 0; g <= gridN; g++) {
    const t = g / gridN;
    const y = y0 - t * plotH;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    const v = vmin + t * (vmax - vmin);
    ctx.fillStyle = TEXT_SECONDARY;
    ctx.font = `${12 * s}px sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText(formatTick(v), x0 - 12 * s, y + 4 * s);
  }
  ctx.setLineDash([]);

  // Axis
  ctx.strokeStyle = AXIS;
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y0);
  ctx.moveTo(x0, y0);
  ctx.lineTo(x0, y1);
  ctx.stroke();

  if (spec.y_label) {
    ctx.save();
    ctx.translate(18 * s, pad.t + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = TEXT_SECONDARY;
    ctx.font = `${12 * s}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(spec.y_label, 0, 0);
    ctx.restore();
  }

  const n = points.length;
  const mapY = (v: number) => y0 - ((v - vmin) / (vmax - vmin)) * plotH;
  const gap = 12 * s;
  const groupW = n > 0 ? Math.max(8 * s, (plotW - gap * (n + 1)) / n) : 8 * s;
  const innerPad = 4 * s;
  const barGap = 4 * s;
  const barW =
    k > 0 ? Math.max(4 * s, (groupW - innerPad * 2 - barGap * (k - 1)) / k) : 4 * s;

  for (let i = 0; i < n; i++) {
    const gx = x0 + gap + i * (groupW + gap) + innerPad;
    for (let j = 0; j < k; j++) {
      const sr = series[j];
      if (!sr) continue;

      const colSet = GROUPED_COLORS[j % GROUPED_COLORS.length]!;
      const customCol = sr.color ? { top: sr.color, bottom: sr.color } : colSet;

      const raw = points[i]?.values[sr.key];
      const val = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
      const x = gx + j * (barW + barGap);
      const y = mapY(val);
      const h = y0 - y;

      if (h > 0) {
        const grad = ctx.createLinearGradient(0, y, 0, y0);
        grad.addColorStop(0, customCol.top);
        grad.addColorStop(1, customCol.bottom);
        ctx.fillStyle = grad;

        ctx.beginPath();
        ctx.roundRect(x, y, barW, h, [3 * s, 3 * s, 0, 0]);
        ctx.fill();
      }
    }
  }

  drawBarLabels(ctx, points, x0, y0, gap, groupW, W, s);

  return canvas.toBuffer("image/png");
}

function formatTick(v: number): string {
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  if (Math.abs(v) < 0.01 && v !== 0) return v.toExponential(1);
  return v.toFixed(v % 1 === 0 ? 0 : 2);
}

function drawBarLabels(
  ctx: SKRSContext2D,
  points: { label: string }[],
  x0: number,
  y0: number,
  gap: number,
  bw: number,
  _canvasW: number,
  s: number = 1,
): void {
  const n = points.length;
  if (n === 0) return;

  ctx.fillStyle = TEXT_SECONDARY;
  const fontSize = 11 * s;
  ctx.font = `${fontSize}px sans-serif`;

  const slotWidth = bw + gap;
  const maxLab = Math.max(6, Math.floor(520 / Math.max(n, 1)));

  const sampleLabel = points[0]!.label.slice(0, maxLab);
  const labelWidth = ctx.measureText(sampleLabel).width + 8 * s;
  const fitsHorizontal = labelWidth <= slotWidth;

  if (n <= 20) {
    if (fitsHorizontal) {
      ctx.textAlign = "center";
      for (let i = 0; i < n; i++) {
        const p = points[i]!;
        const x = x0 + gap + i * (bw + gap) + bw / 2;
        const lab = p.label.length > maxLab ? `${p.label.slice(0, maxLab - 1)}…` : p.label;
        ctx.fillText(lab, x, y0 + 18 * s);
      }
      ctx.textAlign = "start";
    } else {
      drawDiagonalBarLabels(ctx, points, x0, y0, gap, bw, maxLab, s);
    }
  } else {
    drawDiagonalBarLabels(ctx, points, x0, y0, gap, bw, maxLab, s);
  }
}

function drawDiagonalBarLabels(
  ctx: SKRSContext2D,
  points: { label: string }[],
  x0: number,
  y0: number,
  gap: number,
  bw: number,
  maxLab: number,
  s: number,
): void {
  const n = points.length;
  const angle = -Math.PI / 5; // ~36 degrees
  const fontSize = 11 * s;
  ctx.font = `${fontSize}px sans-serif`;
  ctx.fillStyle = TEXT_SECONDARY;

  const cosA = Math.cos(-angle);
  const rotatedLabelWidth = ctx.measureText(points[0]!.label.slice(0, maxLab)).width * cosA + 4 * s;
  const slotWidth = bw + gap;
  const showEvery = n > 20 && rotatedLabelWidth > slotWidth
    ? Math.ceil(rotatedLabelWidth / slotWidth)
    : 1;

  for (let i = 0; i < n; i++) {
    if (showEvery > 1 && i % showEvery !== 0 && i !== n - 1) continue;
    const p = points[i]!;
    const x = x0 + gap + i * (bw + gap) + bw / 2;
    const lab = p.label.length > maxLab ? `${p.label.slice(0, maxLab - 1)}…` : p.label;
    ctx.save();
    ctx.translate(x, y0 + 12 * s);
    ctx.rotate(angle);
    ctx.textAlign = "right";
    ctx.fillText(lab, 0, 0);
    ctx.restore();
  }
}

function drawLineLabels(
  ctx: SKRSContext2D,
  points: { label: string }[],
  x0: number,
  y0: number,
  step: number,
  n: number,
  plotW: number,
  s: number = 1,
): void {
  if (n === 0) return;

  ctx.fillStyle = TEXT_SECONDARY;
  const fontSize = 11 * s;
  ctx.font = `${fontSize}px sans-serif`;

  const maxLab = 12;
  const sampleLabel = points[0]!.label.slice(0, maxLab);
  const labelWidth = ctx.measureText(sampleLabel).width + 8 * s;
  const slotWidth = n > 1 ? step : plotW;
  const fitsHorizontal = labelWidth <= slotWidth;

  if (n <= 20) {
    if (fitsHorizontal) {
      ctx.textAlign = "center";
      for (let i = 0; i < n; i++) {
        const p = points[i];
        if (!p) continue;
        const x = n === 1 ? x0 + plotW / 2 : x0 + i * step;
        const lab = p.label.length > maxLab ? `${p.label.slice(0, maxLab - 1)}…` : p.label;
        ctx.fillText(lab, x, y0 + 18 * s);
      }
      ctx.textAlign = "start";
    } else {
      drawDiagonalLineLabels(ctx, points, x0, y0, step, n, plotW, maxLab, s);
    }
  } else {
    drawDiagonalLineLabels(ctx, points, x0, y0, step, n, plotW, maxLab, s);
  }
}

function drawDiagonalLineLabels(
  ctx: SKRSContext2D,
  points: { label: string }[],
  x0: number,
  y0: number,
  step: number,
  n: number,
  plotW: number,
  maxLab: number,
  s: number,
): void {
  const angle = -Math.PI / 5;
  ctx.font = `${11 * s}px sans-serif`;
  ctx.fillStyle = TEXT_SECONDARY;

  const cosA = Math.cos(-angle);
  const rotatedLabelWidth = ctx.measureText(points[0]!.label.slice(0, maxLab)).width * cosA + 4 * s;
  const slotWidth = n > 1 ? step : plotW;
  const showEvery = n > 20 && rotatedLabelWidth > slotWidth
    ? Math.ceil(rotatedLabelWidth / slotWidth)
    : 1;

  for (let i = 0; i < n; i++) {
    if (showEvery > 1 && i % showEvery !== 0 && i !== n - 1) continue;
    const p = points[i];
    if (!p) continue;
    const x = n === 1 ? x0 + plotW / 2 : x0 + i * step;
    const lab = p.label.length > maxLab ? `${p.label.slice(0, maxLab - 1)}…` : p.label;
    ctx.save();
    ctx.translate(x, y0 + 12 * s);
    ctx.rotate(angle);
    ctx.textAlign = "right";
    ctx.fillText(lab, 0, 0);
    ctx.restore();
  }
}
