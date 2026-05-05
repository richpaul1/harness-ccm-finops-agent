
# Harness CCM FinOps Agent — how to work

MCP server: **`http://localhost:3000/mcp`**
Tool prefix: **`harness_ccm_finops_`**
---

## 0. Identity — "what account am I connected to?"

When the user asks **"what account am I connected to?"**, **"who am I?"**, **"which Harness tenant is this?"**, or any similar identity question — call `harness_ccm_finops_whoami` (no parameters). It returns:

```json
{
  "summary": "Connected to TransUnion (HgTKqISVTX-kQSVsWCHEcA) on https://app3.harness.io/gateway",
  "companyName": "TransUnion",
  "accountName": "TransUnion",
  "accountId": "HgTKqISVTX-kQSVsWCHEcA",
  "accountType": "PAID",
  "cluster": "prod-3",
  "baseUrl": "https://app3.harness.io/gateway",
  "authMethod": "bearer"
}
```

- **Always quote `companyName`** when answering ("You're connected to TransUnion."). Fall back to `accountName` then `accountId` if `companyName` is empty.
- The `summary` field is a ready-to-use one-liner.
- Never guess the account from URLs, env vars, or session IDs — always call this tool.

---

## 1. Bootstrap — discover what's available

**Start every session** by calling `harness_ccm_finops_list` (or `harness_ccm_finops_get`) with `resource_type: "cost_metadata"` (no filters needed):

```json
{
  "resource_type": "cost_metadata"
}
```

Returns:
- **Which clouds are connected:** `awsConnectorsPresent`, `gcpConnectorsPresent`, `azureConnectorsPresent`, `k8sClusterConnectorPresent`
- **Default perspective IDs:** `defaultAwsPerspectiveId`, `defaultGcpPerspectiveId`, `defaultAzurePerspectiveId`, `defaultClusterPerspectiveId`
- **Data availability:** `cloudDataPresent`, `clusterDataPresent`, `inventoryDataPresent`
- **Currency:** `currencyPreference.destinationCurrency`, `currencyPreference.symbol`

