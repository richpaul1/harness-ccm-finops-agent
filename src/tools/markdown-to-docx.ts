import * as z from "zod/v4";
import * as fs from "node:fs";
import * as path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jsonResult, errorResult } from "../utils/response-formatter.js";
import { markdownToDocx } from "../utils/markdown-to-docx.js";

/**
 * MCP tool: convert a Markdown file (or raw Markdown text) to a Word (.docx)
 * document.
 *
 * - Reads from `input_path` (a .md file on disk), **or**
 * - Accepts raw Markdown via `markdown` (string).
 * - Writes the .docx to `output_path`.
 *
 * Output is a native editable Word document — headings, lists, tables, and
 * inline formatting are preserved as live structure, not flattened to images.
 */
export function registerMarkdownToDocxTool(server: McpServer): void {
  server.registerTool(
    "markdown_to_docx",
    {
      description:
        "Convert a Markdown file or raw Markdown text to a native editable Word (.docx) document. " +
        "Provide either input_path (path to a .md file) or markdown (raw text). " +
        "Headings, lists, tables, blockquotes, code blocks, and inline formatting (bold / italic / " +
        "code / links) are preserved as live docx structure — not rasterized. The document opens " +
        "cleanly in Microsoft Word, Google Docs, and Pages. Saved to output_path " +
        "(defaults to the input path with a .docx extension).",
      inputSchema: {
        input_path: z
          .string()
          .describe(
            "ABSOLUTE path to a Markdown file to convert (e.g. '/Users/me/project/docs/report.md'). " +
              "MUST be absolute — relative paths are rejected because the MCP server's cwd differs from your workspace. " +
              "Mutually exclusive with `markdown`.",
          )
          .optional(),
        markdown: z
          .string()
          .describe(
            "Raw Markdown text to convert. Use this when the content is not on disk. " +
              "Mutually exclusive with `input_path`.",
          )
          .optional(),
        output_path: z
          .string()
          .describe(
            "ABSOLUTE path for the output .docx (e.g. '/Users/me/project/triage/report.docx'). " +
              "MUST be absolute — relative paths are rejected because the MCP server's cwd differs from your workspace. " +
              "Defaults to the input_path with a .docx extension.",
          )
          .optional(),
        title: z
          .string()
          .describe("Title shown in docx metadata and as a title paragraph on the first page.")
          .optional(),
        page_size: z
          .enum(["A4", "LETTER", "LEGAL"])
          .describe("Page size for the document. Defaults to A4.")
          .optional(),
      },
      annotations: {
        title: "Convert Markdown to Word (.docx)",
        readOnlyHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      /* ---------- Resolve markdown content ---------- */
      let mdContent: string;
      let resolvedInputPath: string | undefined;

      if (args.input_path && args.markdown) {
        return errorResult("Provide either input_path or markdown, not both.");
      }

      if (args.input_path) {
        if (!path.isAbsolute(args.input_path)) {
          return errorResult(
            `input_path must be an absolute path (got '${args.input_path}'). ` +
              "Relative paths resolve to the MCP server directory, not your workspace. " +
              "Use the full path, e.g. '/Users/you/project/docs/report.md'.",
          );
        }
        resolvedInputPath = args.input_path;
        if (!fs.existsSync(resolvedInputPath)) {
          return errorResult(`File not found: ${resolvedInputPath}`);
        }
        mdContent = fs.readFileSync(resolvedInputPath, "utf-8");
      } else if (args.markdown) {
        mdContent = args.markdown;
      } else {
        return errorResult("Provide either input_path (path to a .md file) or markdown (raw text).");
      }

      if (mdContent.trim().length === 0) {
        return errorResult("Markdown content is empty.");
      }

      /* ---------- Resolve output path ---------- */
      let outPath: string;
      if (args.output_path) {
        if (!path.isAbsolute(args.output_path)) {
          return errorResult(
            `output_path must be an absolute path (got '${args.output_path}'). ` +
              "Relative paths resolve to the MCP server directory, not your workspace. " +
              "Use the full path, e.g. '/Users/you/project/triage/report.docx'.",
          );
        }
        outPath = args.output_path;
      } else if (resolvedInputPath) {
        outPath = resolvedInputPath.replace(/\.md$/i, ".docx");
      } else {
        return errorResult(
          "output_path is required when using raw markdown input. " +
            "Provide an absolute path, e.g. '/Users/you/project/triage/report.docx'.",
        );
      }

      /* ---------- Convert ---------- */
      let docxBuffer: Buffer;
      try {
        docxBuffer = await markdownToDocx(mdContent, {
          title: args.title,
          pageSize: args.page_size as "A4" | "LETTER" | "LEGAL" | undefined,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return errorResult(`DOCX generation failed: ${msg}`);
      }

      /* ---------- Write ---------- */
      try {
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, docxBuffer);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return errorResult(`Failed to write DOCX: ${msg}`);
      }

      return jsonResult({
        ok: true,
        output_path: outPath,
        size_bytes: docxBuffer.length,
        page_size: args.page_size ?? "A4",
        title: args.title ?? null,
        source: resolvedInputPath ? "file" : "inline",
      });
    },
  );
}
