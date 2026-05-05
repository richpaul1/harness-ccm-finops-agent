/**
 * Acme Report Pack — Portfolio Bucket Grid block preprocessor.
 *
 * Converts a ::: portfolio_bucket_grid ... ::: YAML block into the HTML
 * markup consumed by the theme's `.portfolio-bucket-grid` CSS grid.
 *
 * Syntax:
 *
 *   ::: portfolio_bucket_grid
 *   - name: Enterprise Technology Services
 *     color: maroon
 *     potential_savings: 595000
 *     captured_savings: 249000
 *     annual_budget: 12176209
 *     ytd_spend: 8123456
 *     budget_used_pct: 66.7
 *     target_pct: 58.3
 *     waste_pm: 119097
 *     applied_savings_ytd: 32143
 *     other_savings_ytd: 0
 *   - name: ROI & CCC
 *     ...
 *   :::
 *
 * Fields:
 *   name                 Portfolio display name
 *   color                Bucket fill color keyword or hex (maroon|red|orange|amber|purple)
 *   potential_savings    $ remaining FY savings opportunity (shown above bucket)
 *   captured_savings     $ savings already achieved this FY (fill level)
 *   annual_budget        $ annual budget
 *   ytd_spend            $ year-to-date actual spend
 *   budget_used_pct      % of annual budget consumed
 *   target_pct           % target at this point in the year
 *   waste_pm             $ monthly waste/rec opportunity
 *   applied_savings_ytd  $ YTD applied recommendation savings
 *   other_savings_ytd    $ other savings not from Harness recs
 *
 * Export: `preprocessMarkdown(src: string): string`
 */

const BLOCK_RE = /^[ \t]*:::\s*portfolio_bucket_grid\s*\r?\n([\s\S]*?)^[ \t]*:::\s*$/gm;

const COLOUR_MAP = {
  maroon: "#6B0E1A",
  red: "#E01A22",
  orange: "#EA580C",
  amber: "#D97706",
  purple: "#7C3AED",
  blue: "#2563EB",
  green: "#059669",
};

function fmt(n) {
  if (n == null || n === "" || n === undefined) return "—";
  const num = parseFloat(String(n).replace(/[^0-9.\-]/g, ""));
  if (isNaN(num)) return String(n);
  if (Math.abs(num) >= 1_000_000)
    return `$${(num / 1_000_000).toFixed(1)}M`;
  if (Math.abs(num) >= 1_000)
    return `$${Math.round(num).toLocaleString("en-AU")}`;
  return `$${Math.round(num)}`;
}

function fmtPct(n) {
  if (n == null || n === "") return "—";
  return `${parseFloat(String(n)).toFixed(1)}%`;
}

/**
 * Very simple YAML list parser — only handles the two-level structure used
 * in the portfolio bucket block (no nested maps, no anchors, no tags).
 */
function parseYamlList(src) {
  const lines = src.split(/\r?\n/);
  const items = [];
  let current = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    const startMatch = line.match(/^\s*-\s+([\w_]+)\s*:\s*(.*)$/);
    const contMatch = line.match(/^\s+([\w_]+)\s*:\s*(.*)$/);
    if (startMatch) {
      if (current) items.push(current);
      current = {};
      current[startMatch[1]] = startMatch[2].trim();
    } else if (contMatch && current) {
      current[contMatch[1]] = contMatch[2].trim();
    }
  }
  if (current) items.push(current);
  return items;
}

/**
 * Generate an SVG "bucket" where the fill level represents
 * captured / (captured + potential) as a percentage.
 */
