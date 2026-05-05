# Acme Corp — Monthly Portfolio Report Playbook

> **About this pack.** Acme Corp is a fictional reference customer. This pack
> demonstrates the end-to-end Customer Report Pack pattern (theme + custom blocks
> + template + agent playbook) and is designed to be cloned and adapted for a
> real customer. Replace every `Acme Corp` reference, the five portfolio names,
> the cost-centre codes, and the brand palette with the real customer's values.

**Report:** Cloud Cost Optimisation — Monthly Portfolio Summary  
**Template:** `report-packs/acme/templates/portfolio-monthly.md`  
**Theme:** `acme`  
**Output:** `harness_ccm_finops_report_render` with `theme: "acme"`

---

## Who does what

| Step | Owner | What |
|---|---|---|
| Steps 1–4 (data queries) | FinOps Agent | Auto-populate structured fields in template |
| Step 5 (narrative fields) | CSM / Portfolio Champion | Fill `{{...}}` insight bullets, GM names |
| Step 6 (render) | Either | Run `harness_ccm_finops_report_render` |
| Step 7 (export) | CSM | Export PDF from browser for distribution |

---

## Step 0 — Bootstrap (run first, every session)

```
harness_ccm_finops_list  resource_type: "cost_metadata"
```

Capture: `defaultAwsPerspectiveId`, `defaultGcpPerspectiveId`, `defaultClusterPerspectiveId`,
which clouds are connected. Verify the customer's account is connected via
`harness_ccm_finops_whoami` and quote the returned `companyName`.

---

## Step 1 — Discover the portfolio taxonomy

```
harness_ccm_finops_list  resource_type: "cost_category"
```

Identify the cost category mapping that corresponds to the customer's portfolio
breakdown. It will likely be named `Portfolios`, `Portfolio`, `IT Portfolio`, or
similar. Note the **exact mapping name** — this is the `<BU_MAPPING>` used in
all subsequent queries.

This pack ships with five reference portfolio names that you should replace
with the customer's actual portfolios:

| Reference name | Replace with |
|---|---|
| Engineering Platform | `<your portfolio 1>` |
| Customer Experience  | `<your portfolio 2>` |
| Data & Analytics     | `<your portfolio 3>` |
| Security & Risk      | `<your portfolio 4>` |
| Corporate Systems    | `<your portfolio 5>` |

If the customer uses per-portfolio perspectives instead of a cost-category
mapping, find the perspective IDs using:
```
harness_ccm_finops_list  resource_type: "cost_perspective"
```
Search by name: `search_term: "<portfolio-name>"`.

---

## Step 2 — Per-portfolio: YTD spend and budget

Run once per portfolio. Replace `<PORTFOLIO_PERSPECTIVE_ID>` with the actual
perspective UUID, or use a cost-category filter as shown.

```
# Option A — if customer uses per-portfolio perspectives
harness_ccm_finops_list
  resource_type: "cost_summary"
  perspective_id: "<PORTFOLIO_PERSPECTIVE_ID>"
  time_filter: "THIS_YEAR"

# Option B — if customer uses a shared perspective + cost category
harness_ccm_finops_list
  resource_type: "cost_breakdown"
  perspective_id: "<defaultAwsPerspectiveId>"
  business_mapping_name: "<BU_MAPPING>"
  filter_cost_category_value: "<portfolio name>"
  time_filter: "THIS_YEAR"
```

**Fills template fields:** `{{ENG_YTD_SPEND}}`, `{{ENG_BUDGET_USED_PCT}}`
(and equivalent `{{CX_*}}`, `{{DATA_*}}`, `{{SEC_*}}`, `{{CORP_*}}`).

---

## Step 3 — Per-portfolio: open recommendations (waste_pm)

```
harness_ccm_finops_list
  resource_type: "cost_recommendation"
  cost_category_name: "<BU_MAPPING>"
  cost_category_bucket: "<portfolio name>"
  recommendation_state: "OPEN"
  limit: 50
```

Sum `monthlySaving` across all returned items → this is the `waste_pm` for the
portfolio. Repeat for each portfolio.

**Note:** The `waste_pm` values in the template are illustrative placeholders.
Verify against live data and overwrite.

---

## Step 4 — Per-portfolio: applied recommendations (applied_ytd)

The `applied_ytd` figure represents recommendations that have been actioned.
Query:

```
harness_ccm_finops_list
  resource_type: "cost_recommendation"
  cost_category_name: "<BU_MAPPING>"
  cost_category_bucket: "<portfolio name>"
  recommendation_state: "APPLIED"
  limit: 100
```

Sum `monthlySaving` × months-applied-so-far. Many customers also self-track
applied savings in their FinOps record-of-truth — use whichever source the
customer considers authoritative.

---

## Step 5 — Per-portfolio: cost-centre breakdown

The 8-column breakdown table requires per-cost-centre spend. The "cost centre"
dimension varies by customer — confirm with them which dimension to use:

- **Option A — cost centre is a tag:** `group_by: "resource_tag"` with
  `tag_key: "CostCentre"` (or whatever tag the customer uses)
- **Option B — cost centre is a GL code cost category:** use the customer's
  GL-code mapping with `group_by: "cost_category"` + `business_mapping_name: "<gl-code mapping>"`
- **Option C — cost centre is a cloud account:** `group_by: "awsUsageaccountid"`
  (AWS) or `group_by: "gcp_project_id"` (GCP)

Query example for Option A:
```
harness_ccm_finops_list
  resource_type: "cost_breakdown"
  perspective_id: "<PORTFOLIO_PERSPECTIVE_ID>"
  group_by: "resource_tag"
  tag_key: "CostCentre"
  time_filter: "THIS_YEAR"
  limit: 30
```

