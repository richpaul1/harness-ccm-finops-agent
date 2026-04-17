/**
 * FinOps Maturity spider chart — segmented-circle (Crawl / Walk / Run rings)
 * with Inform / Optimize / Operate group colouring.
 *
 * Rendered locally with @napi-rs/canvas — no network required.
 */
import * as z from "zod/v4";
import * as fs from "node:fs";
import * as path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../config.js";
import { chartResult, errorResult } from "../utils/response-formatter.js";

// ─── Palette ─────────────────────────────────────────────────────────────────
const BG       = "#09090b";
const TEXT_PRI = "#f4f4f5";
const TEXT_SEC = "#a1a1aa";

const GROUP_PALETTE = {
  inform:   { fill: "#fb923c", muted: "rgba(251,146,60,0.18)",   bubble: "#f59e0b" },
  optimize: { fill: "#60a5fa", muted: "rgba(96,165,250,0.18)",   bubble: "#3b82f6" },
  operate:  { fill: "#a78bfa", muted: "rgba(167,139,250,0.18)",  bubble: "#8b5cf6" },
} as const;

// ─── Dimension layout ─────────────────────────────────────────────────────────
type GroupKey = "inform" | "optimize" | "operate";

interface DimDef {
  key: string;
  label: string[];  // each entry = one line
  group: GroupKey;
}

const DIMS: DimDef[] = [
  { key: "visibility",          label: ["Visibility"],             group: "inform"   },
  { key: "allocation",          label: ["Allocation"],             group: "inform"   },
  { key: "commitment_strategy", label: ["Commitment", "Strategy"], group: "optimize" },
  { key: "anomaly_detection",   label: ["Anomaly", "Detection"],   group: "optimize" },
  { key: "optimization",        label: ["Optimization"],           group: "optimize" },
  { key: "accountability",      label: ["Accountability"],         group: "operate"  },
  { key: "tooling",             label: ["Tooling"],                group: "inform"   },
];

const N = DIMS.length;

// ─── Scoring helpers ──────────────────────────────────────────────────────────
function scoreLabel(s: number): string {
  if (s >= 2.5) return "Run";
  if (s >= 1.5) return "Walk";
  return "Crawl";
}

function subtitleLabel(s: number): string {
  if (s >= 2.75) return "Strong 'Run' Maturity";
  if (s >= 2.5)  return "Nearly 'Run' Maturity";
  if (s >= 2.0)  return "Strong 'Walk' Maturity";
  if (s >= 1.5)  return "Nearly 'Walk' Maturity";
  if (s >= 1.25) return "Strong 'Crawl' Maturity";
  return "'Crawl' Maturity";
}

