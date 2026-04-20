/**
 * Smoke test for `resolveTtsProvider`.
 *
 * Confirms the auto-discovery priority order (openai → elevenlabs → azure →
 * google), explicit overrides, and "no env vars set" → undefined.
 *
 * Run with:
 *   npm run build && node tests/video/smoke-factory.mjs
 */
import { resolveTtsProvider } from "../build/report-renderer/tts/factory.js";

function check(name, got, want) {
  const ok = got === want;
  console.log(`${ok ? "✓" : "✗"} ${name}: got=${got} want=${want}`);
  if (!ok) process.exitCode = 1;
}

// 1. nothing set → undefined
check("empty env", resolveTtsProvider({ env: {} })?.name, undefined);

// 2. only OpenAI
check(
  "openai only",
  resolveTtsProvider({ env: { OPENAI_API_KEY: "x" }, cache: false }).name,
  "openai:tts-1",
);

// 3. only ElevenLabs
check(
  "elevenlabs only",
  resolveTtsProvider({ env: { ELEVENLABS_API_KEY: "x" }, cache: false }).name,
  "elevenlabs:eleven_multilingual_v2",
);

// 4. only Azure (region required too)
check(
  "azure only",
  resolveTtsProvider({
    env: { AZURE_SPEECH_KEY: "x", AZURE_SPEECH_REGION: "eastus" },
    cache: false,
  }).name,
  "azure:eastus",
);

// 5. only Google
check(
  "google only",
  resolveTtsProvider({ env: { GOOGLE_TTS_API_KEY: "x" }, cache: false }).name,
  "google:texttospeech",
);

// 6. only Local
check(
  "local only (defaults)",
  resolveTtsProvider({
    env: { LOCAL_TTS_BASE_URL: "http://localhost:5005" },
    cache: false,
  }).name,
  "local:tts-1@localhost:5005",
);

// 6b. only Local with model override
check(
  "local with model override",
  resolveTtsProvider({
    env: { LOCAL_TTS_BASE_URL: "http://localhost:5005", LOCAL_TTS_MODEL: "orpheus" },
    cache: false,
  }).name,
  "local:orpheus@localhost:5005",
);

// 7. priority: Local wins over everything else when multiple are set
check(
  "local wins over openai/elevenlabs/azure/google",
  resolveTtsProvider({
    env: {
      LOCAL_TTS_BASE_URL: "http://localhost:5005",
      OPENAI_API_KEY: "x",
      ELEVENLABS_API_KEY: "y",
      AZURE_SPEECH_KEY: "z",
      AZURE_SPEECH_REGION: "eastus",
      GOOGLE_TTS_API_KEY: "w",
    },
    cache: false,
  }).name,
  "local:tts-1@localhost:5005",
);

// 7b. priority: OpenAI wins when no local
check(
  "openai wins over elevenlabs/azure/google",
  resolveTtsProvider({
    env: {
      OPENAI_API_KEY: "x",
      ELEVENLABS_API_KEY: "y",
      AZURE_SPEECH_KEY: "z",
      AZURE_SPEECH_REGION: "eastus",
      GOOGLE_TTS_API_KEY: "w",
    },
    cache: false,
  }).name,
  "openai:tts-1",
);

// 7. explicit override beats auto-discovery
check(
  "explicit elevenlabs override",
  resolveTtsProvider({
    providerName: "elevenlabs",
    env: { OPENAI_API_KEY: "x", ELEVENLABS_API_KEY: "y" },
    cache: false,
  }).name,
  "elevenlabs:eleven_multilingual_v2",
);

// 8. forced provider with no key throws
let threw = false;
try {
  resolveTtsProvider({ providerName: "azure", env: {}, cache: false });
} catch {
  threw = true;
}
check("forced azure with no env throws", threw, true);

// 9. cache wraps the provider name
const cached = resolveTtsProvider({ env: { OPENAI_API_KEY: "x" } });
check("cache wraps provider", cached.name, "openai:tts-1+cache");

if (process.exitCode) {
  console.log("\n✗ factory checks failed");
} else {
  console.log("\n✓ factory checks passed");
}