Each row fills one `breakdown` item in the template:
- `cost_centre` → the tag/GL/account value
- `ytd_spend` → the `cost` field
- `annual_budget` / `forecast_6_6` → **manual from the customer's finance system**
- `recs_pm` / `rec_type` / `est_saving_pm` → from `cost_recommendation` filtered to that CC

**⚠️ Forecast note:** The 6+6 Forecasted Spend column typically comes from a
TBM tool (Apptio, ServiceNow Financial Management, etc.), not Harness CCM. For
v1, paste these values manually. Future: consider a CSV import or webhook.

---

## Step 6 — Fill the template

Open `report-packs/acme/templates/portfolio-monthly.md`.

Replace all `{{...}}` placeholders:

| Placeholder | Source |
|---|---|
| `{{PERIOD}}` | e.g. `FY26 YTD to 31 Jan` |
| `{{DATE}}` | e.g. `January 31, 2026` |
| `{{ENG_YTD_SPEND}}` | Step 2 |
| `{{ENG_BUDGET_USED_PCT}}` | Step 2 |
| `{{ENG_GM}}` | Human — portfolio's GM Sponsor name |
| `{{ENG_CHAMPION}}` | Human — portfolio's Cost Optimisation Champion |
| Insight bullets `{{ENG_REC_1}}` etc. | Human — from Harness recommendations or meeting notes |
| Breakdown table `{{ENG_CC1_*}}` etc. | Steps 3–5 + finance system |
| (same pattern for CX, DATA, SEC, CORP) | — |

Save the filled file to a path of your choosing, e.g.:
```
<output-dir>/<customer>-portfolio-<period>.md
```

---

## Step 7 — Render the report

```
harness_ccm_finops_report_render
  markdown_path: "/absolute/path/to/<customer>-portfolio-<period>.md"
  theme: "acme"
  id: "<customer>-portfolio-<period>"
  label: "<Customer> Portfolio Report · <Period>"
```

A browser tab opens automatically. Use the floating **Edit Source** button in
the bottom-right to make further tweaks live in the browser; ⌘/Ctrl+S saves
back to disk and reloads the preview.

For PDF: click **Export PDF** in the sidebar.

For PowerPoint (image-per-page):
```
harness_ccm_finops_pptx_render
  markdown_path: "/absolute/path/to/<customer>-portfolio-<period>.md"
  theme: "acme"
  slide_size: "A4"
```

> **⚠️ PPTX note:** The `Export PowerPoint` button in the sidebar produces
> editable OOXML slides which do **not** render the bucket grid and portfolio
> detail blocks correctly. Use `harness_ccm_finops_pptx_render` (Paged.js
> path) instead — each rendered page becomes a slide image, preserving the
> theme layout exactly.

---

## Field mapping reference

| Report field | Harness CCM source | Manual source |
|---|---|---|
| Annual Budget (Finance) | — | Customer finance system |
| 6+6 Forecasted Spend | — | Customer TBM tool |
| YTD Spend (Actuals) | `cost_summary.statsValue` | — |
| Budget Used % | Derived: YTD / Annual Budget × 100 | — |
| % Target | Fixed per period (e.g. 58.3% at 7/12 months) | CSM |
| Rec Opportunity p/m (Waste) | `sum(cost_recommendation.monthlySaving)` OPEN | — |
| Applied Opportunities YTD | `sum(cost_recommendation.monthlySaving)` APPLIED | Customer tracking |
| Other Savings YTD | — | Customer self-reported |
| Recommendation Type | `cost_recommendation.resourceType` | — |
| Est Saving p/m | `cost_recommendation.monthlySaving` | — |
| GM Sponsor | — | Customer org chart |
| Champion | — | Customer org chart |
| Insight bullets | FinOps agent + meeting notes | CSM |

---

## Export-format support

| Format | Supported | How |
|---|---|---|
| Browser (themed HTML) | ✅ Full fidelity | `report_render` → browser |
| PDF | ✅ Full fidelity | Export PDF button in browser |
| Paged.js PPTX | ✅ Full fidelity (image slides) | `pptx_render` MCP tool |
| Editable PPTX (sidebar) | ⚠️ Low fidelity | Bucket/detail blocks render as HTML text |
| Word DOCX | ⚠️ Low fidelity | Same as editable PPTX |

---

## Quarterly cadence

1. **Monthly:** Repeat Steps 2–7. Keep the same template; save a new output file per month.
2. **Quarterly:** Run a budget health sweep and update the bucket
   `potential_savings` / `captured_savings` figures based on trailing 3-month actuals.
3. **Annually:** Reset `*_ytd` accumulators and refresh the budget figures from the
   customer's finance system of record.

---

## Adapting this pack for a real customer

Treat this Acme pack as your reference scaffold:

1. **Copy** `report-packs/acme/` to `report-packs/<customer-id>/`.
2. **Theme** — copy `static/themes/acme/` to `static/themes/<customer-id>/`, change the
   `manifest.json` brand fields and the `--c-red*` palette in `theme.css` to the
   customer's brand colours.
3. **Pack metadata** — edit `pack.json` (id, name, theme_id).
4. **Template** — edit `templates/portfolio-monthly.md`: change the five reference
   portfolio names to the customer's real portfolios, change the cost-centre code
   prefixes (e.g. `ENG-001` → customer's actual codes), update placeholder data.
5. **Playbook** — edit this file: replace the reference portfolio names and add any
   customer-specific guidance (e.g. their forecasting tool, their cost-centre
   convention, who owns each portfolio).
6. **Restart the MCP server** — the new pack is auto-discovered.
7. **Verify** — `harness_ccm_finops_packs` should now list both `acme` and your new
   customer pack.
