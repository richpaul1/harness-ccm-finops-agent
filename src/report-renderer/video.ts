/**
 * Narrated video export — drives a headless Chromium (Playwright) at the
 * running report server, captures one PNG per Paged.js page, generates TTS
 * audio for any `<!-- voice: ... -->` comments inside that page, and stitches
 * the result into an MP4 with FFmpeg.
 *
 * Same on-ramp as `pdf.ts`:
 *   1. Open `<baseUrl><docPath>?mode=print&theme=…` in headless Chromium.
 *   2. Wait for `window.__PAGED_READY__` (set by the theme's Paged.Handler).
 *   3. Iterate `.pagedjs_page` elements, capture PNGs, extract voice comments.
 *   4. TTS each non-empty narration → MP3 + ffprobe duration.
 *   5. ffmpeg concat: each scene = [png + (mp3 | silence) + duration].
 *
 * Frame stitching, not screen recording. Each slide is a static still held
 * for `max(audioDuration, minDwellMs)`. Deterministic, debuggable, and the
 * same fix that unblocks the PDF render (Paged.js `__PAGED_READY__` handshake)
 * automatically benefits this pipeline.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
import slugify from "slugify";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import ffprobePath from "@ffprobe-installer/ffprobe";
import { createLogger } from "../utils/logger.js";
import type { DocMeta } from "./render.js";
import type { ParsedVoiceComment } from "./voice-extract.js";
import type { TtsProvider } from "./tts/index.js";

const log = createLogger("video-render");

export interface VideoRenderOptions {
  baseUrl: string;
  meta: DocMeta;
  themeId?: string;
  /** URL path for this doc, e.g. "/reports/<id>/". Trailing slash matters. */
  docPath?: string;
  /** Output directory; defaults to `<cwd>/out`. */
  outDir?: string;
  /** Absolute output path; takes precedence over outDir + slug. */
  outFile?: string;
  /** TTS provider used for any non-empty narration. Required to actually speak. */
  tts?: TtsProvider;
  /** Default voice (provider-specific). */
  voice?: string;
  /** Per-slide minimum dwell when narration is missing (ms). Default 2500. */
  minDwellMs?: number;
  /** Per-slide pad after narration ends (ms). Default 400. */
  trailingPadMs?: number;
  /** Output video width in pixels. Default 1920. */
  width?: number;
  /** Output video height in pixels. Default 1080. */
  height?: number;
  /** Frames per second. Default 30. */
  fps?: number;
  // ── Phase 2 polish ──────────────────────────────────────────────────────
  /**
   * Transition between adjacent slides:
   *   - "cut"   — hard cut (Phase 1 default; concat-demuxer; fastest).
   *   - "xfade" — 400ms cross-dissolve via a single-pass filtergraph.
   *               Slower (re-encodes once for the whole timeline) but cinematic.
   * Default `xfade`.
   */
  transitions?: "cut" | "xfade";
  /** Cross-dissolve duration in milliseconds when transitions === "xfade". Default 400. */
  transitionMs?: number;
  /**
   * Subtle Ken Burns slow-zoom on every still (1.0x → 1.04x over the dwell).
   * OFF by default because text-heavy report slides lose readability when
   * zoomed; enable it for image-rich decks.
   */
  kenBurns?: boolean;
  /**
   * Burn-in narration as captions when narration text exists for a slide.
   * Default `true`. Skips silent slides automatically.
   */
  captions?: boolean;
}

export interface VideoSlideManifest {
  index: number;
  pageIndex: number;
  pngFile: string;
  audioFile?: string;
  /** Per-slide SRT file (Phase 2). Present whenever the slide has narration. */
  srtFile?: string;
  durationMs: number;
  narration?: string;
  voice?: string;
  rate?: number;
  characters: number;
}

export interface VideoRenderResult {
  outPath: string;
  fileName: string;
  manifestPath: string;
  slides: VideoSlideManifest[];
  totalDurationMs: number;
}

const DEFAULT_MIN_DWELL_MS = 2500;
const DEFAULT_TRAILING_PAD_MS = 400;
const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;
const DEFAULT_FPS = 30;
const DEFAULT_TRANSITION_MS = 400;
const KEN_BURNS_ZOOM_END = 1.04;

