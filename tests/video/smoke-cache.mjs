/**
 * Smoke test for the TTS audio cache.
 *
 * Wraps the synthetic TTS provider with `withTtsCache`, calls `synthesize` for
 * the same text twice, and asserts that:
 *   1. The first call goes to the wrapped provider (slow path) and writes a
 *      file into the cache directory.
 *   2. The second call returns the *same buffer* without invoking the
 *      wrapped provider (we count calls via a wrapping spy).
 *   3. Different `voice` / `rate` produce different cache keys.
 *
 * Run with:
 *   npm run build && node tests/video/smoke-cache.mjs
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createSyntheticTtsProvider } from "../build/report-renderer/tts/synthetic.js";
import { withTtsCache } from "../build/report-renderer/tts/cache.js";

const CACHE_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "tts-cache-smoke-"));
let calls = 0;

const real = createSyntheticTtsProvider();
const counted = {
  name: real.name,
  async synthesize(text, opts) {
    calls += 1;
    return real.synthesize(text, opts);
  },
};

const cached = withTtsCache(counted, { cacheDir: CACHE_DIR, verbose: true });

console.log("→ cache dir:", CACHE_DIR);

const text = "The quick brown fox jumps over the lazy dog.";

console.log("\n[1] first call (expect cache miss → 1 underlying call)");
const a = await cached.synthesize(text, { voice: "alloy", rate: 1.0 });
console.log("    bytes:", a.buffer.length, "calls so far:", calls);
if (calls !== 1) throw new Error(`expected 1 call after first synth, got ${calls}`);

console.log("\n[2] second call same text/voice/rate (expect cache hit → still 1 call)");
const b = await cached.synthesize(text, { voice: "alloy", rate: 1.0 });
console.log("    bytes:", b.buffer.length, "calls so far:", calls);
if (calls !== 1) throw new Error(`expected 1 call after second synth, got ${calls}`);
if (!a.buffer.equals(b.buffer)) throw new Error("cached buffer differs from original");

console.log("\n[3] different voice (expect cache miss → 2 calls total)");
await cached.synthesize(text, { voice: "echo", rate: 1.0 });
console.log("    calls so far:", calls);
if (calls !== 2) throw new Error(`expected 2 calls after voice change, got ${calls}`);

console.log("\n[4] different rate (expect cache miss → 3 calls total)");
await cached.synthesize(text, { voice: "alloy", rate: 1.1 });
console.log("    calls so far:", calls);
if (calls !== 3) throw new Error(`expected 3 calls after rate change, got ${calls}`);

const files = await fs.readdir(CACHE_DIR);
console.log("\n[5] cache directory now contains:", files);
if (files.length !== 3) throw new Error(`expected 3 cached files, got ${files.length}`);

console.log("\n✓ TTS cache behaves correctly");
await fs.rm(CACHE_DIR, { recursive: true, force: true });
