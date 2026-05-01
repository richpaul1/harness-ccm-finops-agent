import * as z from "zod/v4";

/**
 * Extract the account ID from a Harness PAT token.
 * PAT format: pat.<accountId>.<tokenId>.<secret>
 * Returns undefined if the token doesn't match the expected format.
 */
export function extractAccountIdFromToken(apiKey: string): string | undefined {
  const parts = apiKey.split(".");
  const accountId = parts[1];
  if (parts.length >= 3 && parts[0] === "pat" && accountId && accountId.length > 0) {
    return accountId;
  }
  return undefined;
}

/**
 * Global (process-wide) config schema. Auth fields are optional here — they
 * act as fallback defaults that may be overridden per-session via HTTP headers
 * in `buildSessionConfig` (see below).
 */
const GlobalConfigSchema = z
  .object({
    /** PAT / service account token for most Harness APIs (`x-api-key`). Default. */
    HARNESS_API_KEY: z.string().optional(),
    /**
     * Browser/session JWT for CCM only. When set, requests to `/ccm/*` use
     * `Authorization: Bearer …` instead of `x-api-key`. Prefer PAT for automation.
     * Default — overridable per-session via X-Harness-Token.
     */
    HARNESS_BEARER_TOKEN: z.string().optional(),
    /**
     * Full browser session cookie string (copied from DevTools → Network → Cookie header).
     * When set, requests to CCM/LW paths include a `Cookie: …` header. The cookie contains
     * the session `token=` value and is the preferred auth for support/browser sessions.
     * Takes precedence over HARNESS_BEARER_TOKEN when both are set on CCM paths.
     * Default — overridable per-session via X-Harness-Cookie.
     */
    HARNESS_COOKIE: z.string().optional(),
    HARNESS_ACCOUNT_ID: z.string().optional(),
    HARNESS_BASE_URL: z.string().url().default("https://app.harness.io"),
    HARNESS_DEFAULT_ORG_ID: z.string().default("default"),
    HARNESS_DEFAULT_PROJECT_ID: z.string().optional(),
    HARNESS_API_TIMEOUT_MS: z.coerce.number().default(30000),
    HARNESS_MAX_RETRIES: z.coerce.number().default(3),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    HARNESS_TOOLSETS: z.string().optional(),
    HARNESS_MAX_BODY_SIZE_MB: z.coerce.number().default(10),
    HARNESS_RATE_LIMIT_RPS: z.coerce.number().default(10),
    HARNESS_READ_ONLY: z.coerce.boolean().default(false),
    /** Max width for harness_ccm_chart PNG output (pixels). Must accommodate large preset (1920+). */
    HARNESS_CCM_CHART_MAX_WIDTH: z.coerce.number().min(200).max(4096).default(2200),
    /** Max height for harness_ccm_chart PNG output (pixels). Must accommodate large preset (1080+). */
    HARNESS_CCM_CHART_MAX_HEIGHT: z.coerce.number().min(120).max(4096).default(1240),
    /** Max data points per chart (sanitized slice). */
    HARNESS_CCM_CHART_MAX_POINTS: z.coerce.number().min(1).max(500).default(120),
    /**
     * Report renderer port — only used in stdio transport mode where there is no
     * MCP HTTP app to mount onto. In HTTP mode, reports share the MCP `PORT`
     * (default 3000) at `http://localhost:<PORT>/reports/<id>/`.
     */
    HARNESS_REPORT_PORT: z.coerce.number().min(1).max(65535).default(4321),
  })
  .transform((data) => ({
    ...data,
    HARNESS_API_KEY: data.HARNESS_API_KEY?.trim() || undefined,
    HARNESS_BEARER_TOKEN: data.HARNESS_BEARER_TOKEN?.trim() || undefined,
    HARNESS_COOKIE: data.HARNESS_COOKIE?.trim() || undefined,
    HARNESS_ACCOUNT_ID: data.HARNESS_ACCOUNT_ID?.trim() || undefined,
  }));

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

/**
 * Auth-related fields that can be overridden per-session via HTTP headers.
 * Anything else stays on GlobalConfig (process-wide).
 */
export interface SessionAuthOverrides {
  HARNESS_API_KEY?: string;
  HARNESS_BEARER_TOKEN?: string;
  HARNESS_COOKIE?: string;
  HARNESS_ACCOUNT_ID?: string;
  HARNESS_BASE_URL?: string;
  HARNESS_DEFAULT_ORG_ID?: string;
  HARNESS_DEFAULT_PROJECT_ID?: string;
}

/**
 * The effective per-session config — all fields resolved, ready for
 * HarnessClient and Registry construction.
 */
export type Config = Omit<
  GlobalConfig,
  | "HARNESS_API_KEY"
  | "HARNESS_BEARER_TOKEN"
  | "HARNESS_COOKIE"
  | "HARNESS_ACCOUNT_ID"
  | "HARNESS_BASE_URL"
  | "HARNESS_DEFAULT_ORG_ID"
  | "HARNESS_DEFAULT_PROJECT_ID"