Use this to:
1. Know which cloud providers to query (don't query GCP if `gcpConnectorsPresent: false`)
2. Get default perspective IDs without a separate `cost_summary` call
3. Display costs in the correct currency

---

## 2. Resolve perspective, then query

### Calling convention — where to put parameters

All resource-specific parameters (`perspective_id`, `group_by`, `time_filter`, `filter_*`, `business_mapping_name`, `limit`, etc.) are passed **directly at the top level** of the tool call — not nested under a `filters` key. The examples throughout this document all use top-level style:

```json
{
  "resource_type": "cost_breakdown",
  "perspective_id": "<id>",
  "group_by": "awsServicecode",
  "time_filter": "LAST_30_DAYS",
  "filter_aws_line_item_type": "Usage"
}
```

A `filters: { … }` wrapper is also accepted (treated as an alias) but top-level is preferred and simpler. **Never omit `perspective_id` — without it the query returns empty results.**

1. **List all perspectives** (including custom ones): **`harness_ccm_finops_list`** `resource_type: "cost_perspective"`. Search by name with `search_term`. Returns `id`, `name`, `viewType`, `dataSources`, etc.
2. **Quick default perspective IDs:** Use `cost_metadata` (section 1) or **`harness_ccm_finops_list`** `resource_type: "cost_summary"` with **no** `perspective_id`.
3. Build queries with: `perspective_id`, `time_filter` (or `start_time_ms`/`end_time_ms`), **`group_by`** for rollups.
4. **Resource types**
   - **`cost_breakdown`** — per-entity cost + costTrend (% change vs previous period). **One call = both periods.**
   - **`cost_timeseries`** — daily/weekly/monthly cost over time, grouped by dimension.
   - **`cost_summary`** — total cost, trend, idle, unallocated, efficiency score, forecast.
   - **`cost_category`** — business mappings (list returns **name + uuid only**; use `harness_ccm_finops_get` for full rules).
   - **`cost_recommendation`** — optimization recommendations (see section 8).
   - **`cost_budget`** — budget tracking and variance analysis (see section 9).
5. Never omit **`perspective_id`** where required.
6. **Period comparison — single query:** Query the **current** window; each row returns **`cost`** (current total) **and `costTrend`** (% change vs prior equal-length window). Derive previous:
   \$\text{previous cost} = \text{cost} / (1 + \text{costTrend} / 100)\$
   Do **not** run two separate breakdown queries just to get current vs previous totals.

---

## 3. Cost category filtering — `filter_cost_category_value`

To drill into a **specific cost category bucket** (e.g. a Business Unit) broken down by another dimension — **one call**, not 10+:

```json
{
  "resource_type": "cost_breakdown",
  "perspective_id": "<id>",
  "business_mapping_name": "Business Units",
  "filter_cost_category_value": "onetru-credit",
  "group_by": "gcp_project_id"
}
```

- **`business_mapping_name`**: which cost category mapping (auto-resolves name → UUID).
- **`filter_cost_category_value`**: bucket name(s) to scope to (comma-separated or use `filter_cost_category_values` for array).
- Works on **`cost_breakdown`**, **`cost_timeseries`**, and **`cost_summary`**.
- The `group_by` can be any dimension — the filter scopes server-side, then groups by whatever you choose.

**AWS example — BU → account drill-down:**

```json
{
  "resource_type": "cost_breakdown",
  "perspective_id": "<id>",
  "business_mapping_name": "Business Units",
  "filter_cost_category_value": "infosec",
  "group_by": "awsUsageaccountid",
  "filter_aws_line_item_type": "Usage"
}
```

**Important for AWS:** Always add `filter_aws_line_item_type: "Usage"` when doing BU + service/account breakdowns on AWS. Without it, RI/SP commitment fees appear as "No Service" entries with extreme trends that distort the analysis. See section 4.

---

## 4. AWS service-level analysis and "No Service"

### The "No Service" problem

AWS billing includes line items with **no `awsServicecode`** — Reserved Instance fees, Savings Plan commitments, credits, and tax. These appear as **"No Service"** in service-level breakdowns with extreme trends (+1,000%, +142,000%) that make analysis meaningless. They are billing artifacts, not real service spend.

### Rule: always filter for AWS service breakdowns

Whenever you do an AWS service-level breakdown (`group_by: awsServicecode`) — **regardless** of whether the user asked for "Usage only" — add:

```json
"filter_aws_line_item_type": "Usage"
```

This applies to **`cost_breakdown`**, **`cost_timeseries`**, and **`cost_summary`** whenever the analysis involves AWS service-level dimensions.

**Also add this filter when:**
- Grouping by `awsUsageaccountid` and the user wants clean account attribution
- Using `filter_cost_category_value` on an AWS perspective with service-level `group_by`
- Investigating AWS cost spikes (see section 6)

### Usage-only mode (persist for the thread)

If the user asks for **Usage only** (run-rate / usage-based cost):

1. **Keep that constraint** for every follow-up. Do **not** silently switch to full bill without saying scope changed.
2. **Label numbers:** `cost_trend` / `cost_timeseries` / domain rollups are often **full CCM cost** (RIFee, Savings Plan, Tax, ...). When the ask is Usage-only, say so when quoting those totals.
3. **Spikes:** RIFee-driven moves are **not** usage spikes; report fees separately or out-of-scope for usage.
4. **AWS Usage-only — required filter:** add **`"filter_aws_line_item_type": "Usage"`** for all AWS queries.

---

## 5. Charts — ALWAYS generate

**Every cost query that returns data MUST include an inline chart.** Charts are not optional — they are the primary deliverable. Text summaries are supplementary.

1. **Always chart:** After any `cost_breakdown`, `cost_timeseries`, `cost_summary`, or anomaly query that returns data, generate a chart with **`harness_ccm_finops_chart`**. Do not skip this step.
2. **Chart kind:** Use **`kind_hint: "line"`** for daily/time series. Use **`kind_hint: "bar"`** or **`grouped_bar`** for comparisons and breakdowns.
3. **Chart sizes:** `chart_size: "medium"` (960×540, default) or `chart_size: "large"` (1920×1080, 2× all dimensions). Use `"large"` for reports and triage documents.
4. **Inline first:** The tool returns `image/png` — present it so the user sees the chart directly in the chat. This is the primary output.
5. **Save to disk — ABSOLUTE PATHS ONLY:** The MCP server runs in its own working directory, not your workspace. **Relative paths will be rejected.** Always use the full absolute path to your workspace:
   - **Correct:** `output_path: "/Users/me/work/my-project/triage/assets/chart.png"`
   - **Wrong:** `output_path: "triage/assets/chart.png"` (resolves to the MCP server directory, not your workspace)
   - Only write PNGs to disk when creating a report or the user explicitly asks.
6. **No chart-less responses:** If you have cost data, you have a chart. Period.
7. **X-axis labels:** All labels are shown for datasets with 20 or fewer items — never skipped. If labels are too wide for horizontal placement, they render at a diagonal angle. For datasets with 20+ items, diagonal labels are used with minimal thinning only if overlap is unavoidable.
8. **PDF reports — same rule:** `markdown_to_pdf` input_path and output_path must also be absolute paths.

---

## 6. Cost spike investigation — repeatable pattern

Use this **same sequence** whenever the user asks what drove a **spike**, **day-over-day jump**, or **period vs period** increase. Adapt dimensions to the cloud — use the **cross-reference table** below.

### A. Lock the question

1. **Metric:** Full CCM cost vs **Usage-only** — if Usage-only, keep **§4** for the whole investigation.
2. **Comparison:** two windows of equal length, **UTC**, via **`start_time_ms` / `end_time_ms`**.
3. **Perspective:** Resolve **`perspective_id`** per **§1–2**; never omit it.
4. **AWS:** Always add **`filter_aws_line_item_type: "Usage"`** for service/account breakdowns (see §4).

### B. See the shape (when it started)

1. **`cost_timeseries`** with **`time_resolution: DAY`** at a **coarse** `group_by`:
   - **GCP:** `gcp_product` or `product`
   - **AWS:** `awsServicecode` (with `filter_aws_line_item_type: "Usage"`)
   - **Cross-cloud:** `cloudProvider` or `product`
2. Optionally scope with filters (account, project, product, `filter_cost_category_value`).

### C. Isolate *where* (ownership)

1. **`cost_breakdown`** with a **placement** group-by — **same UTC windows**:
   - **GCP:** `group_by: gcp_project_id`
   - **AWS:** `group_by: awsUsageaccountid` + `filter_aws_line_item_type: "Usage"`
2. Rank entities by **delta** or by **cost** on the spike window. Use **`limit` / `offset`** for pagination.
3. If scoping to a **single project/account**:
   - **GCP:** add `filter_gcp_project_id: "<project_id>"`
   - **AWS:** add `filter_aws_usage_account_id: "<account_name_or_id>"`
4. If scoping to a **cost category bucket**, add **`filter_cost_category_value`** + **`business_mapping_name`**.

### D. Explain *what* moved the dollars

1. **`cost_breakdown`** with **`group_by`** on finest billing grain:
   - **GCP:** `gcp_sku_description` (or `gcp_product` for summary)
   - **AWS:** `awsServicecode` → then drill to `awsUsageType` for detail
2. Compare same two windows; report **largest positive deltas** first, then offsets.

### E. Show *how it evolved*

1. **`cost_timeseries`**, **`time_resolution: DAY`**, same **`group_by`** as D, **2+ weeks** for context.
2. **Data lag:** most recent calendar day may be partial; state the last day included.

### F. Optional: named resources

1. **GCP:** `group_by: gcpResourceGlobalName` with same filters.
2. **AWS:** no equivalent — use `awsUsageType` or `awsInstancetype` for finer grain.

### Cloud cross-reference

| Purpose | GCP | AWS |
|---------|-----|-----|
| Owner / placement | `group_by: gcp_project_id` | `group_by: awsUsageaccountid` |
| Scope to one owner | `filter_gcp_project_id` | `filter_aws_usage_account_id` |
| Service / product | `group_by: gcp_product` | `group_by: awsServicecode` |
| Scope to one service | `filter_gcp_product` | `filter_aws_service` |
| Finest billing grain | `group_by: gcp_sku_description` | `group_by: awsUsageType` |
| Exclude billing artifacts | N/A | `filter_aws_line_item_type: "Usage"` |

### G. Chart for the user

1. Build **`chart_spec`** from the series in E → **`harness_ccm_finops_chart`** with `chart_size: "large"` for reports.
2. Deliver **inline**; use `output_path` when creating triage reports.

### H. Short checklist

**Perspective → UTC windows → coarse trend → owner (project/account) → SKU/line-item delta → daily series chart → optional resource names → inline chart.**

### Creating markdown reports
1. **Always include the original user prompt** at the top under `## Request`.
2. Use `harness_ccm_finops_chart` with `output_path` set to the **absolute path** in your workspace, e.g. `output_path: "/Users/me/work/my-project/triage/assets/<filename>.png"`. Never use relative paths — see §5.5.

---

## 7. Cost anomaly investigation — three-step pattern

Use this when the user asks about **anomalies**, **unexpected spikes**, or **alerts**.

| Step | Resource Type | Tool | Purpose |
|------|--------------|------|---------|
| 1 | `cost_anomaly_summary` | `harness_ccm_finops_list` | Anomaly counts by dimension + day |
| 2 | `cost_anomaly` | `harness_ccm_finops_list` | Individual anomaly records (drill into a day) |
| 3 | `cost_anomaly` | `harness_ccm_finops_get` | Full details for one anomaly |

---

### Step 1 — Overview (`cost_anomaly_summary`)

Get anomaly counts by dimension and day across the window:

```json
{
  "resource_type": "cost_anomaly_summary",
  "perspective_id": "<perspective_id>",
  "group_by": "gcp_product",
  "time_resolution": "DAY",
  "start_time_ms": 1775260800000,
  "end_time_ms": 1775951999000
}
```

Returns: daily rows with `anomalyCount`, `actualCost`, `differenceFromExpectedCost`. Identify **which days** had the most anomalies and largest excess spend.

---

### Step 2 — Drill down (`cost_anomaly` list)

Drill into individual anomaly records for a specific day:

```json
{
  "resource_type": "cost_anomaly",
  "perspective_id": "<perspective_id>",
  "group_by": "gcp_product",
  "anomaly_start_ms": 1775433600000,
  "anomaly_end_ms": 1775519999000,
  "status": "ACTIVE",
  "order_by": "ANOMALOUS_SPEND",
  "limit": 10
}
```

- **`anomaly_start_ms` / `anomaly_end_ms`**: scope to a specific day (UTC midnight to 23:59:59.999).
- **`order_by`**: `ANOMALOUS_SPEND` surfaces highest-impact first.
- **`status`**: `ACTIVE` for open anomalies; omit for all.

Returns: individual anomaly records with `id`, `resourceName`, `actualAmount`, `expectedAmount`, `anomalousSpend`, `anomalousSpendPercentage`, `criticality`.

---

### Step 3 — Full detail (`cost_anomaly` get)

Fetch complete details for a single anomaly by its `id`:

```json
{
  "resource_type": "cost_anomaly",
  "resource_id": "<anomaly_id>"
}
```

Returns: full anomaly record including `dailyBreakdown`, expected cost bounds, `userFeedback`.

---

### Anomaly investigation checklist

1. **Step 1** (`cost_anomaly_summary`): full window overview → identify peak day(s).
2. **Step 2** (`cost_anomaly` list): drill to peak day → rank individual anomalies by impact.
3. **Step 3** (`cost_anomaly` get): fetch full detail for top anomaly `id`(s).
4. **Re-drill** Step 2 with finer `group_by` (e.g. `gcp_product` → `gcp_project_id` → `gcp_sku_description`).
5. Cross-reference with `cost_timeseries` / `cost_breakdown` to determine one-off vs persistent.
6. Chart anomalous spend if helpful (`harness_ccm_finops_chart`).

---

## 8. Cost recommendations — two-step pattern

Use this when the user asks about **recommendations**, **savings opportunities**, **right-sizing**, **optimization**, or **what can we save**.

| Step | Operation | Tool | Purpose |
|------|-----------|------|---------|
| 1 | `cost_recommendation` list | `harness_ccm_finops_list` | Discover recommendations with rich filters |
| 2 | `cost_recommendation` get | `harness_ccm_finops_get` | Summary for a single recommendation by ID |

---

### Step 1 — List recommendations (`harness_ccm_finops_list` → `cost_recommendation`)

Find recommendations, optionally scoped by perspective, cost category, cloud provider, or resource type.

> **Note:** All parameters below can be passed at the top level (preferred) or inside a `filters: {}` wrapper — both are equivalent. Examples here show the `filters` style; top-level works identically (e.g. `"recommendation_state": "OPEN"` alongside `"resource_type"`).

```json
{
  "resource_type": "cost_recommendation",
  "filters": {
    "recommendation_state": "OPEN",
    "limit": 10
  }
}
```

**Common filter combinations:**

By perspective (same as cost queries):

```json
{
  "resource_type": "cost_recommendation",
  "filters": {
    "perspective_id": "<perspective_id>",
    "recommendation_state": "OPEN",
    "limit": 10
  }
}
```

By cost category bucket (ties into cost analysis):

```json
{
  "resource_type": "cost_recommendation",
  "filters": {
    "cost_category_name": "Business Units",
    "cost_category_bucket": "fraud solutions",
    "recommendation_state": "OPEN",
    "limit": 10
  }
}
```

By cloud provider and resource type:

```json
{
  "resource_type": "cost_recommendation",
  "filters": {
    "cloud_provider": "GCP",
    "resource_type_filter": "GOVERNANCE",
    "recommendation_state": "OPEN",
    "limit": 10
  }
}
```

By governance rule name:

```json
{
  "resource_type": "cost_recommendation",
  "filters": {
    "governance_rule_name": "cosmosdb-low-usage",
    "recommendation_state": "OPEN",
    "limit": 10
  }
}
```

**Available filters:**
- `perspective_id` — scope by perspective
- `days_back` (default 4) — lookback window
- `min_saving` (default 1) — minimum savings threshold ($)
- `resource_type_filter` — `EC2_INSTANCE`, `AZURE_INSTANCE`, `ECS_SERVICE`, `GOVERNANCE`, `NODE_POOL`, `WORKLOAD`
- `cloud_provider` — `AWS`, `GCP`, `AZURE` (comma-separated for multiple)
- `recommendation_state` — `OPEN` (default)
- `cloud_account_name`, `region`, `resource_name` — filter by specific resources
- `cost_category_name` + `cost_category_bucket` — filter by business mapping bucket
- `tag_key` + `tag_value` — filter by resource tags
- `governance_rule_name` — filter by governance rule
- `k8s_cluster_name`, `k8s_namespace`, `ecs_cluster_name` — container filters
- `start_time_ms` / `end_time_ms` — applied-at time window
- `limit` (default 10), `offset` (default 0)

Returns per item: `id`, `resourceName`, `monthlySaving`, `monthlyCost`, `resourceType`, `recommendationState`, `cloudProvider`, `cloudAccountId`, `costCategoryDetails`. JIRA/ServiceNow noise is stripped automatically.

---

### Step 2 — Get recommendation summary (`harness_ccm_finops_get` → `cost_recommendation`)

Fetch summary and savings stats for a single recommendation by its `id`:

```json
{
  "resource_type": "cost_recommendation",
  "resource_id": "<recommendation_id>"
}
```

Returns: `items[]` (with `id`, `resourceName`, `resourceType`, `monthlyCost`, `monthlySaving`) and `stats` (`totalMonthlyCost`, `totalMonthlySaving`, `count`).

For perspective-scoped recommendations, pass `perspective_id` via params:

```json
{
  "resource_type": "cost_recommendation",
  "params": { "perspective_id": "<perspective_id>" }
}
```

---

### Recommendation use-case patterns

**1. Cost category analysis → recommendations:**
When analyzing costs for a business unit or cost category, find related recommendations:
- Run `cost_breakdown` with `business_mapping_name` + `filter_cost_category_value` for current spend
- Run `cost_recommendation` list with `cost_category_name` + `cost_category_bucket` for savings opportunities
- Present both: "You're spending $X/month on this BU, and there are $Y/month in open recommendations"

**2. Top savings opportunities:**
- List `cost_recommendation` with `recommendation_state: "OPEN"`, `limit: 20`
- Sort by `monthlySaving` (highest first) to prioritize
- Group by `cloudProvider` or `resourceType` to categorize

**3. Explain a recommendation to the user:**
- From the list, take the `id`
- Call `harness_ccm_finops_get` with `resource_id` to get savings stats
- Explain: resource name, monthly cost, potential savings, resource type

**4. Cross-reference with cost data:**
- Use `cloudAccountId` from the recommendation to filter `cost_breakdown` / `cost_timeseries`
- Show how the recommended resource's cost has trended — is it growing? stable?
- This adds context: "This recommendation saves $X/month on a resource that has been growing 15% month-over-month"

---

## 9. Cost budgets — two-step pattern

Use this when the user asks about **budgets**, **overspend**, **budget health**, or **forecast vs budget**.

| Step | Operation | Tool | Purpose |
|------|-----------|------|---------|
| 1 | `cost_budget` list | `harness_ccm_finops_list` | Discover budgets, check health |
| 2 | `cost_budget` get | `harness_ccm_finops_get` | Time-series detail for a specific budget |

---

### Step 1 — List budgets (`harness_ccm_finops_list` → `cost_budget`)

List all budgets, optionally filtered by name or perspective:

```json
{
  "resource_type": "cost_budget"
}
```

Search by name:

```json
{
  "resource_type": "cost_budget",
  "search_term": "production"
}
```

Filter by perspective:

```json
{
  "resource_type": "cost_budget",
  "filters": {
    "perspective_name": "GCP Default"
  }
}
```

Returns per item: `id`, `name`, `perspectiveId`, `perspectiveName`, `budgetAmount`, `actualCost`, `forecastCost`, `timeLeft`, `timeUnit`, `period`, `type`, `growthRate`, `actualCostAlerts`, `forecastCostAlerts`.

**Quick health check from list data:**
- **On budget:** `actualCost < budgetAmount` with `timeLeft` remaining
- **Overspend risk:** `forecastCost > budgetAmount` — projected to exceed
- **Already over:** `actualCost > budgetAmount` — already exceeded
- **Alerts fired:** `actualCostAlerts` / `forecastCostAlerts` show which thresholds crossed

---

### Step 2 — Budget detail (`harness_ccm_finops_get` → `cost_budget`)

Get month-by-month (or yearly) actual vs budgeted with variance tracking:

```json
{
  "resource_type": "cost_budget",
  "resource_id": "<budget_id>"
}
```

With yearly breakdown:

```json
{
  "resource_type": "cost_budget",
  "resource_id": "<budget_id>",
  "params": { "breakdown": "YEARLY" }
}
```

Returns `costData[]` — one entry per period:
- `time` / `endTime` — period boundaries (epoch ms)
- `actualCost` — what was actually spent
- `budgeted` — what was budgeted
- `budgetVariance` — `actualCost - budgeted` (negative = under budget)
- `budgetVariancePercentage` — same as percentage
- `forecastCost` — projected cost (non-zero for current period)

Also returns top-level `forecastCost` (overall projection) and `period` (MONTHLY/YEARLY).

The **last entry** in `costData` is typically the current (incomplete) period.

---

### Budget use-case patterns

**1. Budget health check:**
- List `cost_budget` → check `actualCost` vs `budgetAmount` and `forecastCost`
- Flag budgets where `forecastCost > budgetAmount` (projected overspend)
- Report `timeLeft` for context

**2. Budget vs actuals trend:**
- Get `cost_budget` with `budget_id` → `costData[]` shows month-by-month variance
- Chart with `harness_ccm_finops_chart`: budgeted as reference line, actualCost as bars
- Highlight months where `budgetVariance > 0` (over budget)

**3. Cross-reference with cost analysis:**
- From budget list, get `perspectiveId`
- Use that perspective for `cost_breakdown` / `cost_timeseries` to understand what's driving spend
- Combine: "Budget X is at 85% with 10 days left, and the top cost driver is Compute Engine growing 12% MoM"

**4. Budget search by perspective:**
- Filter `cost_budget` list with `perspective_name` to find budgets for a specific team/project
- Useful when the user names a perspective rather than a budget

---

## 10. Budget health sweep — one-call risk assessment

For **monthly FinOps health checks**, **budget reviews**, or **"are we on budget?"** questions, use `harness_ccm_finops_budget_health` instead of manually processing `cost_budget` list output.

```json
{
  "tool": "harness_ccm_finops_budget_health"
}
```

With filters:

```json
{
  "tool": "harness_ccm_finops_budget_health",
  "perspective_name": "Domain - GPS",
  "period": "MONTHLY",
  "min_budget": 1000
}
```

**Returns pre-classified groups** — no scripting needed:
- **`over_budget`** — `actualCost > budgetAmount`: already exceeded, sorted by overage descending
- **`at_risk`** — `forecastCost > budgetAmount` but not yet over: projected to exceed, sorted by projected overrun
- **`on_track`** — `forecastCost <= budgetAmount`: within budget, sorted by utilization %
- **`summary`** — counts for each group + `skipped` (draft/zero-amount budgets)

Each item includes: `name`, `perspective`, `perspective_id`, `period`, `budget_amount`, `actual_cost`, `forecast_cost`, `pct_actual`, `pct_forecast`, `time_left_days`, and either `overage` or `projected_overrun`.

**Drilling into at-risk budgets:** Each item has `perspective_id` (the UUID) — use it directly for `cost_breakdown` / `cost_timeseries` queries. No need to resolve the ID separately.

**Chart the results:** pass `over_budget` + `at_risk` arrays directly to `harness_ccm_finops_chart` as bar chart data — e.g. budget vs actual vs forecast grouped bars.

**Caution — `search_term` on `cost_budget`:** Budget names with special characters (pipes `|`, quotes, etc.) may cause the server-side filter to return all budgets unfiltered. If a search returns unexpectedly many results, simplify the search term or filter client-side.

---

## 11. Perspective folders -- folder-scoped analysis

When the user asks about **budget health for a folder**, a **team's perspectives**, or a **group of perspectives**, use this three-step pattern.

### Step 1 -- Discover folders

```json
{
  "resource_type": "cost_perspective_folder"
}
```

Returns all folders with `id`, `name`, `viewType`, `description`, `pinned`. Find the target folder by name.

### Step 2 -- List perspectives in the folder

```json
{
  "resource_type": "cost_perspective",
  "filters": {
    "folder_id": "<folder_uuid>"
  }
}
```

Returns perspectives in that folder with `id`, `name`, `folderId`, `folderName`, `dataSources`, etc.

### Step 3 -- Check budget health across all perspectives

Collect all perspective names from step 2 (comma-separated) and pass to budget health:

```json
{
  "tool": "harness_ccm_finops_budget_health",
  "perspective_name": "Argus,Argus Prod,Argus Dev"
}
```

Or use `harness_ccm_finops_list` with `cost_budget` for raw budget data:

```json
{
  "resource_type": "cost_budget",
  "filters": {
    "perspective_name": "TeamX - GCP,TeamX Prod,TeamX Dev"
  }
}
```

### Key points

- **Folder ID** is a UUID (e.g. `4shVddgdinS_Ob-0TGHQQC_w`), not a name -- always resolve via step 1.
- **Budget filter** uses `perspective_name` (names, not IDs) -- comma-separated for multiple.
- **Cost queries** still use `perspective_id` (the perspective UUID) -- don't mix these up.
- Combine with section 10 (`harness_ccm_finops_budget_health`) for classified risk assessment across the entire folder.

---

## 12. Available group_by dimensions

| Dimension | Field | Cloud |
|-----------|-------|-------|
| Product (cross-cloud) | `product` | All |
| Region | `region` | All |
| Cloud Provider | `cloudProvider` | All |
| GCP Project | `gcp_project_id` | GCP |
| GCP Product | `gcp_product` | GCP |
| GCP SKU | `gcp_sku_description` | GCP |
| GCP Billing Account | `gcp_billing_account_id` | GCP |
| GCP Invoice Month | `gcp_invoice_month` | GCP |
| GCP Resource Name | `gcpResourceGlobalName` | GCP |
| AWS Service | `awsServicecode` | AWS |
| AWS Account | `awsUsageaccountid` | AWS |
| AWS Instance Type | `awsInstancetype` | AWS |
| AWS Usage Type | `awsUsageType` | AWS |
| AWS Line Item Type | `awsLineItemType` | AWS |
| Cost Category / BU | `cost_category` | All (requires `business_mapping_name`) |
| Resource Tags | `resource_tag` | All (requires `tag_key`) |

### Available scope filters

These narrow results **before** grouping. Works on `cost_breakdown`, `cost_timeseries`, `cost_summary`.

| Filter | Cloud | Purpose |
|--------|-------|---------|
| `filter_gcp_project_id` | GCP | Scope to GCP project(s) |
| `filter_gcp_product` | GCP | Scope to GCP product(s) |
| `filter_aws_usage_account_id` | AWS | Scope to AWS account(s) — parity with GCP project filter |
| `filter_aws_service` | AWS | Scope to AWS service(s) (awsServicecode) |
| `filter_aws_line_item_type` | AWS | Scope to line item type(s). **Use `"Usage"` for clean service breakdowns** |
| `filter_product` | All | Scope to cross-cloud product(s) |
| `filter_cost_category_value` | All | Scope to cost category bucket(s). Requires `business_mapping_name` |

All filters accept comma-separated values or an `_ids`/`_s`/`_values` array variant.

---

## 13. Time filter presets

`LAST_7`, `THIS_MONTH`, `LAST_30_DAYS`, `THIS_QUARTER`, `THIS_YEAR`, `LAST_MONTH`, `LAST_QUARTER`, `LAST_YEAR`, `LAST_3_MONTHS`, `LAST_6_MONTHS`, `LAST_12_MONTHS`

Or use `start_time_ms` / `end_time_ms` (epoch ms, UTC) for custom windows.

---

## 14. Commitment Orchestration (Reserved Instances & Savings Plans)

Commitment Orchestration (CO) covers AWS Reserved Instances and Savings Plans — their coverage, savings, and utilization. All CO resources use the Lightwing API (`/lw/co/api/`).

### Resource types

| Resource | What it returns | Key filters |
|----------|----------------|-------------|
| `cost_commitment_summary` | High-level overview: coverage %, savings totals, utilization rates | `start_date`, `end_date` |
| `cost_commitment_coverage` | Daily coverage chart + table by commitment type | `start_date`, `end_date`, `group_by` |
| `cost_commitment_savings` | Daily savings chart + table by commitment type | `start_date`, `end_date`, `group_by` |
| `cost_commitment_utilisation` | Daily utilization % chart + table with trend | `start_date`, `end_date` |
| `cost_commitment_savings_overview` | Managed vs unmanaged savings split by RI and SP | `start_date`, `end_date`, `service` |
| `cost_commitment_filters` | Available filter values (account IDs, instance families, regions) | `cloud_account_id`, `service` |
| `cost_commitment_accounts` | Connected AWS payer accounts with CO enablement status | — |
| `cost_commitment_analysis` | Spend breakdown by commitment type with daily chart and trend | `start_date`, `end_date`, `service`, `net_amortized` |

### Workflow: Commitment health check

```
Step 1 — Summary snapshot
  harness_ccm_finops_list(resource_type: "cost_commitment_summary",
    filters: { start_date: "2026-03-15", end_date: "2026-04-14" })
  → Coverage split (on-demand vs RI vs SP), total savings, utilization %

Step 2 — Drill into coverage
  harness_ccm_finops_list(resource_type: "cost_commitment_coverage",
    filters: { start_date: "2026-03-15", end_date: "2026-04-14", group_by: "Commitment Type" })
  → Daily cost/hours chart per type; chart this with harness_ccm_finops_chart

Step 3 — Savings breakdown
  harness_ccm_finops_list(resource_type: "cost_commitment_savings",
    filters: { start_date: "2026-03-15", end_date: "2026-04-14", group_by: "Commitment Type" })
  → Daily savings per commitment type

Step 4 — Utilization health
  harness_ccm_finops_list(resource_type: "cost_commitment_utilisation",
    filters: { start_date: "2026-03-15", end_date: "2026-04-14" })
  → RI utilization should be >80%; SP should be near 100%. Trend shows direction.

Step 4b — Managed vs unmanaged savings
  harness_ccm_finops_list(resource_type: "cost_commitment_savings_overview",
    filters: { start_date: "2026-03-15", end_date: "2026-04-14" })
  → Shows how much savings come from Harness-managed vs pre-existing commitments.
  → Filter by service: filters: { service: "Amazon Relational Database Service" }

Step 5 — Discover available filters
  harness_ccm_finops_list(resource_type: "cost_commitment_filters",
    filters: { service: "Amazon Elastic Compute Cloud - Compute" })
  → Returns account IDs, instance families, regions for further drill-down

Step 6 — Connected accounts
  harness_ccm_finops_list(resource_type: "cost_commitment_accounts")
  → Shows which AWS payer accounts have CO enabled (co_enabled: true)
```

### Workflow: Service-level savings drill-down (RDS vs EC2 vs ...)

There is no single API call that returns savings across all services at once. To compare services, call `cost_commitment_savings_overview` or `cost_commitment_analysis` per service:

```
Step 1 — Get overall savings
  harness_ccm_finops_list(resource_type: "cost_commitment_savings_overview",
    filters: { start_date: "2026-03-15", end_date: "2026-04-14" })
  → Total savings (managed + unmanaged), no service filter

Step 2 — Drill into specific services (one call per service)
  harness_ccm_finops_list(resource_type: "cost_commitment_savings_overview",
    filters: { start_date: "2026-03-15", end_date: "2026-04-14",
              service: "Amazon Relational Database Service" })

  harness_ccm_finops_list(resource_type: "cost_commitment_savings_overview",
    filters: { start_date: "2026-03-15", end_date: "2026-04-14",
              service: "Amazon Elastic Compute Cloud - Compute" })

Step 3 — Spend detail per service (with daily chart)
  harness_ccm_finops_list(resource_type: "cost_commitment_analysis",
    filters: { start_date: "2026-03-15", end_date: "2026-04-14",
              service: "Amazon Relational Database Service",
              net_amortized: true })
  → Daily spend by commitment type (On-Demand vs RI vs SP) with trend %

Step 4 — Chart the comparison
  Aggregate results from step 2 into a grouped bar chart:
  service name → managed savings, unmanaged savings, total savings
```

**Common AWS service names** (use exact strings — case-sensitive):
- `Amazon Elastic Compute Cloud - Compute` (EC2)
- `Amazon Relational Database Service` (RDS)
- `Amazon ElastiCache` (ElastiCache)
- `Amazon Redshift` (Redshift)
- `Amazon OpenSearch Service` (OpenSearch)
- `Amazon Elasticsearch Service` (legacy ES)

**Discover services:** Use `cost_commitment_filters` to see available `account_id` and `instance_family` values. For service names, check your `cost_breakdown` with `group_by: awsServicecode` on the default AWS perspective.

### Key points

- **Dates are required** for summary/coverage/savings/utilization — use `YYYY-MM-DD` format.
- **group_by values**: `"Commitment Type"` (default), `"Instance Family"`, `"Region"`.
- **Service filter**: Use exact AWS service names (see list above). One service per call.
- **Utilization signals**: Below 80% RI utilization → over-provisioned commitments. Near 100% SP → well-optimized.
- **Chart data** comes pre-sorted by date — pass directly to `harness_ccm_finops_chart`.
- **Coverage + savings + utilization** together tell the full story: what % is covered, how much that saves, and whether commitments are being used.

---

## 15. AutoStopping Rules (Idle Resource Management)

AutoStopping automatically shuts down idle cloud resources (VMs, ECS, RDS, Kubernetes workloads) and brings them back on demand, saving cost on non-production environments.

### Resource types

| Resource type | Returns | Operation |
|---|---|---|
| `cost_autostopping_rule` | Rule list with status, cloud provider, idle config | `list` |
| `cost_autostopping_rule` | Single rule detail | `get` (resource_id = rule numeric ID) |
| `cost_autostopping_savings` | Daily savings for one rule | `get` (resource_id = rule ID) |
| `cost_autostopping_savings_cumulative` | Aggregate savings across all rules | `list` |
| `cost_autostopping_logs` | Activity logs (state transitions) for one rule | `get` (resource_id = rule ID) |
| `cost_autostopping_schedule` | All uptime/downtime schedules | `list` |

### Key filters

- **`cost_autostopping_rule` list**: `search_term` for name-based filtering
- **`cost_autostopping_savings_cumulative`**: `from_date` / `to_date` as **YYYY-MM-DD strings** (e.g. `2026-04-01`); optional `filter_cloud_provider` (comma-separated: `aws`, `gcp`, `azure`)
- **`cost_autostopping_savings` (per-rule)**: `from_date` / `to_date` as Unix epoch seconds (pass via filters)
- **Logs**: `page` / `size` for pagination

### Workflow: AutoStopping health check

1. **List all rules** → `harness_ccm_finops_list` with `resource_type: cost_autostopping_rule`
2. **Check cumulative savings** → `harness_ccm_finops_list` with `resource_type: cost_autostopping_savings_cumulative`, `from_date: "YYYY-MM-DD"`, `to_date: "YYYY-MM-DD"`. Optionally add `filter_cloud_provider: "aws"` to scope by cloud.
3. **Drill into top savers** → `harness_ccm_finops_get` with `resource_type: cost_autostopping_savings`, `resource_id: <rule_id>` for daily breakdown
4. **Check for errors** → look at `errors` field in rule list; investigate with `harness_ccm_finops_get` on `cost_autostopping_logs`
5. **Review schedules** → `harness_ccm_finops_list` with `resource_type: cost_autostopping_schedule` to see uptime/downtime windows

### Key points

- **Rule `status`**: `"created"` = active, `"disabled"` = paused. The `disabled` boolean is the canonical check.
- **`fulfilment`** field: `"ondemand"` (EC2/VM), `"spot"` (spot instances), or specific to the resource type.
- **Cumulative savings** gives the big picture; per-rule savings lets you find underperforming rules or validate savings claims.
- **Cumulative savings response** includes `k8s_savings` (K8s-specific sub-total) and `chart` (daily series). `total_active_services` = rule count with activity in the window.
- **Logs** show state changes: `cooling_down → stopped → active`. If a rule frequently cycles, the idle_time_mins may be too low.
- **Schedules** are account-level; multiple rules can share the same schedule. Types are `uptime` (force on) or `downtime` (force off).
- **Date formats differ by endpoint**: cumulative savings uses YYYY-MM-DD strings; per-rule savings uses Unix epoch seconds.

---

## 16. Example prompts — getting started

Use these verbatim or adapt them. They cover the most common FinOps workflows and are a good starting point for new users.

### Bootstrap this guide

> "Load the full FinOps agent guide."

Call `harness_ccm_finops_guide` with no parameters — returns this complete document so you have
all tool calling conventions, resource types, patterns, and the BVR playbook available in context.

### Before you start — personalise the placeholders

These prompts use generic placeholders in `[square brackets]`. Before using them, ask the agent to discover your account's structure:

> "List all our cost categories and business mapping names."

The agent will return the exact mapping names (e.g. "Business Units", "Business Domains", "Teams") and their bucket names (e.g. "GPS", "GIS", "fraud solutions"). Substitute those into the placeholders below:

| Placeholder | Replace with |
|---|---|
| `[your cost category mapping]` | The mapping name returned above, e.g. `Business Units` |
| `[your cost category bucket]` | A specific bucket from that mapping, e.g. `Team A` |
| `[your perspective]` | A perspective name, e.g. `GCP Default` or `Team B - GCP` |
| `[date]` | A specific date, e.g. `April 8` |

---

### Orientation (run these first)

> "What cloud providers do we have connected, and what's our overall spend this month?"

> "List all our cost perspectives and cost category mappings."

### Spend & cost analysis

> "Show me a cost breakdown by GCP project for the last 30 days, with trends."

> "Which [your cost category mapping] are spending the most this month, and how does that compare to last month?"

> "Show me daily cost trends for [your cost category bucket] over the last 3 months."

> "What are our top 10 GCP SKUs by spend this month?"

### Budget health

> "Which budgets are at risk of overspending this month?"

> "Show me month-by-month actuals vs budget for the [your perspective] budget."

### Anomalies

> "Are there any active cost anomalies in the last 7 days? What's the dollar impact?"

> "What caused the cost spike on [date] in GCP?"

### Savings & recommendations

> "What are our top open savings recommendations across all clouds?"

> "Are there any open recommendations for [your cost category bucket]?"

### Commitment Orchestration (RI & Savings Plans)

> "What's our current commitment coverage and savings for the last 30 days?"

> "How are our Reserved Instances and Savings Plans utilized? Are any under-performing?"

> "Show me a coverage breakdown by instance family for the last month."

> "Which AWS payer accounts have Commitment Orchestration enabled?"

### AutoStopping

> "List all AutoStopping rules and their current status."

> "How much has AutoStopping saved in the last 30 days across all rules?"

> "Show me daily savings for AutoStopping rule 12345 over the past week."

> "Are there any AutoStopping rules with errors?"

> "What uptime/downtime schedules are configured?"

### Reports

> "Which [your cost category mapping] budgets are at risk of overspending this month, and what is driving the variance?"

> "Generate a monthly FinOps report across all [your cost category mapping] covering budget status, active anomalies, and top savings opportunities."

> "Our [your perspective] budget is tracking over — walk me through what's driving the overrun and what we can do about it."

### Maturity

> "Assess our FinOps maturity and render the spider chart."

> "Score our FinOps maturity across all seven dimensions and produce the Crawl/Walk/Run chart."

---

## 17. FinOps Maturity Chart — `harness_ccm_finops_maturity_chart`

Use this tool whenever the user asks for a **FinOps maturity assessment**, **Crawl/Walk/Run score**, **maturity spider chart**, or **maturity radar**.

### Tool call

```json
{
  "tool": "harness_ccm_finops_maturity_chart",
  "scores": {
    "visibility":          2.5,
    "allocation":          1.5,
    "commitment_strategy": 2.0,
    "anomaly_detection":   1.5,
    "optimization":        2.0,
    "accountability":      1.5,
    "tooling":             1.0
  },
  "title": "Acme Corp FinOps Maturity",
  "output_path": "/absolute/path/to/maturity.png"
}
```

- **Scores**: 1 = Crawl, 2 = Walk, 3 = Run. Fractions are supported (e.g. 1.5, 2.3).
- **title**: customer/account name — appears in chart header.
- **output_path**: absolute path to save PNG; omit to return inline only.

Returns: inline PNG + JSON summary (`overall_score`, `overall_label`, `groups`, `dimensions`).

### Group mapping

| Dimension | Group | Color |
|---|---|---|
| `visibility` | Inform | Orange |
| `allocation` | Inform | Orange |
| `tooling` | Inform | Orange |
| `commitment_strategy` | Optimize | Blue |
| `anomaly_detection` | Optimize | Blue |
| `optimization` | Optimize | Blue |
| `accountability` | Operate | Purple |

Group sub-scores and the overall score are computed automatically.

### Scoring rubric — how to derive scores from agent data

Use the queries in preceding sections to gather evidence, then map to a score:

#### Visibility (Inform)
| Evidence | Score |
|---|---|
| Perspectives exist; no cost categories | 1 — Crawl |
| Cost categories deployed (≥1 mapping with buckets) | 2 — Walk |
| All BUs have dedicated perspectives + categories, 4+ clouds | 3 — Run |

#### Allocation (Inform)
| Evidence | Score |
|---|---|
| Allocated cost < 50 % | 1 — Crawl |
| Allocated cost 50–79 % | 2 — Walk |
| Allocated cost ≥ 80 % | 3 — Run |

*Query: `cost_breakdown` grouped by `cost_category` (Business Units mapping), compare "Unattributed" vs total.*

#### Commitment Strategy (Optimize)
| Evidence | Score |
|---|---|
| CO enabled; < 50 % coverage | 1 — Crawl |
| EC2 coverage 50–89 %; RDS / ElastiCache uncovered | 2 — Walk |
| EC2 + RDS + ElastiCache ≥ 90 % coverage, utilisation > 80 % | 3 — Run |

*Query: `cost_commitment_summary`, `cost_commitment_coverage`, `cost_commitment_utilisation`.*

#### Anomaly Detection (Optimize)
| Evidence | Score |
|---|---|
| Budgets exist; no anomaly rules | 1 — Crawl |
| Budgets with alerts firing; anomaly detection enabled | 2 — Walk |
| Active anomaly rules with response process; zero unreviewed anomalies | 3 — Run |

*Query: `cost_budget` (check `actualCostAlerts`), `cost_anomaly_summary`.*

#### Optimization (Optimize)
| Evidence | Score |
|---|---|
| < 10 AutoStopping rules; many open recommendations | 1 — Crawl |
| AutoStopping active in multiple BUs; recommendations being actioned | 2 — Walk |
| ≥ 50 AutoStopping rules saving > $X/mo; < 20 open high-value recommendations | 3 — Run |

*Query: `cost_autostopping_savings_cumulative`, `cost_recommendation` list.*

#### Accountability (Operate)
| Evidence | Score |
|---|---|
| Cost categories exist but no chargeback | 1 — Crawl |
| BU-level cost visibility; allocation ≥ 50 % | 2 — Walk |
| Automated chargeback + showback with BU sign-off | 3 — Run |

*Inferred from Allocation score + cost category coverage.*

#### Tooling (Inform)
| Evidence | Score |
|---|---|
| FinOps agent accessible; ad-hoc usage only | 1 — Crawl |
| Weekly agent usage; reports produced regularly | 2 — Walk |
| Automated recurring reports; BVR cadence established | 3 — Run |

*Assessed from customer engagement, not a direct API query.*

---

## 18. Report Renderer — `harness_ccm_finops_report_render`

Use this tool whenever the user asks for a **BVR report**, **maturity assessment PDF**, **executive
report**, **themed HTML report**, or anything that needs to be delivered as a polished, paginated
document rather than a chat-style markdown dump.

### What it does

The tool takes a markdown file (with YAML frontmatter + image references) and registers it with the
**in-process report renderer** that ships inside the MCP server. By default it **auto-opens the
report in the user's default browser** (using `open` on macOS, `xdg-open` on Linux, `start` on
Windows). The user picks a theme via the sidebar dropdown and clicks **Export PDF** when ready.
The MCP agent does not generate the PDF; the browser does.

