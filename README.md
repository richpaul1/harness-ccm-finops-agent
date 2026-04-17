# Harness CCM FinOps MCP Server

An MCP (Model Context Protocol) server that gives AI agents full access to the **Harness Cloud Cost Management (CCM)** platform — spend analysis, anomaly detection, budget health, commitment orchestration, AutoStopping, recommendations, and polished report generation.

## What It Does

Connect any MCP-compatible AI agent (Claude, Cursor, Windsurf, etc.) to your Harness CCM account and ask questions in plain language:

> *"Which business units are overspending this month?"*
> *"What caused the AWS cost spike on April 8?"*
> *"Are any of our Reserved Instances under-utilized?"*
> *"Generate a Business Value Review report for Acme Corp."*

The server handles all API calls, chart rendering, and report assembly. The agent just asks the question.

---

## Tools

| Tool | Description |
|------|-------------|
| `harness_ccm_finops_guide` | **Call this first.** Returns the complete 19-section agent guide — calling conventions, all resource types, spike investigation patterns, BVR playbook, and more. The server also sends this as `instructions` on `initialize`. |
| `harness_ccm_finops_list` | List CCM resources with filtering and pagination (`cost_breakdown`, `cost_timeseries`, `cost_budget`, `cost_recommendation`, etc.) |
| `harness_ccm_finops_get` | Get a single CCM resource by ID |
| `harness_ccm_finops_describe` | Discover available resource types, supported operations, and filter fields — no API call |
| `harness_ccm_finops_chart` | Render a bar or line chart PNG from cost data. Returns inline image. |
| `harness_ccm_finops_json` | Parse CCM JSON into a normalized chart spec for `harness_ccm_finops_chart` |
| `harness_ccm_finops_cost_category_chart` | Grouped-bar PNG comparing cost by cost category across two consecutive time windows |
| `harness_ccm_finops_budget_health` | One-call budget risk sweep — returns `over_budget`, `at_risk`, and `on_track` groups pre-classified |
| `harness_ccm_finops_maturity_chart` | Render a FinOps Maturity spider chart (Crawl / Walk / Run) from per-dimension scores |
| `harness_ccm_finops_report_render` | Register a markdown file with the in-process report renderer, auto-open in browser. User picks theme and exports PDF. |
| `markdown_to_pdf` | Convert a markdown file directly to PDF (no browser needed) |

---

## CCM Resource Types

All resource types are accessed via `harness_ccm_finops_list` / `harness_ccm_finops_get`. Pass `resource_type` to select:

| Category | Resource Types |
|---|---|
| **Cost Analysis** | `cost_breakdown`, `cost_timeseries`, `cost_summary`, `cost_overview`, `cost_metadata` |
| **Perspectives** | `cost_perspective`, `cost_perspective_folder`, `cost_filter_value` |
| **Cost Categories** | `cost_category` |
| **Budgets** | `cost_budget` |
| **Anomalies** | `cost_anomaly`, `cost_anomaly_summary`, `cost_ignored_anomaly` |
| **Recommendations** | `cost_recommendation`, `cost_recommendation_stats` |
| **Commitment Orchestration** | `cost_commitment_summary`, `cost_commitment_coverage`, `cost_commitment_savings`, `cost_commitment_utilisation`, `cost_commitment_analysis`, `cost_commitment_savings_overview`, `cost_commitment_filters`, `cost_commitment_accounts` |
| **AutoStopping** | `cost_autostopping_rule`, `cost_autostopping_savings`, `cost_autostopping_savings_cumulative`, `cost_autostopping_logs`, `cost_autostopping_schedule` |

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/richpaul1/harness-ccm-finops-agent.git
cd harness-ccm-finops-agent
pnpm install
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env — set HARNESS_ACCOUNT_ID and at least one of HARNESS_API_KEY or HARNESS_BEARER_TOKEN
```

### 3. Build and run

```bash
pnpm build

# HTTP mode (recommended — report renderer shares the same port)
pnpm start:http

