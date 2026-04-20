/**
 * Google Cloud Text-to-Speech provider.
 * REST endpoint: `POST https://texttospeech.googleapis.com/v1/text:synthesize?key={apiKey}`.
 *
 * Auth: API key in the URL query (`?key=…`). Service-account auth is not
 * supported here on purpose — the env-var setup is one line and matches how
 * the other providers (OpenAI, ElevenLabs, Azure) authenticate.
 *
 * Voice IDs follow Google's `<lang>-<region>-<family>-<variant>` scheme,
 * e.g. `en-US-Studio-O`, `en-US-Wavenet-D`, `en-GB-Neural2-A`. Speaking rate
 * goes into `audioConfig.speakingRate` (Google accepts 0.25–4.0; 1.0 is
 * normal). Output is straight MP3 base64 in the response body.
 */
import type { TtsOptions, TtsProvider, TtsResult } from "./index.js";

const ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize";
const DEFAULT_VOICE = "en-US-Neural2-C";
const DEFAULT_LANG = "en-US";

export interface GoogleTtsOptions {
  apiKey: string;
  defaultVoice?: string;
  defaultLanguageCode?: string;
}

export function createGoogleTtsProvider(opts: GoogleTtsOptions): TtsProvider {
  if (!opts.apiKey) throw new Error("Google TTS requires a GOOGLE_TTS_API_KEY");
  const fallbackVoice = opts.defaultVoice ?? DEFAULT_VOICE;
  const lang = opts.defaultLanguageCode ?? DEFAULT_LANG;

  return {
    name: "google:texttospeech",
    async synthesize(text: string, ttsOpts?: TtsOptions): Promise<TtsResult> {
      const trimmed = text.trim();
      if (!trimmed) throw new Error("Google TTS: empty narration text");

      const voice = ttsOpts?.voice ?? fallbackVoice;
      const body: Record<string, unknown> = {
        input: { text: trimmed },
        // Derive the languageCode from the voice id (everything up to the
        // second hyphen). Falls back to the configured default if parsing
        // fails so a non-standard voice id still gets through.
        voice: {
          name: voice,
          languageCode: deriveLanguageCode(voice) ?? lang,
        },
        audioConfig: {
          audioEncoding: "MP3",
          ...(typeof ttsOpts?.rate === "number" ? { speakingRate: ttsOpts.rate } : {}),
        },
      };

      const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(opts.apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(
          `Google TTS request failed: HTTP ${res.status} ${res.statusText}` +
            (errBody ? ` — ${errBody.slice(0, 500)}` : ""),
        );
      }
      const json = (await res.json()) as { audioContent?: string };
      if (!json.audioContent) {
        throw new Error("Google TTS response missing `audioContent`");
      }
      return {
        buffer: Buffer.from(json.audioContent, "base64"),
        mimeType: "audio/mpeg",
        extension: "mp3",
      };
    },
  };
}

/** "en-US-Neural2-C" → "en-US"; returns null if the id doesn't match. */
function deriveLanguageCode(voice: string): string | null {
  const m = voice.match(/^([a-z]{2}-[A-Z]{2})/);
  return m ? m[1]! : null;
}