In **HTTP transport mode**, reports live at `http://localhost:<MCP_PORT>/reports/<id>/` — the same
host and port as the MCP endpoint. In **stdio transport mode**, the renderer lazily starts a
dedicated listener on `HARNESS_REPORT_PORT` (default `4321`) and reports live there.

The returned `url` is **verified reachable** before the tool returns — if the renderer can't serve
the doc (markdown moved, registry desync, etc.) the tool fails loudly rather than handing back a
broken link.

### When to use this vs other tools

| Need | Tool |
|---|---|
| Polished, paginated BVR / maturity report with cover page, TOC, themed styling | `harness_ccm_finops_report_render` |
| Quick one-off PDF of ad-hoc markdown (triage notes, summary) | `markdown_to_pdf` |
| Render a single chart PNG | `harness_ccm_finops_chart` |
| Render FinOps Maturity spider chart PNG | `harness_ccm_finops_maturity_chart` |

### Tool call

```json
{
  "tool": "harness_ccm_finops_report_render",
  "markdown_path": "/absolute/path/to/customer-bvr.md",
  "theme": "harness",
  "id": "acme-q1-bvr",
  "label": "Acme Q1 FY26 BVR",
  "open_in_browser": true
}
```

- **`markdown_path`** (required, absolute): path to the `.md` file with YAML frontmatter. The
  **directory containing this file is automatically served as the report's web root** — any
  relative URL inside the markdown (`assets/chart.png`, `images/foo.svg`, `sub/dir/inline.png`,
  `bare.png`) resolves directly off disk. No separate assets directory to register.
