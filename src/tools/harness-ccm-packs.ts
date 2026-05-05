/**
 * MCP tool: discover and inspect Customer Report Packs.
 *
 * A Report Pack bundles a customer-branded theme + custom markdown blocks +
 * report templates + an agent-readable playbook. Packs are discovered at server
 * startup from the in-repo `report-packs/` directory and any external roots
 * listed in `HARNESS_REPORT_PACKS_DIR_EXTRA`.
 *
 * This tool is the primary discovery surface so agents and clients can:
 *
 *  - LIST what packs are installed (no `pack_id` argument): returns one row per
 *    pack with its theme id, template inventory, blocks, and pack-root path.
 *  - GET a specific pack (`pack_id: "<id>"`): returns the full manifest plus
 *    the playbook content (so the agent can follow it) and optionally the
 *    template source(s) for autonomous rendering.
 *
 * The tool also surfaces the discovery roots and a short authoring primer so
 * customers / CSMs can scaffold their own pack without reading the source.
 */

import * as z from "zod/v4";
import * as fs from "node:fs";
import * as path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jsonResult, errorResult } from "../utils/response-formatter.js";
import {
  listPacks,
  getPack,
  getPackRoots,
  type RegisteredPack,
  type PackTemplate,
} from "../report-renderer/packs/index.js";

interface TemplateSummary {
  id: string;
  name: string;
  description?: string;
  /** Relative path inside the pack (as authored in pack.json). */
  relative_path: string;
  /** Absolute path on disk (resolved against the pack root). */
  absolute_path: string;
}

interface PackSummary {
  id: string;
  name: string;
  /** Theme id this pack registers (or null if it ships no theme). */
  theme_id: string | null;
  /** Absolute path to the pack directory on disk. */
  pack_dir: string;
  /** Absolute path to the pack's `theme/` directory, or null. */
  theme_dir: string | null;
  /** Number of custom block preprocessors registered. */
  block_count: number;
  /** Block preprocessor relative paths (for verification). */
  blocks: string[];
  /** Templates this pack exposes for rendering. */
  templates: TemplateSummary[];
  /** Whether the pack ships an agent-readable playbook.md. */
  has_playbook: boolean;
  /** Whether the pack ships a README.md. */
  has_readme: boolean;
}

function resolveTemplate(pack: RegisteredPack, t: PackTemplate): TemplateSummary {
  const abs = path.resolve(pack.packDir, t.path);
  return {
    id: t.id,
    name: t.name,
    ...(t.description ? { description: t.description } : {}),
    relative_path: t.path,
    absolute_path: abs,
  };
}

function summarisePack(pack: RegisteredPack): PackSummary {
  const blocks = pack.block_preprocessors ?? [];
  const templates = (pack.templates ?? []).map((t) => resolveTemplate(pack, t));
  return {
    id: pack.id,
    name: pack.name,
    theme_id: pack.theme_id ?? null,
    pack_dir: pack.packDir,
    theme_dir: pack.themeDir,
    block_count: blocks.length,
    blocks,
    templates,
    has_playbook: pack.playbookPath !== null,
    has_readme: pack.readmePath !== null,
  };
}

/**
 * Authoring primer returned in every list response so a CSM browsing packs sees
 * the path to creating a new one without having to dig through docs first.
 */
const AUTHORING_PRIMER = {
  pattern: "Bundle a customer's theme + custom blocks + templates + playbook into a single directory.",
  layout: [
    "report-packs/<id>/",
    "├── pack.json                    # { id, name, theme_id, block_preprocessors, templates }",
    "├── theme/                       # Standard theme dir (manifest.json, template.js, *.css, app.js)",
    "├── blocks/                      # Plain ESM .js modules exporting preprocessMarkdown(src)",
    "├── templates/                   # Markdown skeletons with {{placeholder}} fields",
    "├── playbook.md                  # Step-by-step agent instructions",
    "└── README.md                    # Human onboarding reference",
  ],
  block_contract:
    "Each preprocessor is a plain .js ESM file exporting `preprocessMarkdown(src: string): string`. " +
    "It runs before markdown-it parses the document — same pipeline position as the built-in " +
    "metric-cards and callout-normalize plugins.",
  installation: [
    "Drop the pack directory into report-packs/ in this repo, OR",
    "set HARNESS_REPORT_PACKS_DIR_EXTRA=<absolute-path> to a directory containing one or more packs.",
    "Restart the MCP server to pick up new packs.",
  ],
  usage: [
    "1. Call this tool with `pack_id: \"<id>\"` to read the pack's playbook.",
    "2. Run the agent queries the playbook prescribes (CCM data → fill template fields).",
    "3. Save the filled template as <output-dir>/<customer>-<period>.md.",
    "4. Call harness_ccm_finops_report_render with markdown_path + theme: \"<theme_id>\".",
  ],
  reference: "See Section 20 of harness_ccm_finops_guide for the full spec.",
};

