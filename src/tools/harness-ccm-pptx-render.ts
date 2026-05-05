/**
 * MCP tool: render a registered markdown report as a PowerPoint (.pptx) deck.
 *
 * Segmentation matches the video pipeline exactly: each `.pagedjs_page` in
 * the themed print view becomes one slide. We capture every page as a PNG
 * via Playwright (same handshake as `pdf.ts` / `video.ts`) and embed each
 * one full-bleed into a pptxgenjs slide. The output is an image-per-slide
 * deck that preserves the theme's visual design 1:1 with the PDF / video.
 *
 * Inputs mirror `harness_ccm_finops_report_render` so the same
 * `markdown_path` / `id` can be re-used across PDF, video, and PPTX tools.
 */
import * as z from "zod/v4";
import * as fs from "node:fs";
import * as path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../config.js";
import { jsonResult, errorResult } from "../utils/response-formatter.js";
import {
  registerReport,
  getReportBaseUrl,
} from "../report-renderer/index.js";
import { renderDocument } from "../report-renderer/render.js";
import { renderPptx } from "../report-renderer/pptx.js";

// Theme IDs are discovered at runtime — no hard-coded enum here.
const SLIDE_SIZES = ["16x9", "4x3", "A4"] as const;

export function registerCcmPptxRenderTool(server: McpServer, config: Config): void {
  server.registerTool(
    "harness_ccm_finops_pptx_render",
    {
      description:
        "Render a registered markdown report as an editable PowerPoint (.pptx) deck. Each " +
        "Paged.js page in the themed print view becomes one slide — same segmentation as the " +
        "video render, same visual fidelity as the PDF export. Slides are full-bleed images of " +
        "the rendered pages (not re-authored editable text), so the theme's typography, " +
        "callouts, and brand look exactly like the PDF / video. Good for sharing on-brand " +
        "review decks without having to rebuild the slides by hand in Keynote / PowerPoint. " +
        "Requires Playwright + Chromium (installed on demand by `pnpm add playwright && " +
        "npx playwright install chromium`). " +
        "Inputs: markdown_path (absolute path to the .md, same as the report-render tool); " +
        "id (optional stable slug); theme; slide_size (16x9 / 4x3 / A4 — A4 matches the Paged.js " +
        "page aspect most closely and minimises letterboxing).",
      inputSchema: {
        markdown_path: z
          .string()
          .describe(
            "ABSOLUTE path to the markdown file. Same rule as the report-render tool: relative " +
              "paths are rejected because the MCP server cwd is not your workspace.",
          ),
        base_dir: z
          .string()
          .describe(
            "OPTIONAL absolute path to override the report's web root. Defaults to the directory " +
              "containing markdown_path.",
          )
          .optional(),
        id: z
          .string()
          .describe(
            "Optional stable slug ID for this report (e.g. 'acme-q1-bvr'). Re-registering the " +
              "same `id` produces the same URL and reuses the same registration.",
          )
          .optional(),
        label: z
          .string()
          .describe("Optional human-readable label.")
          .optional(),
        theme: z
          .string()
          .describe(
            "Theme to render the slides in. Default `harness`. The deck frames the print-view " +
              "of the chosen theme exactly as the PDF export does. Built-in: harness, modern, " +
              "glass, kinetic. Customer packs may add more (e.g. 'coles').",
          )
          .optional(),
        slide_size: z
          .enum(SLIDE_SIZES)
          .describe(
            "Slide dimensions. `16x9` (13.33×7.5 in, default) for modern widescreen review decks, " +
              "`4x3` (10×7.5 in) for legacy projector aspect, `A4` (11.69×8.27 in) to match the " +
              "Paged.js page aspect most closely and minimise letterboxing at the top/bottom.",
          )
          .optional(),
      },
      annotations: {
        title: "Render a Report as PowerPoint",
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
        const baseUrl = await getReportBaseUrl(config);

        // Register (or re-register) the report so the renderer can serve the
        // print view at /reports/<id>/?mode=print. Idempotent on `id`.
        const entry = registerReport({
          contentPath: mdPath,
          baseDir,
          id: args.id,
          label: args.label,
        });
        const themeId = args.theme ?? "harness";

        // Reachability check before we spin up Chromium.
        const probeUrl = `${baseUrl}/reports/${entry.id}/?theme=${encodeURIComponent(themeId)}`;
        try {
          const verifyRes = await fetch(probeUrl, { signal: AbortSignal.timeout(5000) });
          if (!verifyRes.ok) {
            return errorResult(
              `Preview URL returned HTTP ${verifyRes.status}. The renderer is up but cannot serve the report.`,
            );
          }
        } catch (err) {
          return errorResult(
            `Could not reach preview URL ${probeUrl}: ${(err as Error).message}`,
          );
        }

        const doc = await renderDocument(mdPath);
        const result = await renderPptx({
          baseUrl,
          meta: doc.meta,
          themeId,
          docPath: `/reports/${entry.id}/`,
          ...(args.slide_size ? { slideSize: args.slide_size } : {}),
        });

        const downloadUrl = `${baseUrl}/reports/${entry.id}/slides.pptx?theme=${encodeURIComponent(
          themeId,
        )}`;

        return jsonResult({
          ok: true,
          id: entry.id,
          theme: themeId,
          slide_size: args.slide_size ?? "16x9",
          out_path: result.outPath,
          file_name: result.fileName,
          slides: result.slides,
          download_url: downloadUrl,
          markdown_link: `[Download PowerPoint deck](${downloadUrl})`,
          hint:
            "Open `out_path` locally in PowerPoint / Keynote, or hit `download_url` from a browser " +
            "to grab the .pptx. Slides are image-based (one full-bleed PNG per Paged.js page) so " +
            "they preserve the theme exactly — edit in Keynote/PowerPoint by overlaying new shapes " +
            "if you want to annotate on top.",
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`PPTX render failed: ${msg}`);
      }
    },
  );
}
