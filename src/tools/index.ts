import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Registry } from "../registry/index.js";
import type { HarnessClient } from "../client/harness-client.js";
import type { Config } from "../config.js";

import { registerListTool } from "./harness-list.js";
import { registerGetTool } from "./harness-get.js";
import { registerDescribeTool } from "./harness-describe.js";
import { registerCcmJsonTool } from "./harness-ccm-json.js";
import { registerCcmChartTool } from "./harness-ccm-chart.js";
import { registerCcmCostCategoryPeriodChartTool } from "./harness-ccm-cost-category-period-chart.js";
import { registerCcmBudgetHealthTool } from "./harness-ccm-budget-health.js";
import { registerMarkdownToPdfTool } from "./markdown-to-pdf.js";
import { registerCcmMaturityChartTool } from "./harness-ccm-maturity-chart.js";
import { registerCcmReportRenderTool } from "./harness-ccm-report-render.js";
import { registerCcmGuideTool } from "./harness-ccm-guide.js";
import { registerCcmFinOpsCurriculumTool } from "./harness-ccm-finops-curriculum.js";

export function registerAllTools(server: McpServer, registry: Registry, client: HarnessClient, config: Config): void {
  registerListTool(server, registry, client);
  registerGetTool(server, registry, client);
  registerDescribeTool(server, registry);
  registerCcmJsonTool(server, config);
  registerCcmChartTool(server, config);
  registerCcmCostCategoryPeriodChartTool(server, registry, client, config);
  registerCcmBudgetHealthTool(server, registry, client);
  registerMarkdownToPdfTool(server);
  registerCcmMaturityChartTool(server, config);
  registerCcmReportRenderTool(server, config);
  registerCcmGuideTool(server);
  registerCcmFinOpsCurriculumTool(server);
}