- **`base_dir`** (optional, absolute): override for the web root. Default is `dirname(markdown_path)`.
  Use this only when your markdown lives somewhere different from the assets it references.
- **`theme`** (optional): initial theme — `harness`, `modern`, `glass`, or `kinetic`. The user can
  switch themes in the browser.
- **`id`** (optional): stable slug for a pinned URL; re-running with the same ID returns the same
  URL. Defaults to filename-slug + hash of the absolute path (so the same markdown path always gets
  the same URL).
- **`label`** (optional): human-readable label for multi-doc indexes.
- **`open_in_browser`** (optional, default `true`): auto-open the URL in the user's default
  browser. Set to `false` for headless / remote-MCP environments where the browser launcher would
  open on the wrong machine.

Returns (HTTP mode — reports share the MCP port, default 3000):
```json
{
  "id": "acme-q1-bvr",
  "url": "http://localhost:3000/reports/acme-q1-bvr/?theme=harness",
  "markdown_link": "[Open Acme Q1 FY26 BVR in browser](http://localhost:3000/reports/acme-q1-bvr/?theme=harness)",
  "opened_in_browser": true,
  "print_url": "http://localhost:3000/reports/acme-q1-bvr/?mode=print&theme=harness",
  "pdf_url": "http://localhost:3000/reports/acme-q1-bvr/download?theme=harness",
  "theme": "harness",
  "available_themes": ["glass", "harness", "kinetic", "modern"],
  "content_path": "...",
  "base_dir": "...",
  "label": "Acme Q1 FY26 BVR",
  "renderer_base_url": "http://localhost:3000"
}
```

