/**
 * MCP tool: render a registered markdown report as a narrated MP4.
 *
 * Reuses the same Paged.js print view that powers the PDF export. Each
 * `.pagedjs_page` becomes one slide; `<!-- voice: ... -->` HTML comments
 * inside that page become the narration; OpenAI TTS turns narration into
 * MP3; FFmpeg stitches `[png + mp3]` pairs into an MP4.
 *
 * Authoring convention (in the markdown):
 *
 *     ## Use case 1 — Cost visibility
 *
 *     <!-- voice:
 *     This is where every customer journey starts: visibility…
 *     -->
 *
 *     **What it does.** …
 *
 * Inputs mirror `harness_ccm_finops_report_render` so the same `id` /
 * `markdown_path` can be re-used. Returns the absolute MP4 path plus a
 * download URL the user can hit from the browser.
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
import { renderVideo, type VideoRenderResult } from "../report-renderer/video.js";
import { resolveTtsProvider } from "../report-renderer/tts/factory.js";

/**
 * Tailored advice for the user based on what actually happened. Three cases
 * matter: (1) we narrated everything we found, (2) the markdown had voice
 * comments but no TTS key was configured so we silently skipped them, and
 * (3) the markdown had zero voice comments to begin with.
 */
function buildHint(result: VideoRenderResult, hasProvider: boolean): string {
  const skipped = result.slides.filter((s) => s.narration && !s.audioFile).length;
  if (skipped > 0 && !hasProvider) {
    return (
      `${skipped} slide${skipped === 1 ? "" : "s"} contained a <!-- voice: ... --> comment but ` +
      "no TTS provider is configured, so they were rendered silently. Set one of " +
      "LOCAL_TTS_BASE_URL (OpenAI-compatible local server), OPENAI_API_KEY, " +
      "ELEVENLABS_API_KEY, AZURE_SPEECH_KEY+AZURE_SPEECH_REGION, or GOOGLE_TTS_API_KEY " +
      "in your .env (or shell) and re-run to add narration."
    );
  }
  if (result.slides.every((s) => !s.narration)) {
    return (
      "Video rendered with no narration. Add `<!-- voice: ... -->` comments inside the markdown " +
      "(one per logical slide) and re-run to add a voice-over."
    );
  }
  return "Open `out_path` locally, or hit `download_url` from a browser to grab the MP4.";
}

// Theme IDs are discovered at runtime — no hard-coded enum here.
const VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;
const TTS_PROVIDERS = ["openai", "elevenlabs", "azure", "google", "local"] as const;

