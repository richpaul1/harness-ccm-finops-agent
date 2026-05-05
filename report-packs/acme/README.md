# Acme Corp — Reference Report Pack

A **reference Customer Report Pack** for the Harness CCM FinOps Agent. Acme Corp
is a fictional company; this pack exists as a working example you can clone and
tailor to a real customer.

It produces a monthly **Cloud Cost Optimisation — Portfolio Summary** report
with two custom block types (a five-bucket savings grid and a per-portfolio
detail page) and a deep-teal brand theme.

## What's in this pack

| File/Directory | Purpose |
|---|---|
| `pack.json` | Pack manifest: theme ID, block preprocessors, template list |
| `theme/` | (Not used here — the Acme theme ships from `src/report-renderer/static/themes/acme/`. Add a `theme/` subdir here if you want the pack to bundle its own theme.) |
| `blocks/portfolio-bucket-grid.js` | `::: portfolio_bucket_grid` block renderer |
| `blocks/portfolio-detail.js` | `::: portfolio_detail` block renderer |
| `templates/portfolio-monthly.md` | Monthly report skeleton with `{{placeholder}}` fields |
| `playbook.md` | Step-by-step agent instructions for populating the template |

## Quickstart

1. Read `playbook.md` — the full data-to-PDF workflow is documented there.
2. Copy `templates/portfolio-monthly.md` to your output directory.
3. Run the prescribed CCM queries (the agent can do this automatically when given
   the playbook via `harness_ccm_finops_packs pack_id:"acme"`).
4. Fill the `{{...}}` placeholders (agent fills data fields; CSM fills narrative fields).
5. Render: `harness_ccm_finops_report_render` with `theme: "acme"`.

## Block syntax

### `::: portfolio_bucket_grid`

A list of portfolio objects rendered as a 5-column SVG bucket grid. Each bucket's
fill level represents `captured_savings / (captured_savings + potential_savings)`.
See `blocks/portfolio-bucket-grid.js` for full field documentation.

### `::: portfolio_detail <name> | GM: <name> | Champion: <name> | Period: <text>`

A full portfolio page with header bar (GM Sponsor / Champion / Period), financial
summary, insights columns (Harness Recommendations / Current Month Achievements /
Next Month Focus), and cost-centre breakdown table. See `blocks/portfolio-detail.js`
for full field documentation.

## Theme notes

- **Colors:** deep teal `#0F766E` primary, charcoal `#1A1A1A` ink, white surface.
- **Fonts:** Inter (sans-serif), JetBrains Mono.
- **Print:** A4 portrait for detail pages; the portfolio summary uses A4 landscape
  via the `portfolio-summary` `@page` rule.
- **`customerLogo`:** Set `customerLogo: "/path/to/logo.svg"` in the markdown
  frontmatter to render a logo on the cover page instead of the wordmark text.

## Export formats

| Format | Recommended? | Notes |
|---|---|---|
| PDF (browser) | ✅ Yes | Full fidelity. Export PDF button. |
| Paged.js PPTX | ✅ Yes | Use `pptx_render` MCP tool, `slide_size: "A4"`. |
| Editable PPTX | ⚠️ Low fidelity | Bucket/detail blocks don't render correctly. |
| DOCX | ⚠️ Low fidelity | Same issue as editable PPTX. |

## Adapting this pack for a real customer

This pack is the reference scaffold. To create a customer-specific pack:

1. Copy `report-packs/acme/` → `report-packs/<customer-id>/`
2. Copy `src/report-renderer/static/themes/acme/` → `src/report-renderer/static/themes/<customer-id>/`
3. Edit the new `pack.json` (`id`, `name`, `theme_id`)
4. Edit the new theme's `manifest.json` (`id`, `name`, brand fields) and
   `theme.css` (palette: search for `--c-red*` and update)
5. Edit `templates/portfolio-monthly.md`: replace the five reference portfolio
   names with the customer's real portfolios; update placeholder data
6. Edit `playbook.md`: replace the reference names and add customer-specific
   guidance (forecasting tool, cost-centre convention, portfolio owners)
7. Restart the MCP server — the pack is auto-discovered

The blocks (`blocks/*.js`) are generic and can usually be reused as-is. Only fork
them if the customer needs a different visual layout (e.g. 4 portfolios instead
of 5, or a different bucket shape).

See **Section 20** of `harness_ccm_finops_guide` for the full pack architecture
spec, and call `harness_ccm_finops_packs` (no args) to see the embedded
authoring primer.
