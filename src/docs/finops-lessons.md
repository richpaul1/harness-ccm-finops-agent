# FinOps Fluency — Lesson Generation Playbook

A specification for building **data-driven, customer-personalised FinOps training** on top
of the Harness CCM FinOps MCP. Every lesson is generated from the customer's **live cloud
bill** and rendered as a standalone, themable, deep-linkable report via
`harness_ccm_finops_report_render`.

This playbook is the source of truth for *how* the curriculum is built. Follow it to
generate the full 7-lesson set for a new customer, or to produce a single refreshed lesson
on demand.

---

## 1. What makes a lesson work

Every lesson in this curriculum obeys the same five-beat teaching rhythm:

| Beat | Purpose | Typical tool output |
|:---|:---|:---|
| **Hook** | One surprising number from their own bill | `cost_summary` + metric cards |
| **Zoom** | Break that number down one level | `cost_breakdown` + bar chart |
| **Reveal** | Show the counter-intuitive thing or gotcha | Callout + filtered breakdown |
| **Pattern** | Name the concept in one line | `:::success` callout |
| **Practice** | Give a concrete follow-up query | `:::action` callout |

If a section doesn't serve one of those beats, cut it. Length is the enemy.

---

## 2. Universal lesson anatomy

Every lesson file follows this skeleton. Only the **data-bearing blocks** (metric values,
chart PNGs, table rows, "Your turn" prompts) change between lessons.

```text
finops-training/
└── lesson-<NN>-<slug>/
    ├── lesson.md                       ← YAML frontmatter + body
    └── assets/
        ├── 01_<concept>.png            ← chart 1
        ├── 02_<concept>.png            ← chart 2
        └── …                           ← 3–5 charts total
```

### 2.1 YAML frontmatter (the cover page)

```yaml
---
title: <One-line promise — e.g. "Where does your cloud money actually go?">
subtitle: Lesson <NN> — <subtitle>
customer: FinOps Fluency · Module <NN> · <Pillar>
docType: Interactive Training · Lesson <NN> of 07
date: <Month DD, YYYY>
author: Harness CCM FinOps Agent
classification: Training · Built from your live data
---
```

- **`customer`** is repurposed from a BVR field — in the training context it becomes the
  curriculum breadcrumb.
- **`classification`** always ends with "Built from your live data" — sets the promise.

### 2.2 Body structure (always in this order)

```markdown
## Welcome to FinOps Fluency
[2–3 sentences on why this lesson matters, 5 concrete learning outcomes as a numbered list]

::: info How to use this lesson
[1 paragraph on how to read it — always identical across lessons]
:::

---

## Chapter 1 — <Hook heading>
[Opening metric cards (`::: metrics` block) — usually 3–4 cards]
![<Chart 1 alt>](assets/01_<slug>.png)

### Concept 1 — <One-line naming of the concept>
[1–2 paragraphs]

::: success Key idea — <snappy name>
[1-sentence principle worth remembering]
:::

::: warning <Gotcha title>   ← OPTIONAL, only if there's a real trap
[1 paragraph on the trap]
:::

---

## Chapter 2 — <Zoom heading>
[Chart + data table with 6–8 rows of real numbers]

### Concept 2 — <Name>
[The Pareto / the 80-20 / the shape observation]

::: critical <Strongest signal from the data>
[The one number that warrants action — a spike, a gap, a risk]
:::

---

## Chapter 3 — <Parallel / counter-example>
[Often: same analysis on a different cloud or BU, showing the shape is universal]

---

## Chapter 4 — <The "hidden" thing>
[The concept every newcomer gets wrong — decode it here]

::: info A great mental model
[An analogy — bill as restaurant receipt, RIs as gym membership, etc.]
:::

---

## Chapter 5 — <Time-series / evolution>
[Daily chart. Always teach data lag here.]

::: warning Watch for data lag
[Always include — the last day is partial, trust days ≥ 36h in the past]
:::

---

## The five concepts — cheat sheet
| # | Concept | Why it matters |
|--:|:---|:---|
| 1 | **<name>** | <1-line> |
| … |            |          |

---

## Your turn — three prompts to try next

::: action 1. <Verb-led title>
"<Exact prompt the student can copy-paste into the agent>"
:::

::: action 2. <Verb-led title>
"<Exact prompt>"
:::

::: action 3. <Verb-led title>
"<Exact prompt>"
:::

---

## What's next in the curriculum
| # | Lesson | You'll learn |
|--:|:---|:---|
[The same 7-row curriculum table in every lesson]

::: info How to request the next lesson
Just ask: *"Start Lesson <NN+1> — <what it teaches> using my live data."*
:::

---
*End of Lesson <NN>. Built from your live CCM data on <date>.*
```

