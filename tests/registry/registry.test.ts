import { describe, it, expect, vi, beforeEach } from "vitest";
import { Registry } from "../../src/registry/index.js";
import type { Config } from "../../src/config.js";
import type { HarnessClient } from "../../src/client/harness-client.js";

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    HARNESS_API_KEY: "pat.test",
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

describe("Registry", () => {
  describe("constructor — toolset loading", () => {
    it("loads all toolsets when HARNESS_TOOLSETS is not set", () => {
      const registry = new Registry(makeConfig());
      const desc = registry.describe() as { total_toolsets: number };
      expect(desc.total_toolsets).toBe(1);
    });

    it("filters to specific toolsets when HARNESS_TOOLSETS is set", () => {
      const registry = new Registry(makeConfig({ HARNESS_TOOLSETS: "ccm" }));
      const desc = registry.describe() as { total_toolsets: number };
      expect(desc.total_toolsets).toBe(1);
    });

    it("throws for invalid toolset names in HARNESS_TOOLSETS", () => {
      expect(() => new Registry(makeConfig({ HARNESS_TOOLSETS: "nonexistent" }))).toThrow(
        /Invalid HARNESS_TOOLSETS: "nonexistent"/,
      );
    });

    it("throws for typo in toolset name (e.g. 'cost' instead of 'ccm')", () => {
      expect(() => new Registry(makeConfig({ HARNESS_TOOLSETS: "cost" }))).toThrow(
        /Invalid HARNESS_TOOLSETS: "cost"/,
      );
      expect(() => new Registry(makeConfig({ HARNESS_TOOLSETS: "cost" }))).toThrow(
        /Valid toolset names:/,
      );
    });

    it("throws listing all invalid names when multiple are wrong", () => {
      expect(() => new Registry(makeConfig({ HARNESS_TOOLSETS: "badname,cost,oops" }))).toThrow(
        /Invalid HARNESS_TOOLSETS: "badname", "cost", "oops"/,
      );
    });

    it("accepts the valid toolset name without error", () => {
      const registry = new Registry(makeConfig({ HARNESS_TOOLSETS: "ccm" }));
      const desc = registry.describe() as { total_toolsets: number };
      expect(desc.total_toolsets).toBe(1);
    });
  });

  describe("getResource", () => {
    let registry: Registry;
    beforeEach(() => {
      registry = new Registry(makeConfig({ HARNESS_TOOLSETS: "ccm" }));
    });

    it("returns a resource definition for a valid type", () => {
      const def = registry.getResource("cost_perspective");
      expect(def.resourceType).toBe("cost_perspective");
      expect(def.displayName).toBe("Cost Perspective");
      expect(def.scope).toBe("account");
      expect(def.identifierFields).toEqual(["perspective_id"]);
    });

    it("throws for unknown resource type with available list", () => {
      expect(() => registry.getResource("nonexistent")).toThrow(/Unknown resource_type "nonexistent"/);
      expect(() => registry.getResource("nonexistent")).toThrow(/Available:/);
    });
  });

  describe("getAllResourceTypes", () => {
    it("returns sorted array of resource types", () => {
      const registry = new Registry(makeConfig({ HARNESS_TOOLSETS: "ccm" }));
      const types = registry.getAllResourceTypes();
      expect(Array.isArray(types)).toBe(true);
      expect(types).toContain("cost_perspective");
      const sorted = [...types].sort();
      expect(types).toEqual(sorted);
    });
  });

  describe("supportsOperation", () => {
    let registry: Registry;
    beforeEach(() => {
      registry = new Registry(makeConfig({ HARNESS_TOOLSETS: "ccm" }));
    });

    it("returns true for supported operation", () => {
      expect(registry.supportsOperation("cost_perspective", "list")).toBe(true);
      expect(registry.supportsOperation("cost_perspective", "get")).toBe(true);
    });

    it("returns false for unsupported operation", () => {
      expect(registry.supportsOperation("cost_perspective", "nonexistent" as never)).toBe(false);
    });

    it("returns false for unknown resource type", () => {
      expect(registry.supportsOperation("nonexistent", "list")).toBe(false);
    });
  });

  describe("describe", () => {
    it("returns structured metadata", () => {
      const registry = new Registry(makeConfig({ HARNESS_TOOLSETS: "ccm" }));
      const desc = registry.describe() as {
        total_resource_types: number;
        total_toolsets: number;
        toolsets: Record<string, { displayName?: string }>;
      };
      expect(desc.total_toolsets).toBe(1);
      expect(desc.total_resource_types).toBeGreaterThan(0);
      expect(desc.toolsets).toHaveProperty("ccm");
      expect(desc.toolsets.ccm.displayName).toBe("Cloud Cost Management");
    });
  });

  describe("getAllFilterFields", () => {
    it("returns deduplicated FilterFieldSpec objects across CCM resources", () => {
      const registry = new Registry(makeConfig({ HARNESS_TOOLSETS: "ccm" }));
      const fields = registry.getAllFilterFields();
      expect(Array.isArray(fields)).toBe(true);
      for (const f of fields) {
        expect(f).toHaveProperty("name");
        expect(f).toHaveProperty("description");
        expect(typeof f.name).toBe("string");
        expect(typeof f.description).toBe("string");
      }
      const searchTermEntries = fields.filter((f) => f.name === "search_term");
      expect(searchTermEntries).toHaveLength(1);
    });

    it("includes enum metadata when defined", () => {
      const registry = new Registry(makeConfig({ HARNESS_TOOLSETS: "ccm" }));
      const fields = registry.getAllFilterFields();
      const groupByField = fields.find((f) => f.name === "group_by");
      expect(groupByField).toBeDefined();
      expect(groupByField!.enum).toBeDefined();
      expect(groupByField!.enum!.length).toBeGreaterThan(0);
    });

    it("returns non-empty filter fields for CCM", () => {
      const registry = new Registry(makeConfig({ HARNESS_TOOLSETS: "ccm" }));
      const fields = registry.getAllFilterFields();
      expect(fields.length).toBeGreaterThan(0);
    });
  });

  describe("LLM field discovery flow", () => {
    let registry: Registry;
    beforeEach(() => {
      registry = new Registry(makeConfig());
    });

    it("harness_ccm_finops_describe exposes listFilterFields for CCM resources", () => {
      const def = registry.getResource("cost_perspective");
      expect(def.listFilterFields).toBeDefined();
    });

    it("most listable resource types expose listFilterFields", () => {
      const allTypes = registry.getAllResourceTypes();
      let withFilters = 0;
      let listable = 0;
      for (const type of allTypes) {
        const def = registry.getResource(type);
        if (def.operations.list) {
          listable++;
          if (def.listFilterFields) withFilters++;
        }
      }
      expect(withFilters / listable).toBeGreaterThanOrEqual(0.5);
    });

    it("describeSummary includes filter discovery hint", () => {
      const summary = registry.describeSummary() as { hint: string };
      expect(summary.hint).toContain("harness_ccm_finops_describe");
    });
  });

  describe("dispatch", () => {
    let registry: Registry;
    beforeEach(() => {
      registry = new Registry(makeConfig({ HARNESS_TOOLSETS: "ccm" }));
    });

    it("builds correct path and body for a list operation (cost_perspective)", async () => {
      const mockRequest = vi.fn().mockResolvedValue({
        data: {
          perspectives: {
            views: [{ id: "p1", name: "Default" }],
            totalCount: 1,
          },
        },
      });
      const client = makeClient(mockRequest);

      await registry.dispatch(client, "cost_perspective", "list", {
        search_term: "prod",
        page: 0,
        size: 10,
      });

      expect(mockRequest).toHaveBeenCalledOnce();
      const call = mockRequest.mock.calls[0][0] as {
        method: string;
        path: string;
        params: Record<string, unknown>;
        body: { operationName?: string; variables?: Record<string, unknown> };
      };
      expect(call.method).toBe("POST");
      expect(call.path).toBe("/ccm/api/graphql");
      expect(call.params).toMatchObject({
        routingId: "test-account",
      });
      expect(call.body.operationName).toBe("FetchAllPerspectives");
      expect(call.body.variables).toMatchObject({
        pageNo: 0,
        pageSize: 10,
        searchKey: "prod",
      });
    });

    it("builds correct path and query params for a get operation", async () => {
      const mockRequest = vi.fn().mockResolvedValue({ data: { id: "my-view", name: "Test" } });
      const client = makeClient(mockRequest);

      await registry.dispatch(client, "cost_perspective", "get", {
        perspective_id: "my-view",
      });

      expect(mockRequest).toHaveBeenCalledOnce();
      const call = mockRequest.mock.calls[0][0] as {
        method: string;
        path: string;
        params: Record<string, unknown>;
      };
      expect(call.method).toBe("GET");
      expect(call.path).toBe("/ccm/api/perspective");
      expect(call.params).toMatchObject({
        routingId: "test-account",
        perspectiveId: "my-view",
      });
    });

    it("throws on unsupported operation", async () => {
      const client = makeClient();
      await expect(
        registry.dispatch(client, "cost_perspective", "nonexistent" as never, {}),
      ).rejects.toThrow(/does not support/);
    });

    it("throws on unknown resource type", async () => {
      const client = makeClient();
      await expect(
        registry.dispatch(client, "nonexistent", "list", {}),
      ).rejects.toThrow(/Unknown resource_type "nonexistent"/);
    });

    it("throws when required path param is missing for list", async () => {
      const client = makeClient();
      await expect(
        registry.dispatch(client, "cost_anomaly_summary", "list", {}),
      ).rejects.toThrow(/Missing required field/);
    });
  });

  describe("read-only mode", () => {
    let registry: Registry;
    beforeEach(() => {
      registry = new Registry(makeConfig({ HARNESS_TOOLSETS: "ccm", HARNESS_READ_ONLY: true }));
    });

    it("allows list operations", async () => {
      const mockRequest = vi.fn().mockResolvedValue({
        data: { perspectives: { views: [], totalCount: 0 } },
      });
      const client = makeClient(mockRequest);
      await registry.dispatch(client, "cost_perspective", "list", {});
      expect(mockRequest).toHaveBeenCalledOnce();
    });

    it("allows get operations", async () => {
      const mockRequest = vi.fn().mockResolvedValue({ data: { id: "v1", name: "View" } });
      const client = makeClient(mockRequest);
      await registry.dispatch(client, "cost_perspective", "get", { perspective_id: "v1" });
      expect(mockRequest).toHaveBeenCalledOnce();
    });
  });
});
