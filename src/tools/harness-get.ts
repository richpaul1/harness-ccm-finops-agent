import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Registry } from "../registry/index.js";
import type { HarnessClient } from "../client/harness-client.js";
import { jsonResult, errorResult } from "../utils/response-formatter.js";
import { isUserError, isUserFixableApiError, toMcpError } from "../utils/errors.js";
import { applyUrlDefaults } from "../utils/url-parser.js";
import { asString } from "../utils/type-guards.js";

export function registerGetTool(server: McpServer, registry: Registry, client: HarnessClient): void {
  server.registerTool(
    "harness_ccm_finops_get",
    {
      description: "Get a CCM FinOps resource by ID. Accepts a Harness URL to auto-extract identifiers.",
      // passthrough() preserves any extra top-level keys the agent passes alongside known fields.
      inputSchema: z.object({
        resource_type: z.string().describe("CCM resource type (e.g. cost_perspective, cost_budget, cost_recommendation). Auto-detected from url.").optional(),
        resource_id: z.string().describe("Primary resource identifier. Auto-detected from url.").optional(),
        url: z.string().describe("Harness UI URL — auto-extracts org, project, type, and ID").optional(),
        org_id: z.string().describe("Organization identifier (overrides default)").optional(),
        project_id: z.string().describe("Project identifier (overrides default)").optional(),
        params: z.record(z.string(), z.unknown()).describe("Additional identifiers for nested resources. Call harness_ccm_finops_describe for fields per resource_type.").optional(),
      }).passthrough(),
      annotations: {
        title: "Get CCM FinOps Resource",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const { params, ...rest } = args;
        const input = applyUrlDefaults(rest as Record<string, unknown>, args.url);
        if (params) Object.assign(input, params);
        const resourceType = asString(input.resource_type);
        if (!resourceType) {
          return errorResult("resource_type is required. Provide it explicitly or via a Harness URL.");
        }
        const resourceId = asString(input.resource_id);

        const def = registry.getResource(resourceType);

        const primaryField = def.identifierFields[0];
        if (primaryField && resourceId) {
          input[primaryField] = resourceId;
        }

        const result = await registry.dispatch(client, resourceType, "get", input);
        return jsonResult(result);
      } catch (err) {
        if (isUserError(err)) return errorResult(err.message);
        if (isUserFixableApiError(err)) return errorResult(err.message);
        throw toMcpError(err);
      }
    },
  );
}