### 2.3 Callout vocabulary

The training reuses the report renderer's callouts with a **consistent semantic meaning**
across every lesson. Don't improvise new meanings.

| Callout | When to use it | Tone |
|:---|:---|:---|
| `:::info` | "How to use this lesson" / mental models / analogies | Calm, explanatory |
| `:::success` | **Key concept** — the thing they must remember | Principle stated plainly |
| `:::critical` | The single biggest signal in their data — action needed | Red flag, named |
| `:::warning` | A gotcha / trap / common mistake | Preventive, specific |
| `:::action` | "Your turn" prompts — exact copy-paste queries | Verb-led imperative |
| `:::risk` | Reserved for allocation / accountability lessons | Use sparingly |

Each lesson should have **exactly one `:::action` block per "Your turn" prompt**
(usually 3) and **no more than 2 `:::critical` blocks total**. Over-use dulls them.

### 2.4 Metric card tones

```markdown
::: metrics
- label: <3–4 word label>
  value: <primary number — $ or %>
  trend: <secondary fact — "+18% vs prior 30d">
  tone: success | risk | warning | info | critical
:::
```

Tone selection rule:

- `success` — green zone, at or better than benchmark
- `warning` — drift, but not yet alarming
- `risk` — forecast to miss or already approaching a threshold
- `critical` — already past threshold or extreme deviation
- `info` — neutral context number (no judgement)

### 2.5 Chart conventions

- **Always `chart_size: "large"`** (1920×1080) — it's what the renderer expects for print.
- **Always write to the lesson's own `assets/` directory** with an **absolute path**.
- **File naming:** `NN_<concept-slug>.png` (e.g. `02_aws_services.png`). The numeric
  prefix preserves chapter order in the file tree.
- **Chart kind:**
  - `bar` for any breakdown (services, accounts, BUs, months)
  - `line` for daily / weekly / monthly time-series
  - `grouped_bar` for period comparisons (current vs previous, budget vs actual)
- **Alt text is the chart title** — no "Image of…" prefixes.
- **Keep each chart to ≤ 8 categories** — chart down to the top N, put the long tail in
  a follow-up table if needed. Readability beats completeness.

---

## 3. How to generate a lesson — step by step

This is the repeatable recipe. Run it sequentially; steps 3 and 4 can be parallelised.

### Step 0 — Bootstrap (always)

```json
{ "tool": "harness_ccm_finops_list", "resource_type": "cost_metadata" }
```

Capture: which clouds are connected, the default perspective IDs, currency symbol.
Skip any cloud where `*ConnectorsPresent: false` for the rest of the flow.

### Step 1 — Discover customer structure

For lessons that need allocation / BU context (mostly Lesson 02, 05, 06):

```json
{ "tool": "harness_ccm_finops_list", "resource_type": "cost_category" }
{ "tool": "harness_ccm_finops_list", "resource_type": "cost_perspective", "limit": 50 }
```

Pick the primary BU cost-category mapping (usually "Business Units" / "Business Domains" /
"Cost Centers") — substitute as `<BU_MAPPING>` everywhere below.

### Step 2 — Pull the lesson's data

Each lesson (§5) lists its exact queries. Always:

- Use `time_filter: "LAST_30_DAYS"` unless the lesson specifies otherwise
- Add `filter_aws_line_item_type: "Usage"` for **every** AWS service/account breakdown
- Set `compact: false` on `cost_breakdown` to get `cost` and `costTrend` fields
- Label the time window consistently — the renderer shows "Mar 19 – Apr 18", not "30d"

### Step 3 — Create the lesson directory

```bash
mkdir -p /<workspace>/finops-training/lesson-<NN>-<slug>/assets
```

Workspace-absolute paths are mandatory (see §2.5).

### Step 4 — Generate charts

For each chart, call `harness_ccm_finops_chart` with:

```json
{
  "chart_spec": { "kind": "bar|line|grouped_bar", "title": "…", "y_label": "…",
                  "points": [ … ] },
  "chart_size": "large",
  "output_path": "/<abs>/finops-training/lesson-<NN>-<slug>/assets/NN_<slug>.png"
}
```

Build all charts in **one parallel tool-call batch** where possible.

### Step 5 — Author `lesson.md`