In stdio mode `url` uses `HARNESS_REPORT_PORT` (default `4321`) instead.

The browser opens automatically. Surface `markdown_link` (or `url`) to the user so they have a
clickable backup if the auto-open didn't fire (e.g. running over a remote MCP).

### Markdown authoring conventions

The renderer expects a specific markdown dialect. The cleaner the markdown, the better the output.

#### 1. YAML frontmatter (drives the cover page)

```yaml
---
title: FinOps Maturity Assessment
subtitle: Cloud financial operations readiness
customer: Acme Holdings
docType: Business Value Review
date: April 16, 2026
author: Harness CCM FinOps Agent
classification: Confidential
---
```

#### 2. Image references

Use **relative paths** — anything in the markdown's directory (or below) is served:

```markdown
![FinOps Maturity Spider Chart](assets/maturity_chart.png)
![Inline diagram](inline.png)
![Nested asset](images/q1/spend-trend.png)
```

The renderer serves these at `/reports/<id>/<same-relative-path>`. There is no fixed assets/
prefix — whatever directory layout you use under `dirname(markdown_path)` is what the URL exposes.
Generate PNGs with `harness_ccm_finops_chart` / `harness_ccm_finops_maturity_chart` /
`harness_ccm_finops_cost_category_chart` and save them anywhere inside that directory tree
**before** calling this tool.

#### 3. Callouts

```markdown
::: critical Azure governance failure
Azure spend grew from $329K to $4.1M/month with zero alerts fired.
:::

::: success Benchmark met
RI utilization at 95.1% — above the 80% benchmark.
:::

::: action To reach Run (3.0)
- Enable K8s AutoStopping
- Schedule weekly agent briefing
:::
```

Supported types: `critical`, `risk`, `warning`, `success`, `info`, `action`, `quote`.

#### 4. Metric card grid

```markdown
::: metrics
- label: Monthly savings
  value: $166,312
  trend: $1.99M annualised
  tone: success
- label: Open recs
  value: $92,833
  trend: $1.11M opportunity
  tone: risk
:::
```

Tones: `success`, `critical`, `risk`, `warning`, `info`, or omit for default.

#### 5. Standard markdown

Regular headings (`#`, `##`, `###`) feed the sidebar TOC. Tables, footnotes, definition lists, and
task lists all render with theme-aware styling.

### Themes

| Theme | Feel | Palette | Best for |
|---|---|---|---|
| `harness` (default) | Corporate executive BVR | Navy + amber, Fraunces serif | Formal customer-facing BVRs |
| `modern` | Editorial / startup | Near-black + coral, Space Grotesk | Internal / bold design |
| `glass` | Adaptive liquid-glass | Iridescent peach/violet + translucent panels | High-visual-impact showcases |
| `kinetic` | Scrollytelling + functional motion | Near-black + lime + coral, Bricolage Grotesque | Interactive web viewing (not PDF-first) |

The user can switch themes in the browser via the sidebar dropdown — no need to re-run the tool
unless you want a different initial theme.

### Typical BVR workflow

1. Gather data via the usual CCM queries (sections 1–17).
2. Render chart PNGs to an assets directory:
   - `harness_ccm_finops_maturity_chart → maturity_chart.png`
   - `harness_ccm_finops_chart → budget_status.png, cloud_spend_mom.png, …`
3. Write the BVR markdown with YAML frontmatter + `:::callouts` + `![](assets/…)` references.
4. Call `harness_ccm_finops_bvr_render` with the absolute markdown path.
5. Hand the returned `url` to the user.

### Environment configuration

The renderer runs in-process inside the MCP server — no separate install or service.

- **HTTP mode**: reports share the MCP `PORT` (default `3000`). No extra config needed.
- **Stdio mode**: lazy-starts an embedded listener on `HARNESS_REPORT_PORT` (default `4321`).

### Voice / narrated-video features are opt-in

The `harness_ccm_finops_video_render` MCP tool — which turns the report into a
narrated MP4 by reading `<!-- voice: ... -->` comments in the markdown — is
gated behind the `HARNESS_VOICE_ENABLED` env flag (default `false`).

**When the flag is off (default):**

- The video tool is **not** registered with the MCP server, so the agent does
  not see it in `tools/list` and cannot call it.
- The shipped Acme report template does **not** include a `<!-- voice: ... -->`
  tag.
- **The agent must NOT author voice comments into reports.** If the user has
  not enabled voice, generating voice tags creates dead weight in the markdown
  — they're invisible in the rendered HTML/PDF but become noise in the source.

**When the flag is on:**

- The video tool registers and is callable.
- Voice tags are a supported authoring convention. The agent may add one
  `<!-- voice: ... -->` per logical page when generating new reports, with the
  narration text inside.
- A TTS provider env var (`OPENAI_API_KEY`, `LOCAL_TTS_BASE_URL`, etc.) must
  also be set, otherwise the video renders silently.

To check whether voice is enabled in the current session, look for the
`harness_ccm_finops_video_render` tool in the `tools/list` response: present
means enabled, absent means disabled.

### Live source editing in the browser

Every rendered report ships with a floating **"Edit Source"** button (bottom-right). Clicking
it opens a slide-in panel with the underlying markdown source. Edits are saved back to the
original file on disk, and the preview reloads immediately.

| Action | Shortcut |
|---|---|
| Open / close the editor | Click the floating button |
| Save changes | ⌘/Ctrl+S, or the "Save & Reload" button |
| Cancel without saving | Esc, or the "Cancel" button |

The renderer watches the source file via SSE (`./source-watch`), so external edits — terminal
vim, your IDE, agent-driven re-renders — also trigger an automatic browser reload **as long as
the editor panel is closed**. If you have the panel open and the file changes externally, you
get an in-panel warning so you can decide whether to overwrite.

**Conflict detection.** When you open the editor we record the file's `mtime`. On Save the
client sends that mtime back; if the file moved underneath you (concurrent external edit), the
server returns 409 and the panel asks whether to force-overwrite.

**Where it works.** The editor is auto-injected into every web-mode render across all themes
(harness, modern, glass, kinetic, plus any pack-shipped themes such as `acme`). It is
automatically suppressed in print mode (`?mode=print`) so it never appears in PDF/PPTX/video
captures.

### Limitations

- PDF export requires Playwright + Chromium: `npx playwright install chromium` (one-time setup).
- If you only need the browser view, Chromium is optional.
- The report registry lives in process memory — if the MCP server restarts, already-registered
  reports need to be re-registered. Re-registering by the same `markdown_path` is idempotent and
  produces the same URL.
- The Live Edit feature writes back to the original markdown file at `markdown_path`. The
  renderer is localhost-only by design, so there is no auth on `POST /reports/:id/source`. If
  the renderer is ever exposed beyond localhost, gate this endpoint behind an env flag.

---

---

## 19. Business Value Review (BVR) — Complete Playbook

# Harness CCM Business Value Review (BVR)

**Customer Name:** [Insert Customer Name]
**Date:** [Insert Date]
**Harness Team:** [Insert Names]
**Customer Attendees:** [Insert Names/Titles]
**Current FinOps Maturity Stage:** [Insert Stage 1-5]

---

## BVR Preparation — How to Use the FinOps Agent

Run these steps **before** the BVR meeting to pre-populate every `[Insert Data]` field below.

### Step 0 — Bootstrap (always run first)

```
harness_ccm_finops_list  resource_type: "cost_metadata"
```

Captures: which clouds are connected, default perspective IDs, currency symbol. Save the
`defaultAwsPerspectiveId`, `defaultGcpPerspectiveId`, `defaultClusterPerspectiveId` — you will
need them throughout the BVR.

### Step 1 — Discover cost categories (BU mappings)

```
harness_ccm_finops_list  resource_type: "cost_category"
```

Returns all business mapping names (e.g. "Business Units", "Business Domains") and their bucket
lists. Pick the primary mapping name; substitute it as `<BU_MAPPING>` in every query below.

### Step 2 — Run section queries in order

Each section below has an **"Agent Queries"** block. Run those queries and paste the key numbers
into the `[Insert Data]` fields in the tables.

### Step 3 — Generate charts into an assets directory

Create a dedicated assets directory for this BVR (e.g. `/path/to/<customer>-bvr/assets/`) and save
every chart PNG into it. Use absolute paths for `output_path`:

- Maturity spider: `harness_ccm_finops_maturity_chart → maturity_chart.png`
- Cost trends / breakdowns: `harness_ccm_finops_chart → budget_status.png`, `cloud_spend_mom.png`, etc.
- Cost-category period comparison: `harness_ccm_finops_cost_category_chart → cost_by_bu.png`

### Step 4 — Author the BVR markdown

Create `<customer>-bvr.md` alongside the assets folder. Include YAML frontmatter for the cover
page, reference charts with relative paths (`![Alt text](assets/maturity_chart.png)`), and use
`:::critical` / `:::success` / `:::action` / `::: metrics` blocks for highlights.
See **Section 18 of this guide** for the full markdown dialect.

### Step 5 — Hand off to the BVR renderer

```
harness_ccm_finops_report_render
  markdown_path: "/absolute/path/to/<customer>-bvr.md"
  theme:         "harness"                                    # user can switch in browser
  id:            "<customer>-bvr"                             # stable pinned URL
  label:         "<Customer> BVR · <Quarter> <FY>"
```

Return the `url` from the response as the **primary deliverable**. The user opens it, chooses a
theme (harness / modern / glass / kinetic) via the sidebar, and clicks **Export PDF** to download
a paginated report.

---

## I. Executive Summary & Goals

### FinOps Maturity Assessment
Identify the customer's current stage and define the requirements to unlock the next level of maturity.

