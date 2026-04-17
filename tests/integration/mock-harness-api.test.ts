/**
 * Integration tests with a mock Harness API.
 *
 * Tests the full request flow from Registry dispatch through HarnessClient
 * to mocked fetch responses, validating URL construction, auth headers,
 * query params, body building, response extraction, and error handling.
 *
 * Registry is CCM-only (`HARNESS_TOOLSETS=ccm`): account-scoped cost APIs,
 * no org/project injection on dispatch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HarnessClient } from "../../src/client/harness-client.js";
import { Registry } from "../../src/registry/index.js";
import type { Config } from "../../src/config.js";

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    HARNESS_API_KEY: "pat.testaccount.tokenid.secret",
    HARNESS_ACCOUNT_ID: "testaccount",
    HARNESS_BASE_URL: "https://app.harness.io",
    HARNESS_DEFAULT_ORG_ID: "default",
    HARNESS_DEFAULT_PROJECT_ID: "test-project",
    HARNESS_API_TIMEOUT_MS: 5000,
    HARNESS_MAX_RETRIES: 0, // No retries for tests
    LOG_LEVEL: "error",
    HARNESS_TOOLSETS: "ccm",
    ...overrides,
  };
}

function mockFetchResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Integration: Registry → HarnessClient → fetch (CCM)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe("cost_perspective list", () => {
    it("sends POST GraphQL with account routing and maps perspectives response", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          data: {
            perspectives: {
              views: [
                { id: "pv-aws", name: "AWS Default", viewType: "CUSTOMER" },
                { id: "pv-gcp", name: "GCP Default", viewType: "CUSTOMER" },
              ],
              totalCount: 2,
            },
            __typename: "Query",
          },
        }),
      );

      const config = makeConfig();
      const client = new HarnessClient(config);
      const registry = new Registry(config);

      const result = (await registry.dispatch(client, "cost_perspective", "list", {
        search_term: "GCP",
        page: 0,
        size: 10,
      })) as { items: unknown[]; total: number };

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, options] = fetchSpy.mock.calls[0]!;
      const urlStr = url instanceof URL ? url.toString() : String(url);

      expect(urlStr).toContain("app.harness.io");
      expect(urlStr).toContain("/ccm/api/graphql");
      expect(urlStr).toContain("accountIdentifier=testaccount");
      expect(urlStr).toContain("routingId=testaccount");
      expect(urlStr).not.toContain("orgIdentifier=");
      expect(urlStr).not.toContain("projectIdentifier=");

      const headers = (options as RequestInit)?.headers as Record<string, string>;
      expect(headers["x-api-key"]).toBe("pat.testaccount.tokenid.secret");

      expect((options as RequestInit)?.method).toBe("POST");

      const bodyRaw = (options as RequestInit)?.body;
      expect(typeof bodyRaw).toBe("string");
      const body = JSON.parse(bodyRaw as string) as {
        operationName?: string;
        variables?: { searchKey?: string; pageNo?: number; pageSize?: number };
      };
      expect(body.operationName).toBe("FetchAllPerspectives");
      expect(body.variables?.searchKey).toBe("GCP");
      expect(body.variables?.pageNo).toBe(0);
      expect(body.variables?.pageSize).toBe(10);

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
    });
  });

  describe("cost_perspective get", () => {
    it("uses GET /ccm/api/perspective with perspectiveId and extracts data", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          status: "SUCCESS",
          data: {
            id: "pv-1",
            name: "GCP Default",
            viewType: "CUSTOMER",
            dataSources: ["GCP"],
          },
        }),
      );

      const config = makeConfig();
      const client = new HarnessClient(config);
      const registry = new Registry(config);

      const result = (await registry.dispatch(client, "cost_perspective", "get", {
        perspective_id: "pv-1",
      })) as Record<string, unknown>;

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, options] = fetchSpy.mock.calls[0]!;
      const urlStr = String(url);

      expect(urlStr).toContain("/ccm/api/perspective");
      expect(urlStr).toContain("perspectiveId=pv-1");
      expect(urlStr).toContain("accountIdentifier=testaccount");
      expect(urlStr).toContain("routingId=testaccount");
      expect(urlStr).not.toContain("orgIdentifier=");

      expect((options as RequestInit)?.method).toBe("GET");

      expect(result.id).toBe("pv-1");
      expect(result.name).toBe("GCP Default");
    });
  });

  describe("error handling", () => {
    it("throws HarnessApiError for 401 unauthorized", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse(
          {
            status: "ERROR",
            code: "INVALID_TOKEN",
            message: "Token is invalid or expired",
            correlationId: "corr-123",
          },
          401,
        ),
      );

      const config = makeConfig();
      const client = new HarnessClient(config);
      const registry = new Registry(config);

      await expect(
        registry.dispatch(client, "cost_perspective", "list", {}),
      ).rejects.toMatchObject({
        statusCode: 401,
      });
    });

    it("throws HarnessApiError for 404 not found", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse(
          {
            status: "ERROR",
            code: "RESOURCE_NOT_FOUND",
            message: "Perspective not found",
          },
          404,
        ),
      );

      const config = makeConfig();
      const client = new HarnessClient(config);
      const registry = new Registry(config);

      await expect(
        registry.dispatch(client, "cost_perspective", "get", { perspective_id: "missing" }),
      ).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it("throws HarnessApiError for 500 server error", async () => {
      fetchSpy.mockResolvedValueOnce(mockFetchResponse({ status: "ERROR", message: "Internal server error" }, 500));

      const config = makeConfig();
      const client = new HarnessClient(config);
      const registry = new Registry(config);

      await expect(registry.dispatch(client, "cost_perspective", "list", {})).rejects.toMatchObject({
        statusCode: 500,
      });
    });
  });

  describe("account-scoped CCM dispatch", () => {
    it("does not inject org or project query params for account-scoped resources", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          data: {
            perspectives: { views: [], totalCount: 0 },
          },
        }),
      );

      const config = makeConfig({
        HARNESS_DEFAULT_ORG_ID: "my-org",
        HARNESS_DEFAULT_PROJECT_ID: "my-project",
      });
      const client = new HarnessClient(config);
      const registry = new Registry(config);

      await registry.dispatch(client, "cost_perspective", "list", {});

      const [url] = fetchSpy.mock.calls[0]!;
      const urlStr = String(url);
      expect(urlStr).toContain("accountIdentifier=testaccount");
      expect(urlStr).not.toContain("orgIdentifier=");
      expect(urlStr).not.toContain("projectIdentifier=");
    });
  });
});