Follow §2.2 exactly. Every `[bracket-placeholder]` in the template must be replaced with
a **real number from this customer's data** or a **real named entity from this customer's
account** (service name, account name, BU name). No synthetic examples. No "Acme Corp".

### Step 6 — Render

```json
{
  "tool": "harness_ccm_finops_report_render",
  "markdown_path": "/<abs>/finops-training/lesson-<NN>-<slug>/lesson.md",
  "theme": "kinetic",
  "id": "<customer>-finops-fluency-lesson-<NN>",
  "label": "FinOps Fluency · Lesson <NN> · <Pillar>",
  "open_in_browser": true
}
```

- **`id` is the curriculum anchor.** Use `<customer>-finops-fluency-lesson-<NN>` so every
  lesson in the set is consistently addressable (e.g. `acme-finops-fluency-lesson-03`).
- **Default theme is `kinetic`** for training — loudest, most playful. The user can
  switch to `harness` for a classroom setting via the sidebar.

### Step 7 — Hand off

Return the `url` plus the 3 "Your turn" prompts from §2.2 as a bulleted list the user can
copy straight into a fresh chat.

---

## 4. Customer discovery — what to ask before you start

Before generating the first lesson for a new customer, resolve these five questions using
the agent. None require touching the customer — everything comes from MCP queries.

| Question | Resolved via |
|:---|:---|
| Which clouds are connected? | `cost_metadata` |
| What is this account's **primary BU mapping**? | `cost_category` list → pick the one with the most buckets covering active spend |
| What is **typical monthly spend**? (sets the narrative scale) | `cost_summary` per cloud |
| Is there a **standout trend** (a spike, a new service)? | `cost_breakdown` + `costTrend` inspection |
| Does the account have **Commitment Orchestration** / **AutoStopping** data? | `cost_commitment_accounts`, `cost_autostopping_rule` |

The answers to 3–5 feed the **Hook** of Lesson 01 and determine which later lessons have
enough data to be worth generating (e.g. skip Lesson 03 if CO is inactive — upgrade path
gets covered in Lesson 07 instead).

---

## 5. The curriculum — per-lesson specification

Seven lessons. Each one is ~10 minutes of reading, built from live data, and ends with a
prompt that seeds the next lesson.

### Lesson 01 — Visibility: *Where does your cloud money actually go?*

> **Pillar:** Inform · **Maturity stage:** 1 (Crawl) → 2 (Walk)
> **Prereq:** None — this is the entry point.

**Core concept:** A cloud bill is a **shape**, not a single number. `group_by` is the
primary analytical tool.

**Five concepts taught:**
1. Shape beats total (split by provider)
2. Pareto is real (top services = 50–60% of spend)
3. Billing artifacts lie ("No Service", filter to Usage)
4. Read the formula (SavingsPlanCoveredUsage + Negation = 0)
5. Trends live in daily data (total → direction → timing)

**Queries:**
```
# Totals per cloud (one call per connected cloud)
cost_summary · perspective_id: <defaultAws|Azure|Gcp|Cluster> · time_filter: LAST_30_DAYS

# Service breakdowns
cost_breakdown · perspective: AWS · group_by: awsServicecode · LAST_30_DAYS ·
                filter_aws_line_item_type: "Usage" · limit: 8 · compact: false
cost_breakdown · perspective: Azure · group_by: product · LAST_30_DAYS · limit: 8

# Line item decomposition (AWS teaching moment)
cost_breakdown · perspective: AWS · group_by: awsLineItemType · LAST_30_DAYS · compact: false

# Daily trend
cost_timeseries · perspective: AWS · group_by: cloudProvider · LAST_30_DAYS ·
                 time_resolution: DAY · filter_aws_line_item_type: "Usage"
```

**Charts (5):**
1. `01_cloud_mix.png` — bar: spend per connected cloud
2. `02_<cloud>_services.png` — bar: top 8 services on biggest cloud
3. `03_<other-cloud>_services.png` — bar: top 8 services on 2nd cloud
4. `04_<biggest-cloud>_daily_trend.png` — line: daily spend over 30 days
5. `05_aws_line_items.png` — bar: line item type decomposition (AWS only — skip if AWS absent)

**"Your turn" prompts:**
1. Deep-dive on the biggest growing service
2. Show Savings Plan coverage & utilization
3. Break total spend by BU cost category (bridge to Lesson 02)

---

### Lesson 02 — Allocation: *Who owns this dollar?*

