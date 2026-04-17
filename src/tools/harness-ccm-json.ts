import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../config.js";
import { jsonResult, errorResult } from "../utils/response-formatter.js";
import { normalizeCcmJsonToChartSpec } from "../utils/ccm-chart-spec.js";

/**
 * Normalize CCM API JSON (or chart-ready JSON) into a compact spec for harness_ccm_finops_chart.
 * No network calls; no image output.
 */
export function registerCcmJsonTool(server: McpServer, config: Config): void {
  server.registerTool(
    "harness_ccm_finops_json",
    {
      description:
        "Parse CCM-related JSON (e.g. output from harness_ccm_finops_list cost_breakdown, cost_timeseries, or a hand-authored { kind, points }) and return a normalized chart spec { kind, title?, points } for harness_ccm_finops_chart. Strips unsafe characters from labels. Does not call Harness APIs.",
      inputSchema: {
        json: z
          .string()
          .min(1)
          .describe("JSON string from CCM tools or a chart spec with kind + points[]"),
        kind_hint: z
          .enum(["bar", "line"])
          .describe("When ambiguous, prefer bar (categories) or line (time series)")
          .optional(),
      },
      annotations: {
        title: "Normalize CCM JSON for charts",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(args.json) as unknown;
      } catch {
        return errorResult("Invalid JSON: could not parse");
      }

      const result = normalizeCcmJsonToChartSpec(
        parsed,
        config.HARNESS_CCM_CHART_MAX_POINTS,
        args.kind_hint,
      );
      if (!result.ok) {
        return errorResult(result.error);
      }

      return jsonResult({
        ok: true,
        spec: result.spec,
        hint: "Pass spec to harness_ccm_finops_chart as chart_spec, or use harness_ccm_finops_chart with ccm_json directly.",
      });
    },
  );
}