| Stage | Focus | Key Indicators for Completion |
| :--- | :--- | :--- |
| **1. Visibility** | Centralized cost data | Perspectives, Cost Categories, and Dashboards are live. |
| **2. Optimization** | Active savings actions | AutoStopping, Recommendations, Commitment Orchestrator active. |
| **3. Governance** | Policy-enforced control | Asset Governance, Budgets with alerts, Anomaly detection live. |
| **4. Accountability** | Allocated team costs | Cost per BU, Cost per Product, active chargeback capability. |
| **5. Forecasting** | Predictable future spend | FY-based savings forecasting, budget vs. actuals tracking. |

> **Agent quick-score:** Each section II deep-dive has a "benchmark met?" signal. Tally how many of
> the 7 sections are green to estimate the stage:  
> 1–2 green → Stage 1–2 · 3–4 green → Stage 3 · 5–6 green → Stage 4 · 7 green → Stage 5.

### FinOps Maturity Spider Chart

After running all section queries below, call `harness_ccm_finops_maturity_chart` to render the
**Crawl / Walk / Run radar chart**. Use the scoring rubric in Section 17 of this guide
to map collected evidence to a 1–3 score per dimension.

```
harness_ccm_finops_maturity_chart
  title: "<Customer Name> FinOps Maturity"
  scores:
    visibility:          <1-3>   # # perspectives, cost categories, cloud breadth
    allocation:          <1-3>   # % allocated spend (Unattributed vs total)
    commitment_strategy: <1-3>   # CO coverage % + RI utilisation
    anomaly_detection:   <1-3>   # budgets-with-alerts + anomaly rules active
    optimization:        <1-3>   # AutoStopping rules + open recommendations
    accountability:      <1-3>   # chargeback / showback maturity
    tooling:             <1-3>   # FinOps agent adoption cadence
  output_path: "/absolute/path/to/<customer>-bvr/assets/maturity_chart.png"
```

Save the PNG **into the BVR assets directory** so it can be referenced from the markdown as
`![FinOps Maturity](assets/maturity_chart.png)` and picked up by `harness_ccm_finops_report_render`.
The tool returns an inline PNG **and** a JSON summary with `overall_score`, `overall_label`, and
per-group sub-scores (`inform`, `optimize`, `operate`). Quote the `overall_score` in the BVR's
Executive Summary header.

### Quarterly North Star Goals
Establish clear, measurable targets for the upcoming quarter. 

* **Savings Target:** Define a specific dollar amount or percentage savings relative to contract value (e.g., "$X saved" or "200% ROI").
* **AutoStopping Expansion:** Assign at least one new AutoStopping pilot to an uncovered Business Unit.
* **Commitment Coverage:** Enable Commitment Orchestrator on at least one new service type (e.g., ElastiCache, RDS).
* **Reporting Evolution:** Complete Cost Categories migration and stand up BU-level self-serve dashboards.
* **Financial Alignment:** Establish a fiscal year (FY) savings baseline for internal finance reporting.

---

## II. CCM Module Deep Dive & Metric Review

Use the following tables to review active modules, assess performance against benchmarks, and guide the discovery conversation.

---

### 1. Cost Visibility & Allocation (CCM Insights)
**Focus:** Establishing foundational visibility, budget tracking, and team accountability.

| Metric to Track | Success Benchmark | Current Status |
| :--- | :--- | :--- |
| Configured Perspectives / Categories | Categories deployed for each BU | [Insert Data] |
| Custom BI Dashboards in use | Zero reliance on Excel for reporting | [Insert Data] |
| Allocated vs. Unallocated Spend | 80%+ of spend allocated to a cost owner | [Insert Data] |
| Active Budgets / Anomaly Rules | Budgets set at BU/team level with alerts | [Insert Data] |

**Agent Queries to Populate:**

```
# Perspectives and cost categories
harness_ccm_finops_list  resource_type: "cost_perspective"
→ total count = "Configured Perspectives"

harness_ccm_finops_list  resource_type: "cost_category"
→ list names + bucket counts = "Categories deployed"

# Allocated vs Unallocated — run for each cloud's default perspective
harness_ccm_finops_list
  resource_type: "cost_breakdown"
  perspective_id: "<defaultAwsPerspectiveId or defaultGcpPerspectiveId>"
  group_by: "cost_category"
  business_mapping_name: "<BU_MAPPING>"
  time_filter: "THIS_MONTH"
→ sum cost of all named buckets = allocated spend
→ find the "Unattributed" row cost = unallocated spend
→ allocation % = allocated / (allocated + unallocated) × 100
→ benchmark met if ≥ 80 %

# Budgets
harness_ccm_finops_budget_health
→ summary.over_budget + summary.at_risk + summary.on_track = total active budgets
→ note any over_budget or at_risk items for the conversation
```

**Discovery Questions:**
* Have you migrated from standard Perspectives to Cost Categories to unlock custom dashboards?
* Can finance and engineering teams access their own dashboards independently?
* Are you scheduling Dynamic Perspective Reports for automated stakeholder delivery?
* Do you have non-cloud costs (SaaS, on-prem) to ingest via the FOCUS standard?

---

### 2. Commitment Orchestration
**Focus:** Maximizing RI/SP coverage and eliminating manual commitment management.

| Metric to Track | Success Benchmark | Current Status |
| :--- | :--- | :--- |
| Total Savings Generated | Annualized run-rate clearly documented | [Insert Data] |
| % Commitments Under Harness | 90%+ commitment coverage | [Insert Data] |
| Value of Unmanaged Commitments | $0 (Pipeline opportunity identified) | [Insert Data] |
| EC2 (Compute) — On-Demand % | < 10% on-demand for EC2 | [Insert Data] |
| RDS — On-Demand % | < 20% on-demand for RDS | [Insert Data] |
| ElastiCache — On-Demand % | < 20% on-demand for ElastiCache | [Insert Data] |
| RDS RI Utilization | ≥ 80% (under-utilization = over-purchased RIs) | [Insert Data] |

> **EC2 vs RDS story:** EC2 is typically well-covered via Savings Plans; RDS and ElastiCache
> are RI-only services that require separate commitment purchases and are frequently uncovered
> or over-purchased. A low RDS RI utilization rate combined with high on-demand spend signals
> both a sizing problem and a CO expansion opportunity.

**Agent Queries to Populate:**

```
# All dates are YYYY-MM-DD strings. Use last 90 days for a stable run-rate.

# ── Step 1: High-level summary ──────────────────────────────────────────────
harness_ccm_finops_list
  resource_type: "cost_commitment_summary"
  start_date: "<90-days-ago>"
  end_date: "<today>"
→ savings.total                       = "Total Savings Generated (90-day)"
→ annualized run-rate                 = savings.total × (365 / 90)
→ coverage.savings_plan_pct           = SP coverage %
→ coverage.reserved_instances_pct     = RI coverage %
→ coverage.ondemand_pct               = residual on-demand % (lower = better)
→ utilization.reserved_instances_pct  (benchmark ≥ 80%)
→ utilization.savings_plan_pct        (benchmark ≥ 95%)

# ── Step 2: Managed vs unmanaged split ─────────────────────────────────────
harness_ccm_finops_list
  resource_type: "cost_commitment_savings_overview"
  start_date: "<90-days-ago>"
  end_date: "<today>"
→ managed_savings_total    = savings Harness is orchestrating
→ unmanaged_savings_total  = "Value of Unmanaged Commitments" (target = $0)
→ % under Harness          = managed_savings_total / overall_savings × 100
→ benchmark met if ≥ 90%

# ── Step 3: Per-service savings — EC2 vs RDS vs ElastiCache ─────────────────
# Run once per service to compare coverage. Expect EC2 to be highest;
# RDS and ElastiCache near-zero savings = uncovered = expansion opportunity.

harness_ccm_finops_list
  resource_type: "cost_commitment_savings_overview"
  start_date: "<90-days-ago>"
  end_date: "<today>"
  service: "Amazon Elastic Compute Cloud - Compute"
→ overall_savings, managed_savings_total, unmanaged_savings_total (EC2 baseline)

harness_ccm_finops_list
  resource_type: "cost_commitment_savings_overview"
  start_date: "<90-days-ago>"
  end_date: "<today>"
  service: "Amazon Relational Database Service"
→ overall_savings ≈ 0 → RDS has no active RI coverage (expansion target)
→ unmanaged_savings_total > 0 → RDS RIs exist but not under Harness

harness_ccm_finops_list
  resource_type: "cost_commitment_savings_overview"
  start_date: "<90-days-ago>"
  end_date: "<today>"
  service: "Amazon ElastiCache"
→ same pattern as RDS — near-zero = uncovered

# ── Step 4: Per-service spend breakdown (On-Demand vs RI vs SP) ─────────────
# cost_commitment_analysis gives the daily spend split and trend.
# Run this for each service to quantify the on-demand exposure.

harness_ccm_finops_list
  resource_type: "cost_commitment_analysis"
  start_date: "<90-days-ago>"
  end_date: "<today>"
  service: "Amazon Relational Database Service"
  net_amortized: true
→ commitment_types."On-Demand".total_spend  = raw on-demand RDS cost (the gap)
→ commitment_types."Reserved Instances".total_spend = existing RI coverage
→ commitment_types."On-Demand".trend_pct    = growing on-demand = urgent
→ chart the daily series to show whether on-demand is shrinking or growing

harness_ccm_finops_list
  resource_type: "cost_commitment_analysis"
  start_date: "<90-days-ago>"
  end_date: "<today>"
  service: "Amazon Elastic Compute Cloud - Compute"
  net_amortized: true
→ EC2 benchmark: On-Demand should be < 10% of total_spend

# ── Step 5: RI utilization — are existing RDS RIs being wasted? ─────────────
harness_ccm_finops_list
  resource_type: "cost_commitment_utilisation"
  start_date: "<90-days-ago>"
  end_date: "<today>"
→ commitment_types."Reserved Instances".utilization_pct
  - ≥ 80%  → healthy
  - 60–80% → over-purchased, some waste
  - < 60%  → significant RI waste — recommend right-sizing before expanding
→ commitment_types."Reserved Instances".trend_pct
  - negative trend = utilization falling = workload was scaled down

# (No per-service filter on utilisation endpoint — use the overall RI row
#  and cross-reference with savings_overview per service to isolate RDS.)

# ── Step 6: Which payer accounts have CO enabled? ───────────────────────────
harness_ccm_finops_list  resource_type: "cost_commitment_accounts"
→ accounts where co_enabled: false = accounts where RDS/ElastiCache RIs
  are being purchased manually with no Harness orchestration
```

**How to frame the EC2 vs RDS gap in the BVR:**
1. Show EC2 on-demand % (usually low — Savings Plans are working)
2. Show RDS on-demand % (usually high — no RI orchestration)
3. Calculate: `RDS on-demand spend × ~40% RI discount rate = annual savings opportunity`
4. If RDS RI utilization < 80%, flag both the waste *and* the coverage gap before recommending new purchases

**Discovery Questions:**
* What percentage of your cloud commitments are currently managed under Harness?
* How much unmanaged commitment spend exists outside Harness today?
* Are ElastiCache and RDS service types covered by your current commitment strategy?
* What is your current RDS RI utilization rate — are existing RIs being fully consumed?
* Are RDS and ElastiCache RIs purchased manually today, or through an automated process?

---

### 3. AutoStopping
**Focus:** Eradicating idle non-prod spend via dynamic, proxy-based, or time-based rules.

| Metric to Track | Success Benchmark | Current Status |
| :--- | :--- | :--- |
| Total Savings Generated | $10K+/month per 100 active rules | [Insert Data] |
| Active Rules | Expansion across all non-prod BUs | [Insert Data] |
| Non-Prod Environment Coverage | 100% of applicable non-prod footprint | [Insert Data] |

**Agent Queries to Populate:**

