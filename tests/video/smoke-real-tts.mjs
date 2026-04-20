#!/usr/bin/env node
/**
 * Full end-to-end MP4 render using the real TTS provider resolved from env.
 * Picks up LOCAL_TTS_BASE_URL / OPENAI_API_KEY / etc. from the environment,
 * so run with:
 *
 *   node --env-file=.env tests/video/smoke-real-tts.mjs
 *
 * Requires dev:serve to be running (npm run dev).
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const { renderVideo } = await import(`${root}/build/report-renderer/video.js`);
const { renderDocument } = await import(`${root}/build/report-renderer/render.js`);
const { resolveTtsProvider } = await import(`${root}/build/report-renderer/tts/factory.js`);

const md = `${root}/techdocs/finops-agent-capabilities.md`;
const baseUrl = "http://localhost:3000";

const tts = resolveTtsProvider({ verboseCache: true });
if (!tts) {
  console.error("No TTS provider — set LOCAL_TTS_BASE_URL, OPENAI_API_KEY, or another provider key in .env");
  process.exit(1);
}
console.log("TTS provider:", tts.name);

// Register report with the running dev:serve instance
async function registerViaMcp() {
  const init = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke-real-tts", version: "0.1" } } }),
  });
  const sid = init.headers.get("mcp-session-id");
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
}
await registerViaMcp();
console.log("Registered report with dev:serve");

const probe = await fetch(`${baseUrl}/reports/finops-agent-capabilities/?theme=harness`);
if (!probe.ok) {
  console.error(`Preview URL unreachable (HTTP ${probe.status}). Is dev:serve running?`);
  process.exit(1);
}

const doc = renderDocument(md);
const outFile = `${root}/out/real-tts-smoke.mp4`;
const t0 = Date.now();

console.log("Rendering MP4 (this will call Orpheus for narrated slides)...");
const result = await renderVideo({
  baseUrl,
  meta: doc.meta,
  themeId: "harness",
  docPath: `/reports/finops-agent-capabilities/`,
  tts,
  outFile,
  minDwellMs: 2500,
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
  ttsProvider: tts.name,
  wallS: ((Date.now() - t0) / 1000).toFixed(1),
}, null, 2));

console.log(`\nPlay: open ${result.outPath}`);
