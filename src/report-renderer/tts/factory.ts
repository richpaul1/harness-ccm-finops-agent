/**
 * TTS provider factory.
 *
 * One function — `resolveTtsProvider(prefs)` — returns a usable `TtsProvider`
 * given:
 *   - an optional explicit provider name (`prefs.providerName`),
 *   - the process env (`OPENAI_API_KEY`, `ELEVENLABS_API_KEY`,
 *     `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION`, `GOOGLE_TTS_API_KEY`).
 *
 * Resolution order when no name is given:
 *   1. The first provider whose API key(s) are present in the env, in the
 *      order: openai → elevenlabs → azure → google.
 *   2. If no keys are configured at all, returns `undefined` so the caller
 *      can fall back to the silent render path.
 *
 * The returned provider is wrapped with the on-disk content-hash cache by
 * default. Disable with `prefs.cache: false` (useful for tests and
 * one-shot CLIs).
 */
import * as path from "node:path";
import { withTtsCache } from "./cache.js";
import { createOpenAiTtsProvider } from "./openai.js";
import { createElevenLabsTtsProvider } from "./elevenlabs.js";
import { createAzureTtsProvider } from "./azure.js";
import { createGoogleTtsProvider } from "./google.js";
import type { TtsProvider } from "./index.js";

export type TtsProviderName = "openai" | "elevenlabs" | "azure" | "google" | "local";

export interface ResolveTtsPreferences {
  /** Force a specific provider. Throws if its env vars aren't set. */
  providerName?: TtsProviderName;
  /** Wrap the provider with the on-disk cache (default true). */
  cache?: boolean;
  /** Override cache directory (default `<cwd>/.cache/voice`). */
  cacheDir?: string;
  /** Custom env (defaults to `process.env`); useful in tests. */
  env?: NodeJS.ProcessEnv;
  /** Verbose cache logs (default false). */
  verboseCache?: boolean;
}

export function resolveTtsProvider(prefs: ResolveTtsPreferences = {}): TtsProvider | undefined {
  const env = prefs.env ?? process.env;
  let provider: TtsProvider | undefined;

  if (prefs.providerName) {
    provider = createNamedProvider(prefs.providerName, env);
    if (!provider) {
      throw new Error(
        `TTS provider '${prefs.providerName}' was requested but its API key is not configured. ` +
          `Set ${envHintFor(prefs.providerName)} before re-running.`,
      );
    }
  } else {
    // First-key-wins auto-discovery in a deliberate priority order. Local is
    // first because if the user took the trouble to stand up an
    // OpenAI-compatible TTS server on their box (Orpheus-FastAPI etc.), they
    // almost certainly want it used over a paid cloud provider. After that
    // OpenAI wins on setup simplicity, then ElevenLabs for voice quality,
    // then the cloud incumbents.
    const order: TtsProviderName[] = ["local", "openai", "elevenlabs", "azure", "google"];
    for (const name of order) {
      const candidate = createNamedProvider(name, env);
      if (candidate) {
        provider = candidate;
        break;
      }
    }
  }

  if (!provider) return undefined;

  if (prefs.cache === false) return provider;
  const cacheDir = prefs.cacheDir ?? path.resolve(process.cwd(), ".cache", "voice");
  return withTtsCache(provider, {
    cacheDir,
    ...(prefs.verboseCache === true ? { verbose: true } : {}),
  });
}

function createNamedProvider(name: TtsProviderName, env: NodeJS.ProcessEnv): TtsProvider | undefined {
  switch (name) {
    case "openai": {
      const apiKey = env.OPENAI_API_KEY?.trim();
      if (!apiKey) return undefined;
      return createOpenAiTtsProvider({ apiKey });
    }
    case "elevenlabs": {
      const apiKey = env.ELEVENLABS_API_KEY?.trim();
      if (!apiKey) return undefined;
      return createElevenLabsTtsProvider({ apiKey });
    }
    case "azure": {
      const apiKey = env.AZURE_SPEECH_KEY?.trim();
      const region = env.AZURE_SPEECH_REGION?.trim();
      if (!apiKey || !region) return undefined;
      return createAzureTtsProvider({ apiKey, region });
    }
    case "google": {
      const apiKey = env.GOOGLE_TTS_API_KEY?.trim();
      if (!apiKey) return undefined;
      return createGoogleTtsProvider({ apiKey });
    }
    case "local": {
      // OpenAI-compatible local server. We only require the base URL; model,
      // voice, and api-key are optional because most local servers either
      // bake a single model in or accept anything as the auth header.
      const baseUrl = env.LOCAL_TTS_BASE_URL?.trim();
      if (!baseUrl) return undefined;
      const model = env.LOCAL_TTS_MODEL?.trim() || "tts-1";
      const apiKey = env.LOCAL_TTS_API_KEY?.trim();
      const defaultVoice = env.LOCAL_TTS_VOICE?.trim();
      return createOpenAiTtsProvider({
        baseUrl,
        model,
        name: `local:${model}@${baseUrl.replace(/^https?:\/\//, "")}`,
        ...(apiKey ? { apiKey } : {}),
        ...(defaultVoice ? { defaultVoice } : {}),
      });
    }
  }
}

function envHintFor(name: TtsProviderName): string {
  switch (name) {
    case "openai":
      return "OPENAI_API_KEY";
    case "elevenlabs":
      return "ELEVENLABS_API_KEY";
    case "azure":
      return "AZURE_SPEECH_KEY and AZURE_SPEECH_REGION";
    case "google":
      return "GOOGLE_TTS_API_KEY";
    case "local":
      return "LOCAL_TTS_BASE_URL (e.g. http://localhost:5005)";
  }
}