```
# Cumulative savings — from_date / to_date are YYYY-MM-DD strings
harness_ccm_finops_list
  resource_type: "cost_autostopping_savings_cumulative"
  from_date: "<YYYY-MM-DD 30 days ago>"
  to_date: "<YYYY-MM-DD today>"
→ total_savings          = "Total Savings Generated (last 30 days)"
→ total_active_services  = active rule count (cross-check with rule list)
→ savings_percent        = savings as % of potential cost
→ k8s_savings.total_savings = K8s-specific savings sub-total
→ monthly run-rate: total_savings covers the window — divide by window days × 30 if needed

# Filter by cloud provider if needed (aws | gcp | azure, comma-separated)
harness_ccm_finops_list
  resource_type: "cost_autostopping_savings_cumulative"
  from_date: "<YYYY-MM-DD>"
  to_date: "<YYYY-MM-DD>"
  filter_cloud_provider: "aws"
→ AWS-only savings for per-cloud breakdown

# Rule inventory
harness_ccm_finops_list  resource_type: "cost_autostopping_rule"
→ count items where disabled = false   = "Active Rules"
→ count items where disabled = true    = "Disabled/paused rules"
→ items with errors ≠ null             = rules needing attention
→ group by cloud_provider to see AWS / GCP / Azure split
→ review rule names/host_name for "prod" — prod rules are a risk signal
→ identify BUs or regions with no rules → uncovered non-prod footprint

# Per-rule savings for top savers — epoch seconds (different from cumulative)
harness_ccm_finops_get
  resource_type: "cost_autostopping_savings"
  resource_id: "<rule_id_from_list>"
  from_date: <epoch_sec_30_days_ago>
  to_date: <epoch_sec_now>
→ validates which rules are generating the most savings
```

**Discovery Questions:**
* What is your current monthly savings run-rate from AutoStopping?
* Which business units or environments are still uncovered?
* What is blocking expansion (e.g., proxy complexity, stakeholder resistance)?

---

### 4. Cluster Orchestrator
**Focus:** Real-time Kubernetes optimization via Spot Orchestration, Bin Packing, and VPA.

| Metric to Track | Success Benchmark | Current Status |
| :--- | :--- | :--- |
| EKS Compute on Spot Instances | 70–90% running on Spot | [Insert Data] |
| Manual Interruption Handling | Zero manual interventions required | [Insert Data] |
| Bin Packing / VPA Status | Bin Packing enabled; VPA generating insights | [Insert Data] |

**Agent Queries to Populate:**

> **Note:** Cluster Orchestrator spot %, bin packing, and VPA metrics live in the Harness platform
> UI (CCO module) and are not yet exposed via the FinOps MCP. Use the agent for the cost-side
> context below; pull spot/VPA metrics from the CCO dashboard directly.

```
# Confirm K8s data is present and locate the cluster perspective
harness_ccm_finops_list  resource_type: "cost_metadata"
→ k8sClusterConnectorPresent: true/false
→ clusterDataPresent: true/false
→ defaultClusterPerspectiveId → use in queries below

# Total cluster spend this month (baseline for ROI conversation)
harness_ccm_finops_list
  resource_type: "cost_summary"
  perspective_id: "<defaultClusterPerspectiveId>"
  time_filter: "THIS_MONTH"
→ cost.statsValue   = current month cluster spend
→ cost.statsTrend   = MoM growth % (high growth = urgent CCO opportunity)

# Cluster spend trend — is it growing?
harness_ccm_finops_list
  resource_type: "cost_timeseries"
  perspective_id: "<defaultClusterPerspectiveId>"
  group_by: "cloudProvider"
  time_filter: "LAST_3_MONTHS"
  time_resolution: "MONTH"
→ rising trend without CCO active = quantified optimization gap

# Cost breakdown by namespace (identify biggest workloads)
harness_ccm_finops_list
  resource_type: "cost_breakdown"
  perspective_id: "<defaultClusterPerspectiveId>"
  group_by: "product"
  time_filter: "THIS_MONTH"
→ top-spending namespaces / workloads = CCO pilot candidates
```

**Discovery Questions:**
* What percentage of your EKS compute is currently running on spot instances vs. on-demand?
* Have you enabled Bin Packing to capture scale-down savings?
* Are you using Cluster Capacity Limits to prevent uncontrolled scaling events?

---

### 5. Asset Governance & Recommendations
**Focus:** Enforcing policy-as-code, improving tag quality, and actioning optimization signals.

| Metric to Track | Success Benchmark | Current Status |
| :--- | :--- | :--- |
| Active Governance Rules | At least 10 active rules covering primary clouds | [Insert Data] |
| Recommendation Action Rate | >50% of surfaced recommendations actioned | [Insert Data] |
| Custom Cloud Custodian Policies | Custom rules utilized over strictly OOTB | [Insert Data] |

**Agent Queries to Populate:**

```
# All open recommendations — total count + total monthly savings at stake
harness_ccm_finops_list
  resource_type: "cost_recommendation"
  recommendation_state: "OPEN"
  limit: 100
→ total count of items       = open recommendation backlog
→ sum monthlySaving          = total $ at stake (monthly)
→ annualized: × 12           = savings opportunity for exec summary

# Governance-specific rules (Cloud Custodian policies)
harness_ccm_finops_list
  resource_type: "cost_recommendation"
  resource_type_filter: "GOVERNANCE"
  recommendation_state: "OPEN"
  limit: 50
→ count distinct governance_rule_name values = "Active Governance Rules"
→ rules with monthlySaving > 0 = rules with enforcement potential

# Right-sizing recommendations (EC2/Azure VMs)
harness_ccm_finops_list
  resource_type: "cost_recommendation"
  resource_type_filter: "EC2_INSTANCE"
  recommendation_state: "OPEN"
  limit: 50
→ total monthlySaving sum = EC2 right-sizing opportunity

# Kubernetes workload recommendations
harness_ccm_finops_list
  resource_type: "cost_recommendation"
  resource_type_filter: "WORKLOAD"
  recommendation_state: "OPEN"
  limit: 50
→ total monthlySaving sum = K8s workload right-sizing opportunity

# BU-scoped recommendations (repeat per BU to show per-team accountability)
harness_ccm_finops_list
  resource_type: "cost_recommendation"
  cost_category_name: "<BU_MAPPING>"
  cost_category_bucket: "<BU_NAME>"
  recommendation_state: "OPEN"
  limit: 30
→ per-BU savings opportunity — use in accountability conversations

# Anomaly check (governance signal)
harness_ccm_finops_list
  resource_type: "cost_anomaly_summary"
  perspective_id: "<defaultAwsPerspectiveId or defaultGcpPerspectiveId>"
  time_filter: "LAST_7"
→ anomalyCount + differenceFromExpectedCost = active governance gaps
```

**Discovery Questions:**
* What percentage of recommendations are actionable versus noise for your environment?
* Are any governance rules running in enforcement mode (auto-stop/tag/delete)?
* Are you integrating findings directly with Jira or ServiceNow for remediation tracking?

---

### 6. FinOps Agent
**Focus:** Accelerating insights via AI-driven conversational cost analysis and anomaly triage.

| Metric to Track | Success Benchmark | Current Status |
| :--- | :--- | :--- |
| Active Users / Sessions | At least one agent-assisted review per week | [Insert Data] |
| Actioning Rate Improvement | Increased action rate post-agent adoption | [Insert Data] |
| Manual Workflow Replacement | Replaced at least one recurring manual report | [Insert Data] |

> **Note:** Agent session/user metrics are captured in Harness platform audit logs and the UI
> usage dashboard — not exposed via MCP. Populate these from the Harness admin UI. The queries
> below demonstrate *what the agent can answer* to build the business case for adoption.

**Agent Queries to Demonstrate Value (run live during the BVR):**

```
# Live demo 1 — "What are our top cost drivers this month?"
harness_ccm_finops_list
  resource_type: "cost_breakdown"
  perspective_id: "<primary perspective>"
  group_by: "cost_category"
  business_mapping_name: "<BU_MAPPING>"
  time_filter: "THIS_MONTH"
→ instant BU-level leaderboard with MoM trends (costTrend)

# Live demo 2 — "Are any budgets at risk?"
harness_ccm_finops_budget_health
→ classified over_budget / at_risk / on_track in one call

# Live demo 3 — "What anomalies fired this week?"
harness_ccm_finops_list
  resource_type: "cost_anomaly_summary"
  perspective_id: "<primary perspective>"
  time_filter: "LAST_7"
→ anomaly timeline + dollar impact, no dashboard navigation needed

# Live demo 4 — "What's our top savings opportunity right now?"
harness_ccm_finops_list
  resource_type: "cost_recommendation"
  recommendation_state: "OPEN"
  limit: 10
→ ranked recommendations by monthlySaving
```

**Discovery Questions:**
* Are your teams using the agent for proactive cost analysis or reactive anomaly triage?
* Are you getting the insights you need in plain language without manual dashboard navigation?
* Are you aware of the MCP integration to connect internal AI tools directly to CCM data?

---

### 7. Savings Accounting & Forecasting
**Focus:** Proving ROI to finance through accurate forecasting and baseline reductions.

| Metric to Track | Success Benchmark | Current Status |
| :--- | :--- | :--- |
| Tracked Savings Format | Both point-in-time and carry-forward tracked | [Insert Data] |
| FY Forecast Alignment | Savings factored into fiscal year baselines | [Insert Data] |

**Agent Queries to Populate:**

```
# ── Total platform savings (last 30 days) ──────────────────────────────────

# AutoStopping (last 30 days) — from_date / to_date are YYYY-MM-DD strings
harness_ccm_finops_list
  resource_type: "cost_autostopping_savings_cumulative"
  from_date: "<YYYY-MM-DD 30 days ago>"
  to_date: "<YYYY-MM-DD today>"
→ total_savings  (A)

# Commitment Orchestration (last 90 days ÷ 3 for monthly rate)
harness_ccm_finops_list
  resource_type: "cost_commitment_savings_overview"
  start_date: "<90-days-ago>"
  end_date: "<today>"
→ managed_savings_total  → monthly rate = managed_savings_total / 3  (B)

# Total monthly savings run-rate = A + B
# Annualized = (A + B) × 12
# ROI = annualized savings / contract value × 100

# ── Budget vs actuals (FY alignment) ───────────────────────────────────────

harness_ccm_finops_budget_health
  period: "MONTHLY"
→ over_budget list   = already exceeded — immediate action required
→ at_risk list       = forecast to exceed — risk to FY baseline
→ on_track list + pct_forecast  = where headroom remains

# Month-by-month actuals vs budgeted for a specific perspective
harness_ccm_finops_get
  resource_type: "cost_budget"
  resource_id: "<budget_id_from_health_sweep>"
→ costData[]: actualCost vs budgeted per month
→ budgetVariancePercentage: trend toward/away from FY target
→ forecastCost: projected end-of-period spend for executive reporting

# ── Spend trend — baseline for FY forecast ─────────────────────────────────

harness_ccm_finops_list
  resource_type: "cost_timeseries"
  perspective_id: "<primary perspective>"
  group_by: "cost_category"
  business_mapping_name: "<BU_MAPPING>"
  time_filter: "LAST_12_MONTHS"
  time_resolution: "MONTH"
→ 12-month BU-level trend series
→ extrapolate forward to FY end for finance baseline conversation
```

**Discovery Questions:**
* Does your organization track savings on a point-in-time or carry-forward basis?
* Are you including Harness-driven savings in your FY forecast as new baseline reductions?
* Do you need a contract burn-down view to track spend against your Harness CCM commitment?

---

## III. Expansion Signals & Action Plan

Monitor the following customer indicators to identify immediate upsell or feature expansion opportunities during the review.