> **Pillar:** Inform · **Maturity stage:** 2 (Walk) → 3 (Run)
> **Prereq:** Lesson 01 or equivalent comfort with `group_by`.

**Core concept:** Every cloud dollar has an owner, but most organisations don't know who
owns 20–40% of theirs. **Cost categories** are how you fix that.

**Five concepts taught:**
1. Tags → cost categories → perspectives: the allocation pipeline
2. Allocated vs Unattributed — the headline metric
3. Why the gap exists (missing tags, shared infra, untagged legacy)
4. Named BU leaderboard — who owns the biggest slice
5. Chargeback vs Showback — what each enables

**Queries:**
```
# List available BU mappings, pick the primary one
cost_category (list)

# Allocation % per cloud
cost_breakdown · perspective: <cloud> · group_by: cost_category ·
                business_mapping_name: "<BU_MAPPING>" · LAST_30_DAYS
# → find "Unattributed" row, compute %

# Trend of unallocated over time
cost_timeseries · perspective: <cloud> · group_by: cost_category ·
                 business_mapping_name: "<BU_MAPPING>" · time_filter: LAST_3_MONTHS ·
                 time_resolution: MONTH

# Top BU drill
cost_breakdown · perspective: <cloud> · business_mapping_name: "<BU_MAPPING>" ·
                filter_cost_category_value: "<top-BU>" · group_by: awsServicecode
```

**Charts (4):**
1. `01_allocation_donut.png` — bar (sorted): BU buckets + "Unattributed" clearly labelled
2. `02_allocation_trend.png` — line: % allocated over last 3 months
3. `03_top_bus.png` — bar: top 5 BUs by spend with trend %
4. `04_top_bu_drill.png` — bar: what the #1 BU actually spends on (services)

**"Your turn" prompts:**
1. Investigate one specific Unattributed source
2. Pull open recommendations for the top BU (bridge to Lesson 05)
3. Show budget health filtered to the top BU (bridge to Lesson 06)

---

### Lesson 03 — Commitments: *The art of paying less for what you're already using*

> **Pillar:** Optimize · **Maturity stage:** 2 → 3
> **Prereq:** AWS data. Skip if AWS is not connected.
> **Fallback:** If the customer has no Commitment Orchestration data, lesson becomes
> "Why you should turn it on" — built from the on-demand spend they *could* be covering.

**Core concept:** RIs and Savings Plans are **contracts** that trade flexibility for
discount. The three metrics that matter are **coverage**, **utilization**, and
**managed share**.

**Five concepts taught:**
1. On-demand = full price, commitments = ~30–60% off
2. Coverage % (how much of Usage is under a contract)
3. Utilization % (is the contract actually being used)
4. Managed vs Unmanaged (how much is under Harness vs manual)
5. Service gap: EC2 usually covered, RDS/ElastiCache usually not

**Queries:**
```
# Big picture
cost_commitment_summary · last 90 days
cost_commitment_savings_overview · last 90 days (overall)

# Per service — at minimum EC2, RDS, ElastiCache
cost_commitment_savings_overview · service: "Amazon Elastic Compute Cloud - Compute"
cost_commitment_savings_overview · service: "Amazon Relational Database Service"
cost_commitment_savings_overview · service: "Amazon ElastiCache"

# Daily coverage & utilization
cost_commitment_coverage · group_by: "Commitment Type" · last 30 days
cost_commitment_utilisation · last 30 days

# On-demand exposure per service
cost_commitment_analysis · service: RDS · net_amortized: true · last 30 days
```

**Charts (4):**
1. `01_coverage_split.png` — bar: OnDemand / RI / SP cost split
2. `02_coverage_daily.png` — line: daily coverage % over 30 days
3. `03_utilization.png` — line: RI utilization % vs 80% benchmark
4. `04_service_gap.png` — grouped_bar: EC2 vs RDS vs ElastiCache — managed savings

**"Your turn" prompts:**
1. Quantify RDS RI opportunity (on-demand × ~40%)
2. Identify under-utilized RIs to right-size first
3. Show which payer accounts don't have CO enabled

---

### Lesson 04 — Anomalies: *Knowing when things change*

> **Pillar:** Optimize · **Maturity stage:** 2 → 3
> **Prereq:** Lesson 01 (daily trend literacy).

**Core concept:** You cannot optimise what you don't notice. Anomaly detection catches
drift between budget reviews.

**Five concepts taught:**
1. What is an anomaly (actual vs expected, not just high)
2. The three-step investigation pattern (summary → drill → detail)
3. Criticality — not every anomaly is worth chasing
4. One-off vs persistent anomalies (fix vs investigate)
5. Feedback loop — marking false positives trains the model

