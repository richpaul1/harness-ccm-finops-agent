import * as z from "zod/v4";
import * as fs from "node:fs";
import * as path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../config.js";
import { chartResult, errorResult } from "../utils/response-formatter.js";
import { normalizeCcmJsonToChartSpec } from "../utils/ccm-chart-spec.js";
import { renderCcmChartPng, CHART_SIZE_PRESETS, type ChartSize } from "../utils/ccm-chart-png.js";

function clampSize(n: number | undefined, fallback: number, max: number, min: number): number {
  const v = n ?? fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/**
 * Render a PNG bar or line chart locally from JSON (no external chart APIs).
 */
export function registerCcmChartTool(server: McpServer, config: Config): void {
  server.registerTool(
    "harness_ccm_finops_chart",
    {
      description:
        "Render a PNG chart from JSON. Pass chart_spec: bar/line { kind, title?, y_label?, points: [{ label, value }] }, or grouped_bar { kind: \"grouped_bar\", series: [{ key, label, color? }], points: [{ label, values: { [key]: number } }] } for side-by-side bars (e.g. current vs previous period). Or pass ccm_json (string) from harness_ccm_finops_list — labels sanitized. Local rendering only; returns image/png. Use chart_size to pick medium (960×540) or large (1920×1080).",
      inputSchema: {
        chart_spec: z
          .record(z.string(), z.unknown())
          .describe("Chart spec object: kind (bar|line), optional title/y_label, points array")
          .optional(),
        ccm_json: z
          .string()
          .describe("Alternative: JSON string to normalize (same shapes as harness_ccm_finops_json)")
          .optional(),
        chart_size: z
          .enum(["medium", "large"])
          .describe("Chart size preset: medium (960×540) or large (1920×1080). Overrides width/height when set")
          .optional(),
        width: z
          .number()
          .min(200)
          .max(4096)
          .describe("Image width in pixels (ignored when chart_size is set)")
          .optional(),
        height: z
          .number()
          .min(120)
          .max(4096)
          .describe("Image height in pixels (ignored when chart_size is set)")
          .optional(),
        kind_hint: z.enum(["bar", "line"]).describe("When normalizing ambiguous JSON, prefer bar or line").optional(),
        output_path: z
          .string()
          .describe(
            "ABSOLUTE path to save the PNG to disk (e.g. '/Users/me/project/triage/assets/chart.png'). " +
            "MUST be absolute — relative paths are rejected because the MCP server's cwd differs from your workspace. " +
            "When set the file is written to disk AND returned inline.",
          )
          .optional(),
      },
      annotations: {
        title: "Render CCM chart PNG",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const hasSpec = args.chart_spec && Object.keys(args.chart_spec).length > 0;
      let raw: unknown;
      if (hasSpec) {
        raw = args.chart_spec;
      } else if (args.ccm_json) {
        try {
          raw = JSON.parse(args.ccm_json) as unknown;
        } catch {
          return errorResult("ccm_json is not valid JSON");
        }
      } else {
        return errorResult("Provide chart_spec (non-empty object) or ccm_json (string).");
      }

      const normalized = normalizeCcmJsonToChartSpec(
        raw,
        config.HARNESS_CCM_CHART_MAX_POINTS,
        args.kind_hint,
      );
      if (!normalized.ok) {
        return errorResult(normalized.error);
      }

      const spec = normalized.spec;
      const preset = args.chart_size ? CHART_SIZE_PRESETS[args.chart_size as ChartSize] : undefined;
      const w = preset
        ? preset.width
        : clampSize(args.width, 960, config.HARNESS_CCM_CHART_MAX_WIDTH, 200);
      const h = preset
        ? preset.height
        : clampSize(args.height, 540, config.HARNESS_CCM_CHART_MAX_HEIGHT, 120);
      const scale = preset?.scale ?? 1;

      let png: Buffer;
      try {
        png = renderCcmChartPng(spec, { width: w, height: h, scale });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return errorResult(`Chart render failed: ${msg}`);
      }

      const summary: Record<string, unknown> = {
        ok: true,
        kind: spec.kind,
        title: spec.title,
        point_count: spec.points.length,
        chart_size: args.chart_size ?? "medium",
        width_px: w,
        height_px: h,
        y_label: spec.y_label,
      };

      if (args.output_path) {
        if (!path.isAbsolute(args.output_path)) {
          return errorResult(
            `output_path must be an absolute path (got '${args.output_path}'). ` +
            "Relative paths resolve to the MCP server directory, not your workspace. " +
            "Use the full path, e.g. '/Users/you/project/triage/assets/chart.png'.",
          );
        }
        fs.mkdirSync(path.dirname(args.output_path), { recursive: true });
        fs.writeFileSync(args.output_path, png);
        summary.saved_to = args.output_path;
      }

      return chartResult(summary, png);
    },
  );
}