> & {
  HARNESS_API_KEY?: string;
  HARNESS_BEARER_TOKEN?: string;
  HARNESS_COOKIE?: string;
  HARNESS_ACCOUNT_ID: string;
  HARNESS_BASE_URL: string;
  HARNESS_DEFAULT_ORG_ID: string;
  HARNESS_DEFAULT_PROJECT_ID?: string;
};

/**
 * Thrown by `buildSessionConfig` when the merged auth context is incomplete.
 * The HTTP transport layer maps this to a 401 with `missing` listed.
 */
export class SessionAuthError extends Error {
  readonly missing: string[];
  constructor(message: string, missing: string[]) {
    super(message);
    this.name = "SessionAuthError";
    this.missing = missing;
  }
}

/**
 * Load process-wide (non-auth) config from environment. Auth defaults are
 * also captured here but are not validated until `buildSessionConfig` runs.
 */
export function loadGlobalConfig(): GlobalConfig {
  const result = GlobalConfigSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return result.data;
}

/** Trim and treat empty string as undefined. */
function clean(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Merge per-session auth overrides on top of the global env defaults and
 * validate that the result has at least one auth method + an account id.
 *
 * Throws `SessionAuthError` listing the missing fields when validation fails,
 * so the HTTP transport can return a clear 401 to the client.
 */
export function buildSessionConfig(
  global: GlobalConfig,
  overrides: SessionAuthOverrides,
): Config {
  const apiKey = clean(overrides.HARNESS_API_KEY) ?? global.HARNESS_API_KEY;
  const bearerToken = clean(overrides.HARNESS_BEARER_TOKEN) ?? global.HARNESS_BEARER_TOKEN;
  const cookie = clean(overrides.HARNESS_COOKIE) ?? global.HARNESS_COOKIE;
  const baseUrl = clean(overrides.HARNESS_BASE_URL) ?? global.HARNESS_BASE_URL;
  const defaultOrgId =
    clean(overrides.HARNESS_DEFAULT_ORG_ID) ?? global.HARNESS_DEFAULT_ORG_ID;
  const defaultProjectId =
    clean(overrides.HARNESS_DEFAULT_PROJECT_ID) ?? global.HARNESS_DEFAULT_PROJECT_ID;

  const explicitAccountId =
    clean(overrides.HARNESS_ACCOUNT_ID) ?? global.HARNESS_ACCOUNT_ID;
  const accountId =
    explicitAccountId ?? (apiKey ? extractAccountIdFromToken(apiKey) : undefined);

  const missing: string[] = [];
  if (!apiKey && !bearerToken && !cookie) {
    missing.push(
      "auth (one of X-Harness-Token, X-Harness-Cookie, X-Harness-Api-Key, or set HARNESS_BEARER_TOKEN/HARNESS_COOKIE/HARNESS_API_KEY in .env)",
    );
  }
  if (!accountId) {
    missing.push(
      "account (X-Harness-Account header, or HARNESS_ACCOUNT_ID in .env, or a PAT api key in the form pat.<accountId>.<tokenId>.<secret>)",
    );
  }

  if (missing.length > 0) {
    throw new SessionAuthError(
      `Missing required Harness credentials: ${missing.join("; ")}`,
      missing,
    );
  }

  return {
    HARNESS_API_KEY: apiKey,
    HARNESS_BEARER_TOKEN: bearerToken,
    HARNESS_COOKIE: cookie,
    HARNESS_ACCOUNT_ID: accountId!,
    HARNESS_BASE_URL: baseUrl,
    HARNESS_DEFAULT_ORG_ID: defaultOrgId,
    HARNESS_DEFAULT_PROJECT_ID: defaultProjectId,
    HARNESS_API_TIMEOUT_MS: global.HARNESS_API_TIMEOUT_MS,
    HARNESS_MAX_RETRIES: global.HARNESS_MAX_RETRIES,
    LOG_LEVEL: global.LOG_LEVEL,
    HARNESS_TOOLSETS: global.HARNESS_TOOLSETS,
    HARNESS_MAX_BODY_SIZE_MB: global.HARNESS_MAX_BODY_SIZE_MB,
    HARNESS_RATE_LIMIT_RPS: global.HARNESS_RATE_LIMIT_RPS,
    HARNESS_READ_ONLY: global.HARNESS_READ_ONLY,
    HARNESS_CCM_CHART_MAX_WIDTH: global.HARNESS_CCM_CHART_MAX_WIDTH,
    HARNESS_CCM_CHART_MAX_HEIGHT: global.HARNESS_CCM_CHART_MAX_HEIGHT,
    HARNESS_CCM_CHART_MAX_POINTS: global.HARNESS_CCM_CHART_MAX_POINTS,
    HARNESS_REPORT_PORT: global.HARNESS_REPORT_PORT,
  };
}
