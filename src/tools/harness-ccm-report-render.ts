/**
 * MCP tool: register a markdown report with the in-process report renderer
 * and return a browser URL the user can open immediately.
 *
 * In HTTP transport mode the report is served from the SAME host and port as
 * the MCP endpoint (e.g. `http://localhost:3000/reports/<id>/`). In stdio
 * mode the renderer lazily starts a dedicated Express listener on
 * `HARNESS_REPORT_PORT` (default 4321).
 */
import * as z from "zod/v4";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../config.js";
import { jsonResult, errorResult } from "../utils/response-formatter.js";
import {
  registerReport,
  getReportBaseUrl,
  listThemes,
} from "../report-renderer/index.js";

const THEME_IDS = ["harness", "modern", "glass", "kinetic"] as const;

/** Open a URL in the OS default browser (best-effort, detached). */
function openInBrowser(url: string): boolean {
  let cmd: string;
  let args: string[];
  switch (process.platform) {
    case "darwin":
      cmd = "open";
      args = [url];
      break;
    case "win32":
      cmd = "cmd";
      args = ["/c", "start", "", url];
      break;
    default:
      cmd = "xdg-open";
      args = [url];
  }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export function registerCcmReportRenderTool(server: McpServer, config: Config): void {
  server.registerTool(
    "harness_ccm_finops_report_render",
    {
      description:
        "Register a markdown report (BVR, maturity assessment, monthly review, or any " +
        "Harness-authored doc) with the in-process report renderer and return a live browser URL. " +
        "By default the URL auto-opens in the user's default browser. The user can switch themes " +
        "via the sidebar dropdown (harness / modern / glass / kinetic) and click 'Export PDF' to " +
        "download a paginated PDF. The report is served from the SAME host and port as the MCP " +
        "server (HTTP mode) or from a dedicated port HARNESS_REPORT_PORT (stdio mode). " +
        "The directory containing the markdown file is automatically served as the report's web " +
        "root, so any relative URL in the markdown (`assets/chart.png`, `images/foo.svg`, " +
        "`inline.png`) Just Works — no separate assets directory to register. " +
        "Inputs: markdown_path (absolute path to a .md file with YAML frontmatter); base_dir " +
        "(optional override for the web root); theme (initial theme); id (optional stable slug " +
        "for a pinned URL); open_in_browser (default true). " +
        "Markdown conventions: YAML frontmatter drives the cover page (title, customer, date, " +
        "subtitle); :::critical / :::success / :::risk / :::action / :::info / :::warning callouts; " +
        "::: metrics ...::: grid blocks; standard markdown tables, figures, footnotes.",
      inputSchema: {
        markdown_path: z
          .string()
          .describe(
            "ABSOLUTE path to the markdown file (e.g. '/Users/me/project/reports/acme-bvr.md'). " +
              "Relative paths are rejected because the MCP server's cwd differs from your workspace. " +
              "The directory containing this file is served as the report's web root, so any " +
              "relative image / link URL inside the markdown resolves correctly off disk.",
          ),
        base_dir: z
          .string()
          .describe(
            "OPTIONAL absolute path to override the report's web root. Defaults to the directory " +
              "containing markdown_path. Use this only when the markdown lives somewhere other " +
              "than the assets it references (e.g. you keep markdown in `reports/` but assets " +
              "in a sibling `assets/` and don't want to refactor).",
          )
          .optional(),
        theme: z
          .enum(THEME_IDS)
          .describe(
            "Initial theme for the preview URL. User can switch themes in the browser after " +
              "loading. Options: harness (navy + amber executive), modern (coral editorial), " +
              "glass (liquid-glass adaptive), kinetic (lime + motion).",
          )
          .optional(),
        id: z
          .string()
          .describe(
            "Optional stable slug ID for this report (e.g. 'acme-q1-bvr'). When set, re-registering " +
              "produces the same URL. If omitted, an ID is derived from the filename + a hash of " +
              "the absolute path.",
          )
          .optional(),
        label: z
          .string()
          .describe("Optional human-readable label (shown in /reports/ index). Defaults to filename.")
          .optional(),
        open_in_browser: z
          .boolean()
          .describe(
            "Auto-open the preview URL in the user's default browser (default true). " +
              "Set false for headless / remote-MCP environments where the browser launcher would " +
              "open on the wrong machine.",
          )
          .default(true)
          .optional(),
      },
      annotations: {
        title: "Render a Harness Report",
        readOnlyHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      const mdPath = args.markdown_path;
      if (!path.isAbsolute(mdPath)) {
        return errorResult(
          `markdown_path must be an absolute path (got '${mdPath}'). ` +
            "Relative paths resolve to the MCP server directory, not your workspace.",
        );
      }
      if (!fs.existsSync(mdPath)) {
        return errorResult(`Markdown file not found: ${mdPath}`);
      }
      if (!fs.statSync(mdPath).isFile()) {
        return errorResult(`markdown_path is not a file: ${mdPath}`);
      }

      let baseDir: string | undefined;
      if (args.base_dir) {
        if (!path.isAbsolute(args.base_dir)) {
          return errorResult(`base_dir must be an absolute path (got '${args.base_dir}').`);
        }
        if (!fs.existsSync(args.base_dir) || !fs.statSync(args.base_dir).isDirectory()) {
          return errorResult(`base_dir does not exist or is not a directory: ${args.base_dir}`);
        }
        baseDir = args.base_dir;
      }

      try {
        // Lazy-start standalone server (stdio mode) or use the MCP HTTP base URL
        const baseUrl = await getReportBaseUrl(config);

        // Register the report (idempotent on contentPath via derived ID).
        // baseDir defaults to the markdown file's directory inside registerReport.
        const entry = registerReport({
          contentPath: mdPath,
          baseDir,
          id: args.id,
          label: args.label,
        });

        const theme = args.theme ?? "harness";
        const themeQuery = `?theme=${encodeURIComponent(theme)}`;
        const previewUrl = `${baseUrl}/reports/${entry.id}/${themeQuery}`;
        const printUrl = `${baseUrl}/reports/${entry.id}/?mode=print&theme=${encodeURIComponent(theme)}`;
        const pdfUrl = `${baseUrl}/reports/${entry.id}/download${themeQuery}`;

        // Verify the URL is actually reachable before handing it back
        try {
          const verifyRes = await fetch(previewUrl, { signal: AbortSignal.timeout(5000) });
          if (!verifyRes.ok) {
            return errorResult(
              `Preview URL returned HTTP ${verifyRes.status}. The renderer is up but cannot serve the report.`,
            );
          }
        } catch (err) {
          return errorResult(
            `Could not reach preview URL ${previewUrl}: ${(err as Error).message}`,
          );
        }

        const shouldOpen = args.open_in_browser !== false;
        const opened = shouldOpen ? openInBrowser(previewUrl) : false;

        const themes = listThemes().map((t) => t.id);

        return jsonResult({
          ok: true,
          id: entry.id,
          url: previewUrl,
          markdown_link: `[Open ${entry.label} in browser](${previewUrl})`,
          opened_in_browser: opened,
          print_url: printUrl,
          pdf_url: pdfUrl,
          theme,
          available_themes: themes,
          content_path: entry.contentPath,
          base_dir: entry.baseDir,
          label: entry.label,
          renderer_base_url: baseUrl,
          hint: opened
            ? "The report opened in your default browser. Switch themes via the sidebar dropdown " +
              "(harness / modern / glass / kinetic) and click 'Export PDF' to download."
            : "Open `url` in a browser. Switch themes via the sidebar dropdown and click 'Export PDF' to download.",
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Report registration failed: ${msg}`);
      }
    },
  );
}