function avg(scores: Record<string, number>, keys: string[]): number {
  const vals = keys.map((k) => clamp(scores[k] ?? 1));
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function clamp(v: number): number {
  return Math.min(3, Math.max(1, v));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

// ─── Renderer ─────────────────────────────────────────────────────────────────
function renderMaturityPng(scores: Record<string, number>, title: string): Buffer {
  const W = 900;
  const H = 960;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // ── Group sub-scores ──────────────────────────────────────────────────────
  const informKeys   = ["visibility", "allocation", "tooling"];
  const optimizeKeys = ["commitment_strategy", "anomaly_detection", "optimization"];
  const operateKeys  = ["accountability"];

  const informScore   = avg(scores, informKeys);
  const optimizeScore = avg(scores, optimizeKeys);
  const operateScore  = avg(scores, operateKeys);
  const overallScore  = (informScore + optimizeScore + operateScore) / 3;

  // ── Title ─────────────────────────────────────────────────────────────────
  ctx.fillStyle = TEXT_PRI;
  ctx.font = "bold 30px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`${title}: ${round1(overallScore).toFixed(1)}`, W / 2, 50);

  ctx.fillStyle = TEXT_SEC;
  ctx.font = "italic 18px sans-serif";
  ctx.fillText(subtitleLabel(overallScore), W / 2, 78);

  // ── Group bubbles ─────────────────────────────────────────────────────────
  const bubbles = [
    { label: "Inform",   score: informScore,   color: GROUP_PALETTE.inform.bubble   },
    { label: "Optimize", score: optimizeScore, color: GROUP_PALETTE.optimize.bubble },
    { label: "Operate",  score: operateScore,  color: GROUP_PALETTE.operate.bubble  },
  ] as const;

  const bubR  = 38;
  const bubY  = 150;
  const bStep = 200;
  const bX0   = W / 2 - bStep;

  for (let i = 0; i < bubbles.length; i++) {
    const { label, score, color } = bubbles[i]!;
    const bx = bX0 + i * bStep;

    // Circle
    ctx.beginPath();
    ctx.arc(bx, bubY, bubR, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // Score inside
    ctx.fillStyle = "#1c1917";
    ctx.font = "bold 20px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(round1(score).toFixed(1), bx, bubY + 7);

    // Label below
    ctx.fillStyle = TEXT_PRI;
    ctx.font = "bold 15px sans-serif";
    ctx.fillText(label, bx, bubY + bubR + 20);
  }

  // ── Spider chart ──────────────────────────────────────────────────────────
  const CX   = W / 2;
  const CY   = 560;          // vertical centre of radar
  const maxR = 270;          // outer Run ring radius
  const GAP  = 0.022;        // radians gap between adjacent segments

  const startOff = -Math.PI / 2;         // 12 o'clock
  const segAng   = (Math.PI * 2) / N;    // arc per dimension

  const rings      = [maxR / 3, maxR * 2 / 3, maxR];
  const ringLabels = ["Crawl", "Walk", "Run"];

  // Draw each dimension segment
  for (let i = 0; i < N; i++) {
    const dim     = DIMS[i]!;
    const palette = GROUP_PALETTE[dim.group];
    const score   = clamp(scores[dim.key] ?? 1);
    const fillR   = maxR * score / 3;

    const aStart = startOff + i * segAng + GAP;
    const aEnd   = startOff + (i + 1) * segAng - GAP;
    const aMid   = (aStart + aEnd) / 2;

    // Muted full-depth sector (Run ring area — unfilled portion)
    ctx.beginPath();
    ctx.moveTo(CX, CY);
    ctx.arc(CX, CY, maxR, aStart, aEnd);
    ctx.closePath();
    ctx.fillStyle = palette.muted;
    ctx.fill();

    // Filled sector up to score radius
    ctx.beginPath();
    ctx.moveTo(CX, CY);
    ctx.arc(CX, CY, fillR, aStart, aEnd);
    ctx.closePath();
    ctx.fillStyle = palette.fill;
    ctx.fill();

    // Dimension label outside the outer ring
    const labelR  = maxR + 44;
    const lx      = CX + Math.cos(aMid) * labelR;
    const ly      = CY + Math.sin(aMid) * labelR;
    const lineH   = 17;
    const lines   = dim.label;
    const totalH  = (lines.length - 1) * lineH;

    ctx.fillStyle  = TEXT_PRI;
    ctx.font       = "bold 14px sans-serif";
    ctx.textAlign  = "center";
    for (let li = 0; li < lines.length; li++) {
      ctx.fillText(lines[li]!, lx, ly - totalH / 2 + li * lineH + 5);
    }
  }

  // Ring grid lines (drawn over filled segments so they're always visible)
  for (let ri = 0; ri < rings.length; ri++) {
    const r = rings[ri]!;
    ctx.beginPath();
    ctx.arc(CX, CY, r, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth   = ri === rings.length - 1 ? 1.5 : 1;
    ctx.stroke();
  }

  // Segment divider lines (bg colour — creates gaps between sectors)
  for (let i = 0; i < N; i++) {
    const angle = startOff + i * segAng;
    ctx.beginPath();
    ctx.moveTo(CX, CY);
    ctx.lineTo(CX + Math.cos(angle) * maxR, CY + Math.sin(angle) * maxR);
    ctx.strokeStyle = BG;
    ctx.lineWidth   = 2.5;
    ctx.stroke();
  }

  // Ring labels (Crawl / Walk / Run) — positioned on the Accountability-Tooling
  // divider line (lower-left), inside each ring midpoint.
  const labelDivAngle = startOff + 6 * segAng;   // boundary between dim 5 and dim 6
  const ringMidRs     = [maxR / 6, maxR / 2, maxR * 5 / 6];

  for (let ri = 0; ri < ringMidRs.length; ri++) {
    const r  = ringMidRs[ri]!;
    const rx = CX + Math.cos(labelDivAngle) * r;
    const ry = CY + Math.sin(labelDivAngle) * r;
    const tw = 38;  // approximate half-width cap for bg rect

    // Subtle dark pill background
    ctx.fillStyle = "rgba(9,9,11,0.72)";
    ctx.beginPath();
    ctx.roundRect(rx - tw, ry - 9, tw * 2, 16, 4);
    ctx.fill();

    ctx.fillStyle  = TEXT_SEC;
    ctx.font       = "11px sans-serif";
    ctx.textAlign  = "center";
    ctx.fillText(ringLabels[ri]!, rx, ry + 3);
  }

  // Centre dot
  ctx.beginPath();
  ctx.arc(CX, CY, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = TEXT_SEC;
  ctx.fill();

  return canvas.toBuffer("image/png") as Buffer;
}

// ─── Tool registration ────────────────────────────────────────────────────────
export function registerCcmMaturityChartTool(server: McpServer, _config: Config): void {
  server.registerTool(
    "harness_ccm_finops_maturity_chart",
    {
      description:
        "Render a FinOps Maturity spider chart (segmented-circle with Crawl / Walk / Run rings) " +
        "from per-dimension scores and return an inline PNG plus a JSON summary. " +
        "Seven dimensions map to three FinOps groups: " +
        "Inform (visibility, allocation, tooling), " +
        "Optimize (commitment_strategy, anomaly_detection, optimization), " +
        "Operate (accountability). " +
        "Scores range from 1 (Crawl) to 3 (Run); fractional values are supported (e.g. 1.5, 2.3). " +
        "The tool computes group sub-scores and an overall score automatically. " +
        "Pass output_path (absolute) to also save the PNG to disk.",
      inputSchema: z.object({
        scores: z.object({
          visibility:          z.number().min(1).max(3).describe("Visibility score — 1 Crawl · 2 Walk · 3 Run"),
          allocation:          z.number().min(1).max(3).describe("Allocation / chargeback score"),
          commitment_strategy: z.number().min(1).max(3).describe("Commitment Strategy (RI / SP coverage) score"),
          anomaly_detection:   z.number().min(1).max(3).describe("Anomaly Detection score"),
          optimization:        z.number().min(1).max(3).describe("Optimization (AutoStopping + recommendations) score"),
          accountability:      z.number().min(1).max(3).describe("Accountability / governance score"),
          tooling:             z.number().min(1).max(3).describe("Tooling adoption score"),
        }).describe("Per-dimension maturity scores (1 = Crawl, 2 = Walk, 3 = Run; fractions allowed)"),
        title: z
          .string()
          .describe("Chart title prefix, e.g. customer name. Displayed as '<title>: X.X'. Default: 'FinOps Maturity Score'.")
          .optional(),
        output_path: z
          .string()
          .describe(
            "ABSOLUTE path to save the PNG to disk " +
            "(e.g. '/Users/me/project/reports/maturity.png'). " +
            "Relative paths are rejected. File is also returned inline.",
          )
          .optional(),
      }),
      annotations: {
        title: "Render FinOps Maturity Chart",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const scores = args.scores as Record<string, number>;
        const title  = (args.title as string | undefined) ?? "FinOps Maturity Score";

        const pngBuffer = renderMaturityPng(scores, title);

        // Optional disk write
        if (args.output_path) {
          const outPath = String(args.output_path);
          if (!path.isAbsolute(outPath)) {
            return errorResult("output_path must be an absolute path — relative paths resolve to the MCP server's cwd, not your workspace.");
          }
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          fs.writeFileSync(outPath, pngBuffer);
        }

        // JSON summary
        const informKeys   = ["visibility", "allocation", "tooling"];
        const optimizeKeys = ["commitment_strategy", "anomaly_detection", "optimization"];
        const operateKeys  = ["accountability"];
        const informScore   = avg(scores, informKeys);
        const optimizeScore = avg(scores, optimizeKeys);
        const operateScore  = avg(scores, operateKeys);
        const overallScore  = (informScore + optimizeScore + operateScore) / 3;

        const summary = {
          overall_score: round1(overallScore),
          overall_label: scoreLabel(overallScore),
          groups: {
            inform:   { score: round1(informScore),   label: scoreLabel(informScore),   dimensions: informKeys },
            optimize: { score: round1(optimizeScore), label: scoreLabel(optimizeScore), dimensions: optimizeKeys },
            operate:  { score: round1(operateScore),  label: scoreLabel(operateScore),  dimensions: operateKeys },
          },
          dimensions: Object.fromEntries(
            DIMS.map((d) => [
              d.key,
              { score: round1(clamp(scores[d.key] ?? 1)), label: scoreLabel(scores[d.key] ?? 1), group: d.group },
            ]),
          ),
        };

        return chartResult(summary, pngBuffer);
      } catch (err) {
        return errorResult(`Maturity chart render failed: ${(err as Error).message}`);
      }
    },
  );
}