# Stdio mode (for Claude Desktop, Cursor, Windsurf)
pnpm start
```

### 4. (Optional) PDF export

PDF export via the browser's **Export PDF** button requires Playwright + Chromium:

```bash
npx playwright install chromium
```

---

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HARNESS_API_KEY` | No* | — | Harness personal access token or service account token (`pat.<accountId>.<tokenId>.<secret>`). Required for non-CCM APIs. |
| `HARNESS_BEARER_TOKEN` | No* | — | Browser session JWT for CCM `/ccm/*` endpoints. Alternative to PAT for CCM-only access. |
| `HARNESS_ACCOUNT_ID` | Yes | *(from PAT)* | Account identifier. Auto-extracted from PAT tokens; required when using a bearer token. |
| `HARNESS_BASE_URL` | No | `https://app.harness.io` | Override for self-managed Harness. |
| `PORT` | No | `3000` | HTTP transport port. |
| `HARNESS_DEFAULT_ORG_ID` | No | `default` | Default org identifier. |
| `HARNESS_API_TIMEOUT_MS` | No | `30000` | HTTP request timeout (ms). |
| `HARNESS_MAX_RETRIES` | No | `3` | Retries for transient failures (429, 5xx). |
| `LOG_LEVEL` | No | `info` | `debug` \| `info` \| `warn` \| `error`. All logs go to stderr only. |
| `HARNESS_LOG_REQUEST_FILE` | No | — | If set, logs every outbound HTTP request to this file path (useful for debugging). |

\* At least one of `HARNESS_API_KEY` or `HARNESS_BEARER_TOKEN` must be provided.

---

## Client Configuration

### Cursor (`.cursor/mcp.json`) — HTTP mode

```json
{
  "mcpServers": {
    "user-finops": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

Start the server first with `pnpm start:http`, then connect Cursor.

### Claude Desktop (`claude_desktop_config.json`) — stdio mode

```json
{
  "mcpServers": {
    "harness-finops": {
      "command": "node",
      "args": ["/absolute/path/to/harness-ccm-finops-agent/build/index.js", "stdio"],
      "env": {
        "HARNESS_API_KEY": "pat.xxx.xxx.xxx",
        "HARNESS_ACCOUNT_ID": "your-account-id"
      }
    }
  }
}
```

### HTTP health check and manual session

```bash
# Health check
curl http://localhost:3000/health

# Initialize an MCP session
curl -i -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}'
```

---

## Report Renderer

The server includes an **in-process report renderer** that converts markdown files into themed, interactive HTML documents with one-click PDF export.

### Usage

1. Query CCM data and generate chart PNGs using `harness_ccm_finops_chart` or `harness_ccm_finops_maturity_chart`
2. Write a markdown report with YAML frontmatter (see below)
3. Call `harness_ccm_finops_report_render` with the absolute path to the markdown file

```json
{
  "markdown_path": "/absolute/path/to/report.md",
  "id": "acme-q1-bvr",
  "label": "Acme Q1 FY26 BVR",
  "theme": "harness",
  "open_in_browser": true
}
```

The tool returns a live URL and auto-opens the browser. Switch themes via the sidebar dropdown. Click **Export PDF** to download.

### Markdown frontmatter

```yaml
---
title: Amazon SageMaker Spend Analysis
subtitle: Cost deep-dive · Mar 17 – Apr 16, 2026
customer: Acme Corp
date: April 16, 2026
author: Harness CCM FinOps Agent
classification: Confidential
---
```

### Supported callout blocks

```markdown
::: critical High spend concentration
93% of SageMaker spend is in a single account.
:::

::: success Optimization in progress
Three rightsizing recommendations applied this month.
:::

::: metrics
- label: 30-Day Total
  value: $1,471,113
  trend: +15.8% vs prior period
  tone: risk
:::
```

Callout types: `critical`, `risk`, `warning`, `success`, `info`, `action`, `quote`.

Charts are referenced as standard markdown images. Image paths resolve relative to the markdown file's directory — copy or `output_path` charts into the same folder.

### Themes

| Theme | Feel | Best for |
|---|---|---|
| `harness` | Corporate executive, navy + amber | Customer-facing BVRs |
| `modern` | Editorial, near-black + coral | Internal or bold designs |
| `glass` | Adaptive liquid-glass | High-visual-impact presentations |
| `kinetic` | Scrollytelling + motion | Interactive web viewing |

---

## FinOps Agent Guide

Call `harness_ccm_finops_guide` (no parameters) at the start of any session. It loads the full 19-section protocol into the agent's context:

| Sections | Covers |
|---|---|
| 1–5 | Bootstrap (`cost_metadata`), perspective resolution, cost categories, AWS filtering, chart rules |
| 6–7 | Cost spike investigation pattern, anomaly triage three-step pattern |
| 8–11 | Recommendations, budgets, budget health sweep, perspective folders |
| 12–13 | All `group_by` dimensions and time filter presets |
| 14–15 | Commitment Orchestration (RI & Savings Plans), AutoStopping |
| 16 | Example prompts for common FinOps workflows |
| 17–18 | FinOps Maturity chart, Report Renderer reference |
| 19 | Full BVR (Business Value Review) playbook with per-section agent queries |

The guide is also returned automatically via the MCP `instructions` field on `initialize`, so MCP clients that surface server instructions will display it without an explicit tool call.

---

## Development

```bash
# Build (TypeScript + copy static assets)
pnpm build

