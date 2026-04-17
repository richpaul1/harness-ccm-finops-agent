import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Registry } from "../registry/index.js";
import type { HarnessClient } from "../client/harness-client.js";
import { jsonResult, errorResult } from "../utils/response-formatter.js";
import { isUserError, isUserFixableApiError, toMcpError } from "../utils/errors.js";
import { isRecord } from "../utils/type-guards.js";

interface BudgetItem {
  id: unknown;
  name: unknown;
  perspectiveId: unknown;
  perspectiveName: unknown;
  period: unknown;
  budgetAmount: number;
  actualCost: number;
  forecastCost: number;
  timeLeft: number;
  timeUnit: unknown;
  growthRate: unknown;
  folderId: unknown;
}

interface ClassifiedBudget {
  name: string;
  perspective: string;
  perspective_id: string;
  period: string;
  budget_amount: number;
  actual_cost: number;
  forecast_cost: number;
  pct_actual: number;
  pct_forecast: number;
  time_left_days: number;
}

interface OverBudget extends ClassifiedBudget {
  overage: number;
}

interface AtRisk extends ClassifiedBudget {
  projected_overrun: number;
}

function parseBudgetItem(raw: unknown): BudgetItem | null {
  if (!isRecord(raw)) return null;
  const ba = Number(raw.budgetAmount ?? 0);
  if (!Number.isFinite(ba)) return null;
  return {
    id: raw.id,
    name: raw.name,
    perspectiveId: raw.perspectiveId,
    perspectiveName: raw.perspectiveName,
    period: raw.period,
    budgetAmount: ba,
    actualCost: Number(raw.actualCost ?? 0),
    forecastCost: Number(raw.forecastCost ?? 0),
    timeLeft: Number(raw.timeLeft ?? 0),
    timeUnit: raw.timeUnit,
    growthRate: raw.growthRate,
    folderId: raw.folderId,
  };
}

function pct(value: number, base: number): number {
  if (base <= 0) return 0;
  return Math.round((value / base) * 1000) / 10;
}

export function registerCcmBudgetHealthTool(
  server: McpServer,
  registry: Registry,
  client: HarnessClient,
): void {
  server.registerTool(
    "harness_ccm_finops_budget_health",
    {
      description:
        "Classified budget health sweep. Calls cost_budget list internally and returns " +
        "over_budget, at_risk, and on_track groups with pct_actual, pct_forecast, and projected " +
        "overrun amounts. One call → structured risk assessment, no client-side scripting.",
      inputSchema: {
        search_term: z.string().describe("Search budgets by name").optional(),
        perspective_name: z
          .string()
          .describe("Filter by perspective name(s) (comma-separated)")
          .optional(),
        period: z
          .enum(["MONTHLY", "YEARLY", "DAILY", "WEEKLY"])
          .describe("Only include budgets with this period")
          .optional(),
        min_budget: z
          .number()
          .describe("Skip budgets with budgetAmount below this threshold")
          .default(0)
          .optional(),
        limit: z
          .number()
          .describe("Max budgets to fetch (default 200)")
          .default(200)
          .optional(),
      },
      annotations: {
        title: "Budget Health Sweep",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const input: Record<string, unknown> = {
          resource_type: "cost_budget",
          limit: args.limit ?? 200,
          offset: 0,
        };
        if (args.search_term) input.search_term = args.search_term;
        if (args.perspective_name) input.perspective_name = args.perspective_name;

        const raw = await registry.dispatch(client, "cost_budget", "list", input);
        const result = raw as { items?: unknown[]; total?: number };
        const allItems = Array.isArray(result?.items) ? result.items : [];

        const minBudget = args.min_budget ?? 0;
        const periodFilter = args.period;

        const overBudget: OverBudget[] = [];
        const atRisk: AtRisk[] = [];
        const onTrack: ClassifiedBudget[] = [];
        let skipped = 0;

        for (const rawItem of allItems) {
          const b = parseBudgetItem(rawItem);
          if (!b) continue;

          if (b.budgetAmount <= 0 || b.budgetAmount < minBudget) {
            skipped++;
            continue;
          }

          if (periodFilter && b.period !== periodFilter) {
            skipped++;
            continue;
          }

          const classified: ClassifiedBudget = {
            name: String(b.name ?? ""),
            perspective: String(b.perspectiveName ?? ""),
            perspective_id: String(b.perspectiveId ?? ""),
            period: String(b.period ?? ""),
            budget_amount: b.budgetAmount,
            actual_cost: Math.round(b.actualCost * 100) / 100,
            forecast_cost: Math.round(b.forecastCost * 100) / 100,
            pct_actual: pct(b.actualCost, b.budgetAmount),
            pct_forecast: pct(b.forecastCost, b.budgetAmount),
            time_left_days: b.timeLeft,
          };

          if (b.actualCost > b.budgetAmount) {
            overBudget.push({
              ...classified,
              overage: Math.round((b.actualCost - b.budgetAmount) * 100) / 100,
            });
          } else if (b.forecastCost > b.budgetAmount) {
            atRisk.push({
              ...classified,
              projected_overrun: Math.round((b.forecastCost - b.budgetAmount) * 100) / 100,
            });
          } else {
            onTrack.push(classified);
          }
        }

        overBudget.sort((a, b) => b.overage - a.overage);
        atRisk.sort((a, b) => b.projected_overrun - a.projected_overrun);
        onTrack.sort((a, b) => b.pct_actual - a.pct_actual);

        return jsonResult({
          summary: {
            total: overBudget.length + atRisk.length + onTrack.length,
            over_budget: overBudget.length,
            at_risk: atRisk.length,
            on_track: onTrack.length,
            skipped,
          },
          over_budget: overBudget,
          at_risk: atRisk,
          on_track: onTrack,
        });
      } catch (err) {
        if (isUserError(err)) return errorResult(err.message);
        if (isUserFixableApiError(err)) return errorResult(err.message);
        throw toMcpError(err);
      }
    },
  );
}
