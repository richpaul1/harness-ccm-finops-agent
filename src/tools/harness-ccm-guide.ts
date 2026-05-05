import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadGuide(): string {
  const guidePath = resolve(__dirname, "..", "docs", "finops-guide.md");
  return readFileSync(guidePath, "utf8");
}

export function registerCcmGuideTool(server: McpServer): void {
  server.registerTool(
    "harness_ccm_finops_guide",
    {
      description:
        "Return the complete Harness CCM FinOps agent guide as markdown. " +
        "Call this at the start of any session to understand all available tools, " +
        "calling conventions, resource types, group_by dimensions, time filter presets, " +
        "spike investigation patterns, anomaly triage, recommendations, budgets, " +
        "commitment orchestration, AutoStopping, maturity charts, report rendering, " +
        "the full BVR (Business Value Review) playbook with per-section agent queries, " +
        "and the Customer Report Pack system (per-customer branded report families with " +
        "their own theme + custom blocks + agent playbook — see Section 20 and the " +
        "harness_ccm_finops_packs tool for discovery).",
      inputSchema: {},
      annotations: {
        title: "FinOps Agent Guide",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const guide = loadGuide();
      return {
        content: [{ type: "text", text: guide }],
      };
    }
  );
}
