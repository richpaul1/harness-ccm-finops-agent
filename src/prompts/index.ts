import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerOptimizeCostsPrompt } from "./optimize-costs.js";
import { registerCloudCostBreakdownPrompt } from "./cloud-cost-breakdown.js";
import { registerCommitmentUtilizationPrompt } from "./commitment-utilization.js";
import { registerCostAnomalyPrompt } from "./cost-anomaly.js";
import { registerRightsizingPrompt } from "./rightsizing.js";

export function registerAllPrompts(server: McpServer): void {
  registerOptimizeCostsPrompt(server);
  registerCloudCostBreakdownPrompt(server);
  registerCommitmentUtilizationPrompt(server);
  registerCostAnomalyPrompt(server);
  registerRightsizingPrompt(server);
}
