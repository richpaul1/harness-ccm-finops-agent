import type { ToolsetDefinition } from "../types.js";
import { ngExtract, pageExtract, passthrough, gqlExtract, ccmBusinessMappingListExtract, ccmBusinessMappingListCompactExtract, ccmRecommendationListCompactExtract, ccmBudgetListCompactExtract, ccmBudgetDetailExtract, ccmCommitmentSummaryExtract, ccmCommitmentCoverageExtract, ccmCommitmentSavingsExtract, ccmCommitmentUtilisationExtract, ccmCommitmentFiltersExtract, ccmCommitmentAccountsExtract, ccmCommitmentSavingsOverviewExtract, ccmCommitmentSpendDetailExtract, ccmAutoStoppingListExtract, ccmAutoStoppingDetailExtract, ccmAutoStoppingCumulativeSavingsExtract, ccmAutoStoppingRuleSavingsExtract, ccmAutoStoppingLogsExtract, ccmAutoStoppingSchedulesExtract } from "../extractors.js";

// ---------------------------------------------------------------------------
// GraphQL queries — ported from the official Go MCP server
// (client/ccmcommons/ccmgraphqlqueries.go)
// ---------------------------------------------------------------------------

const PERSPECTIVE_GRID_QUERY = `
query FetchperspectiveGrid(
  $filters: [QLCEViewFilterWrapperInput],
  $groupBy: [QLCEViewGroupByInput],
  $limit: Int,
  $offset: Int,
  $aggregateFunction: [QLCEViewAggregationInput],
  $isClusterOnly: Boolean!,
  $isClusterHourlyData: Boolean = null,
  $preferences: ViewPreferencesInput
) {
  perspectiveGrid(
    aggregateFunction: $aggregateFunction
    filters: $filters
    groupBy: $groupBy
    limit: $limit
    offset: $offset
    preferences: $preferences
    isClusterHourlyData: $isClusterHourlyData
    sortCriteria: [{sortType: COST, sortOrder: DESCENDING}]
  ) {
    data { name id cost costTrend __typename }
    __typename
  }
  perspectiveTotalCount(
    filters: $filters
    groupBy: $groupBy
    isClusterQuery: $isClusterOnly
    isClusterHourlyData: $isClusterHourlyData
  )
}`;

const PERSPECTIVE_TIMESERIES_QUERY = `
query FetchPerspectiveTimeSeries(
  $filters: [QLCEViewFilterWrapperInput],
  $groupBy: [QLCEViewGroupByInput],
  $limit: Int,
  $preferences: ViewPreferencesInput,
  $isClusterHourlyData: Boolean = null
) {
  perspectiveTimeSeriesStats(
    filters: $filters
    groupBy: $groupBy
    limit: $limit
    preferences: $preferences
    isClusterHourlyData: $isClusterHourlyData
    aggregateFunction: [{operationType: SUM, columnName: "cost"}]
    sortCriteria: [{sortType: COST, sortOrder: DESCENDING}]
  ) {
    stats {
      values {
        key { id name type __typename }
        value
        __typename
      }
      time
      __typename
    }
    __typename
  }
}`;

const PERSPECTIVE_SUMMARY_QUERY = `
query FetchPerspectiveDetailsSummaryWithBudget(
  $filters: [QLCEViewFilterWrapperInput],
  $aggregateFunction: [QLCEViewAggregationInput],
  $isClusterQuery: Boolean,
  $isClusterHourlyData: Boolean = null,
  $groupBy: [QLCEViewGroupByInput],
  $preferences: ViewPreferencesInput
) {
  perspectiveTrendStats(
    filters: $filters
    aggregateFunction: $aggregateFunction
    isClusterQuery: $isClusterQuery
    isClusterHourlyData: $isClusterHourlyData
    groupBy: $groupBy
    preferences: $preferences
  ) {
    cost { statsDescription statsLabel statsTrend statsValue value __typename }
    idleCost { statsLabel statsValue value __typename }
    unallocatedCost { statsLabel statsValue value __typename }
    utilizedCost { statsLabel statsValue value __typename }
    efficiencyScoreStats { statsLabel statsTrend statsValue __typename }
    __typename
  }
  perspectiveForecastCost(
    filters: $filters
    aggregateFunction: $aggregateFunction
    isClusterQuery: $isClusterQuery
    isClusterHourlyData: $isClusterHourlyData
    groupBy: $groupBy
    preferences: $preferences
  ) {
    cost { statsLabel statsTrend statsValue statsDescription value __typename }
    __typename
  }
}`;

const PERSPECTIVE_BUDGET_QUERY = `
query FetchPerspectiveBudget($perspectiveId: String) {
  budgetSummaryList(perspectiveId: $perspectiveId) {
    id name budgetAmount actualCost timeLeft timeUnit timeScope period folderId __typename
  }
}`;

const CCM_METADATA_QUERY = `
query FetchCcmMetaData {
  ccmMetaData {
    k8sClusterConnectorPresent cloudDataPresent awsConnectorsPresent
    gcpConnectorsPresent azureConnectorsPresent applicationDataPresent
    inventoryDataPresent clusterDataPresent externalDataPresent
    isSampleClusterPresent defaultAzurePerspectiveId defaultAwsPerspectiveId
    defaultGcpPerspectiveId defaultClusterPerspectiveId
    defaultExternalDataPerspectiveId showCostOverview
    currencyPreference { destinationCurrency symbol locale setupTime __typename }
    __typename
  }
}`;

const PERSPECTIVES_LIST_QUERY = `
query FetchAllPerspectives(
  $folderId: String,
  $sortCriteria: QLCEViewSortCriteriaInput = null,
  $pageNo: Int,
  $pageSize: Int,
  $searchKey: String,
  $filters: [CloudFilter]
) {
  perspectives(
    folderId: $folderId
    sortCriteria: $sortCriteria
    pageNo: $pageNo
    pageSize: $pageSize
    searchKey: $searchKey
    cloudFilters: $filters
  ) {
    totalCount
    views {
      id name chartType viewType viewState
      createdAt lastUpdatedAt timeRange
      dataSources folderId folderName
      reportScheduledConfigured
      groupBy { fieldId fieldName identifier identifierName __typename }
      __typename
    }
    __typename
  }
}`;

const PERSPECTIVE_RECOMMENDATIONS_QUERY = `
query PerspectiveRecommendations($filter: RecommendationFilterDTOInput) {
  recommendationStatsV2(filter: $filter) {
    totalMonthlyCost totalMonthlySaving count __typename
  }
  recommendationsV2(filter: $filter) {
    items {
      clusterName namespace id resourceType resourceName
      monthlyCost monthlySaving __typename
    }
    __typename
  }
}`;

const BUDGET_GRID_DATA_QUERY = `
query FetchBudgetsGridData($id: String!, $breakdown: BudgetBreakdown) {
  budgetCostData(budgetId: $id, breakdown: $breakdown) {
    costData {
      time actualCost forecastCost budgeted
      budgetVariance budgetVariancePercentage endTime
      __typename
    }
    forecastCost
    __typename
  }
  budgetSummary(budgetId: $id) {
    period
    __typename
  }
}`;

// ---------------------------------------------------------------------------
// GraphQL helper builders — TypeScript equivalents of the Go filter helpers
// ---------------------------------------------------------------------------

const VALID_TIME_FILTERS = [
  "LAST_7", "THIS_MONTH", "LAST_30_DAYS", "THIS_QUARTER", "THIS_YEAR",
  "LAST_MONTH", "LAST_QUARTER", "LAST_YEAR", "LAST_3_MONTHS",
  "LAST_6_MONTHS", "LAST_12_MONTHS",
] as const;

const VALID_GROUP_BY_FIELDS = [
  "region", "awsUsageaccountid", "awsServicecode", "awsBillingEntity",
  "awsInstancetype", "awsLineItemType", "awspayeraccountid", "awsUsageType",
  "cloudProvider", "none", "product",
  /** GCP billing project (QLCE entity group GCP / gcpProjectId). */
  "gcpprojectid", "gcpProjectId", "gcp_project_id",
  /** GCP billing account (QLCE field gcpBillingAccountId). */
  "gcpbillingaccountid", "gcpBillingAccountId", "gcp_billing_account_id",
  /** GCP invoice month (QLCE field gcpInvoiceMonth). */
  "gcpinvoicemonth", "gcpInvoiceMonth", "gcp_invoice_month",
  /** GCP product (QLCE field gcpProduct; distinct from COMMON `product`). */
  "gcpproduct", "gcpProduct", "gcp_product",
  /** GCP resource global name (QLCE field gcpresource.global_name). */
  "gcpresource.global_name", "gcpresource_global_name", "gcpResourceGlobalName",
  /** GCP SKUs (QLCE field gcpSkuDescription). */
  "gcpskudescription", "gcpSkuDescription", "gcp_sku_description",
  /** Resource tags (QLCE LABEL_V2; requires tag_key — see buildGroupBy). */
  "resource_tag", "resource_tags", "tag", "tags", "labels", "label_v2", "labelv2",
  /** Same GraphQL path: BUSINESS_MAPPING + fieldId from cost category `uuid` (see buildGroupBy). */
  "business_domain", "cost_category",
] as const;

/** GCP Project dimension — matches CE perspective grid / scripts/gcp-unattributed-by-project.mjs. */
const GCP_PROJECT_ENTITY_GROUP = {
  fieldId: "gcpProjectId",
  fieldName: "Project",
  identifier: "GCP",
  identifierName: "GCP",
};

/** GCP Billing Account — user-provided curl shape (entityGroupBy GCP / gcpBillingAccountId). */
const GCP_BILLING_ACCOUNT_ENTITY_GROUP = {
  fieldId: "gcpBillingAccountId",
  fieldName: "Billing Account",
  identifier: "GCP",
  identifierName: "GCP",
};

/** GCP Invoice Month — user-provided GraphQL (entityGroupBy GCP / gcpInvoiceMonth). */
const GCP_INVOICE_MONTH_ENTITY_GROUP = {
  fieldId: "gcpInvoiceMonth",
  fieldName: "Invoice Month",
  identifier: "GCP",
  identifierName: "GCP",
};

/** GCP Product (SKU/service product) — user GraphQL entityGroupBy GCP / gcpProduct. */
const GCP_PRODUCT_ENTITY_GROUP = {
  fieldId: "gcpProduct",
  fieldName: "Product",
  identifier: "GCP",
  identifierName: "GCP",
};

/** GCP Resource Global Name — user GraphQL entityGroupBy GCP / gcpresource.global_name. */
const GCP_RESOURCE_GLOBAL_NAME_ENTITY_GROUP = {
  fieldId: "gcpresource.global_name",
  fieldName: "Resource Global Name",
  identifier: "GCP",
  identifierName: "GCP",
};

/** GCP SKUs — user GraphQL entityGroupBy GCP / gcpSkuDescription (fieldName "SKUs"). */
const GCP_SKU_DESCRIPTION_ENTITY_GROUP = {
  fieldId: "gcpSkuDescription",
  fieldName: "SKUs",
  identifier: "GCP",
  identifierName: "GCP",
};

