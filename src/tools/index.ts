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
import { registerMarkdownToDocxTool } from "./markdown-to-docx.js";
import { registerCcmMaturityChartTool } from "./harness-ccm-maturity-chart.js";
import { registerCcmReportRenderTool } from "./harness-ccm-report-render.js";
import { registerCcmVideoRenderTool } from "./harness-ccm-video-render.js";
import { registerCcmPptxRenderTool } from "./harness-ccm-pptx-render.js";
import { registerCcmGuideTool } from "./harness-ccm-guide.js";
import { registerCcmFinOpsCurriculumTool } from "./harness-ccm-finops-curriculum.js";
import { registerCcmWhoamiTool } from "./harness-ccm-whoami.js";
import { registerCcmPacksTool } from "./harness-ccm-packs.js";

export function registerAllTools(server: McpServer, registry: Registry, client: HarnessClient, config: Config): void {
  registerListTool(server, registry, client);
  registerGetTool(server, registry, client);
  registerDescribeTool(server, registry);
  registerCcmJsonTool(server, config);
  registerCcmChartTool(server, config);
  registerCcmCostCategoryPeriodChartTool(server, registry, client, config);
  registerCcmBudgetHealthTool(server, registry, client);
  registerMarkdownToPdfTool(server);
  registerMarkdownToDocxTool(server);
  registerCcmMaturityChartTool(server, config);
  registerCcmReportRenderTool(server, config);
  // Voice/narrated-video tool is gated behind HARNESS_VOICE_ENABLED so that
  // (a) the agent doesn't see it as an option when voice isn't configured,
  // and (b) the agent isn't tempted to author <!-- voice: ... --> tags into
  // markdown reports that will never get narrated. Set HARNESS_VOICE_ENABLED=true
  // in .env (plus a TTS provider env var) to expose this tool.
  if (config.HARNESS_VOICE_ENABLED) {
    registerCcmVideoRenderTool(server, config);
  }
  registerCcmPptxRenderTool(server, config);
  registerCcmGuideTool(server);
  registerCcmFinOpsCurriculumTool(server);
  registerCcmWhoamiTool(server, client, config);
  registerCcmPacksTool(server);
}
