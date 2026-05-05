/**
 * Acme Report Pack — Portfolio Detail block preprocessor.
 *
 * Converts a ::: portfolio_detail ... ::: block into a structured HTML
 * layout matching the per-portfolio page in the reference Cloud Cost
 * Optimisation report: header bar (GM Sponsor / Champion / Period), Financial Summary
 * card + Insights columns, then the full Cost Centre breakdown table.
 *
 * Syntax:
 *
 *   ::: portfolio_detail Enterprise Technology Services | GM: Chrissy Chu | Champion: DJ Acornley | Period: FY26 YTD to 31 Jan
 *   financial_summary:
 *     annual_budget: 12176209
 *     ytd_spend: 0
 *     budget_used_pct: 0
 *     target_pct: 58.3
 *     waste_pm: 119097
 *     applied_ytd: 32143
 *   insights:
 *     harness_recommendations:
 *       - Forecasted spend update has been provided by IT Finance.
 *       - Manual update in Harness Pending
 *     current_month_achievements:
 *       - Completed onboarding of two new cost centres
 *     next_month_focus:
 *       - Onboarding individual Cost Centre owners with action to execute recommendations
 *   breakdown:
 *     - cost_centre: CHRTEX
 *       annual_budget: 56673
 *       forecast_6_6: 71090
 *       forecast_used_pct: 32
 *       ytd_spend: 22700
 *       applied_recs_ytd: 0
 *       recs_pm: 153
 *       rec_type: "Workload, Azure Instance"
 *       est_saving_pm: 44
 *   :::
 *
 * The opener line after "portfolio_detail" is parsed as:
 *   <portfolio name> | GM: <name> | Champion: <name> | Period: <text>
 * Any field except the portfolio name is optional.
 *
 * The body is a simple YAML-ish document with three top-level sections:
 *   financial_summary, insights, breakdown.
 *
 * Export: `preprocessMarkdown(src: string): string`
 */

