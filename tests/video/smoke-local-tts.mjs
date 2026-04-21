/**
 * Quick one-shot test that calls the configured local TTS provider
 * (resolved from env vars via the factory) and saves the output.
 *
 *   node --env-file=.env tests/video/smoke-local-tts.mjs
 */
import { resolveTtsProvider } from "../build/report-renderer/tts/factory.js";
import * as fs from "node:fs/promises";

const tts = resolveTtsProvider({ cache: false });
if (!tts) {
  console.error("No TTS provider resolved — check that LOCAL_TTS_BASE_URL (or another provider key) is set in .env");
  process.exit(1);
}
console.log("Provider:", tts.name);
console.log("Synthesizing...");

const t0 = Date.now();
const result = await tts.synthesize(
  "Welcome to the Harness FinOps agent. This is a narrated report generated locally using Orpheus TTS via Tara's voice.",
  { voice: process.env.LOCAL_TTS_VOICE ?? "tara" },
);
const elapsed = Date.now() - t0;

const outFile = `/tmp/orpheus-real.${result.extension}`;
await fs.writeFile(outFile, result.buffer);

console.log(`Done in ${elapsed}ms — ${result.buffer.length} bytes (${result.mimeType})`);
console.log(`Saved → ${outFile}`);
console.log(`Play:   afplay ${outFile}`);