const OUTPUT_FIELDS: Record<string, Record<string, string>> = {
  region:              { fieldId: "region",              fieldName: "Region",         identifier: "COMMON", identifierName: "Common" },
  awsUsageaccountid:   { fieldId: "awsUsageaccountid",   fieldName: "Account",        identifier: "AWS",    identifierName: "AWS" },
  awsServicecode:      { fieldId: "awsServicecode",      fieldName: "Service",        identifier: "AWS",    identifierName: "AWS" },
  awsBillingEntity:    { fieldId: "awsBillingEntity",     fieldName: "Billing Entity", identifier: "AWS",    identifierName: "AWS" },
  awsInstancetype:     { fieldId: "awsInstancetype",      fieldName: "Instance Type",  identifier: "AWS",    identifierName: "AWS" },
  awsLineItemType:     { fieldId: "awsLineItemType",      fieldName: "Line Item Type", identifier: "AWS",    identifierName: "AWS" },
  awspayeraccountid:   { fieldId: "awspayeraccountid",    fieldName: "Payer Account",  identifier: "AWS",    identifierName: "AWS" },
  awsUsageType:        { fieldId: "awsUsageType",         fieldName: "Usage Type",     identifier: "AWS",    identifierName: "AWS" },
  cloudProvider:       { fieldId: "cloudProvider",        fieldName: "Cloud Provider", identifier: "COMMON", identifierName: "Common" },
  none:                { fieldId: "none",                 fieldName: "None",           identifier: "COMMON", identifierName: "Common" },
  product:             { fieldId: "product",              fieldName: "Product",        identifier: "COMMON", identifierName: "Common" },
  gcpprojectid:           GCP_PROJECT_ENTITY_GROUP,
  gcpProjectId:           GCP_PROJECT_ENTITY_GROUP,
  gcp_project_id:         GCP_PROJECT_ENTITY_GROUP,
  gcpbillingaccountid:    GCP_BILLING_ACCOUNT_ENTITY_GROUP,
  gcpBillingAccountId:    GCP_BILLING_ACCOUNT_ENTITY_GROUP,
  gcp_billing_account_id: GCP_BILLING_ACCOUNT_ENTITY_GROUP,
  gcpinvoicemonth:        GCP_INVOICE_MONTH_ENTITY_GROUP,
  gcpInvoiceMonth:        GCP_INVOICE_MONTH_ENTITY_GROUP,
  gcp_invoice_month:      GCP_INVOICE_MONTH_ENTITY_GROUP,
  gcpproduct:             GCP_PRODUCT_ENTITY_GROUP,
  gcpProduct:             GCP_PRODUCT_ENTITY_GROUP,
  gcp_product:            GCP_PRODUCT_ENTITY_GROUP,
  "gcpresource.global_name": GCP_RESOURCE_GLOBAL_NAME_ENTITY_GROUP,
  gcpresource_global_name:   GCP_RESOURCE_GLOBAL_NAME_ENTITY_GROUP,
  gcpResourceGlobalName:     GCP_RESOURCE_GLOBAL_NAME_ENTITY_GROUP,
  gcpskudescription:         GCP_SKU_DESCRIPTION_ENTITY_GROUP,
  gcpSkuDescription:         GCP_SKU_DESCRIPTION_ENTITY_GROUP,
  gcp_sku_description:       GCP_SKU_DESCRIPTION_ENTITY_GROUP,
};

function buildTimeFilters(timeFilter: string): Record<string, unknown>[] {
  const now = new Date();
  let start: Date;
  let end: Date;

  switch (timeFilter) {
    case "LAST_7": {
      start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6));
      end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
      break;
    }
    case "THIS_MONTH": {
      start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
      break;
    }
    case "LAST_30_DAYS": {
      start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 30));
      end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
      break;
    }
    case "LAST_MONTH": {
      start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));
      break;
    }
    case "LAST_12_MONTHS": {
      start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12, 1));
      end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));
      break;
    }
    default: {
      start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 30));
      end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
      break;
    }
  }

  return [
    { timeFilter: { field: { fieldId: "startTime", fieldName: "startTime", identifier: "COMMON" }, operator: "AFTER", value: start.getTime() } },
    { timeFilter: { field: { fieldId: "startTime", fieldName: "startTime", identifier: "COMMON" }, operator: "BEFORE", value: end.getTime() } },
  ];
}

/** Absolute time range for perspective GraphQL (same shape as preset-driven filters). */
function buildTimeFiltersFromEpochRange(startMs: number, endMs: number): Record<string, unknown>[] {
  return [
    {
      timeFilter: {
        field: { fieldId: "startTime", fieldName: "startTime", identifier: "COMMON" },
        operator: "AFTER",
        value: startMs,
      },
    },
    {
      timeFilter: {
        field: { fieldId: "startTime", fieldName: "startTime", identifier: "COMMON" },
        operator: "BEFORE",
        value: endMs,
      },
    },
  ];
}

function buildViewFilter(viewId: string): Record<string, unknown>[] {
  return [{ viewMetadataFilter: { viewId, isPreview: false } }];
}

/** Normalize strings or comma-separated strings into a list for QLCE `idFilter.values`. */
function normalizePerspectiveIdFilterValues(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) {
    return raw
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return [];
    return t
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return [];
}

function firstNonEmptyStringList(...sources: unknown[]): string[] {
  for (const s of sources) {
    const v = normalizePerspectiveIdFilterValues(s);
    if (v.length > 0) return v;
  }
  return [];
}

/**
 * Optional `idFilter` clauses (QLCE) after view + time — scope perspective queries by GCP project,
 * GCP product, AWS account, AWS service, AWS line item type, cross-cloud product, and/or
 * cost category bucket (same shapes as CE / scripts using idFilter + IN).
 */
function buildOptionalPerspectiveIdFilters(input?: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];

  const gcpProjectIds = firstNonEmptyStringList(
    input?.filter_gcp_project_ids,
    input?.filter_gcp_project_id,
  );
  if (gcpProjectIds.length > 0) {
    out.push({
      idFilter: {
        operator: "IN",
        values: gcpProjectIds,
        field: {
          fieldId: GCP_PROJECT_ENTITY_GROUP.fieldId,
          fieldName: GCP_PROJECT_ENTITY_GROUP.fieldName,
          identifier: GCP_PROJECT_ENTITY_GROUP.identifier,
          identifierName: GCP_PROJECT_ENTITY_GROUP.identifierName,
        },
      },
    });
  }

  const gcpProducts = firstNonEmptyStringList(input?.filter_gcp_products, input?.filter_gcp_product);
  if (gcpProducts.length > 0) {
    out.push({
      idFilter: {
        operator: "IN",
        values: gcpProducts,
        field: {
          fieldId: GCP_PRODUCT_ENTITY_GROUP.fieldId,
          fieldName: GCP_PRODUCT_ENTITY_GROUP.fieldName,
          identifier: GCP_PRODUCT_ENTITY_GROUP.identifier,
          identifierName: GCP_PRODUCT_ENTITY_GROUP.identifierName,
        },
      },
    });
  }

  const commonProducts = firstNonEmptyStringList(input?.filter_products, input?.filter_product);
  if (commonProducts.length > 0) {
    const pf = OUTPUT_FIELDS.product;
    out.push({
      idFilter: {
        operator: "IN",
        values: commonProducts,
        field: {
          fieldId: pf?.fieldId ?? "product",
          fieldName: pf?.fieldName ?? "Product",
          identifier: pf?.identifier ?? "COMMON",
          identifierName: pf?.identifierName ?? "Common",
        },
      },
    });
  }

  // Cost category bucket filter — scope results to specific value(s) within a business mapping.
  // Requires business_mapping_field_id (resolved from business_mapping_name by registry dispatch).
  const costCatValues = firstNonEmptyStringList(
    input?.filter_cost_category_values,
    input?.filter_cost_category_value,
  );
  if (costCatValues.length > 0) {
    const fieldId =
      typeof input?.business_mapping_field_id === "string"
        ? input.business_mapping_field_id.trim()
        : "";
    if (!fieldId) {
      throw new Error(
        "filter_cost_category_value requires business_mapping_name (or business_mapping_field_id) " +
          "to identify which cost category mapping the bucket belongs to.",
      );
    }
    out.push({
      idFilter: {
        operator: "IN",
        values: costCatValues,
        field: {
          fieldId,
          fieldName: "Business Mapping",
          identifier: "BUSINESS_MAPPING",
          identifierName: "Business Mapping",
        },
      },
    });
  }

  // AWS account filter — scope by awsUsageaccountid (parity with filter_gcp_project_id).
  const awsAccounts = firstNonEmptyStringList(
    input?.filter_aws_usage_account_ids,
    input?.filter_aws_usage_account_id,
  );
  if (awsAccounts.length > 0) {
    const f = OUTPUT_FIELDS.awsUsageaccountid!;
    out.push({
      idFilter: {
        operator: "IN",
        values: awsAccounts,
        field: { fieldId: f.fieldId, fieldName: f.fieldName, identifier: f.identifier, identifierName: f.identifierName },
      },
    });
  }

  // AWS service filter — scope by awsServicecode.
  const awsServices = firstNonEmptyStringList(
    input?.filter_aws_services,
    input?.filter_aws_service,
  );
  if (awsServices.length > 0) {
    const f = OUTPUT_FIELDS.awsServicecode!;
    out.push({
      idFilter: {
        operator: "IN",
        values: awsServices,
        field: { fieldId: f.fieldId, fieldName: f.fieldName, identifier: f.identifier, identifierName: f.identifierName },
      },
    });
  }

  // AWS line item type filter — scope by awsLineItemType.
  // Use "Usage" to exclude RI/SP fees, credits, and tax entries that appear as "No Service".
  const awsLineItemTypes = firstNonEmptyStringList(
    input?.filter_aws_line_item_types,
    input?.filter_aws_line_item_type,
  );
  if (awsLineItemTypes.length > 0) {
    const f = OUTPUT_FIELDS.awsLineItemType!;
    out.push({
      idFilter: {
        operator: "IN",
        values: awsLineItemTypes,
        field: { fieldId: f.fieldId, fieldName: f.fieldName, identifier: f.identifier, identifierName: f.identifierName },
      },
    });
  }

  return out;
}

/**
 * When `start_time_ms` and `end_time_ms` are set on input, they override `time_filter`
 * (custom UTC window for period comparisons).
 */
function buildFilters(viewId: string, timeFilter: string, input?: Record<string, unknown>): Record<string, unknown>[] {
  const startMs = input?.start_time_ms;
  const endMs = input?.end_time_ms;
  const idFilters = buildOptionalPerspectiveIdFilters(input);
  let timePart: Record<string, unknown>[];
  if (
    typeof startMs === "number" &&
    typeof endMs === "number" &&
    Number.isFinite(startMs) &&
    Number.isFinite(endMs) &&
    endMs > startMs
  ) {
    timePart = buildTimeFiltersFromEpochRange(startMs, endMs);
  } else {
    timePart = buildTimeFilters(timeFilter);
  }
  return [...buildViewFilter(viewId), ...timePart, ...idFilters];
}

function isCostCategoryGroupBy(field?: string): boolean {
  if (!field) return false;
  const f = field.trim().toLowerCase();
  return f === "business_domain" || f === "cost_category";
}

function isResourceTagGroupBy(field?: string): boolean {
  if (!field) return false;
  const f = field.trim().toLowerCase();
  return (
    f === "resource_tag" ||
    f === "resource_tags" ||
    f === "tag" ||
    f === "tags" ||
    f === "labels" ||
    f === "label_v2" ||
    f === "labelv2"
  );
}

/** Tag key for LABEL_V2 group-by (GraphQL fieldName). Generic first, then legacy label_* aliases. */
function readResourceTagKey(input?: Record<string, unknown>): string {
  const candidates = [
    input?.tag_key,
    input?.resource_tag_key,
    input?.label_key,
    input?.label_field_name,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim() !== "") return c.trim();
  }
  return "";
}

/** QLCE label field id (default labels.value). Generic tag_field_id, then label_field_id. */
function readResourceTagFieldId(input?: Record<string, unknown>): string {
  const candidates = [input?.tag_field_id, input?.resource_tag_field_id, input?.label_field_id];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim() !== "") return c.trim();
  }
  return "labels.value";
}

/**
 * Built-in dimensions use OUTPUT_FIELDS. Cost categories (e.g. "Business Domains") are dynamic:
 * resolve uuid via `harness_ccm_finops_list cost_category` (or server-side resolve from name), then pass
 * `business_mapping_field_id` + `business_mapping_field_name` on the request input.
 *
 * Resource tags (QLCE LABEL_V2): use group_by `resource_tag` (or `tag`, `tags`, `labels`, …) and pass
 * `tag_key` (the tag key to aggregate by, e.g. action-type). Optional `tag_field_id` defaults to `labels.value`.
 */
