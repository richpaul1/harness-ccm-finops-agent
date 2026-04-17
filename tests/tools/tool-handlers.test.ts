/**
 * Tool handler tests for FinOps Agent MCP tools.
 *
 * Tests input validation and error handling paths with mocked registry/client.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Config } from "../../src/config.js";
import type { HarnessClient } from "../../src/client/harness-client.js";
import type { ToolResult } from "../../src/utils/response-formatter.js";
import { Registry } from "../../src/registry/index.js";
import { HarnessApiError } from "../../src/utils/errors.js";

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    HARNESS_API_KEY: "pat.test.abc.xyz",
    HARNESS_ACCOUNT_ID: "test-account",
    HARNESS_BASE_URL: "https://app.harness.io",
    HARNESS_DEFAULT_ORG_ID: "default",
    HARNESS_DEFAULT_PROJECT_ID: "test-project",
    HARNESS_API_TIMEOUT_MS: 30000,
    HARNESS_MAX_RETRIES: 3,
    LOG_LEVEL: "info",
    ...overrides,
  };
}

function makeClient(requestFn?: (...args: unknown[]) => unknown): HarnessClient {
  return {
    request: requestFn ?? vi.fn().mockResolvedValue({}),
    account: "test-account",
  } as unknown as HarnessClient;
}

function makeMcpServer() {
  const tools = new Map<string, { handler: (...args: unknown[]) => Promise<ToolResult> }>();
  return {
    server: {
      getClientCapabilities: () => ({}),
    },
    registerTool: vi.fn((name: string, _schema: unknown, handler: (...args: unknown[]) => Promise<ToolResult>) => {
      tools.set(name, { handler });
    }),
    _tools: tools,
    async call(name: string, args: Record<string, unknown>, extra?: Record<string, unknown>): Promise<ToolResult> {
      const tool = tools.get(name);
      if (!tool) throw new Error(`Tool "${name}" not registered`);
      const defaultExtra = { signal: new AbortController().signal, sendNotification: vi.fn(), _meta: {} };
      return tool.handler(args, { ...defaultExtra, ...extra }) as Promise<ToolResult>;
    },
  } as any;
}

function parseResult(result: ToolResult): unknown {
  return JSON.parse(result.content[0]!.text);
}

// ---------------------------------------------------------------------------
// harness_ccm_finops_list
// ---------------------------------------------------------------------------

describe("harness_ccm_finops_list", () => {
  let server: ReturnType<typeof makeMcpServer>;
  let registry: Registry;
  let client: HarnessClient;
  let mockRequest: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    server = makeMcpServer();
    registry = new Registry(makeConfig({ HARNESS_TOOLSETS: "ccm" }));
    mockRequest = vi.fn().mockResolvedValue({ data: { content: [{ id: "p1" }], totalElements: 1 } });
    client = makeClient(mockRequest);
    const { registerListTool } = await import("../../src/tools/harness-list.js");
    registerListTool(server, registry, client);
  });

  it("returns error when resource_type is missing", async () => {
    const result = await server.call("harness_ccm_finops_list", {});
    expect(result.isError).toBe(true);
    expect(parseResult(result)).toMatchObject({ error: expect.stringContaining("resource_type is required") });
  });

  it("returns error for unknown resource_type", async () => {
    const result = await server.call("harness_ccm_finops_list", { resource_type: "nonexistent" });
    expect(result.isError).toBe(true);
    expect(parseResult(result)).toMatchObject({ error: expect.stringContaining("Unknown resource_type") });
  });

  it("propagates user-fixable API errors as errorResult", async () => {
    mockRequest.mockRejectedValueOnce(new HarnessApiError("Not found", 404));
    const result = await server.call("harness_ccm_finops_list", { resource_type: "cost_perspective" });
    expect(result.isError).toBe(true);
  });

  it("throws for infrastructure API errors", async () => {
    mockRequest.mockRejectedValueOnce(new HarnessApiError("Server error", 500));
    await expect(server.call("harness_ccm_finops_list", { resource_type: "cost_perspective" })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// harness_ccm_finops_get
// ---------------------------------------------------------------------------

describe("harness_ccm_finops_get", () => {
  let server: ReturnType<typeof makeMcpServer>;
  let registry: Registry;
  let client: HarnessClient;
  let mockRequest: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    server = makeMcpServer();
    registry = new Registry(makeConfig({ HARNESS_TOOLSETS: "ccm" }));
    mockRequest = vi.fn().mockResolvedValue({ data: { id: "test-perspective" } });
    client = makeClient(mockRequest);
    const { registerGetTool } = await import("../../src/tools/harness-get.js");
    registerGetTool(server, registry, client);
  });

  it("returns error when resource_type is missing", async () => {
    const result = await server.call("harness_ccm_finops_get", {});
    expect(result.isError).toBe(true);
    expect(parseResult(result)).toMatchObject({ error: expect.stringContaining("resource_type is required") });
  });

  it("returns error for unknown resource_type", async () => {
    const result = await server.call("harness_ccm_finops_get", { resource_type: "nonexistent" });
    expect(result.isError).toBe(true);
  });

  it("propagates 404 as errorResult", async () => {
    mockRequest.mockRejectedValueOnce(new HarnessApiError("Not found", 404));
    const result = await server.call("harness_ccm_finops_get", { resource_type: "cost_perspective", resource_id: "missing" });
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// harness_ccm_finops_describe
// ---------------------------------------------------------------------------

describe("harness_ccm_finops_describe", () => {
  let server: ReturnType<typeof makeMcpServer>;
  let registry: Registry;

  beforeEach(async () => {
    server = makeMcpServer();
    registry = new Registry(makeConfig({ HARNESS_TOOLSETS: "ccm" }));
    const { registerDescribeTool } = await import("../../src/tools/harness-describe.js");
    registerDescribeTool(server, registry);
  });

  it("returns compact summary when no args provided", async () => {
    const result = await server.call("harness_ccm_finops_describe", {});
    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as { total_resource_types: number; hint: string };
    expect(data.total_resource_types).toBeGreaterThan(0);
    expect(data.hint).toContain("harness_ccm_finops_describe");
  });

  it("returns details for a specific resource_type", async () => {
    const result = await server.call("harness_ccm_finops_describe", { resource_type: "cost_perspective" });
    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as { resource_type: string; operations: unknown[] };
    expect(data.resource_type).toBe("cost_perspective");
    expect(data.operations.length).toBeGreaterThan(0);
  });

  it("returns error hint for unknown resource_type", async () => {
    const result = await server.call("harness_ccm_finops_describe", { resource_type: "nonexistent" });
    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as { error: string };
    expect(data.error).toContain("Unknown resource_type");
  });

  it("filters by toolset", async () => {
    const result = await server.call("harness_ccm_finops_describe", { toolset: "ccm" });
    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as { toolset: string };
    expect(data.toolset).toBe("ccm");
  });

  it("returns error for unknown toolset", async () => {
    const result = await server.call("harness_ccm_finops_describe", { toolset: "nonexistent" });
    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as { error: string };
    expect(data.error).toContain("Unknown toolset");
  });

  it("searches by keyword", async () => {
    const result = await server.call("harness_ccm_finops_describe", { search_term: "cost" });
    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as { total_results: number; resource_types: unknown[] };
    expect(data.total_results).toBeGreaterThan(0);
  });
});