export function registerCcmPacksTool(server: McpServer): void {
  server.registerTool(
    "harness_ccm_finops_packs",
    {
      description:
        "Discover Customer Report Packs (per-customer branded report families). " +
        "Each pack bundles a theme, custom ::: blocks, markdown templates, and an agent-readable " +
        "playbook with the exact CCM queries to run for that customer. " +
        "" +
        "Call with NO arguments to LIST all installed packs (one row per pack with theme id, " +
        "template inventory, blocks, pack-root path). Call with `pack_id` to GET a specific pack " +
        "with its full playbook content (so the agent can follow it step-by-step) and optional " +
        "template sources. " +
        "" +
        "Use this tool whenever the user mentions a specific customer report (e.g. \"generate " +
        "the monthly portfolio report for <customer>\", \"render the <customer> BVR\"), asks " +
        "what branded reports are available, or asks how to create a new customer pack. The " +
        "list response includes an authoring primer for scaffolding new packs. The shipped " +
        "`acme` pack is a fictional reference example — clone it as the starting point for " +
        "any real customer pack. " +
        "" +
        "Pack discovery roots: in-repo `report-packs/` plus any directories listed in " +
        "the HARNESS_REPORT_PACKS_DIR_EXTRA env var (colon-separated). First match wins on id.",
      inputSchema: {
        pack_id: z
          .string()
          .describe(
            "Optional. When set, returns the full pack detail (manifest + playbook content + " +
              "template metadata). When omitted, returns the list of all installed packs.",
          )
          .optional(),
        include_playbook: z
          .boolean()
          .describe(
            "When true (default for `get`), includes the playbook.md content in the response " +
              "as a top-level `playbook` field so the agent can follow it without a separate " +
              "filesystem read. Default false in list mode, true in get mode.",
          )
          .optional(),
        include_template_source: z
          .boolean()
          .describe(
            "When true, includes the markdown source of every template in the response. " +
              "Default false — templates can be large, and most workflows just need the path.",
          )
          .optional(),
        include_readme: z
          .boolean()
          .describe(
            "When true, includes the pack's README.md content in the response. Default false.",
          )
          .optional(),
      },
      annotations: {
        title: "Discover Customer Report Packs",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const includePlaybookDefault = args.pack_id ? true : false;
        const includePlaybook = args.include_playbook ?? includePlaybookDefault;
        const includeTemplateSource = args.include_template_source ?? false;
        const includeReadme = args.include_readme ?? false;

        // ─── GET mode ─────────────────────────────────────────────────────
        if (args.pack_id) {
          const pack = getPack(args.pack_id);
          if (!pack) {
            const available = listPacks().map((p) => p.id);
            return errorResult(
              `Pack '${args.pack_id}' not found. ` +
                (available.length === 0
                  ? "No packs are currently installed. Drop a pack directory into report-packs/ " +
                    "or set HARNESS_REPORT_PACKS_DIR_EXTRA=<absolute-path> and restart the server."
                  : `Available packs: ${available.join(", ")}.`),
            );
          }

          const summary = summarisePack(pack);

          // Optional: enrich each template with its source markdown.
          const templates = summary.templates.map((t) => {
            if (!includeTemplateSource) return t;
            try {
              const source = fs.readFileSync(t.absolute_path, "utf8");
              return { ...t, source };
            } catch (err) {
              return { ...t, source_error: String((err as Error).message) };
            }
          });

          let playbook: string | null = null;
          let playbookError: string | null = null;
          if (includePlaybook && pack.playbookPath) {
            try {
              playbook = fs.readFileSync(pack.playbookPath, "utf8");
            } catch (err) {
              playbookError = String((err as Error).message);
            }
          }

          let readme: string | null = null;
          let readmeError: string | null = null;
          if (includeReadme && pack.readmePath) {
            try {
              readme = fs.readFileSync(pack.readmePath, "utf8");
            } catch (err) {
              readmeError = String((err as Error).message);
            }
          }

          return jsonResult({
            ok: true,
            mode: "get",
            pack: {
              ...summary,
              templates,
              playbook_path: pack.playbookPath,
              readme_path: pack.readmePath,
              playbook,
              ...(playbookError ? { playbook_error: playbookError } : {}),
              readme,
              ...(readmeError ? { readme_error: readmeError } : {}),
            },
            hint: pack.playbookPath
              ? "Read the `playbook` field (or the file at `playbook_path`) for step-by-step " +
                "agent instructions on how to populate this pack's template(s) and render."
              : "This pack does not ship a playbook.md. Inspect template paths and consult " +
                "Section 20 of harness_ccm_finops_guide for the generic authoring flow.",
          });
        }

        // ─── LIST mode ────────────────────────────────────────────────────
        const packs = listPacks().map(summarisePack);

        // Optional inclusion of playbook content even in list mode (rarely useful
        // but supported for clients that want a single-call full bootstrap).
        const enriched = packs.map((p, i) => {
          if (!includePlaybook) return p;
          const pack = listPacks()[i];
          if (!pack || !pack.playbookPath) return p;
          try {
            return { ...p, playbook: fs.readFileSync(pack.playbookPath, "utf8") };
          } catch {
            return p;
          }
        });

        return jsonResult({
          ok: true,
          mode: "list",
          pack_count: packs.length,
          packs: enriched,
          discovery_roots: getPackRoots(),
          authoring_primer: AUTHORING_PRIMER,
          hint:
            packs.length === 0
              ? "No customer report packs are currently installed. See `authoring_primer` " +
                "for how to create one."
              : "Call this tool again with `pack_id: \"<id>\"` to get a specific pack's " +
                "playbook (the step-by-step agent guide for filling and rendering its templates).",
        });
      } catch (err) {
        return errorResult(
          `Pack discovery failed: ${(err as Error).message || String(err)}`,
        );
      }
    },
  );
}
