/**
 * ElevenLabs text-to-speech provider — calls
 * `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}`.
 *
 * Auth: `xi-api-key` header. ElevenLabs uses voice *IDs*, not human-readable
 * names like OpenAI does. The default below is "Rachel" (a stable, neutral
 * voice that ships in every ElevenLabs account); callers can override per
 * provider config or per-comment with `<!-- voice voice="<id>": ... -->`.
 *
 * Rate is mapped to the `voice_settings.speaking_rate` parameter when the
 * model supports it (Eleven v2.5 / v3). Older models silently ignore it.
 */
import type { TtsOptions, TtsProvider, TtsResult } from "./index.js";

const ENDPOINT_BASE = "https://api.elevenlabs.io/v1/text-to-speech";
const DEFAULT_MODEL = "eleven_multilingual_v2";
/** "Rachel" — neutral US female, included with every account. */
const DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM";
/** ElevenLabs caps a single-call request at 5000 characters. */
const MAX_INPUT_CHARS = 5000;

export interface ElevenLabsTtsOptions {
  apiKey: string;
  model?: string;
  defaultVoice?: string;
}

export function createElevenLabsTtsProvider(opts: ElevenLabsTtsOptions): TtsProvider {
  const apiKey = opts.apiKey;
  if (!apiKey) {
    throw new Error("ElevenLabs TTS requires an ELEVENLABS_API_KEY");
  }
  const model = opts.model ?? DEFAULT_MODEL;
  const fallbackVoice = opts.defaultVoice ?? DEFAULT_VOICE;

  return {
    name: `elevenlabs:${model}`,
    async synthesize(text: string, ttsOpts?: TtsOptions): Promise<TtsResult> {
      const trimmed = text.trim();
      if (!trimmed) throw new Error("ElevenLabs TTS: empty narration text");
      if (trimmed.length > MAX_INPUT_CHARS) {
        throw new Error(
          `ElevenLabs TTS: narration of ${trimmed.length} chars exceeds the ${MAX_INPUT_CHARS} char limit. ` +
            "Split the slide into smaller `<!-- voice: ... -->` comments.",
        );
      }
      const voiceId = ttsOpts?.voice ?? fallbackVoice;

      const body: Record<string, unknown> = {
        text: trimmed,
        model_id: model,
        output_format: "mp3_44100_128",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          ...(typeof ttsOpts?.rate === "number" ? { speaking_rate: ttsOpts.rate } : {}),
        },
      };

      const res = await fetch(`${ENDPOINT_BASE}/${encodeURIComponent(voiceId)}`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(
          `ElevenLabs TTS request failed: HTTP ${res.status} ${res.statusText}` +
            (errBody ? ` — ${errBody.slice(0, 500)}` : ""),
        );
      }
      const arrayBuf = await res.arrayBuffer();
      return { buffer: Buffer.from(arrayBuf), mimeType: "audio/mpeg", extension: "mp3" };
    },
  };
}