const BLOCK_RE = /^[ \t]*:::\s*portfolio_detail([ \t]+[^\r\n]*)?\r?\n([\s\S]*?)^[ \t]*:::\s*$/gm;

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(n) {
  if (n == null || n === "" || n === undefined) return "—";
  const num = parseFloat(String(n).replace(/[^0-9.\-]/g, ""));
  if (isNaN(num)) return esc(String(n));
  if (Math.abs(num) >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
  if (Math.abs(num) >= 1_000) return `$${Math.round(num).toLocaleString("en-AU")}`;
  return `$${Math.round(num)}`;
}

function fmtPct(n) {
  if (n == null || n === "") return "—";
  return `${parseFloat(String(n)).toFixed(1)}%`;
}

/** Parse the opener line: "Portfolio Name | GM: foo | Champion: bar | Period: baz" */
function parseOpener(raw) {
  const parts = (raw || "").trim().split(/\s*\|\s*/);
  const result = { name: "", gm: "", champion: "", period: "" };
  if (!parts.length) return result;
  result.name = parts[0]?.trim() || "";
  for (const part of parts.slice(1)) {
    const m = part.match(/^(GM|Champion|Period)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key === "gm") result.gm = m[2].trim();
    else if (key === "champion") result.champion = m[2].trim();
    else if (key === "period") result.period = m[2].trim();
  }
  return result;
}

/**
 * Very minimal YAML block parser for the nested structure used in this block.
 * Returns a plain JS object with string/array values only. Not general YAML.
 *
 * Understands:
 *   top_key:            → section header (value = sub-object)
 *     sub_key: value    → string value
 *     - item            → push to array under previous key
 *     - list_key: val   → push to array under list_key
 */
function parseBody(src) {
  const lines = src.split(/\r?\n/);
  const root = {};
  let currentSection = null; // string key of current top-level section
  let currentSubSection = null; // string key inside insights
  let currentItem = null; // current breakdown row object

  for (const raw of lines) {
    if (!raw.trim()) continue;
    const indent = raw.match(/^(\s*)/)?.[1].length ?? 0;

    // Top-level section header: "financial_summary:", "insights:", "breakdown:"
    const sectionMatch = raw.match(/^([\w_]+):\s*$/);
    if (sectionMatch && indent === 0) {
      currentSection = sectionMatch[1];
      root[currentSection] = {};
      currentSubSection = null;
      currentItem = null;
      continue;
    }

    if (!currentSection) continue;

    // Inside financial_summary or top of any section: "  key: value"
    const kvMatch = raw.match(/^\s{2,4}([\w_]+)\s*:\s*(.+)$/);
    const listItemMatch = raw.match(/^\s{4,6}-\s+([\w_]+)\s*:\s*(.+)$/);
    const listBulletMatch = raw.match(/^\s{4,6}-\s+(.+)$/);
    const subSectionMatch = raw.match(/^\s{2,4}([\w_]+):\s*$/);

    if (currentSection === "financial_summary" && kvMatch) {
      root.financial_summary[kvMatch[1]] = kvMatch[2].trim().replace(/^["']|["']$/g, "");
      continue;
    }

    if (currentSection === "insights") {
      if (subSectionMatch && indent <= 4) {
        currentSubSection = subSectionMatch[1];
        root.insights[currentSubSection] = [];
        continue;
      }
      if (currentSubSection && listBulletMatch) {
        root.insights[currentSubSection].push(listBulletMatch[1].trim());
        continue;
      }
    }

    if (currentSection === "breakdown") {
      if (!Array.isArray(root.breakdown)) root.breakdown = [];
      if (listItemMatch && indent <= 4) {
        // Start of new breakdown row or continuation
        if (!currentItem || listItemMatch[1] === "cost_centre") {
          if (currentItem) root.breakdown.push(currentItem);
          currentItem = {};
        }
        currentItem[listItemMatch[1]] = listItemMatch[2].trim().replace(/^["']|["']$/g, "");
        continue;
      }
      if (kvMatch && indent >= 4) {
        if (!currentItem) currentItem = {};
        currentItem[kvMatch[1]] = kvMatch[2].trim().replace(/^["']|["']$/g, "");
        continue;
      }
    }
  }

  // Flush last breakdown item
  if (currentItem && Array.isArray(root.breakdown)) {
    root.breakdown.push(currentItem);
  }

  return root;
}

/**
 * Collapse whitespace between HTML tags and remove blank lines.
 * markdown-it (CommonMark) ends an HTML block at the first blank line, so any
 * whitespace-only line inside our generated markup causes the rest to be parsed
 * as regular markdown — where 4+-space indented lines become code blocks.
 */
function compact(html) {
  return html
    .replace(/>\s*\n\s*</g, "><")  // collapse newlines+whitespace between tags
    .replace(/\n\s*\n/g, "\n")      // collapse blank lines
    .trim();
}

function renderInsightList(items, label) {
  if (!items || !items.length) return "";
  const lis = items.map((t) => `<li>${esc(t)}</li>`).join("");
  return `<h4>${esc(label)}</h4><ul>${lis}</ul>`;
}

function kpiRow(label, value) {
  return `<div class="portfolio-detail-kpi-row"><span class="portfolio-detail-kpi-label">${label}</span><span class="portfolio-detail-kpi-value">${value}</span></div>`;
}

function renderDetail(openerRaw, bodyRaw) {
  const hdr = parseOpener(openerRaw);
  const data = parseBody(bodyRaw);
  const fs = data.financial_summary || {};
  const ins = data.insights || {};
  const breakdown = Array.isArray(data.breakdown) ? data.breakdown : [];

  const headerGrid = compact(`<div class="portfolio-detail-header">
    <div><span class="portfolio-detail-header-label">GM Sponsor</span><span class="portfolio-detail-header-value">${esc(hdr.gm || "—")}</span></div>
    <div><span class="portfolio-detail-header-label">Champion</span><span class="portfolio-detail-header-value">${esc(hdr.champion || "—")}</span></div>
    <div><span class="portfolio-detail-header-label">Period</span><span class="portfolio-detail-header-value">${esc(hdr.period || "—")}</span></div>
  </div>`);

  const namebar = `<div class="portfolio-detail-name-bar">Portfolio | ${esc(hdr.name)}</div>`;

  const summaryBlock = compact(`<div class="portfolio-detail-summary">
    <h4>Financial Summary</h4>
    ${kpiRow("Annual Budget (Finance)", fmt(fs.annual_budget))}
    ${kpiRow("YTD Spend (Actuals)", fmt(fs.ytd_spend))}
    ${kpiRow("Budget Used", fmtPct(fs.budget_used_pct))}
    ${kpiRow("% Target", fmtPct(fs.target_pct))}
    ${kpiRow("Rec Opportunity p/m (Waste)", fmt(fs.waste_pm))}
    ${kpiRow("Applied Opportunities YTD", fmt(fs.applied_ytd))}
  </div>`);

  const insightsBlock = compact(`<div class="portfolio-detail-insights">
    ${renderInsightList(ins.harness_recommendations, "Harness Recommendations")}
    ${renderInsightList(ins.current_month_achievements, "Current Month Achievements")}
    ${renderInsightList(ins.next_month_focus, "Next Month Focus")}
  </div>`);

  const breakdownRows = breakdown.map((row) =>
    `<tr><td>${esc(row.cost_centre)}</td><td>${fmt(row.annual_budget)}</td><td>${fmt(row.forecast_6_6)}</td><td>${fmtPct(row.forecast_used_pct)}</td><td>${fmt(row.ytd_spend)}</td><td>${fmt(row.applied_recs_ytd)}</td><td>${fmt(row.recs_pm)}</td><td>${esc(row.rec_type || "—")}</td><td>${fmt(row.est_saving_pm)}</td></tr>`
  ).join("");

  const breakdownTable = breakdown.length ? compact(`<div class="portfolio-detail-breakdown">
    <table>
      <thead><tr>
        <th>Cost Centre</th><th>Annual Budget</th><th>6+6 Forecast</th>
        <th>% Forecast Used</th><th>YTD Spend</th><th>Applied Recs YTD</th>
        <th>Recs p/m</th><th>Rec Type</th><th>Est Saving p/m</th>
      </tr></thead>
      <tbody>${breakdownRows}</tbody>
    </table>
  </div>`) : "";

  // Wrap in a single compact HTML block. The leading \n and trailing \n ensure
  // markdown-it sees the opening <div at the start of its own line.
  const inner = compact(`<div class="portfolio-detail">
    ${headerGrid}${namebar}
    <div class="portfolio-detail-body">${summaryBlock}${insightsBlock}</div>
    ${breakdownTable}
  </div>`);

  // Emit on the same source line where `:::` originally started so the
  // html_block's `data-source-line` matches the user's editor view (see
  // the matching note in portfolio-bucket-grid.js).
  return `${inner}\n`;
}

/**
 * Exported preprocessor. Replaces all ::: portfolio_detail blocks
 * with their rendered HTML equivalents before markdown-it sees the source.
 *
 * Preserves the LINE COUNT of the original `:::` block by padding the
 * emitted HTML with trailing blank lines. Without this, every block AFTER
 * a portfolio_detail block would be tagged with the wrong source line,
 * breaking the click-pencil-to-jump behaviour of the live edit panel.
 */
export function preprocessMarkdown(src) {
  return src.replace(BLOCK_RE, (match, opener, body) => {
    const html = renderDetail(opener, body);
    const inputLines = match.split("\n").length;
    const outputLines = html.split("\n").length;
    const pad = Math.max(0, inputLines - outputLines);
    return html + "\n".repeat(pad);
  });
}