**Queries:**
```
# Step 1 — summary
cost_anomaly_summary · perspective: <primary> · time_filter: LAST_30_DAYS

# Step 2 — drill into the peak day
cost_anomaly · perspective: <primary> · anomaly_start_ms/end_ms: <peak day> ·
             order_by: ANOMALOUS_SPEND · limit: 10

# Step 3 — pick the top anomaly, fetch full detail
cost_anomaly (get) · resource_id: <top anomaly id>

# Cross-reference daily context
cost_timeseries · same perspective · same group_by as the anomaly
```

**Charts (3):**
1. `01_anomaly_calendar.png` — line: anomaly count per day over 30 days
2. `02_top_anomalies.png` — bar: top 10 anomalies by anomalous spend
3. `03_context_trend.png` — line: daily cost of the top anomaly's dimension over 2 weeks

**"Your turn" prompts:**
1. Explain one specific anomaly with full detail
2. Wire up anomaly alerts for the top-spend perspective
3. Review false positives in the last 30 days

---

### Lesson 05 — Right-sizing: *Paying only for what you actually use*

> **Pillar:** Optimize · **Maturity stage:** 2 → 3
> **Prereq:** Lesson 02 (recommendations are more useful when allocated).

**Core concept:** Most workloads are provisioned for peak. Right-sizing + idle
shutdown reclaims the 30–50% gap between provisioned and utilised.

**Five concepts taught:**
1. Recommendation types (EC2, VM, workload, governance)
2. The opportunity stack — sort by `monthlySaving` desc
3. AutoStopping — shutdown what's not used
4. Cluster optimisation — spot, bin packing, VPA
5. Action rate — recommendations ignored = money left on the table

**Queries:**
```
# All open recommendations
cost_recommendation · state: OPEN · limit: 100

# By type
cost_recommendation · resource_type_filter: EC2_INSTANCE
cost_recommendation · resource_type_filter: WORKLOAD
cost_recommendation · resource_type_filter: GOVERNANCE

# AutoStopping
cost_autostopping_savings_cumulative · last 30 days
cost_autostopping_rule (list)
```

**Charts (4):**
1. `01_rec_backlog.png` — bar: open monthly savings by resource type
2. `02_top_recs.png` — bar: top 10 individual recommendations by monthlySaving
3. `03_autostopping_daily.png` — line: AutoStopping savings per day
4. `04_rec_by_bu.png` — bar: open savings per BU (uses cost_category on recs)

**"Your turn" prompts:**
1. Drill into the #1 recommendation
2. Expand AutoStopping to an uncovered BU
3. Pitch one governance rule to the top offender

---

### Lesson 06 — Budgets & Forecasts: *Talking to finance*

> **Pillar:** Operate · **Maturity stage:** 3 → 4
> **Prereq:** Lesson 02 (budgets without allocation are guesses).

**Core concept:** Budgets turn FinOps from engineering trivia into a business
conversation. The three states are *on track*, *at risk*, and *already over*.

**Five concepts taught:**
1. Budget = perspective + time period + amount + alerts
2. Variance — actual vs budgeted, positive = over
3. Forecast — the agent's projection, not a guarantee
4. Alert thresholds — 50/80/100% is the classic ladder
5. FY alignment — monthly budgets roll up into annual savings baselines

**Queries:**
```
# Health sweep — classifies everything in one call
harness_ccm_finops_budget_health

# Pick the most at-risk budget — monthly detail
cost_budget (get) · resource_id: <at-risk budget id>

# FY context
cost_timeseries · perspective matching the budget · time_filter: LAST_12_MONTHS ·
                 time_resolution: MONTH
```

**Charts (3):**
1. `01_budget_classification.png` — bar: count in each state (on_track / at_risk / over)
2. `02_at_risk_detail.png` — grouped_bar: budgeted vs actual vs forecast for at-risk
3. `03_fy_trend.png` — line: 12 months of actuals with budget overlay

**"Your turn" prompts:**
1. Investigate what's driving the top at-risk budget
2. Set a budget on a currently-uncovered perspective
3. Forecast end-of-FY spend for the primary perspective

---

### Lesson 07 — Maturity: *Where are we, really?*

> **Pillar:** All three (Inform / Optimize / Operate) · **Maturity stage:** self-assessment
> **Prereq:** All previous lessons — this is the capstone.

