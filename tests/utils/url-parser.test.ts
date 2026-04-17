import { describe, it, expect } from "vitest";
import { parseHarnessUrl, applyUrlDefaults } from "../../src/utils/url-parser.js";

describe("parseHarnessUrl", () => {
  it("extracts account, org, project from a standard URL", () => {
    const result = parseHarnessUrl(
      "https://app.harness.io/ng/account/lnFZRF6jQO6tQnB9znMALw/all/orgs/default/projects/PM_Signoff/perspectives",
    );
    expect(result.account_id).toBe("lnFZRF6jQO6tQnB9znMALw");
    expect(result.org_id).toBe("default");
    expect(result.project_id).toBe("PM_Signoff");
    expect(result.resource_type).toBe("cost_perspective");
    expect(result.resource_id).toBeUndefined();
  });

  it("extracts perspective ID from CCM perspective URL", () => {
    const result = parseHarnessUrl(
      "https://app3.harness.io/ng/account/HgTKqISVTX-kQSVsWCHEcA/ce/perspectives/h3ais2fbQbyeD5g6qNY3xg/name/Domain%20-%20GIS",
    );
    expect(result.account_id).toBe("HgTKqISVTX-kQSVsWCHEcA");
    expect(result.module).toBe("ce");
    expect(result.resource_type).toBe("cost_perspective");
    expect(result.resource_id).toBe("h3ais2fbQbyeD5g6qNY3xg");
  });

  it("extracts module from /all/{module}/orgs/... pattern", () => {
    const result = parseHarnessUrl(
      "https://app.harness.io/ng/account/abc123/all/ce/orgs/default/projects/test",
    );
    expect(result.module).toBe("ce");
    expect(result.org_id).toBe("default");
  });

  it("detects ce module directly in path", () => {
    const result = parseHarnessUrl(
      "https://app3.harness.io/ng/account/abc123/ce/perspectives",
    );
    expect(result.module).toBe("ce");
    expect(result.resource_type).toBe("cost_perspective");
  });

  it("handles vanity domain URLs", () => {
    const result = parseHarnessUrl(
      "https://company.harness.io/ng/account/cetPGmqTQ22qdnkyMdP_9A/all/orgs/Genomics/projects/ga_ethnicity",
    );
    expect(result.account_id).toBe("cetPGmqTQ22qdnkyMdP_9A");
    expect(result.org_id).toBe("Genomics");
    expect(result.project_id).toBe("ga_ethnicity");
  });

  it("handles URL-encoded segments", () => {
    const result = parseHarnessUrl(
      "https://app.harness.io/ng/account/abc123/ce/perspectives/My%20Perspective",
    );
    expect(result.resource_id).toBe("My Perspective");
    expect(result.resource_type).toBe("cost_perspective");
  });

  it("returns empty account when no account segment present", () => {
    const result = parseHarnessUrl("https://app.harness.io/ng/");
    expect(result.account_id).toBe("");
    expect(result.resource_type).toBeUndefined();
  });
});

describe("applyUrlDefaults", () => {
  it("merges URL-derived values into args as defaults", () => {
    const args = { some_filter: true };
    const result = applyUrlDefaults(
      args as Record<string, unknown>,
      "https://app3.harness.io/ng/account/abc/ce/perspectives/perspId123",
    );
    expect(result.resource_type).toBe("cost_perspective");
    expect(result.resource_id).toBe("perspId123");
    expect(result.some_filter).toBe(true);
  });

  it("explicit args take precedence over URL-derived values", () => {
    const args = { org_id: "explicitOrg", resource_type: "cost_budget" };
    const result = applyUrlDefaults(
      args as Record<string, unknown>,
      "https://app.harness.io/ng/account/abc/all/orgs/urlOrg/projects/urlProject/perspectives",
    );
    expect(result.org_id).toBe("explicitOrg");
    expect(result.resource_type).toBe("cost_budget");
    expect(result.project_id).toBe("urlProject");
  });

  it("returns args unchanged when url is undefined", () => {
    const args = { resource_type: "cost_perspective" };
    const result = applyUrlDefaults(args as Record<string, unknown>, undefined);
    expect(result).toEqual(args);
  });

  it("returns args unchanged for invalid URL", () => {
    const args = { resource_type: "cost_perspective" };
    const result = applyUrlDefaults(args as Record<string, unknown>, "not-a-url");
    expect(result).toEqual(args);
  });

  it("does not mutate the original args object", () => {
    const args = { resource_type: "cost_budget" };
    const result = applyUrlDefaults(
      args as Record<string, unknown>,
      "https://app.harness.io/ng/account/abc/all/orgs/myOrg/projects/myProject",
    );
    expect(args).toEqual({ resource_type: "cost_budget" });
    expect(result.org_id).toBe("myOrg");
  });
});