# Watch mode with auto-restart
pnpm dev

# Type check only
pnpm typecheck

# Tests
pnpm test

# Interactive MCP Inspector
pnpm inspect
```

### Project Structure

```
src/
  index.ts                          # Server entrypoint, HTTP + stdio transport
  config.ts                         # Env var validation (Zod)
  client/
    harness-client.ts               # HTTP client (auth, retry, rate limiting)
  registry/
    index.ts                        # Registry class + dispatch logic
    extractors.ts                   # Response extractors for CCM API shapes
    toolsets/
      ccm.ts                        # All CCM resource definitions
  tools/
    harness-list.ts                 # harness_ccm_finops_list
    harness-get.ts                  # harness_ccm_finops_get
    harness-describe.ts             # harness_ccm_finops_describe
    harness-ccm-chart.ts            # harness_ccm_finops_chart
    harness-ccm-json.ts             # harness_ccm_finops_json
    harness-ccm-cost-category-period-chart.ts  # harness_ccm_finops_cost_category_chart
    harness-ccm-budget-health.ts    # harness_ccm_finops_budget_health
    harness-ccm-maturity-chart.ts   # harness_ccm_finops_maturity_chart
    harness-ccm-report-render.ts    # harness_ccm_finops_report_render
    harness-ccm-guide.ts            # harness_ccm_finops_guide
    markdown-to-pdf.ts              # markdown_to_pdf
  report-renderer/
    index.ts                        # Multi-document registry + Express routes
    render.ts                       # Markdown → HTML pipeline (markdown-it + plugins)
    pdf.ts                          # Playwright PDF export
    themes.ts                       # Theme discovery and resolution
    plugins/
      callouts.ts                   # :::critical / :::success / etc.
      metric-cards.ts               # ::: metrics grid blocks
    static/
      themes/                       # harness / modern / glass / kinetic
        <theme>/
          manifest.json
          template.js               # Server-side HTML shell renderer
          app.js                    # Client-side JS (TOC scrollspy, PDF export)
          theme.css                 # Typography and document styles
          web.css                   # Web app chrome (sidebar, header)
          print.css                 # Paged media / PDF styles
      public/
        theme-switch.js             # Theme dropdown client logic
  docs/
    finops-guide.md                 # Combined 19-section agent guide source
  utils/
    logger.ts                       # stderr-only structured logger
    errors.ts                       # Error normalization
    rate-limiter.ts                 # Client-side rate limiting
tests/                              # Vitest unit tests
```

---

## Architecture

```
  AI Agent (Claude / Cursor / Windsurf / etc.)
         │  MCP (stdio or HTTP)
  ┌──────▼──────────────────────────────────────┐
  │  harness-ccm-finops-agent  (port 3000)      │
  │                                             │
  │  MCP Tools  (harness_ccm_finops_*)          │
  │       │                                     │
  │  Registry  (CCM resource types)             │
  │       │                                     │
  │  HarnessClient  ─────────► Harness CCM API  │
  │                                             │
  │  Report Renderer  (/reports/*)              │
  │  Chart Engine  (PNG via @napi-rs/canvas)    │
  └─────────────────────────────────────────────┘
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `cost_breakdown` returns no data | `perspective_id` missing | Always pass `perspective_id`; get it from `cost_metadata` or the `cost_perspective` list |
| AWS breakdowns show "No Service" with extreme trends | RI/SP billing artifacts included | Add `filter_aws_line_item_type: "Usage"` to every AWS service-level query |
| Report renders HTTP 500 | Static assets not built | Run `pnpm build` to copy theme files into `build/` |
| Report 404 after server restart | In-memory renderer registry cleared | Re-call `harness_ccm_finops_report_render` to re-register |
| PDF export fails | Playwright Chromium not installed | Run `npx playwright install chromium` |
| `HARNESS_ACCOUNT_ID is required` | API key is not a PAT | Set `HARNESS_ACCOUNT_ID` explicitly in env or `.env` |
| CCM queries return 401 | Bearer token expired | Refresh `HARNESS_BEARER_TOKEN` from your browser session |

---

## License

Apache 2.0