**Core concept:** FinOps maturity is a 7-dimensional measurement, not a single score.
Where you are across each dimension determines what you invest in next quarter.

**Five concepts taught:**
1. The 7 dimensions (see §17 of the agent guide)
2. Crawl / Walk / Run — 1, 2, 3 scoring
3. The three pillars — Inform, Optimize, Operate
4. Evidence-driven scoring — pull data, don't guess
5. The next-step tree — what unlocks the next level

**Queries:** synthesis of data collected across Lessons 01–06, plus:

```
# Evidence for each dimension (see §17 scoring rubric)
cost_perspective (visibility)
cost_breakdown grouped by cost_category (allocation)
cost_commitment_summary (commitment strategy)
cost_anomaly_summary + cost_budget (anomaly detection)
cost_autostopping_savings_cumulative + cost_recommendation (optimization)
# Accountability inferred from allocation + cost categories
# Tooling inferred from engagement cadence
```

**Charts (2):**
1. `01_maturity_spider.png` — use `harness_ccm_finops_maturity_chart` directly
2. `02_next_steps_tree.png` — optional grouped_bar: current vs target per dimension

**"Your turn" prompts:**
1. Pick one dimension and build a 90-day plan to reach the next level
2. Schedule a BVR using `harness_ccm_finops_report_render`
3. Re-run Lesson 01 in 90 days and compare the numbers

---

## 6. Authoring rules — do / don't

### Do

- Use the **customer's own numbers** in every callout, every metric card, every concept sentence.
- Name **actual entities** from their account (service names, account names, BU names).
- Keep each chapter to **one chart, one table, one concept** — never two of anything.
- Write in **second person** ("your bill", "your top service") — the student is the subject.
- Use **specific trend verbs**: "grew 31%", "shrank 4%", "flat at $1,000". Avoid "increased" / "decreased" alone.
- End every lesson with **three concrete "Your turn" prompts** that bridge to later lessons.

### Don't

- Invent numbers or use placeholders.
- Cite "industry averages" — teach from their data, not ours.
- Use more than **5 charts per lesson**. Four is usually better.
- Stack callouts. One `:::success` per chapter, max.
- Repeat the curriculum-next-steps table in a different format each lesson. It's identical.
- Forget `filter_aws_line_item_type: "Usage"` on AWS service breakdowns. Ever.

---

## 7. Triggering the curriculum — the user-facing prompts

Give the customer these verbatim. They work because each prompt maps to a lesson spec in §5.

| Prompt | Triggers |
|:---|:---|
| *"Start FinOps Fluency — teach me Lesson 01 using my live data."* | Generate Lesson 01 |
| *"Continue — Lesson 02, cost allocation."* | Generate Lesson 02 |
| *"Lesson 03 — commitment strategy."* | Generate Lesson 03 |
| *"Lesson 04 — anomalies and drift detection."* | Generate Lesson 04 |
| *"Lesson 05 — right-sizing and idle resources."* | Generate Lesson 05 |
| *"Lesson 06 — budgets and forecasts."* | Generate Lesson 06 |
| *"Lesson 07 — assess our FinOps maturity."* | Generate Lesson 07 + spider chart |
| *"Generate the full FinOps Fluency curriculum (01–07) for this account."* | All seven in sequence |

For the final "all seven" variant, run sequentially (not in parallel) — each lesson's
data pull informs the narrative for the next, and the MCP renderer registers reports by
`id` so the lessons all become deep-linkable from a single index page at
`http://localhost:3000/reports/`.

---

## 8. File layout for a generated curriculum

After generating the full curriculum for a customer, the tree looks like:

```text
finops-training/
├── LESSON_PLAYBOOK.md                 ← this file (source of truth)
├── lesson-01-where-does-money-go/
│   ├── lesson.md
│   └── assets/ (5 PNGs)
├── lesson-02-who-owns-this-dollar/
│   ├── lesson.md
│   └── assets/ (4 PNGs)
├── lesson-03-paying-less/
├── lesson-04-knowing-when-things-change/
├── lesson-05-right-sizing/
├── lesson-06-talking-to-finance/
└── lesson-07-where-are-we-really/
```

Each `lesson.md` is self-contained and can be re-rendered at any time by calling
`harness_ccm_finops_report_render` with its path. The registry in the MCP server is
idempotent on `markdown_path` + `id`, so re-running after a data refresh simply
replaces the content at the same URL.

---

## 9. Change log

- **v1.0 (Apr 18, 2026)** — Initial playbook, extracted from Lesson 01 as the reference
  implementation.
