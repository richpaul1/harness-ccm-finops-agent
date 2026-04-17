import * as z from "zod/v4";
import * as fs from "node:fs";
import * as path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Registry } from "../registry/index.js";
import type { HarnessClient } from "../client/harness-client.js";
import type { Config } from "../config.js";
import { chartResult, errorResult } from "../utils/response-formatter.js";
import { renderCcmChartPng, CHART_SIZE_PRESETS, type ChartSize } from "../utils/ccm-chart-png.js";
import { computeTwoPeriodWindowsBeforeExcludedTail } from "../utils/ccm-period-windows.js";
import { isRecord } from "../utils/type-guards.js";
import { isUserError, isUserFixableApiError, toMcpError } from "../utils/errors.js";

function clampSize(n: number | undefined, fallback: number, max: number, min: number): number {
  const v = n ?? fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

function extractBreakdownCosts(rows: unknown): Map<string, number> {
  const m = new Map<string, number>();
  if (!Array.isArray(rows)) return m;
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const name = row.name ?? row.id;
    const cost = row.cost;
    if (name === undefined || name === null) continue;
    const c = typeof cost === "number" ? cost : Number(cost);
    if (!Number.isFinite(c)) continue;
    m.set(String(name), c);
  }
  return m;
}

/**
 * Two-period grouped bar chart for any CCM cost-category mapping (BUSINESS_MAPPING group-by).
 */
export function registerCcmCostCategoryPeriodChartTool(
  server: McpServer,
  registry: Registry,
  client: HarnessClient,
  config: Config,
): void {
  server.registerTool(
    "harness_ccm_finops_cost_category_chart",
    {
      description:
        "Render a grouped-bar PNG chart comparing cost by **cost category** across two consecutive UTC windows. " +
        "Note: a single harness_ccm_finops_list cost_breakdown call already returns both cost and costTrend (% change vs previous period) per row — use that for data-only comparisons. " +
        "This tool adds a visual chart: it calls cost_breakdown twice with explicit time windows to get absolute dollar values for both periods, then renders current (green) vs previous (red) bars. " +
        "Current window: last N days ending before an excluded trailing tail (default exclude 2 calendar days). " +
        "Previous window: the N days immediately before that. Requires CCM toolset.",
      inputSchema: {
        perspective_id: z.string().min(1).describe("Perspective UUID"),
        cost_category_name: z
          .string()
          .min(1)
          .describe(
            "Exact cost category / business-mapping name to group by (e.g. from harness_ccm_finops_list cost_category). Not limited to Business Domains.",
          ),
        exclude_last_days: z
          .number()
          .int()
          .min(0)
          .max(14)
          .describe("Exclude the most recent N UTC calendar days before defining windows (default 2)")
          .optional(),
        period_days: z
          .number()
          .int()
          .min(1)
          .max(90)
          .describe("Length of each comparison window in UTC days (default 14)")
          .optional(),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .describe("Max breakdown rows per API call (default 100)")
          .optional(),
        chart_size: z
          .enum(["medium", "large"])
          .describe("Chart size preset: medium (1100×620) or large (2200×1240). Overrides width/height when set")
          .optional(),
        width: z.number().min(400).max(4096).describe("PNG width (pixels, ignored when chart_size is set)").optional(),
        height: z.number().min(280).max(4096).describe("PNG height (pixels, ignored when chart_size is set)").optional(),
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
        title: "Cost category period comparison chart",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const excludeLast = args.exclude_last_days ?? 2;
        const periodDays = args.period_days ?? 14;
        const limit = args.limit ?? 100;
        const mappingName = args.cost_category_name.trim();

        const windows = computeTwoPeriodWindowsBeforeExcludedTail(new Date(), {
          excludeLastDays: excludeLast,
          periodDays,
        });

        const base = {
          perspective_id: args.perspective_id,
          group_by: "cost_category",
          business_mapping_name: mappingName,
          limit,
        };

        const cur = await registry.dispatch(
          client,
          "cost_breakdown",
          "list",
          {
            ...base,
            start_time_ms: windows.current.startMs,
            end_time_ms: windows.current.endMs,
            time_filter: "LAST_30_DAYS",
          },
        );

        const prev = await registry.dispatch(
          client,
          "cost_breakdown",
          "list",
          {
            ...base,
            start_time_ms: windows.previous.startMs,
            end_time_ms: windows.previous.endMs,
            time_filter: "LAST_30_DAYS",
          },
        );

        const curItems = isRecord(cur) && Array.isArray(cur.items) ? cur.items : [];
        const prevItems = isRecord(prev) && Array.isArray(prev.items) ? prev.items : [];

        const curMap = extractBreakdownCosts(curItems);
        const prevMap = extractBreakdownCosts(prevItems);
        const names = new Set<string>([...curMap.keys(), ...prevMap.keys()]);
        const sorted = [...names].sort((a, b) => {
          const ma = Math.max(curMap.get(a) ?? 0, prevMap.get(a) ?? 0);
          const mb = Math.max(curMap.get(b) ?? 0, prevMap.get(b) ?? 0);
          return mb - ma || a.localeCompare(b);
        });

        const points = sorted.map((label) => ({
          label,
          values: {
            current: curMap.get(label) ?? 0,
            previous: prevMap.get(label) ?? 0,
          },
        }));

        const shortTitle =
          mappingName.length > 48 ? `${mappingName.slice(0, 46)}…` : mappingName;
        const spec = {
          kind: "grouped_bar" as const,
          title: `${shortTitle} — ${periodDays}d vs prior ${periodDays}d (excl. last ${excludeLast}d)`,
          y_label: "Cost (USD)",
          series: [
            { key: "current", label: `Current: ${windows.currentLegend}`, color: "#86efac" },
            { key: "previous", label: `Previous: ${windows.previousLegend}`, color: "#fca5a5" },
          ],
          points,
        };

        const preset = args.chart_size
          ? {
              width: CHART_SIZE_PRESETS[args.chart_size as ChartSize].scale * 1100,
              height: CHART_SIZE_PRESETS[args.chart_size as ChartSize].scale * 620,
              scale: CHART_SIZE_PRESETS[args.chart_size as ChartSize].scale,
            }
          : undefined;
        const w = preset
          ? preset.width
          : clampSize(args.width, 1100, config.HARNESS_CCM_CHART_MAX_WIDTH, 400);
        const h = preset
          ? preset.height
          : clampSize(args.height, 620, config.HARNESS_CCM_CHART_MAX_HEIGHT, 280);
        const scale = preset?.scale ?? 1;

        const png = renderCcmChartPng(spec, { width: w, height: h, scale });

        const summary: Record<string, unknown> = {
          ok: true,
          kind: "grouped_bar",
          perspective_id: args.perspective_id,
          cost_category_name: mappingName,
          exclude_last_days: excludeLast,
          period_days: periodDays,
          current_window_ms: windows.current,
          previous_window_ms: windows.previous,
          current_legend: windows.currentLegend,
          previous_legend: windows.previousLegend,
          entity_count: points.length,
          chart_size: args.chart_size ?? "medium",
          width_px: w,
          height_px: h,
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
      } catch (err) {
        if (isUserError(err)) return errorResult(err.message);
        if (isUserFixableApiError(err)) return errorResult(err.message);
        throw toMcpError(err);
      }
    },
  );
}