function bucketSvg(captured, potential, fillColor) {
  const total = Number(captured) + Number(potential);
  const fillPct = total > 0 ? Math.min(100, Math.max(0, (Number(captured) / total) * 100)) : 0;

  // Bucket shape: trapezoid (wider at top, narrower at bottom)
  // SVG viewBox 100×120; bucket occupies most of the height.
  const bucketTop = 5;
  const bucketBottom = 115;
  const bucketH = bucketBottom - bucketTop;
  const halfWidthTop = 44;
  const halfWidthBottom = 30;

  // Fill level: fills from bottom up
  const fillH = (fillPct / 100) * bucketH;
  const fillY = bucketBottom - fillH;

  // At fillY, the half-width is interpolated between bottom and top widths.
  const t = (bucketBottom - fillY) / bucketH; // 0 = top, 1 = bottom
  const halfWidthAtFillY = halfWidthTop + (halfWidthBottom - halfWidthTop) * (1 - t);

  // Clipping polygon for fill: trapezoid section below fillY
  const fillPoints = [
    `${50 - halfWidthAtFillY},${fillY}`,
    `${50 + halfWidthAtFillY},${fillY}`,
    `${50 + halfWidthBottom},${bucketBottom}`,
    `${50 - halfWidthBottom},${bucketBottom}`,
  ].join(" ");

  const color = COLOUR_MAP[fillColor] || fillColor || COLOUR_MAP.red;
  const colorLight = `${color}33`; // 20% opacity of fill color for empty area

  const labelY = fillPct > 15 ? fillY + fillH / 2 + 5 : bucketTop + bucketH / 2 + 5;
  const labelFill = fillPct > 15 ? "#fff" : color;
  const fillPolygon = fillPct > 0
    ? `<polygon points="${fillPoints}" fill="${color}" opacity="0.9"/>`
    : "";
  // Single-line SVG — no blank lines so markdown-it never breaks out of the HTML block.
  return `<svg class="portfolio-bucket-svg" viewBox="0 0 100 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polygon points="${50 - halfWidthTop},${bucketTop} ${50 + halfWidthTop},${bucketTop} ${50 + halfWidthBottom},${bucketBottom} ${50 - halfWidthBottom},${bucketBottom}" fill="${colorLight}" stroke="${color}" stroke-width="2.5"/>${fillPolygon}<text x="50" y="${labelY}" font-family="Inter,sans-serif" font-size="14" font-weight="800" fill="${labelFill}" text-anchor="middle">${Math.round(fillPct)}%</text></svg>`;
}

/**
 * Collapse all runs of whitespace (including newlines) between HTML tags so the
 * entire block is one continuous string with no blank lines. markdown-it ends an
 * HTML block at the first blank line, so any blank line (even spaces-only) inside
 * our generated markup would cause the remainder to be parsed as markdown — which
 * treats 4+-space-indented lines as code blocks.
 */
function compact(html) {
  return html
    .replace(/>\s*\n\s*</g, "><")   // collapse whitespace between tags
    .replace(/\n\s*\n/g, "\n")       // collapse blank lines
    .trim();
}

function renderBucketGrid(yamlSrc) {
  const items = parseYamlList(yamlSrc);
  if (!items.length) return '<div class="portfolio-bucket-grid"></div>';

  const cols = items.map((item) => {
    const captured = parseFloat(String(item.captured_savings || 0));
    const potential = parseFloat(String(item.potential_savings || 0));
    const svg = bucketSvg(captured, potential, item.color || "red");
    const potentialLabel = potential > 0
      ? `<div class="portfolio-bucket-tag">${fmt(potential)} remaining</div>`
      : "";
    const statsRows = [
      ["Annual Budget", fmt(item.annual_budget)],
      ["YTD Spend",     fmt(item.ytd_spend)],
      ["Budget Used",   fmtPct(item.budget_used_pct)],
      ["Target",        fmtPct(item.target_pct)],
      ["Waste p/m",     fmt(item.waste_pm)],
      ["Applied YTD",   fmt(item.applied_savings_ytd)],
      ["Other Savings", fmt(item.other_savings_ytd)],
    ].map(([label, val]) =>
      `<tr><td>${label}</td><td><strong>${val}</strong></td></tr>`
    ).join("");
    const stats = `<table class="portfolio-bucket-stats">${statsRows}</table>`;
    const title = `<div class="portfolio-bucket-title">${item.name || ""}</div>`;
    // Build each item as a single compact string — no blank lines, no 4-space indents.
    return compact(
      `<div class="portfolio-bucket-item">${potentialLabel}${svg}${title}${stats}</div>`
    );
  });

  // Emit on the same source line where `:::` originally started so the
  // html_block's `data-source-line` matches the user's editor view. The
  // markdown convention (and the Acme template) always has a blank line
  // before `:::`, so we don't need a leading `\n` to start a Type 6 HTML
  // block — the source already provides one. Trailing `\n` ends the block.
  return `<div class="portfolio-bucket-grid">${cols.join("")}</div>\n`;
}

/**
 * Exported preprocessor. Replaces all ::: portfolio_bucket_grid blocks
 * with their rendered HTML equivalents before markdown-it sees the source.
 *
 * Critically, the replacement preserves the LINE COUNT of the original
 * `:::` block by padding the emitted HTML with trailing blank lines. The
 * report renderer attaches `data-source-line` annotations for the live
 * edit panel — without line preservation, every block AFTER a custom
 * `:::` block would be tagged with the wrong source line, and clicking
 * the pencil icon would jump the editor cursor to the wrong place.
 */
export function preprocessMarkdown(src) {
  return src.replace(BLOCK_RE, (match, body) => {
    const html = renderBucketGrid(body);
    const inputLines = match.split("\n").length;
    const outputLines = html.split("\n").length;
    const pad = Math.max(0, inputLines - outputLines);
    return html + "\n".repeat(pad);
  });
}
