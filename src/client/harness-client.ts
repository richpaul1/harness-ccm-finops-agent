import type { Config } from "../config.js";
import type { RequestOptions } from "./types.js";
import { HarnessApiError } from "../utils/errors.js";
import { RateLimiter } from "../utils/rate-limiter.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("harness-client");

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const BASE_BACKOFF_MS = 1000;

/** Strip HTML tags and collapse whitespace — used for non-JSON error bodies. */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/** Produce a clean, actionable error message for non-JSON HTTP error responses. */
function humanizeHttpError(status: number, rawBody: string): string {
  const isHtml = /^\s*</.test(rawBody);
  const hint = isHtml ? stripHtml(rawBody).slice(0, 120) : rawBody.slice(0, 200);

  switch (status) {
    case 401:
      return `HTTP 401 Unauthorized — invalid or expired credentials. For most APIs use HARNESS_API_KEY (PAT/SA). For CCM with a session JWT, set HARNESS_BEARER_TOKEN (CCM paths only).${hint ? ` (${hint})` : ""}`;
    case 403:
      return `HTTP 403 Forbidden — access denied. Possible causes: wrong HARNESS_ACCOUNT_ID, IP restrictions, missing RBAC permissions, or corporate proxy/WAF blocking the request.${hint ? ` (${hint})` : ""}`;
    case 404:
      return `HTTP 404 Not Found — the API endpoint or resource does not exist. Verify the base URL and resource identifiers.${hint ? ` (${hint})` : ""}`;
    default:
      return `HTTP ${status}: ${hint || "empty response"}`;
  }
}

const MAX_TIMEOUT_LOG_BODY = 12_000;
const MAX_TIMEOUT_LOG_GRAPHQL = 16_000;
const MAX_TIMEOUT_LOG_VARS = 4_000;

/**
 * Request snapshot for timeout / exhausted-retry logs: path, params, and body or GraphQL query (truncated).
 * Does not include auth headers or API keys.
 */
function summarizeRequestForTimeoutLog(options: RequestOptions, timeoutMs: number): Record<string, unknown> {
  const method = options.method ?? "GET";
  const path = options.path;
  const snapshot: Record<string, unknown> = {
    method,
    path,
    timeoutMs,
  };

  if (options.params && Object.keys(options.params).length > 0) {
    snapshot.queryParams = JSON.stringify(options.params).slice(0, 4000);
  }

  if (options.body === undefined || options.body === null) {
    return snapshot;
  }

  if (
    typeof options.body === "object" &&
    !Array.isArray(options.body) &&
    typeof (options.body as { query?: unknown }).query === "string"
  ) {
    const b = options.body as { query: string; variables?: unknown };
    const graphql: Record<string, unknown> = {
      queryLength: b.query.length,
      query:
        b.query.length > MAX_TIMEOUT_LOG_GRAPHQL
          ? `${b.query.slice(0, MAX_TIMEOUT_LOG_GRAPHQL)}...(truncated)`
          : b.query,
    };
    if (b.variables !== undefined) {
      const vars = JSON.stringify(b.variables);
      graphql.variablesLength = vars.length;
      graphql.variables =
        vars.length > MAX_TIMEOUT_LOG_VARS ? `${vars.slice(0, MAX_TIMEOUT_LOG_VARS)}...(truncated)` : vars;
    }
    snapshot.graphql = graphql;
    return snapshot;
  }

  const raw = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  snapshot.bodyLength = raw.length;
  snapshot.bodyPreview =
    raw.length > MAX_TIMEOUT_LOG_BODY ? `${raw.slice(0, MAX_TIMEOUT_LOG_BODY)}...(truncated)` : raw;
  return snapshot;
}

