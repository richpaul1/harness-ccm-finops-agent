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

const RawConfigSchema = z
  .object({
  /** PAT / service account token for most Harness APIs (`x-api-key`). */
  HARNESS_API_KEY: z.string().optional(),
  /**
   * Browser/session JWT for CCM only. When set, requests to `/ccm/*` use
   * `Authorization: Bearer …` instead of `x-api-key`. Prefer PAT for automation.
   */
  HARNESS_BEARER_TOKEN: z.string().optional(),
  /**
   * Full browser session cookie string (copied from DevTools → Network → Cookie header).
   * When set, requests to CCM/LW paths include a `Cookie: …` header. The cookie contains
   * the session `token=` value and is the preferred auth for support/browser sessions.
   * Takes precedence over HARNESS_BEARER_TOKEN when both are set on CCM paths.
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
  .superRefine((data, ctx) => {
    const hasKey = Boolean(data.HARNESS_API_KEY?.trim());
    const hasBearer = Boolean(data.HARNESS_BEARER_TOKEN?.trim());
    const hasCookie = Boolean(data.HARNESS_COOKIE?.trim());
    if (!hasKey && !hasBearer && !hasCookie) {
      ctx.addIssue({
        code: "custom",
        message: "At least one auth method is required: HARNESS_API_KEY, HARNESS_BEARER_TOKEN, or HARNESS_COOKIE",
        path: ["HARNESS_API_KEY"],
      });
    }
  });

export const ConfigSchema = RawConfigSchema.transform((data) => {
  const apiKey = data.HARNESS_API_KEY?.trim() || undefined;
  const bearerToken = data.HARNESS_BEARER_TOKEN?.trim() || undefined;
  const cookie = data.HARNESS_COOKIE?.trim() || undefined;
  const accountId =
    data.HARNESS_ACCOUNT_ID?.trim() || (apiKey ? extractAccountIdFromToken(apiKey) : undefined);
  if (!accountId) {
    throw new Error(
      "HARNESS_ACCOUNT_ID is required when HARNESS_API_KEY is missing or not a PAT (pat.<accountId>.<tokenId>.<secret>). Set it explicitly when using HARNESS_BEARER_TOKEN or HARNESS_COOKIE only.",
    );
  }
  return { ...data, HARNESS_API_KEY: apiKey, HARNESS_BEARER_TOKEN: bearerToken, HARNESS_COOKIE: cookie, HARNESS_ACCOUNT_ID: accountId };
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const result = ConfigSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }

  return result.data;
}