// ── Caption defaults (all overridable via env) ────────────────────────────
// Fontsize is in libass virtual pixels (PlayRes 384×288). At 1080p the scale
// factor is ~3.75×, so fontsize 14 → ~52px actual. Tune up/down to taste.
const CAPTION_FONTSIZE   = intEnv("CAPTION_FONTSIZE",   11);
const CAPTION_MAX_LINES  = intEnv("CAPTION_MAX_LINES",   2);
const CAPTION_LINE_WIDTH = intEnv("CAPTION_LINE_WIDTH",  55);
const CAPTION_FONT       = process.env.CAPTION_FONT?.trim() || "Arial";
/**
 * Height of the dedicated caption bar in actual output pixels.
 * Playwright captures slides at (height - CAPTION_BAR_HEIGHT) so slide
 * content never bleeds into the bar. FFmpeg pads the PNG back to full height
 * and draws the dark bar before burning in subtitles. Default 100px (≈9% of
 * 1080p — roomy enough for 3 lines at Fontsize=14 with comfortable margins).
 */
const CAPTION_BAR_HEIGHT = intEnv("CAPTION_BAR_HEIGHT", 120);
/** Hex RGB colour of the caption bar (no leading #). Default near-black. */
const CAPTION_BAR_COLOR  = process.env.CAPTION_BAR_COLOR?.replace(/^#/, "").trim() || "0d0d0d";

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function renderVideo(opts: VideoRenderOptions): Promise<VideoRenderResult> {
  const themeId = opts.themeId ?? "harness";
  const docPath = opts.docPath ?? "/";
  const minDwellMs = opts.minDwellMs ?? DEFAULT_MIN_DWELL_MS;
  const trailingPadMs = opts.trailingPadMs ?? DEFAULT_TRAILING_PAD_MS;
  const width = opts.width ?? DEFAULT_WIDTH;
  const height = opts.height ?? DEFAULT_HEIGHT;
  const fps = opts.fps ?? DEFAULT_FPS;
  const transitions = opts.transitions ?? "xfade";
  const transitionMs = opts.transitionMs ?? DEFAULT_TRANSITION_MS;
  const kenBurns = opts.kenBurns ?? false;
  const captionsEnabled = opts.captions ?? true;

  // ── Output paths ──────────────────────────────────────────────────────────
  let outPath: string;
  if (opts.outFile) {
    outPath = path.resolve(opts.outFile);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
  } else {
    const outDir = opts.outDir ?? path.resolve(process.cwd(), "out");
    await fs.mkdir(outDir, { recursive: true });
    const slug = slugify(`${opts.meta.customer || "report"}-${opts.meta.title}`, {
      lower: true,
      strict: true,
    });
    const date = opts.meta.date || new Date().toISOString().slice(0, 10);
    outPath = path.join(outDir, `${slug}-${themeId}-${date}.mp4`);
  }
  const manifestPath = `${outPath.replace(/\.mp4$/, "")}.manifest.json`;

  // Per-render scratch directory keeps frame PNGs / audio MP3s isolated so
  // concurrent renders never stomp on each other and a debug session can
  // inspect what went into the final cut.
  const workDir = `${outPath.replace(/\.mp4$/, "")}.work`;
  await fs.rm(workDir, { recursive: true, force: true });
  await fs.mkdir(workDir, { recursive: true });

  // ── Phase 1: capture PNGs + voice comments ────────────────────────────────
  const captures = await capturePagedScenes({
    baseUrl: opts.baseUrl,
    docPath,
    themeId,
    width,
    height,
    captionBarHeight: captionsEnabled ? CAPTION_BAR_HEIGHT : 0,
    workDir,
  });
  if (captures.length === 0) {
    throw new Error("Video render produced zero pages; the print view returned no `.pagedjs_page` elements");
  }

  // ── Phase 2: TTS each non-empty narration ─────────────────────────────────
  const slides: VideoSlideManifest[] = [];
  for (let i = 0; i < captures.length; i++) {
    const cap = captures[i]!;
    const slide: VideoSlideManifest = {
      index: i,
      pageIndex: cap.pageIndex,
      pngFile: cap.pngFile,
      durationMs: minDwellMs,
      characters: 0,
    };
    if (cap.narration && !opts.tts) {
      // Graceful degradation: a voice comment is present but no TTS provider
      // is configured (e.g. OPENAI_API_KEY is unset). We still render the
      // slide, just silently. The slide carries the narration text in the
      // manifest so the author can see the comment was detected and either
      // (a) plug in a key + re-render, or (b) prune the comment.
      log.warn("Voice comment skipped — no TTS provider configured", {
        slide: i + 1,
        chars: cap.narration.text.length,
      });
      slide.narration = cap.narration.text;
      slide.characters = cap.narration.text.length;
    } else if (cap.narration && opts.tts) {
      const tts = opts.tts;
      const audioOut = path.join(workDir, `slide-${String(i + 1).padStart(3, "0")}.mp3`);
      const synth = await tts.synthesize(cap.narration.text, {
        voice: cap.narration.voice ?? opts.voice,
        rate: cap.narration.rate,
      });
      await fs.writeFile(audioOut, synth.buffer);
      const audioMs = await probeDurationMs(audioOut);
      slide.audioFile = audioOut;
      slide.durationMs = Math.max(minDwellMs, Math.round(audioMs + trailingPadMs));
      slide.narration = cap.narration.text;
      slide.voice = cap.narration.voice ?? opts.voice;
      slide.rate = cap.narration.rate;
      slide.characters = cap.narration.text.length;
      log.info("Slide narrated", {
        slide: i + 1,
        chars: cap.narration.text.length,
        audioMs: Math.round(audioMs),
        dwellMs: slide.durationMs,
      });
    } else {
      log.info("Slide silent", { slide: i + 1, dwellMs: minDwellMs });
    }
    // Phase 2 polish: write an SRT alongside any narrated slide. We attach
    // the SRT path here (not in the loop above) so silent slides + narrated-
    // but-no-key slides both stay tidy.
    if (captionsEnabled && slide.narration && slide.audioFile) {
      const srtPath = path.join(workDir, `slide-${String(i + 1).padStart(3, "0")}.srt`);
      await fs.writeFile(srtPath, buildSrt(slide.narration, slide.durationMs));
      slide.srtFile = srtPath;
    }
    slides.push(slide);
  }

  // ── Phase 3: ffmpeg stitch ────────────────────────────────────────────────
  await stitchSlidesToMp4({
    slides,
    outPath,
    workDir,
    width,
    height,
    fps,
    transitions,
    transitionMs,
    kenBurns,
    captionBarHeight: captionsEnabled ? CAPTION_BAR_HEIGHT : 0,
  });

  const totalDurationMs = slides.reduce((acc, s) => acc + s.durationMs, 0);

  // Manifest sits next to the MP4 so a developer can `cat` it and verify
  // exactly which page got which narration / dwell.
  const manifest = {
    outFile: outPath,
    theme: themeId,
    width,
    height,
    fps,
    minDwellMs,
    trailingPadMs,
    transitions,
    transitionMs,
    kenBurns,
    captionsEnabled,
    totalDurationMs,
    slides: slides.map((s) => ({
      ...s,
      pngFile: path.basename(s.pngFile),
      audioFile: s.audioFile ? path.basename(s.audioFile) : undefined,
      srtFile: s.srtFile ? path.basename(s.srtFile) : undefined,
    })),
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  return {
    outPath,
    fileName: path.basename(outPath),
    manifestPath,
    slides,
    totalDurationMs,
  };
}

// ─── Playwright capture ──────────────────────────────────────────────────────

interface CapturedScene {
  pageIndex: number;
  pngFile: string;
  narration?: ParsedVoiceComment;
}

interface CaptureOptions {
  baseUrl: string;
  docPath: string;
  themeId: string;
  width: number;
  height: number;
  /** Height reserved for the caption bar (actual px). Viewport is reduced by
   *  this so slide content never renders inside the bar. */
  captionBarHeight: number;
  workDir: string;
}

async function capturePagedScenes(opts: CaptureOptions): Promise<CapturedScene[]> {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error(
      "Video export requires Playwright. Install with: pnpm add playwright && npx playwright install chromium",
    );
  }

  const browser = await chromium.launch();
  try {
    // Capture viewport at full video width. Height is the full frame so
    // Paged.js can render each page at its natural CSS dimensions. The bottom
    // caption bar strip is removed by FFmpeg's crop filter during encoding.
    const context = await browser.newContext({
      viewport: { width: opts.width, height: opts.height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await page.emulateMedia({ media: "print" });

    const docPath = opts.docPath.endsWith("/") ? opts.docPath : `${opts.docPath}/`;
    const url = `${opts.baseUrl}${docPath}?mode=print&theme=${encodeURIComponent(opts.themeId)}`;
    log.info("Navigating", { url });
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForFunction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__PAGED_READY__ === true,
      null,
      { timeout: 120_000 },
    );
    // Same trick as pdf.ts — let Paged.js settle, then expand the page
    // container so every page is reachable / fits in screenshot bounds.
    await page.waitForTimeout(400);
    await page.addStyleTag({
      content: `
        html, body, .pagedjs_pages { height: auto !important; overflow: visible !important; }
        .pagedjs_page { box-shadow: none !important; margin: 0 !important; }
        ${opts.captionBarHeight > 0 ? `
        /* Hide Paged.js running bottom margin boxes (page number, footer text)
           so they don't visually bleed into the caption bar area. The margin
           space itself is still present — we clip it away in the screenshot. */
        .pagedjs_margin-bottom,
        .pagedjs_margin-bottom-left,
        .pagedjs_margin-bottom-center,
        .pagedjs_margin-bottom-right { visibility: hidden !important; }
        ` : ""}
      `,
    });
    await page.waitForTimeout(200);

    const pageHandles = await page.$$(".pagedjs_page");
    log.info("Paginated", { pages: pageHandles.length });

    const scenes: CapturedScene[] = [];
    for (let i = 0; i < pageHandles.length; i++) {
      const handle = pageHandles[i]!;
      // Voice narration was injected by the markdown render step as
      // `<div class="voice-narration" hidden data-text="…" data-voice="…"
      //  data-rate="…">`. Walking those out of each `.pagedjs_page` is more
      // robust than DOM Comment nodes — Paged.js's chunker preserves elements
      // but quietly drops Comment nodes during cloneNode operations.
      const narrationData = await handle.evaluate(
        (el: Element): Array<{ text: string; voice?: string; rate?: string }> => {
          const out: Array<{ text: string; voice?: string; rate?: string }> = [];
          const nodes = el.querySelectorAll<HTMLElement>(".voice-narration[data-text]");
          nodes.forEach((n) => {
            const text = n.getAttribute("data-text") || "";
            if (!text) return;
            const entry: { text: string; voice?: string; rate?: string } = { text };
            const v = n.getAttribute("data-voice");
            const r = n.getAttribute("data-rate");
            if (v) entry.voice = v;
            if (r) entry.rate = r;
            out.push(entry);
          });
          return out;
        },
      );

      let narration: ParsedVoiceComment | undefined;
      if (narrationData.length > 0) {
        const rateRaw = narrationData.find((n) => n.rate)?.rate;
        const rateNum = rateRaw != null ? Number(rateRaw) : NaN;
        narration = {
          text: narrationData.map((n) => n.text).join(" "),
          voice: narrationData.find((n) => n.voice)?.voice,
          ...(Number.isFinite(rateNum) && rateNum > 0 ? { rate: rateNum } : {}),
        };
      }

      const pngFile = path.join(opts.workDir, `slide-${String(i + 1).padStart(3, "0")}.png`);
      await handle.screenshot({ path: pngFile, type: "png" });
      scenes.push({ pageIndex: i, pngFile, narration });
    }

    return scenes;
  } finally {
    await browser.close();
  }
}

// ─── ffmpeg / ffprobe wrappers ───────────────────────────────────────────────

const FFMPEG_BIN = (ffmpegPath as unknown as { path: string }).path;
const FFPROBE_BIN = (ffprobePath as unknown as { path: string }).path;

async function probeDurationMs(file: string): Promise<number> {
  const out = await runCmd(FFPROBE_BIN, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const seconds = Number(out.trim());
  if (!Number.isFinite(seconds)) {
    throw new Error(`ffprobe could not parse duration from ${file}: ${out}`);
  }
  return seconds * 1000;
}

interface StitchOptions {
  slides: VideoSlideManifest[];
  outPath: string;
  workDir: string;
  width: number;
  height: number;
  fps: number;
  transitions: "cut" | "xfade";
  transitionMs: number;
  kenBurns: boolean;
  captionBarHeight: number;
}

async function stitchSlidesToMp4(opts: StitchOptions): Promise<void> {
  // Strategy: build per-slide MP4 segments with a constant resolution + fps.
  // For "cut" transitions we then concat-demuxer them together (stream copy,
  // very fast). For "xfade" we run a single second-pass through ffmpeg with
  // a generated filter graph that cross-dissolves between adjacent segments.
  const segments: string[] = [];
  for (let i = 0; i < opts.slides.length; i++) {
    const slide = opts.slides[i]!;
    const segPath = path.join(opts.workDir, `seg-${String(i + 1).padStart(3, "0")}.mp4`);
    await encodeSegment({
      pngFile: slide.pngFile,
      audioFile: slide.audioFile,
      srtFile: slide.srtFile,
      durationMs: slide.durationMs,
      width: opts.width,
      height: opts.height,
      fps: opts.fps,
      kenBurns: opts.kenBurns,
      captionBarHeight: opts.captionBarHeight,
      outPath: segPath,
    });
    segments.push(segPath);
  }

  if (opts.transitions === "xfade" && segments.length > 1) {
    await stitchWithXfade({
      segments,
      slides: opts.slides,
      transitionMs: opts.transitionMs,
      outPath: opts.outPath,
      width: opts.width,
      height: opts.height,
      fps: opts.fps,
    });
    return;
  }

  // Hard-cut concat. Faster, simpler, and bit-exact stream copy.
  const listFile = path.join(opts.workDir, "concat.txt");
  await fs.writeFile(
    listFile,
    segments.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n") + "\n",
  );

  await runCmd(FFMPEG_BIN, [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listFile,
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    opts.outPath,
  ]);
}

interface EncodeSegmentOptions {
  pngFile: string;
  audioFile?: string;
  srtFile?: string;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  kenBurns: boolean;
  /** Height of the caption bar in actual output pixels (0 = no bar). */
  captionBarHeight: number;
  outPath: string;
}

async function encodeSegment(opts: EncodeSegmentOptions): Promise<void> {
  const seconds = (opts.durationMs / 1000).toFixed(3);
  const totalFrames = Math.max(1, Math.round((opts.durationMs / 1000) * opts.fps));
  const args: string[] = ["-y"];
  args.push("-loop", "1", "-t", seconds, "-i", opts.pngFile);
  if (opts.audioFile) {
    args.push("-i", opts.audioFile);
  } else {
    args.push(
      "-f",
      "lavfi",
      "-t",
      seconds,
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=44100",
    );
  }

  // Compose the video filter chain. Order matters: zoompan first (operates
  // on the raw still), then scale + pad to lock dimensions, then the caption
  // bar (drawbox fills the reserved strip with a solid dark colour), then
  // optional subtitles burn-in (libass renders against the final canvas),
  // then format.
  const vfParts: string[] = [];
  const slideH = opts.height - opts.captionBarHeight;  // height of the slide area PNG
  if (opts.captionBarHeight > 0) {
    // Crop the bottom captionBarHeight/videoHeight fraction of the PNG.
    // The page is rendered at its CSS @page size (794×1124 for A4), so we
    // compute the strip proportionally. `trunc()` keeps the value even so
    // the codec doesn't complain about odd dimensions later.
    const cropFrac = (1 - opts.captionBarHeight / opts.height).toFixed(6);
    vfParts.push(`crop=iw:trunc(ih*${cropFrac}):0:0`);
  }
  if (opts.kenBurns) {
    // zoompan works on the slide area. We scale to slideH first, then pad
    // below to the full canvas height so the bar is added after the zoom.
    const zoomStep = ((KEN_BURNS_ZOOM_END - 1) / totalFrames).toFixed(6);
    vfParts.push(
      `zoompan=z='min(zoom+${zoomStep},${KEN_BURNS_ZOOM_END})':d=${totalFrames}:` +
        `s=${opts.width}x${slideH}:fps=${opts.fps}`,
    );
  } else {
    // Scale the PNG to fill the slide area, keeping aspect ratio.
    vfParts.push(
      `scale=${opts.width}:${slideH}:force_original_aspect_ratio=decrease`,
      `pad=${opts.width}:${slideH}:(ow-iw)/2:(oh-ih)/2:color=black`,
    );
  }
  if (opts.captionBarHeight > 0) {
    // Expand canvas down to full frame height. The new pixels at the bottom
    // are black (0x000000) — drawbox will paint them with the bar colour next.
    vfParts.push(
      `pad=${opts.width}:${opts.height}:0:0:color=black`,
    );
    // Fill the bar strip with the configured colour. `t=fill` paints the
    // interior rather than just the border.
    const barY = opts.height - opts.captionBarHeight;
    vfParts.push(
      `drawbox=x=0:y=${barY}:w=${opts.width}:h=${opts.captionBarHeight}:color=0x${CAPTION_BAR_COLOR}@1.0:t=fill`,
    );
  }
  if (opts.srtFile) {
    // libass drives `subtitles=`; it ships inside the static ffmpeg binary.
    // force_style overrides the .srt's default look so captions render the
    // same regardless of the subtitle file's metadata. The path is escaped
    // for filter-graph syntax (colons + apostrophes are special).
    vfParts.push(
      `subtitles=${escapeFilterPath(opts.srtFile)}:force_style='${SUBTITLE_STYLE}'`,
    );
  }
  vfParts.push("setsar=1", "format=yuv420p");

  args.push(
    "-vf",
    vfParts.join(","),
    "-r",
    String(opts.fps),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-shortest",
    "-movflags",
    "+faststart",
    opts.outPath,
  );
  await runCmd(FFMPEG_BIN, args);
}

// libass force_style tokens; tuned for 1080p screencast captions over a
// translucent dark background so the text reads on any slide background.
// SUBTITLE_STYLE is built at module-load time so it picks up env overrides.
// MarginV centres the entire text block vertically within the bar.
// libass PlayRes is 384×288; scale factor to actual pixels is videoH/PlayResY.
//
//   barVirtual      = barHeight × (PlayResY / videoHeight)
//   textBlockVirtual= lines × fontSize × lineSpacing(1.2)
//   MarginV         = (barVirtual − textBlockVirtual) / 2
//
// This places equal whitespace above and below the text within the bar.
// A minimum of 2 virtual px prevents the text from touching the frame edge.
const _LINE_SPACING       = 1.2;
const _barVirtual         = Math.round(CAPTION_BAR_HEIGHT * 288 / 1080);
const _textBlockVirtual   = CAPTION_MAX_LINES * CAPTION_FONTSIZE * _LINE_SPACING;
const _marginV            = Math.max(2, Math.round((_barVirtual - _textBlockVirtual) / 2));
const SUBTITLE_STYLE = [
  `Fontname=${CAPTION_FONT}`,
  `Fontsize=${CAPTION_FONTSIZE}`,
  "Bold=0",
  "PrimaryColour=&H00FFFFFF",   // opaque white text
  "BackColour=&H00000000",      // transparent — bar colour comes from drawbox
  "BorderStyle=1",              // outline-only (no secondary box; bar IS the box)
  "Outline=1",                  // thin dark outline keeps text readable on light bars
  "OutlineColour=&H99000000",
  "Shadow=0",
  `MarginV=${_marginV}`,        // centres text in the bar at current bar height
  "MarginL=40",
  "MarginR=40",
  "Alignment=2",                // bottom-center
  "WrapStyle=2",
].join(",");

interface XfadeStitchOptions {
  segments: string[];
  slides: VideoSlideManifest[];
  transitionMs: number;
  outPath: string;
  width: number;
  height: number;
  fps: number;
}

/**
 * Stitch per-slide MP4 segments together with `xfade` cross-dissolves
 * between every adjacent pair, plus matching `acrossfade` on the audio.
 *
 * The filtergraph is:
 *
 *    [0:v][1:v] xfade=offset=O0[v01];
 *    [v01][2:v] xfade=offset=O1[v012];
 *    …
 *    [0:a][1:a] acrossfade=d=T[a01];
 *    [a01][2:a] acrossfade=d=T[a012];
 *    …
 *
 * The offset for the i-th xfade is the cumulative duration of segments 0..i
 * minus i*T (the dissolve overlap "eats" T from the timeline at each cut).
 */
async function stitchWithXfade(opts: XfadeStitchOptions): Promise<void> {
  const fadeSec = opts.transitionMs / 1000;
  const segDurationsSec = opts.slides.map((s) => s.durationMs / 1000);

  // Build the chained xfade graph. Each xfade's `offset` is the running
  // wall-clock time at which the *next* segment starts blending in.
  const videoChain: string[] = [];
  const audioChain: string[] = [];
  let lastV = "[0:v]";
  let lastA = "[0:a]";
  let runningOffset = segDurationsSec[0]! - fadeSec;
  for (let i = 1; i < opts.segments.length; i++) {
    const vTag = i === opts.segments.length - 1 ? "[vout]" : `[v${i}]`;
    const aTag = i === opts.segments.length - 1 ? "[aout]" : `[a${i}]`;
    videoChain.push(
      `${lastV}[${i}:v]xfade=transition=fade:duration=${fadeSec.toFixed(3)}:offset=${runningOffset.toFixed(3)}${vTag}`,
    );
    audioChain.push(
      `${lastA}[${i}:a]acrossfade=d=${fadeSec.toFixed(3)}:c1=tri:c2=tri${aTag}`,
    );
    lastV = vTag;
    lastA = aTag;
    runningOffset += segDurationsSec[i]! - fadeSec;
  }

  const filter = [...videoChain, ...audioChain].join(";");
  const args: string[] = ["-y"];
  for (const seg of opts.segments) {
    args.push("-i", seg);
  }
  args.push(
    "-filter_complex",
    filter,
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-r",
    String(opts.fps),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    opts.outPath,
  );
  await runCmd(FFMPEG_BIN, args);
}

/**
 * Format milliseconds as an SRT timestamp, e.g. 1234ms → "00:00:01,234".
 */
function formatSrtTimestamp(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const hh = Math.floor(total / 3_600_000);
  const mm = Math.floor((total % 3_600_000) / 60_000);
  const ss = Math.floor((total % 60_000) / 1_000);
  const mmm = total % 1_000;
  const pad = (n: number, w: number) => String(n).padStart(w, "0");
  return `${pad(hh, 2)}:${pad(mm, 2)}:${pad(ss, 2)},${pad(mmm, 3)}`;
}

/**
 * Build a single-cue SRT covering the whole slide. We don't try to time-align
 * individual phrases — slides are short, narration is one breath, and a single
 * subtitle that fades in with the slide reads cleanly. Lines longer than ~80
 * chars are word-wrapped so libass doesn't push them off-screen.
 */
function buildSrt(text: string, durationMs: number): string {
  const lines = wrapAt(text.trim(), CAPTION_LINE_WIDTH);

  // Split into pages of CAPTION_MAX_LINES each — captions scroll forward as
  // the narration progresses rather than showing one truncated block.
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += CAPTION_MAX_LINES) {
    pages.push(lines.slice(i, i + CAPTION_MAX_LINES));
  }
  if (pages.length === 0) return "";

  // Distribute the total duration proportionally by character count so each
  // page stays on screen for roughly as long as it takes to speak it.
  const pageLengths = pages.map((p) => p.join(" ").length);
  const totalChars = pageLengths.reduce((a, b) => a + b, 0);

  let srt = "";
  let cursorMs = 0;
  for (let i = 0; i < pages.length; i++) {
    const share = totalChars > 0 ? pageLengths[i]! / totalChars : 1 / pages.length;
    const pageMs = Math.round(share * durationMs);
    const startMs = cursorMs;
    // Last page always ends at the exact audio duration to avoid a gap.
    const endMs = i === pages.length - 1 ? durationMs : cursorMs + pageMs;
    cursorMs += pageMs;
    srt += `${i + 1}\n${formatSrtTimestamp(startMs)} --> ${formatSrtTimestamp(endMs)}\n${pages[i]!.join("\n")}\n\n`;
  }
  return srt;
}

function wrapAt(s: string, max: number): string[] {
  const words = s.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line.length === 0) line = w;
    else if (line.length + 1 + w.length <= max) line = `${line} ${w}`;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Escape a filesystem path for the `subtitles=` filter. ffmpeg's filter
 * grammar treats `:` as an arg separator and `\` / `'` as escapes, so any
 * absolute path needs to escape these characters.
 */
function escapeFilterPath(p: string): string {
  return p
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

function runCmd(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(
          new Error(
            `${path.basename(cmd)} exited ${code}\n` +
              `args: ${args.join(" ")}\n` +
              `stderr (last 1k): ${stderr.slice(-1024)}`,
          ),
        );
      }
    });
  });
}
