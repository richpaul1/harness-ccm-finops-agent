#!/usr/bin/env node
/**
 * Smoke test that exercises the captions burn-in path end-to-end without
 * needing OPENAI_API_KEY. Calls renderVideo() directly with a synthetic TTS
 * provider that emits a real MP3 (sine wave) so:
 *   - SRT files get written
 *   - subtitles= filter chain runs against real audio durations
 *   - xfade timing math respects narrated slides' real durations
 *
 * Run after `npm run build` while the dev server is up.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const { renderVideo } = await import(`${root}/build/report-renderer/video.js`);
const { renderDocument } = await import(`${root}/build/report-renderer/render.js`);
const { createSyntheticTtsProvider } = await import(
  `${root}/build/report-renderer/tts/synthetic.js`
);
const md = "/Users/richardpaul/work/harness-ccm-finops-agent/techdocs/finops-agent-capabilities.md";
const baseUrl = "http://localhost:3000";

// Register the report through the running dev:serve (so its in-memory
// registry knows about it). My local process imports renderVideo and
// supplies the synthetic TTS, but the actual Paged.js HTML must come from
// the same server we're navigating Playwright at.
async function registerViaMcp() {
  const init = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "captions-smoke", version: "0.1" } } }),
  });
  const sid = init.headers.get("mcp-session-id");
  const body = await init.text();
  await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "mcp-session-id": sid },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "notifications/initialized" }),
  });
  await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "mcp-session-id": sid },
    body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "harness_ccm_finops_report_render", arguments: { markdown_path: md, id: "finops-agent-capabilities", open_in_browser: false } } }),
  });
  return sid;
}
await registerViaMcp();
console.log("registered via MCP");

const probe = await fetch(`${baseUrl}/reports/finops-agent-capabilities/?theme=harness`);
if (!probe.ok) {
  console.error(`Preview URL unreachable (HTTP ${probe.status}). Is dev:serve running?`);
  process.exit(1);
}

const doc = renderDocument(md);
const t0 = Date.now();
const result = await renderVideo({
  baseUrl,
  meta: doc.meta,
  themeId: "harness",
  docPath: `/reports/finops-agent-capabilities/`,
  tts: createSyntheticTtsProvider(),
  outFile: `${root}/out/captions-smoke.mp4`,
  minDwellMs: 1500,
  transitions: "xfade",
  captions: true,
});
console.log(JSON.stringify({
  ok: true,
  outPath: result.outPath,
  totalDurationMs: result.totalDurationMs,
  slides: result.slides.length,
  narratedSlides: result.slides.filter((s) => s.audioFile).length,
  withSrt: result.slides.filter((s) => s.srtFile).length,
  wallS: ((Date.now() - t0) / 1000).toFixed(1),
}, null, 2));