export class HarnessClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly bearerToken: string | undefined;
  private readonly cookie: string | undefined;
  private readonly accountId: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly rateLimiter: RateLimiter;

  constructor(config: Config) {
    this.baseUrl = config.HARNESS_BASE_URL.replace(/\/$/, "");
    this.apiKey = config.HARNESS_API_KEY;
    this.bearerToken = config.HARNESS_BEARER_TOKEN;
    this.cookie = config.HARNESS_COOKIE;
    this.accountId = config.HARNESS_ACCOUNT_ID;
    this.timeout = config.HARNESS_API_TIMEOUT_MS;
    this.maxRetries = config.HARNESS_MAX_RETRIES;
    this.rateLimiter = new RateLimiter(config.HARNESS_RATE_LIMIT_RPS);
  }

  get account(): string {
    return this.accountId;
  }

  get baseUrlPublic(): string {
    return this.baseUrl;
  }

  /**
   * Which auth method is configured for this client, in order of CCM-path
   * precedence (cookie > bearer > apiKey). Useful for diagnostics like the
   * whoami tool — never returns the credential value itself.
   */
  get authMethod(): "cookie" | "bearer" | "apiKey" | "none" {
    if (this.cookie) return "cookie";
    if (this.bearerToken) return "bearer";
    if (this.apiKey) return "apiKey";
    return "none";
  }

  async request<T>(options: RequestOptions): Promise<T> {
    await this.rateLimiter.acquire();

    const method = options.method ?? "GET";
    const path = options.path;
    const requestWallStart = performance.now();
    const url = this.buildUrl(options);
    const headers: Record<string, string> = {
      "Harness-Account": this.accountId,
      ...options.headers,
    };

    const ccmPath = options.path.includes("/ccm/") || options.path.includes("/lw/");
    if (ccmPath && this.cookie) {
      // Cookie auth takes precedence for CCM/LW paths — full browser session cookie string.
      headers["Cookie"] = this.cookie;
    } else if (ccmPath && this.bearerToken) {
      headers["Authorization"] = `Bearer ${this.bearerToken}`;
    } else if (this.apiKey) {
      headers["x-api-key"] = this.apiKey;
    } else if (this.bearerToken) {
      // Non-CCM path with no API key — fall back to the session JWT. Required
      // for multi-tenant header-only sessions hitting endpoints like
      // /ng/api/accounts/{accountId} (whoami) which accept Authorization: Bearer.
      headers["Authorization"] = `Bearer ${this.bearerToken}`;
    } else if (this.cookie) {
      // Last-resort fallback for non-CCM paths when only a browser cookie is available.
      headers["Cookie"] = this.cookie;
    } else {
      throw new HarnessApiError(
        "No Harness credentials available for this request. Provide HARNESS_API_KEY, HARNESS_BEARER_TOKEN, or HARNESS_COOKIE (in .env, or as X-Harness-* request headers in HTTP transport mode).",
        400,
      );
    }

    if (options.body) {
      if (typeof options.body === "string") {
        headers["Content-Type"] = headers["Content-Type"] ?? "application/yaml";
      } else {
        headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
      }
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt - 1) * (0.5 + Math.random() * 0.5);
        log.debug(`Retry attempt ${attempt}/${this.maxRetries}`, { backoffMs: Math.round(backoff) });
        await new Promise((r) => setTimeout(r, backoff));
      }

      const attemptStart = performance.now();

      try {
        // Check if already aborted before starting the request
        if (options.signal?.aborted) {
          throw options.signal.reason ?? new DOMException("The operation was aborted", "AbortError");
        }

        const timeoutController = new AbortController();
        const timer = setTimeout(() => timeoutController.abort(), this.timeout);
        // Merge external signal (client disconnect) with timeout signal
        const signal = options.signal
          ? AbortSignal.any([options.signal, timeoutController.signal])
          : timeoutController.signal;

        const bodyString = options.body
          ? (typeof options.body === "string" ? options.body : JSON.stringify(options.body))
          : undefined;
        const requestBodyBytes = bodyString?.length ?? 0;
        const requestBody = bodyString ? bodyString.slice(0, 1000) : undefined;

        log.info("Harness API request", { method, path, url });
        if (bodyString) {
          log.debug("Request body", { body: requestBody });
        }

        const response = await fetch(url, {
          method,
          headers,
          body: bodyString,
          signal,
        });

        clearTimeout(timer);

        const attemptDurationMs = Math.round(performance.now() - attemptStart);
        const totalDurationMs = Math.round(performance.now() - requestWallStart);

        if (!response.ok) {
          const body = await response.text();
          let parsed: { message?: string; code?: string; correlationId?: string } = {};
          try {
            parsed = JSON.parse(body);
          } catch {
            // Non-JSON error (HTML proxy page, WAF block, etc.)
            // Provide actionable messages instead of leaking raw HTML to the LLM
          }

          const message = parsed.message ?? humanizeHttpError(response.status, body);
          const error = new HarnessApiError(
            message,
            response.status,
            parsed.code,
            parsed.correlationId,
          );

          const willRetry = RETRYABLE_STATUS_CODES.has(response.status) && attempt < this.maxRetries;
          log.info("Harness API response", {
            outcome: willRetry ? "http_error_will_retry" : "http_error",
            method,
            path,
            httpStatus: response.status,
            attemptDurationMs,
            totalDurationMs,
            attempt: attempt + 1,
            maxAttempts: this.maxRetries + 1,
            responseBytes: body.length,
            responseBody: body.slice(0, 1000),
            requestBodyBytes,
            requestBody,
          });

          if (willRetry) {
            lastError = error;
            continue;
          }

          throw error;
        }

        const text = await response.text();
        const readDurationMs = Math.round(performance.now() - attemptStart);
        const totalMsAfterRead = Math.round(performance.now() - requestWallStart);

        if (!text) {
          log.info("Harness API response", {
            outcome: "error",
            reason: "empty_body",
            method,
            path,
            attemptDurationMs: readDurationMs,
            totalDurationMs: totalMsAfterRead,
            attempt: attempt + 1,
            responseBytes: 0,
            requestBodyBytes,
            requestBody,
          });
          throw new HarnessApiError(
            `Empty response body from ${method} ${path}`,
            502,
          );
        }
        let data: unknown;
        try {
          data = JSON.parse(text);
        } catch (parseErr) {
          log.info("Harness API response", {
            outcome: "error",
            reason: "invalid_json",
            method,
            path,
            attemptDurationMs: readDurationMs,
            totalDurationMs: totalMsAfterRead,
            attempt: attempt + 1,
            responseBytes: text.length,
            requestBodyBytes,
            requestBody,
          });
          throw new HarnessApiError(
            `Non-JSON response from ${method} ${path}: ${text.slice(0, 200)}`,
            502,
            undefined,
            undefined,
            parseErr,
          );
        }

        log.info("Harness API response", {
          outcome: "success",
          method,
          path,
          attemptDurationMs: readDurationMs,
          totalDurationMs: totalMsAfterRead,
          attempt: attempt + 1,
          responseBytes: text.length,
          requestBodyBytes,
          requestBody,
        });
        log.debug("Response body", { body: text.slice(0, 1000) });
        return data as T;
      } catch (err) {
        if (err instanceof HarnessApiError) throw err;
        if (err instanceof Error && err.name === "AbortError") {
          const attemptDurationMs = Math.round(performance.now() - attemptStart);
          const totalDurationMs = Math.round(performance.now() - requestWallStart);
          // External signal (client disconnect) — stop immediately, don't retry
          if (options.signal?.aborted) {
            log.info("Harness API response", {
              outcome: "error",
              reason: "aborted",
              method,
              path,
              attemptDurationMs,
              totalDurationMs,
              attempt: attempt + 1,
            });
            throw new HarnessApiError("Request cancelled", 499, undefined, undefined, err);
          }
          // Timeout — retry if allowed
          lastError = new HarnessApiError("Request timed out", 408, undefined, undefined, err);
          const willRetryTimeout = attempt < this.maxRetries;
          log.warn("Harness API request timed out", {
            outcome: willRetryTimeout ? "timeout_will_retry" : "timeout",
            ...summarizeRequestForTimeoutLog(options, this.timeout),
            attemptDurationMs,
            totalDurationMs,
            attempt: attempt + 1,
            maxAttempts: this.maxRetries + 1,
            willRetry: willRetryTimeout,
          });
          if (willRetryTimeout) {
            continue;
          }
          throw lastError;
        }
        const attemptDurationMs = Math.round(performance.now() - attemptStart);
        const totalDurationMs = Math.round(performance.now() - requestWallStart);
        log.info("Harness API response", {
          outcome: "error",
          reason: "network_or_unknown",
          method,
          path,
          attemptDurationMs,
          totalDurationMs,
          attempt: attempt + 1,
          error: (err as Error).message ?? String(err),
        });
        throw new HarnessApiError(
          `Request failed: ${(err as Error).message ?? String(err)}`,
          502,
          undefined,
          undefined,
          err,
        );
      }
    }

    const totalDurationMs = Math.round(performance.now() - requestWallStart);
    log.info("Harness API response", {
      outcome: "error",
      reason: "max_retries",
      method,
      path,
      totalDurationMs,
      maxAttempts: this.maxRetries + 1,
      ...summarizeRequestForTimeoutLog(options, this.timeout),
    });
    throw lastError ?? new HarnessApiError("Max retries exceeded", 500);
  }

  private buildUrl(options: RequestOptions): string {
    let path = options.path;

    // Prevent double /gateway when HARNESS_BASE_URL already ends with /gateway
    // (common with self-managed Harness installations)
    if (this.baseUrl.endsWith("/gateway") && path.startsWith("/gateway/")) {
      path = path.slice("/gateway".length);
    }

    // Inject accountIdentifier into query params (used by most Harness APIs)
    const params = new URLSearchParams();
    params.set("accountIdentifier", this.accountId);

    // Log-service gateway expects accountID (capital ID) in query params
    if (path.includes("/log-service/")) {
      params.set("accountID", this.accountId);
    }

    if (options.params) {
      for (const [key, value] of Object.entries(options.params)) {
        if (value !== undefined && value !== "") {
          params.set(key, String(value));
        }
      }
    }

    return `${this.baseUrl}${path}?${params.toString()}`;
  }
}