export function registerCcmVideoRenderTool(server: McpServer, config: Config): void {
  server.registerTool(
    "harness_ccm_finops_video_render",
    {
      description:
        "Render a registered markdown report as a narrated MP4 video. Each Paged.js page in " +
        "the print view becomes one slide; `<!-- voice: ... -->` HTML comments inside the " +
        "markdown (invisible in the rendered HTML/PDF) become the narration for that slide. " +
        "OpenAI TTS produces the audio; FFmpeg stitches PNG + MP3 per slide into a 1920x1080 " +
        "H.264 MP4. Slides without voice comments hold silently for `min_dwell_ms` (default 2.5s). " +
        "Requires OPENAI_API_KEY in the env if any voice comments are present. Returns the " +
        "absolute MP4 path, a download URL, and a manifest summarising every slide. " +
        "Inputs: markdown_path (absolute path to the .md, same as the report-render tool); " +
        "id (optional stable slug); theme; voice (default `alloy`); width / height / fps; " +
        "min_dwell_ms (silent dwell). " +
        "Authoring tip: the convention is one `<!-- voice: ... -->` per logical page; " +
        "multiple comments inside the same page get concatenated in document order. " +
        "Optional metadata: `<!-- voice voice=\"nova\" rate=1.05: ... -->`.",
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
            "Theme to render the slides in. Default `harness`. The video frames the print-view " +
              "of the chosen theme exactly as the PDF export does. Built-in: harness, modern, " +
              "glass, kinetic. Customer packs may add more (e.g. 'acme').",
          )
          .optional(),
        voice: z
          .enum(VOICES)
          .describe(
            "OpenAI TTS voice. `alloy` is a neutral business default. Per-comment overrides via " +
              "`<!-- voice voice=\"nova\": ... -->` take precedence over this default.",
          )
          .optional(),
        width: z
          .number()
          .int()
          .min(640)
          .max(3840)
          .describe("Output width in pixels. Default 1920.")
          .optional(),
        height: z
          .number()
          .int()
          .min(360)
          .max(2160)
          .describe("Output height in pixels. Default 1080.")
          .optional(),
        fps: z
          .number()
          .int()
          .min(15)
          .max(60)
          .describe("Output frames per second. Default 30.")
          .optional(),
        min_dwell_ms: z
          .number()
          .int()
          .min(500)
          .max(60_000)
          .describe(
            "Minimum dwell per slide in milliseconds. Used as the full duration for slides " +
              "with no voice comment, and as the floor for narrated slides. Default 2500.",
          )
          .optional(),
        transitions: z
          .enum(["cut", "xfade"])
          .describe(
            "Transition between adjacent slides. `cut` does a hard cut (fastest; concat-demuxer " +
              "stream copy). `xfade` cross-dissolves between every slide pair via a single-pass " +
              "filtergraph (more cinematic, ~2x slower). Default `xfade`.",
          )
          .optional(),
        transition_ms: z
          .number()
          .int()
          .min(50)
          .max(2000)
          .describe(
            "Cross-dissolve duration in milliseconds when transitions === 'xfade'. Default 400.",
          )
          .optional(),
        ken_burns: z
          .boolean()
          .describe(
            "Subtle slow-zoom on every still (1.0x → 1.04x). Off by default because it reduces " +
              "readability of text-heavy report slides; turn on for image-rich decks.",
          )
          .optional(),
        captions: z
          .boolean()
          .describe(
            "Burn narration text into the video as captions whenever a slide has narration. " +
              "Default true. Silent slides never get captions.",
          )
          .optional(),
        tts_provider: z
          .enum(TTS_PROVIDERS)
          .describe(
            "Force a specific TTS provider. If omitted the first one whose env var(s) are set " +
              "wins, in order: local (LOCAL_TTS_BASE_URL, e.g. an Orpheus-FastAPI / " +
              "Kokoro-FastAPI / LMStudio server speaking the OpenAI /v1/audio/speech protocol), " +
              "openai (OPENAI_API_KEY), elevenlabs (ELEVENLABS_API_KEY), azure " +
              "(AZURE_SPEECH_KEY+AZURE_SPEECH_REGION), google (GOOGLE_TTS_API_KEY).",
          )
          .optional(),
        tts_cache: z
          .boolean()
          .describe(
            "Cache synthesized audio on disk under `<cwd>/.cache/voice/`, keyed by " +
              "sha256(provider|voice|rate|text). Re-renders only re-call TTS for changed " +
              "narration. Default true.",
          )
          .optional(),
      },
      annotations: {
        title: "Render a Narrated Video",
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

        // Reachability check before we spend a minute spinning up Chromium.
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

        // Resolve a TTS provider from `args.tts_provider` (or the first env
        // var present), wrapped with the on-disk cache by default. The render
        // module itself errors with a precise message if a voice comment is
        // encountered without a provider configured.
        const tts = resolveTtsProvider({
          ...(args.tts_provider ? { providerName: args.tts_provider } : {}),
          ...(args.tts_cache === false ? { cache: false } : {}),
        });

        const doc = await renderDocument(mdPath);
        const result = await renderVideo({
          baseUrl,
          meta: doc.meta,
          themeId,
          docPath: `/reports/${entry.id}/`,
          tts,
          ...(args.voice ? { voice: args.voice } : {}),
          ...(typeof args.width === "number" ? { width: args.width } : {}),
          ...(typeof args.height === "number" ? { height: args.height } : {}),
          ...(typeof args.fps === "number" ? { fps: args.fps } : {}),
          ...(typeof args.min_dwell_ms === "number" ? { minDwellMs: args.min_dwell_ms } : {}),
          ...(args.transitions ? { transitions: args.transitions } : {}),
          ...(typeof args.transition_ms === "number" ? { transitionMs: args.transition_ms } : {}),
          ...(typeof args.ken_burns === "boolean" ? { kenBurns: args.ken_burns } : {}),
          ...(typeof args.captions === "boolean" ? { captions: args.captions } : {}),
        });

        const downloadUrl = `${baseUrl}/reports/${entry.id}/video.mp4?theme=${encodeURIComponent(
          themeId,
        )}`;

        return jsonResult({
          ok: true,
          id: entry.id,
          theme: themeId,
          out_path: result.outPath,
          file_name: result.fileName,
          manifest_path: result.manifestPath,
          download_url: downloadUrl,
          markdown_link: `[Download narrated video](${downloadUrl})`,
          total_duration_ms: result.totalDurationMs,
          slides: result.slides.length,
          narrated_slides: result.slides.filter((s) => s.audioFile).length,
          characters_total: result.slides.reduce((acc, s) => acc + s.characters, 0),
          tts_provider: tts?.name ?? null,
          skipped_voice_comments: !tts ? result.slides.filter((s) => s.narration && !s.audioFile).length : 0,
          hint: buildHint(result, !!tts),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Video render failed: ${msg}`);
      }
    },
  );
}