| Customer Signal | Recommended Action / Upsell Path |
| :--- | :--- |
| Using Excel for cost-per-product reporting | **Action:** Pitch Cost Categories + Custom BI Dashboards. |
| Commitment coverage is below 90% | **Action:** Expand Commitment Orchestrator footprint. |
| No ElastiCache or RDS coverage | **Action:** Quantify RDS/ElastiCache on-demand spend via `cost_commitment_analysis` per service, then multiply by ~40% RI discount rate to show the savings opportunity. |
| AutoStopping deployed in only 1-2 BUs | **Action:** Initiate multi-BU expansion and pilot new environments. |
| Using Insights only, but has active K8s spend | **Action:** Pitch Cluster Orchestrator for EKS spot orchestration. |
| Unaware of FinOps Agent or AI features | **Action:** Schedule a dedicated FinOps Agent and MCP feature walkthrough. |
| Poor tagging coverage in Perspectives | **Action:** Deploy Asset Governance rules for auto-tagging enforcement. |
| Recommendations ignored or low action rate | **Action:** Introduce Custom Cloud Custodian policies and FinOps Agent triage. |

**Agent Queries to Surface Expansion Signals:**

```
# Signal: allocation < 80 % → Cost Categories upsell
harness_ccm_finops_list
  resource_type: "cost_breakdown"
  perspective_id: "<default perspective>"
  group_by: "cost_category"
  business_mapping_name: "<BU_MAPPING>"
  time_filter: "THIS_MONTH"
→ "Unattributed" cost / total > 20 % = signal

# Signal: commitment coverage < 90 % → CO expansion
harness_ccm_finops_list
  resource_type: "cost_commitment_summary"
  start_date: "<30-days-ago>"  end_date: "<today>"
→ coverage.ondemand_pct > 10 % = signal

# Signal: RDS/ElastiCache on-demand exposure (most common gap)
harness_ccm_finops_list
  resource_type: "cost_commitment_analysis"
  start_date: "<30-days-ago>"  end_date: "<today>"
  service: "Amazon Relational Database Service"
  net_amortized: true
→ commitment_types."On-Demand".total_spend > $0 = RDS coverage gap
→ multiply by 40% ≈ annual savings opportunity from adding RDS RIs

harness_ccm_finops_list
  resource_type: "cost_commitment_analysis"
  start_date: "<30-days-ago>"  end_date: "<today>"
  service: "Amazon ElastiCache"
  net_amortized: true
→ same check for ElastiCache

# Signal: unmanaged commitments > $0 → CO upsell
harness_ccm_finops_list
  resource_type: "cost_commitment_savings_overview"
  start_date: "<30-days-ago>"  end_date: "<today>"
→ unmanaged_savings_total > 0 = signal

# Signal: AutoStopping in few BUs → expansion pilot
harness_ccm_finops_list  resource_type: "cost_autostopping_rule"
→ cluster rules by cloud_account_id or name patterns
→ few distinct accounts = limited BU coverage = signal

# Signal: K8s spend but no CO
harness_ccm_finops_list  resource_type: "cost_metadata"
→ k8sClusterConnectorPresent: true + clusterDataPresent: true
→ then: large cluster spend with no CCO metrics = signal

# Signal: large open recommendation backlog → governance triage
harness_ccm_finops_list
  resource_type: "cost_recommendation"
  recommendation_state: "OPEN"
  limit: 1
→ high monthlySaving on first result = high-value ignored backlog = signal
```

---

## 20. Customer Report Packs

A **Report Pack** bundles everything one customer needs to produce a branded,
recurring report family without touching the core renderer. Each pack lives under
`report-packs/<pack-id>/` in the repo (or in an external directory pointed to by
`HARNESS_REPORT_PACKS_DIR_EXTRA`).

### Discovery — `harness_ccm_finops_packs`

This is the **primary discovery tool** for packs. Use it whenever the user
mentions a specific customer's report, asks what branded reports are available,
or asks how to create a new pack.

```
# List installed packs (no args)
harness_ccm_finops_packs

# Get a specific pack — returns the playbook content so you can follow it
harness_ccm_finops_packs  pack_id: "acme"

# Get a pack with full template source baked in (single-shot bootstrap)
harness_ccm_finops_packs  pack_id: "acme"  include_template_source: true
```

**List response** includes one entry per pack with `id`, `name`, `theme_id`,
`templates[]`, `block_count`, `pack_dir`, `has_playbook`. It also includes:

- `discovery_roots` — every directory the registry scanned (so you can see
  which root the pack was loaded from, useful when debugging customer overlays).
- `authoring_primer` — the directory layout, block contract, installation steps,
  and end-to-end usage flow for creating a new pack.

**Get response** includes the full pack metadata + the **playbook markdown**
(when `include_playbook` is true, the default in get mode). The playbook is the
agent-readable script for that customer: which CCM queries to run, which
perspective IDs map to which template field, and which sections to leave for
human authoring.

### When to call this tool — example user prompts

| User asks | Action |
|---|---|
| "Generate the monthly portfolio report for `<customer>`" | `harness_ccm_finops_packs pack_id:"<id>"` → follow the returned playbook |
| "What customer reports do we have?" | `harness_ccm_finops_packs` (list mode) |
| "Render the `<customer>` BVR" | List packs, find the one matching `<customer>`, then get it |
| "How do I create a new customer report pack?" | `harness_ccm_finops_packs` → read `authoring_primer` + Section 20 |
| "Show me the playbook for `<pack-id>`" | `harness_ccm_finops_packs pack_id:"<id>" include_playbook:true` |
| "Show me the example report pack" | `harness_ccm_finops_packs pack_id:"acme"` (the `acme` pack is a fictional reference) |

### Pack anatomy

```
report-packs/
  <customer-id>/
    pack.json         # manifest: id, name, theme_id, block_preprocessors, templates
    theme/            # Optional pack-bundled theme (manifest.json + template.js + *.css + app.js)
    blocks/           # Custom ::: block preprocessors (plain .js, ESM)
    templates/        # Markdown skeletons with {{placeholder}} fields
    playbook.md       # Agent-readable instructions: which CCM queries to run, what to fill
    README.md         # CSM onboarding reference
```

### Discovery and loading

The pack registry (`src/report-renderer/packs/index.ts`) scans all pack roots at server
startup. Blocks are loaded lazily on first render and cached. Theme directories contributed
by packs are added to the theme-roots list so `?theme=<pack-theme-id>` Just Works.

**Pack roots, in priority order (first match wins on `id` collision):**

1. `HARNESS_REPORT_PACKS_DIR_EXTRA` — colon-separated list of external absolute paths.
   Use this for customers whose packs are maintained outside the core repo (CI overlays,
   customer-operated CSM environments).
2. `report-packs/` in this repo — the default in-repo location.

**Extra themes dir** (`HARNESS_REPORT_THEMES_DIR_EXTRA`) similarly lets you drop customer
themes in without touching the bundled `src/report-renderer/static/themes/` directory.

### The `pack.json` manifest

```json
{
  "id": "acme",
  "name": "Acme Corp",
  "theme_id": "acme",
  "block_preprocessors": [
    "blocks/portfolio-bucket-grid.js",
    "blocks/portfolio-detail.js"
  ],
  "templates": [
    {
      "id": "portfolio-monthly",
      "name": "Monthly Portfolio Cost Optimisation Report",
      "path": "templates/portfolio-monthly.md"
    }
  ]
}
```

- `theme_id` — the `id` field in the pack's `theme/manifest.json`. The pack's theme
  directory is exposed to the renderer automatically.
- `block_preprocessors` — relative paths to **compiled JS (ESM)** files. Each must export
  `preprocessMarkdown(src: string): string`. Applied in order before markdown-it parses
  the document — same pipeline position as `metric-cards` and `callout-normalize`.
- `templates` — informational list for the agent; not auto-loaded by the renderer.

### Writing a custom block preprocessor

Two authoring patterns, matching the built-in plugins:

**Pattern 1 — Preprocessor (like metric-cards):** for data-driven visual blocks.

```js
// blocks/my-block.js
const BLOCK_RE = /^[ \t]*:::\s*my_block\s*\r?\n([\s\S]*?)^[ \t]*:::\s*$/gm;

export function preprocessMarkdown(src) {
  return src.replace(BLOCK_RE, (_match, body) => {
    // Parse body, render HTML
    return `\n<div class="my-block">...</div>\n`;
  });
}
```

**Pattern 2 — Container (like callouts, via markdown-it-container):** for narrative/titled blocks.
If you need container-style rendering, write a preprocessor that emits the HTML directly
(Pattern 1) rather than registering a markdown-it plugin — this avoids requiring access to
the markdown-it instance and keeps the contract to the simple `preprocessMarkdown` export.

### Reference example — the `acme` pack

The `report-packs/acme/` pack ships a fictional reference Cloud Cost Optimisation
monthly report with two new block types. Acme Corp is **not a real customer** — the
pack exists so CSMs and customers can see a working end-to-end example before
building their own.

| Block | Purpose |
|---|---|
| `::: portfolio_bucket_grid` | Page-1 hero: 5-column SVG bucket grid showing captured vs potential FY savings per portfolio |
| `::: portfolio_detail <name> \| GM: <name> \| ...` | Per-portfolio detail page: header bar, financial summary, insights narrative, cost-centre breakdown table |

**To explore the reference report, tell the agent:**

> "Read the Acme pack's playbook and render an example portfolio report."

The agent will:
1. Call `harness_ccm_finops_packs pack_id:"acme"` to fetch the playbook.
2. Either run the CCM queries against your account (if you authorise it) or
   render the template with its built-in placeholder data.
3. Call `harness_ccm_finops_report_render` with `theme: "acme"` to produce the URL.

**To create a real customer pack:** clone `report-packs/acme/` to
`report-packs/<customer-id>/`, rename, rebrand the theme, replace the five reference
portfolios with the customer's actual portfolios, and update the playbook with their
specific cost-centre dimension and forecasting tool. See "Adding a new customer pack"
below.

### Export formats for pack-specific reports

| Format | Works | How |
|---|---|---|
| Browser (HTML) | ✅ Full fidelity | `harness_ccm_finops_report_render` |
| PDF | ✅ Full fidelity | Export PDF button in browser |
| Paged.js PPTX | ✅ Full fidelity (image slides) | `harness_ccm_finops_pptx_render` with `slide_size: "A4"` |
| Editable PPTX (sidebar) | ⚠️ Low fidelity | Custom blocks render as HTML text; acceptable for simple reports |
| DOCX | ⚠️ Low fidelity | Same limitation |

### Adding a new customer pack

1. Create `report-packs/<new-customer>/pack.json` with your `id`, `theme_id`,
   `block_preprocessors`, and `templates`. Example:

   ```json
   {
     "id": "<new-customer>",
     "name": "<Customer Display Name>",
     "theme_id": "<new-customer>",
     "block_preprocessors": ["blocks/my-block.js"],
     "templates": [
       {
         "id": "monthly",
         "name": "Monthly Cost Optimisation Report",
         "description": "One-pager portfolio summary + per-team detail",
         "path": "templates/monthly.md"
       }
     ]
   }
   ```

2. Create the theme: copy `src/report-renderer/static/themes/acme/` to
   `src/report-renderer/static/themes/<new-customer>/` (or to a `theme/` subdir
   inside the pack itself for a self-contained delivery), update `manifest.json`
   (id, name, brand fields) and `theme.css` (search-and-replace `--c-red*`
   palette tokens with the customer's brand colours).
3. Write block preprocessors as plain `.js` ESM modules in `blocks/` — each
   must export `preprocessMarkdown(src: string): string`. The CommonMark gotcha
   to remember: collapse blank lines from generated HTML or markdown-it will
   drop out of the HTML block and treat indented children as code blocks.
4. Create a `templates/<id>.md` skeleton with `{{placeholder}}` fields and a
   `playbook.md` documenting the CCM queries that fill those fields.
5. Restart the MCP server — the pack is auto-discovered on next startup.
6. Verify discovery: `harness_ccm_finops_packs` should now list your pack.
7. Render: `harness_ccm_finops_report_render` with `theme: "<new-customer>"`.

No code changes to the core renderer are needed. The `harness_ccm_finops_packs`
tool's response also embeds the same authoring primer in its `authoring_primer`
field — a good shortcut for agents helping a customer scaffold a new pack.

---
