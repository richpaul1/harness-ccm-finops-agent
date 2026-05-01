import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../config.js";
import type { HarnessClient } from "../client/harness-client.js";
import { jsonResult, errorResult } from "../utils/response-formatter.js";
import { isUserError, isUserFixableApiError, toMcpError } from "../utils/errors.js";
import { isRecord } from "../utils/type-guards.js";

/**
 * Shape returned by GET /ng/api/accounts/{accountId} — only the fields we
 * actually surface. Many other fields exist (accountStatus, oauthEnabled, …);
 * we deliberately keep the whoami response narrow.
 */
interface AccountResponseData {
  identifier?: string;
  name?: string;
  companyName?: string;
  accountType?: string;
  accountStatus?: string;
  cluster?: string;
  defaultExperience?: string;
  ringName?: string;
  subdomainURL?: string;
  createdAt?: number;
}

function pickAccountData(raw: unknown): AccountResponseData | undefined {
  if (!isRecord(raw)) return undefined;
  const data = raw.data;
  if (!isRecord(data)) return undefined;
  return data as AccountResponseData;
}

/**
 * Register `harness_ccm_finops_whoami` — a no-input identity probe.
 *
 * Calls `GET /ng/api/accounts/{accountId}` using whatever credentials the
 * current MCP session is configured with (header overrides in HTTP transport,
 * env defaults in stdio) and returns the account's `companyName` plus a
 * one-line `summary` the agent can quote when asked
 * "what account am I connected to?".
 *
 * The tool intentionally does not echo the credential back — it returns only
 * the auth *method* (`cookie` | `bearer` | `apiKey`) for diagnostics.
 */
export function registerCcmWhoamiTool(
  server: McpServer,
  client: HarnessClient,
  config: Config,
): void {
  server.registerTool(
    "harness_ccm_finops_whoami",
    {
      description:
        "Identity probe — returns the Harness account this MCP session is " +
        "connected to. Calls GET /ng/api/accounts/{accountId} and surfaces " +
        "companyName, account name, accountId, base URL, default org/project, " +
        "and which auth method is in use. Use the returned `companyName` (e.g. " +
        "\"TransUnion\") when the user asks questions like \"what account am I " +
        "connected to?\" or \"who am I?\". Does NOT return any credential value.",
      inputSchema: {},
      annotations: {
        title: "Harness Whoami",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async (_args, { signal }) => {
      try {
        const path = `/ng/api/accounts/${encodeURIComponent(client.account)}`;
        const raw = await client.request<unknown>({
          method: "GET",
          path,
          signal,
        });

        const data = pickAccountData(raw);
        if (!data) {
          return errorResult(
            `Unexpected response shape from ${path} — no \`data\` envelope present.`,
          );
        }

        const companyName = data.companyName ?? data.name ?? "";
        const accountName = data.name ?? "";
        const summary = companyName
          ? `Connected to ${companyName} (${client.account}) on ${client.baseUrlPublic}`
          : `Connected to account ${client.account} on ${client.baseUrlPublic}`;

        return jsonResult({
          ok: true,
          summary,
          companyName,
          accountName,
          accountId: client.account,
          accountType: data.accountType,
          accountStatus: data.accountStatus,
          cluster: data.cluster,
          defaultExperience: data.defaultExperience,
          ringName: data.ringName,
          subdomainURL: data.subdomainURL,
          baseUrl: client.baseUrlPublic,
          defaultOrg: config.HARNESS_DEFAULT_ORG_ID,
          defaultProject: config.HARNESS_DEFAULT_PROJECT_ID ?? null,
          authMethod: client.authMethod,
          hint:
            "Use `companyName` when answering \"what account am I connected to?\". " +
            "If `companyName` is empty, fall back to `accountName` then `accountId`.",
        });
      } catch (err) {
        if (isUserError(err)) return errorResult(err.message);
        if (isUserFixableApiError(err)) return errorResult(err.message);
        throw toMcpError(err);
      }
    },
  );
}