function buildGroupBy(field?: string, input?: Record<string, unknown>): Record<string, unknown>[] {
  if (isResourceTagGroupBy(field)) {
    const tagKey = readResourceTagKey(input);
    if (!tagKey) {
      throw new Error(
        'group_by resource_tag (or tag, tags, labels, label_v2) requires tag_key (or resource_tag_key / label_key): ' +
          'the resource tag key to group by, e.g. "action-type".',
      );
    }
    const fieldId = readResourceTagFieldId(input);
    return [
      {
        entityGroupBy: {
          identifier: "LABEL_V2",
          identifierName: "Label V2",
          fieldId,
          fieldName: tagKey,
        },
      },
    ];
  }

  if (isCostCategoryGroupBy(field)) {
    const fieldId =
      typeof input?.business_mapping_field_id === "string"
        ? input.business_mapping_field_id.trim()
        : "";
    const fieldName =
      typeof input?.business_mapping_field_name === "string" &&
      input.business_mapping_field_name.trim() !== ""
        ? input.business_mapping_field_name.trim()
        : "Cost category";
    if (!fieldId) {
      throw new Error(
        "group_by business_domain or cost_category requires business_mapping_field_id (uuid from harness_ccm_finops_list cost_category). " +
          "Omit business_mapping_field_id only when the server can resolve it from business_mapping_name (default: Business Domains).",
      );
    }
    return [
      {
        entityGroupBy: {
          identifier: "BUSINESS_MAPPING",
          identifierName: "Cost Categories",
          fieldId,
          fieldName,
        },
      },
    ];
  }

  const groupByField =
    field && OUTPUT_FIELDS[field] ? OUTPUT_FIELDS[field] : OUTPUT_FIELDS["product"];
  return [{ entityGroupBy: groupByField }];
}

function buildAggregateFunction(): Record<string, string>[] {
  return [{ operationType: "SUM", columnName: "cost" }];
}

function buildPreferences(): Record<string, unknown> {
  return {
    includeOthers: false,
    includeUnallocatedCost: false,
    awsPreferences: {
      includeDiscounts: false,
      includeCredits: false,
      includeRefunds: false,
      includeTaxes: false,
      awsCost: "UNBLENDED",
    },
    gcpPreferences: null,
    azureViewPreferences: null,
    showAnomalies: false,
  };
}

// ---------------------------------------------------------------------------
// GraphQL endpoint path helper
// ---------------------------------------------------------------------------

function gqlPath(input: Record<string, unknown>): string {
  const accountId = input.account_id as string | undefined;
  if (accountId) {
    return `/ccm/api/graphql?accountIdentifier=${accountId}&routingId=${accountId}`;
  }
  return "/ccm/api/graphql";
}

// ---------------------------------------------------------------------------
// Toolset definition: 6 resource types covering REST + GraphQL
// ---------------------------------------------------------------------------

