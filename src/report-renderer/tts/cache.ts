/**
 * Content-hash audio cache wrapper for any `TtsProvider`.
 *
 * The TTS leg is the slowest + most expensive part of the video render. When
 * a report's narration hasn't changed between renders (which is the common
 * case — typically only one or two slides change at a time), we should not
 * re-call the provider for narration we've already synthesized.
 *
 * Strategy:
 *   key   = sha256(`${provider.name}|${voice}|${rate}|${text}`).slice(0, 24)
 *   path  = `<cacheDir>/<key>.<ext>`
 *
 * On synthesize:
 *   - If the cached file exists, read it back and return its buffer.
 *   - Otherwise call the wrapped provider, write the buffer to the cache
 *     atomically (`<key>.<ext>.tmp` → rename), and return it.
 *
 * The key includes the provider name so two providers with different output
 * (e.g. OpenAI alloy vs ElevenLabs Rachel) don't collide. Rate is part of the
 * key so re-rendering at a different rate doesn't reuse the wrong audio.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createLogger } from "../../utils/logger.js";
import type { TtsOptions, TtsProvider, TtsResult } from "./index.js";

const log = createLogger("tts-cache");

export interface CacheOptions {
  /** Absolute directory to store cached MP3s. Created if missing. */
  cacheDir: string;
  /** When true, log cache hits / misses at info level (default false). */
  verbose?: boolean;
}

export function withTtsCache(provider: TtsProvider, opts: CacheOptions): TtsProvider {
  const cacheDir = path.resolve(opts.cacheDir);
  let initPromise: Promise<void> | null = null;
  const ensureDir = (): Promise<void> => {
    if (!initPromise) initPromise = fs.mkdir(cacheDir, { recursive: true }).then(() => undefined);
    return initPromise;
  };

  return {
    name: `${provider.name}+cache`,
    async synthesize(text: string, ttsOpts?: TtsOptions): Promise<TtsResult> {
      await ensureDir();
      const key = hashKey(provider.name, text, ttsOpts);
      const candidates = await findCacheHit(cacheDir, key);
      if (candidates) {
        if (opts.verbose) log.info("TTS cache hit", { key });
        return candidates;
      }
      if (opts.verbose) log.info("TTS cache miss — synthesizing", { key });
      const result = await provider.synthesize(text, ttsOpts);
      const finalPath = path.join(cacheDir, `${key}.${result.extension}`);
      const tmpPath = `${finalPath}.tmp`;
      await fs.writeFile(tmpPath, result.buffer);
      await fs.rename(tmpPath, finalPath);
      return result;
    },
  };
}

function hashKey(providerName: string, text: string, ttsOpts?: TtsOptions): string {
  const voice = ttsOpts?.voice ?? "";
  const rate = typeof ttsOpts?.rate === "number" ? ttsOpts.rate.toString() : "";
  const payload = `${providerName}|${voice}|${rate}|${text.trim()}`;
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 24);
}

/**
 * Look for `<cacheDir>/<key>.<ext>` for any extension we know about. Returns
 * the matching `TtsResult` or null. We don't presume MP3 — providers may
 * legitimately return WAV for HD voices in the future, and the cache should
 * preserve whatever the provider stored.
 */
async function findCacheHit(cacheDir: string, key: string): Promise<TtsResult | null> {
  const knownExts: Array<{ ext: string; mimeType: string }> = [
    { ext: "mp3", mimeType: "audio/mpeg" },
    { ext: "wav", mimeType: "audio/wav" },
    { ext: "ogg", mimeType: "audio/ogg" },
  ];
  for (const { ext, mimeType } of knownExts) {
    const file = path.join(cacheDir, `${key}.${ext}`);
    try {
      const buffer = await fs.readFile(file);
      return { buffer, mimeType, extension: ext };
    } catch {
      // miss — try next extension
    }
  }
  return null;
}
