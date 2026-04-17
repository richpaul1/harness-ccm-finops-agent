import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Registry } from "../registry/index.js";
import type { HarnessClient } from "../client/harness-client.js";
import type { Config } from "../config.js";

export function registerAllResources(_server: McpServer, _registry: Registry, _client: HarnessClient, _config: Config): void {
  // CCM resources are exposed via harness_ccm_finops_list / harness_ccm_finops_get tools.
  // No standalone MCP resources registered at this time.
}