export const ccmToolset: ToolsetDefinition = {
  name: "ccm",
  displayName: "Cloud Cost Management",
  description:
    "Cloud cost visibility, analysis, recommendations, and anomaly detection. Covers perspectives, cost breakdowns, time series, summaries, recommendations, and anomalies.",
  resources: [
    // ------------------------------------------------------------------
    // 0. cost_perspective_folder — REST list of perspective folders
    // ------------------------------------------------------------------
    {
      resourceType: "cost_perspective_folder",
      displayName: "Cost Perspective Folder",
      description:
        "Perspective folders group related perspectives. Use harness_ccm_finops_list to discover folders, " +
        "then list perspectives within a folder via cost_perspective with folder_id filter. " +
        "Workflow: folder → perspectives → budget health (see harness_ccm_finops_budget_health).",
      toolset: "ccm",
      scope: "account",
      identifierFields: ["folder_id"],
      listFilterFields: [
        { name: "search_term", description: "Search folders by name" },
      ],
      operations: {
        list: {
          method: "GET",
          path: "/ccm/api/perspectiveFolders",
          responseExtractor: (raw) => {
            const r = raw as { status?: string; data?: Array<Record<string, unknown>> };
            const data = r.data ?? [];
            const items = data.map((f) => ({
              id: f.uuid,
              name: f.name,
              viewType: f.viewType,
              description: f.description ?? null,
              pinned: f.pinned ?? false,
            }));
            return { items, total: items.length };
          },
          description:
            "List all perspective folders. Returns id, name, viewType, description, pinned. " +
            "Use the folder id with cost_perspective list (folder_id filter) to get perspectives in that folder.",
        },
      },
    },

    // ------------------------------------------------------------------
    // 1. cost_perspective — REST CRUD for perspective management
    // ------------------------------------------------------------------
    {
      resourceType: "cost_perspective",
      displayName: "Cost Perspective",
      description:
        "A cloud cost perspective (saved view). Use harness_ccm_finops_list to see all perspectives (including custom ones), harness_ccm_finops_get for details. This is the starting point — get a perspective_id first, then use cost_breakdown or cost_timeseries to drill into costs.",
      toolset: "ccm",
      scope: "account",
      identifierFields: ["perspective_id"],
      listFilterFields: [
        { name: "search_term", description: "Search perspectives by name" },
        { name: "folder_id", description: "Filter by folder ID" },
      ],
      operations: {
        list: {
          method: "POST",
          path: "/ccm/api/graphql",
          bodyBuilder: (input) => ({
            query: PERSPECTIVES_LIST_QUERY,
            operationName: "FetchAllPerspectives",
            variables: {
              folderId: (input.folder_id as string) ?? "",
              sortCriteria: { sortOrder: "DESCENDING", sortType: "TIME" },
              pageSize: (input.size as number) ?? 20,
              pageNo: (input.page as number) ?? 0,
              searchKey: (input.search_term as string) ?? "",
              filters: [],
            },
          }),
          responseExtractor: (raw) => {
            const r = raw as {
              data?: {
                perspectives?: {
                  views?: unknown[];
                  totalCount?: number;
                };
              };
            };
            return {
              items: r.data?.perspectives?.views ?? [],
              total: r.data?.perspectives?.totalCount ?? 0,
            };
          },
          description: "List all cost perspectives (including custom ones) via GraphQL. Supports search_term and pagination.",
        },
        get: {
          method: "GET",
          path: "/ccm/api/perspective",
          queryParams: { perspective_id: "perspectiveId" },
          responseExtractor: ngExtract,
          description: "Get cost perspective details by ID — returns viewRules, viewPreferences (cost accounting settings), dataSources, viewVisualization (default groupBy/chart), totalCost, and creator info.",
        },
      },
    },

    // ------------------------------------------------------------------
    // 2. cost_breakdown — GraphQL perspective grid (drill-down by dimension)
    //    Replaces: ccm_perspective_grid from the official server
    //    Answers: "Where is my money going?"
    // ------------------------------------------------------------------
    {
      resourceType: "cost_breakdown",
      displayName: "Cost Breakdown",
      description: `Drill-down cost breakdown by any dimension within a perspective. Answers "where is my money going?" Returns cost AND costTrend per entity (e.g. per AWS service, per region, per cost category).

Each row includes: name, id, cost (current period total), and costTrend (percentage change vs the equivalent previous period). A single query gives you both current and previous period comparison — no need to call twice with different time windows.

To drill into a specific cost category bucket (e.g. a Business Unit) broken down by another dimension: set filter_cost_category_value to the bucket name, business_mapping_name to the mapping, and group_by to the drill-down dimension (e.g. gcp_project_id). This scopes all results to that bucket in one call.

Required: perspective_id (get from cost_perspective list).
Optional: group_by (${VALID_GROUP_BY_FIELDS.join(", ")}), time_filter (${VALID_TIME_FILTERS.join(", ")}), start_time_ms/end_time_ms (override preset), filter_cost_category_value + business_mapping_name (scope to a cost category bucket), filter_gcp_project_id / filter_gcp_product / filter_product, limit, offset.`,
      toolset: "ccm",
      scope: "account",
      identifierFields: ["perspective_id"],
      listFilterFields: [
        { name: "group_by", description: "Group results by field", enum: [...VALID_GROUP_BY_FIELDS] },
        { name: "time_filter", description: "Time range filter (ignored when start_time_ms and end_time_ms are set)", enum: [...VALID_TIME_FILTERS] },
        { name: "start_time_ms", description: "Custom window start (epoch ms, UTC); use with end_time_ms for period comparisons" },
        { name: "end_time_ms", description: "Custom window end (epoch ms, UTC); must be greater than start_time_ms" },
        { name: "business_mapping_name", description: "Cost category name to resolve (default Business Domains); uuid used as group-by fieldId and for filter_cost_category_value scoping" },
        { name: "business_mapping_field_id", description: "Cost category uuid from harness_ccm_finops_list cost_category; required for group_by business_domain / cost_category if not auto-resolved" },
        {
          name: "filter_cost_category_value",
          description:
            "Scope results to specific bucket(s) within the named cost category (business mapping). " +
            "One value or comma-separated values. Requires business_mapping_name (or business_mapping_field_id). " +
            "Example: business_mapping_name='Business Units', filter_cost_category_value='onetru-credit', group_by='gcp_project_id' " +
            "→ breaks down by GCP project scoped to that BU.",
        },
        { name: "filter_cost_category_values", description: "Array form of filter_cost_category_value (multiple bucket names)" },
        { name: "tag_key", description: 'Resource tag key when group_by is resource_tag, tag, tags, or labels (QLCE fieldName), e.g. "action-type"' },
        { name: "resource_tag_key", description: "Alias for tag_key" },
        { name: "tag_field_id", description: 'QLCE label field id; default "labels.value"' },
        { name: "resource_tag_field_id", description: "Alias for tag_field_id" },
        { name: "label_key", description: "Legacy alias for tag_key" },
        { name: "label_field_name", description: "Legacy alias for tag_key" },
        { name: "label_field_id", description: "Legacy alias for tag_field_id" },
        {
          name: "filter_gcp_project_id",
          description:
            "Scope results to GCP billing project id(s): one id, comma-separated ids, or use filter_gcp_project_ids (QLCE idFilter IN on gcpProjectId)",
        },
        { name: "filter_gcp_project_ids", description: "Array of GCP project ids (alternative to filter_gcp_project_id)" },
        {
          name: "filter_gcp_product",
          description:
            "Scope to GCP product name(s) (gcpProduct), e.g. Compute Engine — comma-separated or use filter_gcp_products",
        },
        { name: "filter_gcp_products", description: "Array of GCP product names" },
        {
          name: "filter_product",
          description: "Scope to cross-cloud product name(s) (COMMON product); comma-separated or filter_products",
        },
        { name: "filter_products", description: "Array of COMMON product names" },
        {
          name: "filter_aws_usage_account_id",
          description:
            "Scope to AWS account id(s) (awsUsageaccountid) — comma-separated or use filter_aws_usage_account_ids. " +
            "AWS parity with filter_gcp_project_id.",
        },
        { name: "filter_aws_usage_account_ids", description: "Array of AWS account ids" },
        {
          name: "filter_aws_service",
          description:
            "Scope to AWS service name(s) (awsServicecode, e.g. AmazonEC2) — comma-separated or use filter_aws_services",
        },
        { name: "filter_aws_services", description: "Array of AWS service names" },
        {
          name: "filter_aws_line_item_type",
          description:
            "Scope to AWS line item type(s) (e.g. Usage, SavingsPlanCoveredUsage). " +
            "Use 'Usage' to exclude RI/SP fees, credits, and 'No Service' entries that distort service breakdowns.",
        },
        { name: "filter_aws_line_item_types", description: "Array of AWS line item types" },
        { name: "limit", description: "Result limit", type: "number" },
        { name: "offset", description: "Pagination offset", type: "number" },
      ],
      operations: {
        list: {
          method: "POST",
          path: "/ccm/api/graphql",
          bodyBuilder: (input) => ({
            query: PERSPECTIVE_GRID_QUERY,
            operationName: "FetchperspectiveGrid",
            variables: {
              filters: buildFilters(
                input.perspective_id as string,
                (input.time_filter as string) ?? "LAST_30_DAYS",
                input,
              ),
              groupBy: buildGroupBy(input.group_by as string | undefined, input),
              limit: (input.limit as number) ?? 25,
              offset: (input.offset as number) ?? 0,
              aggregateFunction: buildAggregateFunction(),
              isClusterOnly: false,
              isClusterHourlyData: false,
              preferences: buildPreferences(),
            },
          }),
          responseExtractor: (raw) => {
            const r = raw as {
              data?: {
                perspectiveGrid?: { data?: unknown[] };
                perspectiveTotalCount?: number;
              };
            };
            return {
              items: r.data?.perspectiveGrid?.data ?? [],
              total: r.data?.perspectiveTotalCount ?? 0,
            };
          },
          description:
            "Get cost breakdown by dimension for a perspective. Each row returns cost (current period total) and costTrend (% change vs previous period) — one call covers both periods. Group by region, awsServicecode, product, cloudProvider, cost_category, etc.",
        },
      },
    },

    // ------------------------------------------------------------------
    // 3. cost_timeseries — GraphQL perspective time series
    //    Replaces: ccm_perspective_time_series from the official server
    //    Answers: "How has my spend changed over time?"
    // ------------------------------------------------------------------
    {
      resourceType: "cost_timeseries",
      displayName: "Cost Time Series",
      description: `Cost over time for a perspective, grouped by a dimension. Answers "how has my spend changed?" Returns daily/monthly cost data points.

Supports filter_cost_category_value to scope the time series to specific bucket(s) within a cost category (e.g. a Business Unit), combined with any group_by dimension.

Required: perspective_id, group_by (${VALID_GROUP_BY_FIELDS.join(", ")}).
Optional: time_filter (${VALID_TIME_FILTERS.join(", ")}), start_time_ms/end_time_ms (override preset), filter_cost_category_value + business_mapping_name, filter_gcp_project_id / filter_gcp_product / filter_product, time_resolution (DAY, MONTH, WEEK), limit.`,
      toolset: "ccm",
      scope: "account",
      identifierFields: ["perspective_id"],
      listFilterFields: [
        { name: "group_by", description: "Group results by field", enum: [...VALID_GROUP_BY_FIELDS] },
        { name: "time_filter", description: "Time range filter (ignored when start_time_ms and end_time_ms are set)", enum: [...VALID_TIME_FILTERS] },
        { name: "start_time_ms", description: "Custom window start (epoch ms, UTC); use with end_time_ms for period comparisons" },
        { name: "end_time_ms", description: "Custom window end (epoch ms, UTC); must be greater than start_time_ms" },
        { name: "time_resolution", description: "Time resolution for aggregation", enum: ["DAY", "MONTH", "WEEK"] },
        { name: "business_mapping_name", description: "Cost category name to resolve (default Business Domains); uuid used as group-by fieldId and for filter_cost_category_value scoping" },
        { name: "business_mapping_field_id", description: "Cost category uuid from harness_ccm_finops_list cost_category; required for group_by business_domain / cost_category if not auto-resolved" },
        {
          name: "filter_cost_category_value",
          description:
            "Scope results to specific bucket(s) within the named cost category. " +
            "One value or comma-separated. Requires business_mapping_name (or business_mapping_field_id).",
        },
        { name: "filter_cost_category_values", description: "Array form of filter_cost_category_value" },
        { name: "tag_key", description: 'Resource tag key when group_by is resource_tag, tag, tags, or labels' },
        { name: "resource_tag_key", description: "Alias for tag_key" },
        { name: "tag_field_id", description: 'QLCE label field id; default "labels.value"' },
        { name: "resource_tag_field_id", description: "Alias for tag_field_id" },
        { name: "label_key", description: "Legacy alias for tag_key" },
        { name: "label_field_name", description: "Legacy alias for tag_key" },
        { name: "label_field_id", description: "Legacy alias for tag_field_id" },
        {
          name: "filter_gcp_project_id",
          description: "GCP project id(s) to scope the series (comma-separated or filter_gcp_project_ids)",
        },
        { name: "filter_gcp_project_ids", description: "Array of GCP project ids" },
        { name: "filter_gcp_product", description: "GCP product name(s) to scope (comma-separated or filter_gcp_products)" },
        { name: "filter_gcp_products", description: "Array of GCP product names" },
        { name: "filter_product", description: "COMMON product name(s) to scope (comma-separated or filter_products)" },
        { name: "filter_products", description: "Array of COMMON product names" },
        {
          name: "filter_aws_usage_account_id",
          description:
            "Scope to AWS account id(s) (awsUsageaccountid) — comma-separated or use filter_aws_usage_account_ids",
        },
        { name: "filter_aws_usage_account_ids", description: "Array of AWS account ids" },
        {
          name: "filter_aws_service",
          description:
            "Scope to AWS service name(s) (awsServicecode, e.g. AmazonEC2) — comma-separated or use filter_aws_services",
        },
        { name: "filter_aws_services", description: "Array of AWS service names" },
        {
          name: "filter_aws_line_item_type",
          description:
            "Scope to AWS line item type(s) (e.g. Usage, SavingsPlanCoveredUsage). " +
            "Use 'Usage' to exclude RI/SP fees, credits, and 'No Service' entries.",
        },
        { name: "filter_aws_line_item_types", description: "Array of AWS line item types" },
        { name: "limit", description: "Result limit", type: "number" },
      ],
      operations: {
        list: {
          method: "POST",
          path: "/ccm/api/graphql",
          bodyBuilder: (input) => {
            const timeResolution = (input.time_resolution as string) ?? "DAY";
            const entityGroupBy = buildGroupBy(input.group_by as string | undefined, input);
            const timeTruncGroupBy = { timeTruncGroupBy: { resolution: timeResolution } };

            return {
              query: PERSPECTIVE_TIMESERIES_QUERY,
              operationName: "FetchPerspectiveTimeSeries",
              variables: {
                filters: buildFilters(
                  input.perspective_id as string,
                  (input.time_filter as string) ?? "LAST_30_DAYS",
                  input,
                ),
                groupBy: [timeTruncGroupBy, entityGroupBy[0]],
                limit: (input.limit as number) ?? 12,
                preferences: buildPreferences(),
                isClusterHourlyData: false,
              },
            };
          },
          responseExtractor: (raw) => {
            const r = raw as {
              data?: { perspectiveTimeSeriesStats?: { stats?: unknown[] } };
            };
            return r.data?.perspectiveTimeSeriesStats?.stats ?? [];
          },
          description:
            "Get cost time series data for a perspective. Shows cost trends over time grouped by a dimension.",
        },
      },
    },

    // ------------------------------------------------------------------
    // 4. cost_summary — GraphQL perspective trend + forecast + budget
    //    Replaces: ccm_perspective_summary_with_budget, ccm_perspective_budget,
    //              get_ccm_overview, get_ccm_metadata from the official server
    //    Answers: "What's my cost overview for this perspective?"
    // ------------------------------------------------------------------
    {
      resourceType: "cost_summary",
      displayName: "Cost Summary",
      description: `High-level cost summary for a perspective: total cost, trend, idle cost, unallocated cost, efficiency score, forecast, and budget status. Answers "what's my cost overview?"

Required: perspective_id.
Optional: time_filter (${VALID_TIME_FILTERS.join(", ")}).

Use with no perspective_id to get CCM metadata (available connectors, default perspective IDs).`,
      toolset: "ccm",
      scope: "account",
      identifierFields: ["perspective_id"],
      listFilterFields: [
        { name: "time_filter", description: "Time range filter" },
        { name: "start_time_ms", description: "Custom window start (epoch ms, UTC); use with end_time_ms" },
        { name: "end_time_ms", description: "Custom window end (epoch ms, UTC)" },
        { name: "business_mapping_name", description: "Cost category name to resolve (default Business Domains); needed for filter_cost_category_value" },
        { name: "business_mapping_field_id", description: "Cost category uuid; alternative to business_mapping_name" },
        {
          name: "filter_cost_category_value",
          description:
            "Scope summary to specific bucket(s) within a cost category. " +
            "Requires business_mapping_name (or business_mapping_field_id).",
        },
        { name: "filter_cost_category_values", description: "Array form of filter_cost_category_value" },
        { name: "filter_gcp_project_id", description: "GCP project id(s) to scope summary (comma-separated or filter_gcp_project_ids)" },
        { name: "filter_gcp_project_ids", description: "Array of GCP project ids" },
        { name: "filter_gcp_product", description: "GCP product name(s) to scope" },
        { name: "filter_gcp_products", description: "Array of GCP product names" },
        { name: "filter_product", description: "COMMON product name(s) to scope" },
        { name: "filter_products", description: "Array of COMMON product names" },
        {
          name: "filter_aws_usage_account_id",
          description: "Scope to AWS account id(s) (awsUsageaccountid) — comma-separated or use filter_aws_usage_account_ids",
        },
        { name: "filter_aws_usage_account_ids", description: "Array of AWS account ids" },
        {
          name: "filter_aws_service",
          description: "Scope to AWS service name(s) (awsServicecode, e.g. AmazonEC2) — comma-separated or use filter_aws_services",
        },
        { name: "filter_aws_services", description: "Array of AWS service names" },
        {
          name: "filter_aws_line_item_type",
          description:
            "Scope to AWS line item type(s) (e.g. Usage, SavingsPlanCoveredUsage). " +
            "Use 'Usage' to exclude RI/SP fees, credits, and 'No Service' entries.",
        },
        { name: "filter_aws_line_item_types", description: "Array of AWS line item types" },
      ],
      operations: {
        list: {
          method: "POST",
          path: "/ccm/api/graphql",
          bodyBuilder: (input) => {
            const perspectiveId = input.perspective_id as string | undefined;

            if (!perspectiveId) {
              return {
                query: CCM_METADATA_QUERY,
                operationName: "FetchCcmMetaData",
                variables: {},
              };
            }

            return {
              query: PERSPECTIVE_SUMMARY_QUERY,
              operationName: "FetchPerspectiveDetailsSummaryWithBudget",
              variables: {
                filters: buildFilters(
                  perspectiveId,
                  (input.time_filter as string) ?? "LAST_30_DAYS",
                  input,
                ),
                groupBy: buildGroupBy(),
                aggregateFunction: buildAggregateFunction(),
                isClusterQuery: false,
                isClusterHourlyData: false,
                preferences: buildPreferences(),
              },
            };
          },
          responseExtractor: (raw) => {
            const r = raw as { data?: Record<string, unknown> };
            if (!r.data) return raw;
            if (r.data.ccmMetaData) return r.data.ccmMetaData;
            return {
              trendStats: r.data.perspectiveTrendStats,
              forecastCost: r.data.perspectiveForecastCost,
            };
          },
          description:
            "Get cost summary with trend, forecast, idle/unallocated costs. Omit perspective_id to get CCM metadata.",
        },
        get: {
          method: "POST",
          path: "/ccm/api/graphql",
          bodyBuilder: (input) => ({
            query: PERSPECTIVE_BUDGET_QUERY,
            operationName: "FetchPerspectiveBudget",
            variables: { perspectiveId: input.perspective_id as string },
          }),
          responseExtractor: gqlExtract("budgetSummaryList"),
          description:
            "Get budget status for a perspective (budget amount, actual cost, time remaining).",
        },
      },
    },

    // ------------------------------------------------------------------
    // 5. cost_recommendation — REST list with rich filtering, GraphQL get
    //    for single recommendation or perspective-scoped stats.
    //    Answers: "How do I reduce my cloud bill?"
    // ------------------------------------------------------------------
    {
      resourceType: "cost_recommendation",
      displayName: "Cost Recommendation",
      description: `Cloud cost optimization recommendations. Answers "how do I reduce my cloud bill?"

harness_ccm_finops_list: Discover recommendations with rich filtering — by perspective, cost category, cloud provider, resource type, governance rule, tags, and more. Returns all resource types (EC2, Azure VM, ECS, Node Pool, Workload, Governance) in a single list. Strips verbose JIRA/ServiceNow payloads for clean output.

harness_ccm_finops_get: With resource_id (recommendation ID) → summary for that recommendation. With perspective_id via params → perspective-scoped recommendations with savings stats.`,
      toolset: "ccm",
      scope: "account",
      identifierFields: ["recommendation_id"],
      listFilterFields: [
        { name: "perspective_id", description: "Scope recommendations to a perspective" },
        { name: "days_back", description: "Lookback window in days (default 4)", type: "number" },
        { name: "min_saving", description: "Minimum savings threshold in dollars (default 1)", type: "number" },
        { name: "resource_type_filter", description: "Filter by resource type (comma-separated: EC2_INSTANCE, AZURE_INSTANCE, ECS_SERVICE, GOVERNANCE, NODE_POOL, WORKLOAD)" },
        { name: "cloud_provider", description: "Filter by cloud provider (comma-separated: AWS, GCP, AZURE)" },
        { name: "recommendation_state", description: "Filter by state (default OPEN)", enum: ["OPEN", "APPLIED", "IGNORED"] },
        { name: "cloud_account_name", description: "Filter by cloud account name(s)" },
        { name: "region", description: "Filter by region(s)" },
        { name: "resource_name", description: "Filter by resource name(s)" },
        { name: "cost_category_name", description: "Cost category name for bucket filtering (used with cost_category_bucket)" },
        { name: "cost_category_bucket", description: "Cost category bucket value (used with cost_category_name)" },
        { name: "tag_key", description: "Resource tag key (used with tag_value)" },
        { name: "tag_value", description: "Resource tag value (used with tag_key)" },
        { name: "governance_rule_name", description: "Filter by governance rule name(s)" },
        { name: "k8s_cluster_name", description: "Filter by Kubernetes cluster name(s)" },
        { name: "k8s_namespace", description: "Filter by Kubernetes namespace(s)" },
        { name: "ecs_cluster_name", description: "Filter by ECS cluster name(s)" },
        { name: "start_time_ms", description: "Applied-at window start (epoch ms)" },
        { name: "end_time_ms", description: "Applied-at window end (epoch ms)" },
        { name: "time_filter", description: "Time range preset for perspective scoping", enum: [...VALID_TIME_FILTERS] },
        { name: "limit", description: "Result limit (default 10)", type: "number" },
        { name: "offset", description: "Pagination offset (default 0)", type: "number" },
      ],
      operations: {
        list: {
          method: "POST",
          path: "/ccm/api/recommendation/overview/list",
          bodyBuilder: (input) => {
            const body: Record<string, unknown> = {
              filterType: "CCMRecommendation",
              daysBack: (input.days_back as number) ?? 4,
              minSaving: (input.min_saving as number) ?? 1,
              offset: (input.offset as number) ?? 0,
              limit: (input.limit as number) ?? 10,
            };

            if (input.perspective_id) {
              body.perspectiveFilters = buildFilters(
                input.perspective_id as string,
                (input.time_filter as string) ?? "LAST_30_DAYS",
                input,
              );
            }

            if (input.cost_category_name && input.cost_category_bucket) {
              body.costCategoryDTOs = [{
                costCategory: input.cost_category_name as string,
                costBucket: input.cost_category_bucket as string,
              }];
            }

            if (input.tag_key && input.tag_value) {
              body.tagDTOs = [{
                key: input.tag_key as string,
                value: input.tag_value as string,
              }];
            }

            const baseFilter: Record<string, unknown> = {};
            if (input.resource_type_filter) {
              baseFilter.resourceType = normalizePerspectiveIdFilterValues(input.resource_type_filter);
            }
            if (input.cloud_provider) {
              baseFilter.cloudProvider = normalizePerspectiveIdFilterValues(input.cloud_provider);
            }
            if (input.cloud_account_name) {
              baseFilter.cloudAccountName = normalizePerspectiveIdFilterValues(input.cloud_account_name);
            }
            if (input.region) {
              baseFilter.region = normalizePerspectiveIdFilterValues(input.region);
            }
            if (input.resource_name) {
              baseFilter.resourceName = normalizePerspectiveIdFilterValues(input.resource_name);
            }
            if (typeof input.start_time_ms === "number") {
              baseFilter.appliedAtStartTime = input.start_time_ms;
            }
            if (typeof input.end_time_ms === "number") {
              baseFilter.appliedAtEndTime = input.end_time_ms;
            }
            if (Object.keys(baseFilter).length > 0) {
              body.baseRecommendationFilterPropertiesDTO = baseFilter;
            }

            const containerFilter: Record<string, unknown> = {};
            if (input.k8s_cluster_name) {
              containerFilter.k8sClusterName = normalizePerspectiveIdFilterValues(input.k8s_cluster_name);
            }
            if (input.k8s_namespace) {
              containerFilter.k8sNamespace = normalizePerspectiveIdFilterValues(input.k8s_namespace);
            }
            if (input.ecs_cluster_name) {
              containerFilter.ecsClusterName = normalizePerspectiveIdFilterValues(input.ecs_cluster_name);
            }
            if (Object.keys(containerFilter).length > 0) {
              body.containerRecommendationFilterPropertiesDTO = containerFilter;
            }

            if (input.governance_rule_name) {
              body.governanceRecommendationFilterPropertiesDTO = {
                governanceRuleName: normalizePerspectiveIdFilterValues(input.governance_rule_name),
              };
            }

            if (input.recommendation_state) {
              body.k8sRecommendationFilterPropertiesDTO = {
                recommendationStates: normalizePerspectiveIdFilterValues(input.recommendation_state),
              };
            }

            return body;
          },
          responseExtractor: ccmRecommendationListCompactExtract,
          description:
            "List cost recommendations with rich filtering — by perspective, cost category, cloud provider, resource type, governance rule, tags. " +
            "Strips verbose JIRA/ServiceNow payloads. Returns items with id, resourceName, monthlySaving, monthlyCost, resourceType, cloudProvider.",
        },
        get: {
          method: "POST",
          path: "/ccm/api/graphql",
          bodyBuilder: (input) => {
            const filter: Record<string, unknown> = {
              limit: (input.limit as number) ?? 25,
              offset: (input.offset as number) ?? 0,
              minSaving: (input.min_saving as number) ?? 0,
            };

            if (input.recommendation_id) {
              filter.ids = [input.recommendation_id as string];
            }

            if (input.perspective_id) {
              filter.perspectiveFilters = buildFilters(
                input.perspective_id as string,
                (input.time_filter as string) ?? "LAST_30_DAYS",
                input,
              );
            }

            if (input.recommendation_state) {
              filter.recommendationStates = normalizePerspectiveIdFilterValues(input.recommendation_state);
            }

            return {
              query: PERSPECTIVE_RECOMMENDATIONS_QUERY,
              operationName: "PerspectiveRecommendations",
              variables: { filter },
            };
          },
          responseExtractor: (raw) => {
            const r = raw as {
              data?: {
                recommendationsV2?: { items?: unknown[] };
                recommendationStatsV2?: unknown;
              };
            };
            return {
              items: r.data?.recommendationsV2?.items ?? [],
              stats: r.data?.recommendationStatsV2,
            };
          },
          description:
            "Get recommendation details. With resource_id: summary for a single recommendation. " +
            "With perspective_id (via params): perspective-scoped recommendations with aggregate savings stats.",
        },
      },
    },

    // ------------------------------------------------------------------
    // 6. cost_anomaly — REST only (rich filtering)
    //    Replaces: list_ccm_anomalies, list_all_ccm_anomalies,
    //              list_ccm_ignored_anomalies, get_ccm_anomalies_for_perspective
    //    All consolidated into one parameterized resource type
    //    Answers: "Are there any unexpected cost spikes?"
    // ------------------------------------------------------------------
    {
      resourceType: "cost_anomaly",
      displayName: "Cost Anomaly",
      description: `Detected cloud cost anomalies — unexpected cost spikes. Answers "are there any unusual charges?"

Recommended drill-down flow:
1. **cost_anomaly_summary** list with perspective_id + group_by + time range → anomaly counts by dimension/day (which entities have spikes)
2. **cost_anomaly** list with anomaly_start_ms/anomaly_end_ms + perspective_id → individual anomaly records for a specific day
3. **cost_anomaly** get with anomaly_id → full details for a single anomaly (root cause, cost breakdown, timeline)

list (v2) supports: perspective_id for scoping, anomaly_start_ms/anomaly_end_ms for day drill-down, status, search_text, order_by, limit/offset.`,
      toolset: "ccm",
      scope: "account",
      identifierFields: ["anomaly_id"],
      listFilterFields: [
        { name: "perspective_id", description: "Perspective to scope anomalies to" },
        { name: "status", description: "Anomaly status filter", enum: ["ACTIVE", "IGNORED", "ARCHIVED", "RESOLVED"] },
        { name: "min_amount", description: "Minimum amount threshold", type: "number" },
        { name: "min_anomalous_spend", description: "Minimum anomalous spend threshold", type: "number" },
        { name: "anomaly_start_ms", description: "Filter anomalies AFTER this timestamp (epoch ms) — drill into a specific day/window" },
        { name: "anomaly_end_ms", description: "Filter anomalies BEFORE this timestamp (epoch ms) — drill into a specific day/window" },
        { name: "search_text", description: "Search text to filter anomalies by name" },
        { name: "order_by", description: "Sort field for list results", enum: ["ANOMALOUS_SPEND", "ACTUAL_AMOUNT", "TIME"] },
        { name: "order_direction", description: "Sort direction", enum: ["ASCENDING", "DESCENDING"] },
        { name: "limit", description: "Result limit", type: "number" },
        { name: "offset", description: "Pagination offset", type: "number" },
        { name: "group_by", description: "Group dimension (for get: perspective summary; for list: perspective scoping)", enum: [...VALID_GROUP_BY_FIELDS] },
        { name: "time_filter", description: "Perspective time range preset (for get/list perspective scoping, ignored when start_time_ms/end_time_ms set)", enum: [...VALID_TIME_FILTERS] },
        { name: "start_time_ms", description: "Perspective window start (epoch ms, UTC); for get and list perspective scoping" },
        { name: "end_time_ms", description: "Perspective window end (epoch ms, UTC); for get and list perspective scoping" },
        { name: "time_resolution", description: "Time aggregation for get operation", enum: ["DAY", "MONTH", "WEEK"] },
        { name: "business_mapping_name", description: "Cost category name (for group_by cost_category)" },
        { name: "business_mapping_field_id", description: "Cost category uuid (for group_by cost_category)" },
        { name: "tag_key", description: "Resource tag key (for group_by resource_tag)" },
      ],
      operations: {
        list: {
          method: "POST",
          path: "/ccm/api/anomaly/v2/list",
          bodyBuilder: (input) => {
            const anomalyFilter: Record<string, unknown> = {
              filterType: "Anomaly",
              limit: (input.limit as number) ?? 10,
              offset: (input.offset as number) ?? 0,
              groupBy: [],
            };

            if (input.status) {
              anomalyFilter.status = Array.isArray(input.status) ? input.status : [input.status];
            }
            if (input.min_amount) {
              anomalyFilter.minActualAmount = input.min_amount;
            }
            if (input.min_anomalous_spend) {
              anomalyFilter.minAnomalousSpend = input.min_anomalous_spend;
            }

            const searchText =
              typeof input.search_text === "string" && input.search_text.trim()
                ? [input.search_text.trim()]
                : [""];
            anomalyFilter.searchText = searchText;

            // Anomaly-level time filters (drill into a specific day)
            const timeFilters: Record<string, unknown>[] = [];
            if (typeof input.anomaly_start_ms === "number" && Number.isFinite(input.anomaly_start_ms)) {
              timeFilters.push({ operator: "AFTER", timestamp: input.anomaly_start_ms });
            }
            if (typeof input.anomaly_end_ms === "number" && Number.isFinite(input.anomaly_end_ms)) {
              timeFilters.push({ operator: "BEFORE", timestamp: input.anomaly_end_ms });
            }
            if (timeFilters.length > 0) {
              anomalyFilter.timeFilters = timeFilters;
            }

            // Order by
            const orderField = (input.order_by as string) ?? "ANOMALOUS_SPEND";
            const orderDir = (input.order_direction as string) ?? "DESCENDING";
            anomalyFilter.orderBy = [{ field: orderField, order: orderDir }];

            const body: Record<string, unknown> = { anomalyFilterPropertiesDTO: anomalyFilter };

            // Perspective scoping (optional) — adds perspectiveQueryDTO with filters + groupBy
            if (input.perspective_id) {
              const perspectiveId = input.perspective_id as string;
              const timeFilter = (input.time_filter as string) ?? "LAST_30_DAYS";
              const perspectiveFilters = buildFilters(perspectiveId, timeFilter, input as Record<string, unknown>);
              const perspectiveGroupBy = input.group_by
                ? buildGroupBy(input.group_by as string, input as Record<string, unknown>)
                : [];

              body.perspectiveQueryDTO = {
                filters: perspectiveFilters,
                groupBy: perspectiveGroupBy,
              };
            }

            return body;
          },
          responseExtractor: ngExtract,
          description:
            "List cost anomalies (v2). Supports anomaly_start_ms/anomaly_end_ms to drill into a specific day, " +
            "perspective_id + group_by to scope by perspective and dimension, status, search_text, order_by.",
        },
        get: {
          method: "GET",
          path: "/ccm/api/anomaly/v2/drill-down",
          queryParams: { anomaly_id: "anomalyId" },
          responseExtractor: ngExtract,
          description:
            "Get full details for a single anomaly by anomaly_id — root cause, cost breakdown, timeline. " +
            "Use after listing anomalies to drill into a specific one.",
        },
      },
    },

    // ------------------------------------------------------------------
    // 6b. cost_anomaly_summary — perspective-scoped anomaly summary by dimension + time
    //     Answers: "Which projects/services/regions have anomalies this week?"
    // ------------------------------------------------------------------
    {
      resourceType: "cost_anomaly_summary",
      displayName: "Cost Anomaly Summary (by Perspective)",
      description: `Perspective-scoped anomaly summary grouped by a dimension (e.g. GCP project, product) and time. Answers "which entities have cost spikes?"

Requires perspective_id. Returns anomaly counts/totals per dimension per time bucket — use to identify which entities have spikes before drilling into specific anomalies with cost_anomaly list + anomaly_start_ms/anomaly_end_ms.

Supports the same group_by dimensions as cost_breakdown (${VALID_GROUP_BY_FIELDS.slice(0, 10).join(", ")}, etc.) and time_resolution (DAY, MONTH, WEEK).`,
      toolset: "ccm",
      scope: "account",
      identifierFields: ["perspective_id"],
      listFilterFields: [
        { name: "perspective_id", description: "Perspective UUID (required)" },
        { name: "group_by", description: "Group anomalies by dimension", enum: [...VALID_GROUP_BY_FIELDS] },
        { name: "time_filter", description: "Time range preset (ignored when start_time_ms/end_time_ms set)", enum: [...VALID_TIME_FILTERS] },
        { name: "start_time_ms", description: "Custom window start (epoch ms, UTC)" },
        { name: "end_time_ms", description: "Custom window end (epoch ms, UTC)" },
        { name: "time_resolution", description: "Time aggregation resolution", enum: ["DAY", "MONTH", "WEEK"] },
        { name: "business_mapping_name", description: "Cost category name (for group_by cost_category)" },
        { name: "business_mapping_field_id", description: "Cost category uuid (for group_by cost_category)" },
        { name: "tag_key", description: "Resource tag key (for group_by resource_tag)" },
      ],
      operations: {
        list: {
          method: "POST",
          path: "/ccm/api/anomaly/perspective/{perspectiveId}",
          pathParams: { perspective_id: "perspectiveId" },
          bodyBuilder: (input) => {
            const perspectiveId = input.perspective_id as string;
            const timeFilter = (input.time_filter as string) ?? "LAST_30_DAYS";

            const filters = buildFilters(perspectiveId, timeFilter, input as Record<string, unknown>);

            const timeResolution = (input.time_resolution as string) ?? "DAY";
            const entityGroupBy = buildGroupBy(input.group_by as string | undefined, input as Record<string, unknown>);
            const groupBy = [
              entityGroupBy[0],
              { timeTruncGroupBy: { resolution: timeResolution } },
            ];

            return { filters, groupBy };
          },
          responseExtractor: ngExtract,
          description:
            "Get anomaly summary for a perspective grouped by dimension and time. " +
            "Shows which entities (projects, services, regions) have cost spikes.",
        },
      },
    },

    // ------------------------------------------------------------------
    // 7. cost_category — REST for business mappings / cost categories (rules)
    // ------------------------------------------------------------------
    {
      resourceType: "cost_category",
      displayName: "Cost Category (Business Mapping)",
      description:
        "Cost categories are **business mappings**: they define rules/conditions that assign cloud spend to dimensions (e.g. Business Domains, Business Units). " +
        "Use **list** to page through mappings (names, ids). Use **get** with a mapping **uuid** (`category_id`) to load the full rule payload (conditions, priorities) to explain why costs appear under one category vs another.",
      toolset: "ccm",
      scope: "account",
      identifierFields: ["category_id"],
      listFilterFields: [
        { name: "search_key", description: "Search text (maps to CCM searchKey)", type: "string" },
        { name: "search_term", description: "Alias for search_key (same as harness_ccm_finops_list search_term)", type: "string" },
        { name: "limit", description: "Page size (CCM query param; default 20)", type: "number" },
        { name: "offset", description: "Row offset for pagination (default 0)", type: "number" },
        {
          name: "sort_order",
          description: "Sort direction",
          enum: ["ASCENDING", "DESCENDING"],
        },
        {
          name: "sort_type",
          description: "Sort field",
          enum: ["LAST_EDIT", "NAME", "CREATION_TIME"],
        },
      ],
      deepLinkTemplate: "/ng/account/{accountId}/ce/cost-categories",
      operations: {
        list: {
          method: "GET",
          path: "/ccm/api/business-mapping",
          queryParams: {
            search_key: "searchKey",
            limit: "limit",
            offset: "offset",
            sort_order: "sortOrder",
            sort_type: "sortType",
          },
          responseExtractor: ccmBusinessMappingListCompactExtract,
          description:
            "List cost categories / business mappings — returns uuid, name, dataSources, and timestamps only (lightweight). " +
            "Use harness_ccm_finops_get with the uuid to load full rule details (costTargets, conditions, shared costs).",
        },
        get: {
          method: "GET",
          path: "/ccm/api/business-mapping",
          queryParams: { category_id: "uuid" },
          responseExtractor: ngExtract,
          description:
            "Get one business mapping by **uuid** (pass as resource_id / category_id). Returns full mapping including rule definitions for triage.",
        },
      },
    },

    // ------------------------------------------------------------------
    // 8. cost_budget — REST list + GraphQL detail with time-series variance
    //    Answers: "Are we on budget?" / "Will we overspend?"
    // ------------------------------------------------------------------
    {
      resourceType: "cost_budget",
      displayName: "Cost Budget",
      description: `Cloud cost budgets — track spend vs budget, forecast overspend, and monitor alerts. Answers "are we on budget?" and "will we overspend?"

harness_ccm_finops_list: List budgets with optional search by name and perspective filtering. Returns budget health: actualCost vs budgetAmount, forecastCost, timeLeft, alerts.
harness_ccm_finops_get: Time-series detail for a specific budget — month-by-month (or yearly) actual vs budgeted with variance tracking. Pass budget_id (from list) and optional breakdown (MONTHLY or YEARLY).`,
      toolset: "ccm",
      scope: "account",
      identifierFields: ["budget_id"],
      listFilterFields: [
        { name: "search_term", description: "Search budgets by name" },
        { name: "perspective_name", description: "Filter by perspective name(s) (comma-separated)" },
        { name: "sort_type", description: "Sort field", enum: ["NAME", "LAST_EDIT", "CREATION_TIME"] },
        { name: "sort_order", description: "Sort direction", enum: ["ASCENDING", "DESCENDING"] },
        { name: "breakdown", description: "Time breakdown for get operation", enum: ["MONTHLY", "YEARLY"] },
        { name: "limit", description: "Result limit (default 20)", type: "number" },
        { name: "offset", description: "Pagination offset (default 0)", type: "number" },
      ],
      deepLinkTemplate: "/ng/account/{accountId}/ce/budget",
      operations: {
        list: {
          method: "POST",
          path: "/ccm/api/budgets/v2/list",
          queryParams: {
            sort_type: "sortType",
            sort_order: "sortOrder",
          },
          bodyBuilder: (input) => {
            const body: Record<string, unknown> = {
              filterType: "CCMBudget",
              limit: (input.limit as number) ?? (input.size as number) ?? 20,
              offset: (input.offset as number) ?? 0,
            };

            const searchKey = (input.search_term ?? input.search_key) as string | undefined;
            if (typeof searchKey === "string" && searchKey.trim()) {
              body.searchKey = searchKey.trim();
            }

            const perspectiveNames = normalizePerspectiveIdFilterValues(input.perspective_name);
            if (perspectiveNames.length > 0) {
              body.perspectiveNames = perspectiveNames;
            }

            return body;
          },
          responseExtractor: ccmBudgetListCompactExtract,
          description:
            "List budgets. Filter by search_term (name) or perspective_name. " +
            "Returns budget health: actualCost vs budgetAmount, forecastCost, timeLeft, alerts.",
        },
        get: {
          method: "POST",
          path: "/ccm/api/graphql",
          bodyBuilder: (input) => ({
            query: BUDGET_GRID_DATA_QUERY,
            operationName: "FetchBudgetsGridData",
            variables: {
              id: input.budget_id as string,
              breakdown: (input.breakdown as string) ?? "MONTHLY",
            },
          }),
          responseExtractor: ccmBudgetDetailExtract,
          description:
            "Get budget detail with time-series: actual vs budgeted per period with variance tracking. " +
            "Pass budget_id from list. Optional breakdown: MONTHLY (default) or YEARLY.",
        },
      },
    },

    // ------------------------------------------------------------------
    // 9. cost_overview — REST overview endpoint
    // ------------------------------------------------------------------
    {
      resourceType: "cost_overview",
      displayName: "Cost Overview",
      description: "High-level cost overview with start/end time and groupBy. Supports get.",
      toolset: "ccm",
      scope: "account",
      identifierFields: [],
      listFilterFields: [
        { name: "start_time", description: "Start time filter (ISO 8601)" },
        { name: "end_time", description: "End time filter (ISO 8601)" },
        { name: "group_by", description: "Group results by field" },
      ],
      deepLinkTemplate: "/ng/account/{accountId}/ce/overview",
      operations: {
        get: {
          method: "GET",
          path: "/ccm/api/overview",
          queryParams: {
            start_time: "startTime",
            end_time: "endTime",
            group_by: "groupBy",
          },
          responseExtractor: ngExtract,
          description: "Get cost overview with optional time range and grouping",
        },
      },
    },

    // ------------------------------------------------------------------
    // 10. cost_metadata — GraphQL CCM metadata (bootstrap query)
    // ------------------------------------------------------------------
    {
      resourceType: "cost_metadata",
      displayName: "Cost Metadata",
      description: "CCM metadata — available connectors, default perspective IDs, currency preferences. Start every session with this to discover what's available. Supports both harness_ccm_finops_list and harness_ccm_finops_get (same result).",
      toolset: "ccm",
      scope: "account",
      identifierFields: [],
      operations: {
        list: {
          method: "POST",
          path: "/ccm/api/graphql",
          bodyBuilder: () => ({
            query: CCM_METADATA_QUERY,
            operationName: "FetchCcmMetaData",
            variables: {},
          }),
          responseExtractor: gqlExtract("ccmMetaData"),
          description: "Get CCM metadata (available connectors, default perspectives, currency). No filters needed.",
        },
        get: {
          method: "POST",
          path: "/ccm/api/graphql",
          bodyBuilder: () => ({
            query: CCM_METADATA_QUERY,
            operationName: "FetchCcmMetaData",
            variables: {},
          }),
          responseExtractor: gqlExtract("ccmMetaData"),
          description: "Get CCM metadata (available connectors, default perspectives, currency)",
        },
      },
    },

    // ------------------------------------------------------------------
    // 10. cost_filter_value — GraphQL perspective filter values
    // ------------------------------------------------------------------
    {
      resourceType: "cost_filter_value",
      displayName: "Cost Filter Value",
      description: "Available filter values for perspectives (e.g. regions, accounts, services). Supports list.",
      toolset: "ccm",
      scope: "account",
      identifierFields: [],
      listFilterFields: [
        { name: "perspective_id", description: "Cost perspective identifier" },
        { name: "field_id", description: "Field identifier" },
        { name: "field_identifier", description: "Field identifier" },
      ],
      operations: {
        list: {
          method: "POST",
          path: "/ccm/api/graphql",
          bodyBuilder: (input) => ({
            query: `query FetchPerspectiveFilters($filters: [QLCEViewFilterWrapperInput], $values: [String]) {
  perspectiveFilters(filters: $filters, values: $values) { values { name id __typename } __typename }
}`,
            operationName: "FetchPerspectiveFilters",
            variables: {
              filters: input.perspective_id
                ? buildViewFilter(input.perspective_id as string)
                : [],
              values: input.field_id ? [input.field_id] : [],
            },
          }),
          responseExtractor: gqlExtract("perspectiveFilters"),
          description: "List available filter values for a perspective field",
        },
      },
    },

    // ------------------------------------------------------------------
    // 11. cost_recommendation_stats — REST overview stats
    // ------------------------------------------------------------------
    {
      resourceType: "cost_recommendation_stats",
      displayName: "Cost Recommendation Stats",
      description: "Aggregate statistics for cost recommendations. Supports get.",
      toolset: "ccm",
      scope: "account",
      identifierFields: [],
      deepLinkTemplate: "/ng/account/{accountId}/ce/recommendations",
      operations: {
        get: {
          method: "POST",
          path: "/ccm/api/recommendation/overview/stats",
          bodyBuilder: () => ({}),
          responseExtractor: ngExtract,
          description: "Get aggregate cost recommendation statistics",
        },
      },
    },

    // ------------------------------------------------------------------
    // 12. cost_recommendation_by_type — REST stats per resource type
    // ------------------------------------------------------------------
    {
      resourceType: "cost_recommendation_by_type",
      displayName: "Cost Recommendation By Type",
      description: "Cost recommendation stats grouped by resource type. Supports list.",
      toolset: "ccm",
      scope: "account",
      identifierFields: [],
      deepLinkTemplate: "/ng/account/{accountId}/ce/recommendations",
      operations: {
        list: {
          method: "POST",
          path: "/ccm/api/recommendation/overview/resource-type/stats",
          bodyBuilder: () => ({}),
          responseExtractor: ngExtract,
          description: "List cost recommendation stats grouped by resource type",
        },
      },
    },

    // ------------------------------------------------------------------
    // 13. cost_recommendation_detail — REST detail by resource type path
    // ------------------------------------------------------------------
    {
      resourceType: "cost_recommendation_detail",
      displayName: "Cost Recommendation Detail",
      description: "Detailed cost recommendation for a specific resource type. Supports get. Pass type_path: ec2-instance, azure-vm, ecs-service, node-pool, or workload.",
      toolset: "ccm",
      scope: "account",
      identifierFields: ["type_path"],
      deepLinkTemplate: "/ng/account/{accountId}/ce/recommendations",
      operations: {
        get: {
          method: "GET",
          path: "/ccm/api/recommendation/details/{typePath}",
          pathParams: { type_path: "typePath" },
          responseExtractor: ngExtract,
          description: "Get detailed recommendation for a resource type (ec2-instance, azure-vm, ecs-service, node-pool, workload)",
        },
      },
    },

    // ------------------------------------------------------------------
    // 14. cost_ignored_anomaly — POST with ignored filter
    // ------------------------------------------------------------------
    {
      resourceType: "cost_ignored_anomaly",
      displayName: "Cost Ignored Anomaly",
      description: "Ignored cost anomalies. Supports list.",
      toolset: "ccm",
      scope: "account",
      identifierFields: [],
      listFilterFields: [
        { name: "limit", description: "Result limit" },
        { name: "offset", description: "Pagination offset" },
      ],
      deepLinkTemplate: "/ng/account/{accountId}/ce/anomaly-detection",
      operations: {
        list: {
          method: "POST",
          path: "/ccm/api/anomaly",
          bodyBuilder: (input) => ({
            anomalyFilterPropertiesDTO: {
              filterType: "Anomaly",
              status: ["IGNORED"],
              limit: (input.limit as number) ?? 25,
              offset: (input.offset as number) ?? 0,
            },
          }),
          responseExtractor: ngExtract,
          description: "List ignored cost anomalies",
        },
      },
    },

    // ------------------------------------------------------------------
    // 15. cost_commitment_summary — Lightwing CO high-level overview
    // ------------------------------------------------------------------
    {
      resourceType: "cost_commitment_summary",
      displayName: "Cost Commitment Summary",
      description:
        "High-level commitment orchestration overview: compute spend split (on-demand vs RI vs savings plan), " +
        "coverage percentages, total savings, and utilization rates. " +
        "Start here to assess overall commitment health before drilling into coverage/savings/utilization details.",
      toolset: "ccm",
      scope: "account",
      identifierFields: [],
      deepLinkTemplate: "/ng/account/{accountId}/ce/commitment-orchestration",
      listFilterFields: [
        { name: "start_date", description: "Start date (YYYY-MM-DD). Defaults to 30 days ago." },
        { name: "end_date", description: "End date (YYYY-MM-DD). Defaults to today." },
      ],
      diagnosticHint:
        "Returns coverage %, savings totals, and utilization for RI + Savings Plans. " +
        "Drill into cost_commitment_coverage, cost_commitment_savings, or cost_commitment_utilisation for daily charts.",
      operations: {
        list: {
          method: "POST",
          path: "/lw/co/api/accounts/{accountId}/v1/summary",
          pathParams: { account_id: "accountId" },
          queryParams: { start_date: "start_date", end_date: "end_date" },
          bodyBuilder: () => ({ is_harness_managed: true }),
          responseExtractor: ccmCommitmentSummaryExtract,
          description: "Get commitment orchestration summary with coverage, savings, and utilization overview.",
        },
      },
    },

    // ------------------------------------------------------------------
    // 16. cost_commitment_coverage — Lightwing compute coverage details
    // ------------------------------------------------------------------
    {
      resourceType: "cost_commitment_coverage",
      displayName: "Cost Commitment Coverage",
      description:
        "Daily compute coverage breakdown by commitment type (On-Demand, Reserved Instances, Savings Plans). " +
        "Returns daily chart data (coverage_cost, coverage_hours) plus table summaries per type. " +
        "Use group_by to segment by 'Commitment Type' (default), 'Instance Family', or 'Region'.",
      toolset: "ccm",
      scope: "account",
      identifierFields: [],
      deepLinkTemplate: "/ng/account/{accountId}/ce/commitment-orchestration",
      listFilterFields: [
        { name: "start_date", description: "Start date (YYYY-MM-DD). Defaults to 30 days ago." },
        { name: "end_date", description: "End date (YYYY-MM-DD). Defaults to today." },
        { name: "group_by", description: "Group coverage by: 'Commitment Type' (default), 'Instance Family', 'Region'." },
      ],
      diagnosticHint:
        "Chart data is sorted by date. Each commitment type has a table summary with total_cost, total_hours, " +
        "on_demand_cost, reservation_cost, ri_coverage_hours, and savings_plan_hours.",
      operations: {
        list: {
          method: "POST",
          path: "/lw/co/api/accounts/{accountId}/v1/detail/compute_coverage",
          pathParams: { account_id: "accountId" },
          queryParams: { start_date: "start_date", end_date: "end_date" },
          bodyBuilder: (input) => ({
            group_by: (input.group_by as string) ?? "Commitment Type",
          }),
          responseExtractor: ccmCommitmentCoverageExtract,
          description: "Get daily compute coverage breakdown by commitment type with chart and table data.",
        },
      },
    },

    // ------------------------------------------------------------------
    // 17. cost_commitment_savings — Lightwing savings details
    // ------------------------------------------------------------------
    {
      resourceType: "cost_commitment_savings",
      displayName: "Cost Commitment Savings",
      description:
        "Daily savings breakdown by commitment type (Reserved Instances, Savings Plans). " +
        "Returns per-type chart data (date, savings) and table total. " +
        "Use group_by to segment by 'Commitment Type' (default), 'Instance Family', or 'Region'.",
      toolset: "ccm",
      scope: "account",
      identifierFields: [],
      deepLinkTemplate: "/ng/account/{accountId}/ce/commitment-orchestration",
      listFilterFields: [
        { name: "start_date", description: "Start date (YYYY-MM-DD). Defaults to 30 days ago." },
        { name: "end_date", description: "End date (YYYY-MM-DD). Defaults to today." },
        { name: "group_by", description: "Group savings by: 'Commitment Type' (default), 'Instance Family', 'Region'." },
      ],
      diagnosticHint:
        "Shows how much each commitment type saved vs on-demand pricing. " +
        "Combine with cost_commitment_summary for a quick savings-to-spend ratio.",
      operations: {
        list: {
          method: "POST",
          path: "/lw/co/api/accounts/{accountId}/v1/detail/savings",
          pathParams: { account_id: "accountId" },
          queryParams: { start_date: "start_date", end_date: "end_date" },
          bodyBuilder: (input) => ({
            group_by: (input.group_by as string) ?? "Commitment Type",
            is_harness_managed: true,
          }),
          responseExtractor: ccmCommitmentSavingsExtract,
          description: "Get daily savings breakdown by commitment type.",
        },
      },
    },

    // ------------------------------------------------------------------
    // 18. cost_commitment_utilisation — Lightwing utilisation details
    // ------------------------------------------------------------------
    {
      resourceType: "cost_commitment_utilisation",
      displayName: "Cost Commitment Utilisation",
      description:
        "Daily utilization percentage for Reserved Instances and Savings Plans. " +
        "Returns per-type chart data (date, utilization_percentage) plus table with compute_spend, " +
        "utilization amount, percentage, and trend. Low utilization signals wasted commitments.",
      toolset: "ccm",
      scope: "account",
      identifierFields: [],
      deepLinkTemplate: "/ng/account/{accountId}/ce/commitment-orchestration",
      listFilterFields: [
        { name: "start_date", description: "Start date (YYYY-MM-DD). Defaults to 30 days ago." },
        { name: "end_date", description: "End date (YYYY-MM-DD). Defaults to today." },
      ],
      diagnosticHint:
        "Utilization below 80% indicates over-provisioned commitments. " +
        "Trend shows direction (negative = declining utilization). " +
        "Cross-reference with cost_commitment_coverage to understand the spend mix.",
      operations: {
        list: {
          method: "POST",
          path: "/lw/co/api/accounts/{accountId}/v1/detail/commitment_utilisation",
          pathParams: { account_id: "accountId" },
          queryParams: { start_date: "start_date", end_date: "end_date" },
          bodyBuilder: () => ({ is_harness_managed: true }),
          responseExtractor: ccmCommitmentUtilisationExtract,
          description: "Get daily utilization percentages for RI and Savings Plan commitments.",
        },
      },
    },

    // ------------------------------------------------------------------
    // 19. cost_commitment_savings_overview — Lightwing savings overview (v2)
    // ------------------------------------------------------------------
    {
      resourceType: "cost_commitment_savings_overview",
      displayName: "Cost Commitment Savings Overview",
      description:
        "Savings overview split by managed (Harness-orchestrated) vs unmanaged commitments, " +
        "broken down by Reserved Instances and Savings Plans. Shows how much of your savings " +
        "come from Harness-managed commitments vs pre-existing ones. Filter by AWS service.",
      toolset: "ccm",
      scope: "account",
      identifierFields: [],
      deepLinkTemplate: "/ng/account/{accountId}/ce/commitment-orchestration",
      listFilterFields: [
        { name: "start_date", description: "Start date (YYYY-MM-DD). Defaults to 30 days ago." },
        { name: "end_date", description: "End date (YYYY-MM-DD). Defaults to today." },
        { name: "service", description: "Filter by AWS service (e.g. 'Amazon Relational Database Service', 'Amazon Elastic Compute Cloud - Compute')." },
      ],
      diagnosticHint:
        "Managed savings are from Harness-orchestrated commitments. Unmanaged are pre-existing. " +
        "High unmanaged % means most savings come from commitments Harness didn't create — " +
        "opportunity to migrate more under Harness management.",
      operations: {
        list: {
          method: "POST",
          path: "/lw/co/api/accounts/{accountId}/v2/savings/overview",
          pathParams: { account_id: "accountId" },
          queryParams: { start_date: "start_date", end_date: "end_date" },
          bodyBuilder: (input) => {
            const body: Record<string, unknown> = {};
            if (input.service) body.service = input.service;
            return body;
          },
          responseExtractor: ccmCommitmentSavingsOverviewExtract,
          description: "Get savings overview with managed vs unmanaged breakdown by RI and Savings Plans.",
        },
      },
    },

    // ------------------------------------------------------------------
    // 20. cost_commitment_filters — Lightwing available filter values
    // ------------------------------------------------------------------
    {
      resourceType: "cost_commitment_filters",
      displayName: "Cost Commitment Filters",
      description:
        "Available filter values for commitment orchestration queries: AWS account IDs, " +
        "instance families, and regions. Use to discover valid filter values before drilling " +
        "into coverage/savings/utilization by specific account or service.",
      toolset: "ccm",
      scope: "account",
      identifierFields: [],
      deepLinkTemplate: "/ng/account/{accountId}/ce/commitment-orchestration",
      listFilterFields: [
        { name: "cloud_account_id", description: "Filter by specific AWS cloud account ID." },
        { name: "service", description: "Filter by AWS service name (e.g. 'Amazon Elastic Compute Cloud - Compute')." },
      ],
      operations: {
        list: {
          method: "POST",
          path: "/lw/co/api/accounts/{accountId}/v1/filters",
          pathParams: { account_id: "accountId" },
          queryParams: { cloud_account_id: "cloud_account_id", service: "service" },
          bodyBuilder: () => ({}),
          responseExtractor: ccmCommitmentFiltersExtract,
          description: "List available filter values (account IDs, instance families, regions) for CO queries.",
        },
      },
    },

    // ------------------------------------------------------------------
    // 20. cost_commitment_accounts — Lightwing connected payer accounts
    // ------------------------------------------------------------------
    {
      resourceType: "cost_commitment_accounts",
      displayName: "Cost Commitment Accounts",
      description:
        "List AWS master/payer accounts connected for Commitment Orchestration. " +
        "Shows connector status, AWS account ID, features enabled (BILLING, COMMITMENT_ORCHESTRATOR), " +
        "and connection health. Use to verify which accounts have CO enabled.",
      toolset: "ccm",
      scope: "account",
      identifierFields: [],
      deepLinkTemplate: "/ng/account/{accountId}/ce/commitment-orchestration",
      operations: {
        list: {
          method: "POST",
          path: "/lw/co/api/accounts/{accountId}/v1/setup/listMasterAccounts",
          pathParams: { account_id: "accountId" },
          bodyBuilder: () => ({}),
          responseExtractor: ccmCommitmentAccountsExtract,
          description: "List AWS payer accounts with Commitment Orchestration status and connection health.",
        },
      },
    },

    // ------------------------------------------------------------------
    // 21. cost_commitment_analysis — Lightwing spend detail v2
    // ------------------------------------------------------------------
    {
      resourceType: "cost_commitment_analysis",
      displayName: "Cost Commitment Analysis",
      description:
        "Commitment spend breakdown by type (On-Demand, Reserved Instances, Savings Plans) " +
        "with daily chart and table summaries including trend %. " +
        "Filter by AWS service to see per-service spend. Use net_amortized for amortized cost view.",
      toolset: "ccm",
      scope: "account",
      identifierFields: [],
      deepLinkTemplate: "/ng/account/{accountId}/ce/commitment-orchestration",
      listFilterFields: [
        { name: "start_date", description: "Start date (YYYY-MM-DD). Defaults to 30 days ago." },
        { name: "end_date", description: "End date (YYYY-MM-DD). Defaults to today." },
        { name: "service", description: "Filter by AWS service (e.g. 'Amazon Relational Database Service', 'Amazon Elastic Compute Cloud - Compute')." },
        { name: "net_amortized", description: "Use net amortized cost (true/false). Default false.", type: "boolean" },
      ],
      diagnosticHint:
        "Shows actual spend per commitment type with trend. " +
        "Negative trend = spend declining. Positive trend = spend increasing. " +
        "Combine with cost_commitment_savings to see spend vs savings side by side.",
      operations: {
        list: {
          method: "POST",
          path: "/lw/co/api/accounts/{accountId}/v2/spend/detail",
          pathParams: { account_id: "accountId" },
          queryParams: { start_date: "start_date", end_date: "end_date" },
          bodyBuilder: (input) => {
            const body: Record<string, unknown> = {};
            if (input.service) body.service = input.service;
            if (input.net_amortized !== undefined) body.net_amortized = input.net_amortized;
            return body;
          },
          responseExtractor: ccmCommitmentSpendDetailExtract,
          description: "Get commitment spend breakdown by type with daily chart and trend.",
        },
      },
    },

    // ------------------------------------------------------------------
    // 22. cost_estimated_savings — Lightwing estimated savings per cloud account
    // ------------------------------------------------------------------
    {
      resourceType: "cost_estimated_savings",
      displayName: "Cost Estimated Savings",
      description:
        "Estimated savings for a specific cloud account setup. " +
        "Pass cloud_account_id as resource_id to see projected savings from commitment optimization.",
      toolset: "ccm",
      scope: "account",
      identifierFields: ["cloud_account_id"],
      deepLinkTemplate: "/ng/account/{accountId}/ce/commitment-orchestration",
      operations: {
        get: {
          method: "POST",
          path: "/lw/co/api/accounts/{accountId}/v2/setup/{cloudAccountId}/estimated_savings",
          pathParams: {
            account_id: "accountId",
            cloud_account_id: "cloudAccountId",
          },
          bodyBuilder: (input) => input.body ?? {},
          responseExtractor: passthrough,
          description: "Get estimated savings for a cloud account.",
        },
      },
    },

    // ------------------------------------------------------------------
    // 23. cost_autostopping_rule — AutoStopping rules list + detail
    // ------------------------------------------------------------------
    {
      resourceType: "cost_autostopping_rule",
      displayName: "AutoStopping Rule",
      description:
        "Harness AutoStopping rules manage idle cloud resources (VMs, ECS, RDS, Kubernetes) " +
        "by automatically shutting them down when idle and bringing them back on demand. " +
        "List all rules to see status, idle time config, and savings. " +
        "Get a specific rule by passing its numeric ID as resource_id.",
      toolset: "ccm",
      scope: "account",
      identifierFields: ["resource_id"],
      deepLinkTemplate: "/ng/account/{accountId}/ce/autostopping-rules",
      diagnosticHint:
        "Use 'list' to show all AutoStopping rules with status and cloud info. " +
        "Use 'get' with rule_id as resource_id for full detail on a single rule.",
      operations: {
        list: {
          method: "POST",
          path: "/lw/api/accounts/{accountId}/autostopping/rules/list",
          pathParams: { account_id: "accountId" },
          bodyBuilder: (input) => {
            const body: Record<string, unknown> = {};
            if (input.page !== undefined) body.page = input.page;
            if (input.size !== undefined) body.limit = input.size;
            if (input.search_term) body.text = input.search_term;
            if (input.filters) body.filters = input.filters;
            return body;
          },
          responseExtractor: ccmAutoStoppingListExtract,
          description: "List AutoStopping rules with pagination and optional text search.",
        },
        get: {
          method: "GET",
          path: "/lw/api/accounts/{accountId}/autostopping/rules/{ruleId}",
          pathParams: {
            account_id: "accountId",
            resource_id: "ruleId",
          },
          responseExtractor: ccmAutoStoppingDetailExtract,
          description: "Get full detail for a single AutoStopping rule.",
        },
      },
      listFilterFields: [
        { name: "search_term", description: "Filter rules by name or keyword" },
      ],
    },

    // ------------------------------------------------------------------
    // 24. cost_autostopping_savings — Per-rule daily savings breakdown
    // ------------------------------------------------------------------
    {
      resourceType: "cost_autostopping_savings",
      displayName: "AutoStopping Rule Savings",
      description:
        "Daily savings breakdown for a single AutoStopping rule. " +
        "Shows potential cost vs actual cost, idle hours, and savings percentage per day. " +
        "Pass the rule's numeric ID as resource_id.",
      toolset: "ccm",
      scope: "account",
      identifierFields: ["resource_id"],
      deepLinkTemplate: "/ng/account/{accountId}/ce/autostopping-rules/{ruleId}",
      diagnosticHint:
        "Returns daily chart data showing cost and savings for a specific rule. " +
        "Filter by from_date and to_date (Unix epoch seconds).",
      operations: {
        get: {
          method: "GET",
          path: "/lw/api/accounts/{accountId}/autostopping/rules/{ruleId}/savings",
          pathParams: {
            account_id: "accountId",
            resource_id: "ruleId",
          },
          queryParams: { from_date: "from", to_date: "to" },
          responseExtractor: ccmAutoStoppingRuleSavingsExtract,
          description: "Get daily savings breakdown for one AutoStopping rule.",
        },
      },
    },

    // ------------------------------------------------------------------
    // 25. cost_autostopping_savings_cumulative — Cross-rule savings summary
    // ------------------------------------------------------------------
    {
      resourceType: "cost_autostopping_savings_cumulative",
      displayName: "AutoStopping Cumulative Savings",
      description:
        "Aggregate savings across all AutoStopping rules. " +
        "Shows total potential cost, actual cost, total savings, savings %, K8s breakdown, and a daily chart. " +
        "Use to answer 'how much has AutoStopping saved overall?' " +
        "from_date and to_date are YYYY-MM-DD strings. Optionally filter by cloud provider (aws, gcp, azure).",
      toolset: "ccm",
      scope: "account",
      identifierFields: [],
      deepLinkTemplate: "/ng/account/{accountId}/ce/autostopping-rules",
      diagnosticHint:
        "Returns overall savings numbers and a daily timeseries. " +
        "from_date and to_date are YYYY-MM-DD strings (e.g. 2026-04-01). " +
        "Use filter_cloud_provider (aws, gcp, azure — comma-separated) to scope to a single cloud.",
      operations: {
        list: {
          method: "POST",
          path: "/lw/api/accounts/{accountId}/autostopping/rules/savings/cumulative",
          pathParams: { account_id: "accountId" },
          bodyBuilder: (input) => {
            const body: Record<string, unknown> = {
              dry_run: false,
              from: input.from_date as string | undefined,
              to: input.to_date as string | undefined,
            };
            const cloudProvider = input.filter_cloud_provider as string | undefined;
            if (cloudProvider) {
              const values = cloudProvider
                .split(",")
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean);
              if (values.length > 0) {
                body.filters = [{ field: "service_provider", operator: "equals", values }];
              }
            }
            return body;
          },
          responseExtractor: ccmAutoStoppingCumulativeSavingsExtract,
          description:
            "Get cumulative AutoStopping savings across all rules. " +
            "from_date / to_date are YYYY-MM-DD strings. " +
            "filter_cloud_provider accepts comma-separated values: aws, gcp, azure.",
        },
      },
      listFilterFields: [
        { name: "from_date", description: "Start date as YYYY-MM-DD string (e.g. 2026-04-01)" },
        { name: "to_date", description: "End date as YYYY-MM-DD string (e.g. 2026-04-15)" },
        {
          name: "filter_cloud_provider",
          description:
            "Scope to one or more cloud providers — comma-separated: aws, gcp, azure. " +
            "Maps to the API filters array (field: service_provider).",
        },
      ],
    },

    // ------------------------------------------------------------------
    // 26. cost_autostopping_logs — Activity logs for a specific rule
    // ------------------------------------------------------------------
    {
      resourceType: "cost_autostopping_logs",
      displayName: "AutoStopping Rule Logs",
      description:
        "Activity logs for a specific AutoStopping rule showing state transitions " +
        "(cooling down, stopped, active). Pass rule's numeric ID as resource_id.",
      toolset: "ccm",
      scope: "account",
      identifierFields: ["resource_id"],
      deepLinkTemplate: "/ng/account/{accountId}/ce/autostopping-rules/{ruleId}",
      diagnosticHint:
        "Returns paginated logs with state changes. " +
        "Use to debug why a rule did or didn't stop resources.",
      operations: {
        get: {
          method: "GET",
          path: "/lw/api/accounts/{accountId}/autostopping/rules/{ruleId}/logs/v2",
          pathParams: {
            account_id: "accountId",
            resource_id: "ruleId",
          },
          queryParams: { page: "page", size: "limit" },
          responseExtractor: ccmAutoStoppingLogsExtract,
          description: "Get activity logs for a single AutoStopping rule.",
        },
      },
    },

    // ------------------------------------------------------------------
    // 27. cost_autostopping_schedule — Schedules (uptime/downtime windows)
    // ------------------------------------------------------------------
    {
      resourceType: "cost_autostopping_schedule",
      displayName: "AutoStopping Schedules",
      description:
        "Fixed uptime/downtime schedules applied to AutoStopping rules. " +
        "Schedules define recurring windows when resources should be forced on or off. " +
        "Lists all schedules for the account.",
      toolset: "ccm",
      scope: "account",
      identifierFields: [],
      deepLinkTemplate: "/ng/account/{accountId}/ce/autostopping-rules",
      diagnosticHint:
        "Returns all schedules with type (uptime/downtime), days, and time windows.",
      operations: {
        list: {
          method: "GET",
          path: "/lw/api/accounts/{accountId}/schedules",
          pathParams: { account_id: "accountId" },
          responseExtractor: ccmAutoStoppingSchedulesExtract,
          description: "List all AutoStopping schedules (uptime/downtime windows).",
        },
      },
    },
  ],
};
