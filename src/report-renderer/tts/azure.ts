/**
 * Azure Cognitive Services / Speech text-to-speech provider.
 * REST endpoint: `POST https://{region}.tts.speech.microsoft.com/cognitiveservices/v1`.
 *
 * Auth: `Ocp-Apim-Subscription-Key` header. Region must be configured (e.g.
 * `eastus`, `westeurope`) — Azure does not auto-discover. Voices are
 * documented at https://learn.microsoft.com/azure/ai-services/speech-service/language-support
 * (e.g. `en-US-JennyNeural`, `en-US-GuyNeural`, `en-GB-RyanNeural`).
 *
 * Body is SSML so we wrap the input text in `<speak><voice><prosody>` tags
 * so the rate parameter is forwarded as a real prosody attribute (Azure
 * supports `rate="+10%"` style strings; we map a 1.0=normal float to that).
 */
import type { TtsOptions, TtsProvider, TtsResult } from "./index.js";

const DEFAULT_VOICE = "en-US-JennyNeural";
/** mp3 at 24kHz 48kbit — matches OpenAI's default and is small. */
const DEFAULT_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

export interface AzureTtsOptions {
  apiKey: string;
  region: string;
  defaultVoice?: string;
  outputFormat?: string;
}

export function createAzureTtsProvider(opts: AzureTtsOptions): TtsProvider {
  if (!opts.apiKey) throw new Error("Azure TTS requires an AZURE_SPEECH_KEY");
  if (!opts.region) throw new Error("Azure TTS requires an AZURE_SPEECH_REGION (e.g. 'eastus')");
  const fallbackVoice = opts.defaultVoice ?? DEFAULT_VOICE;
  const outputFormat = opts.outputFormat ?? DEFAULT_OUTPUT_FORMAT;
  const endpoint = `https://${opts.region}.tts.speech.microsoft.com/cognitiveservices/v1`;

  return {
    name: `azure:${opts.region}`,
    async synthesize(text: string, ttsOpts?: TtsOptions): Promise<TtsResult> {
      const trimmed = text.trim();
      if (!trimmed) throw new Error("Azure TTS: empty narration text");

      const voice = ttsOpts?.voice ?? fallbackVoice;
      const ratePct = typeof ttsOpts?.rate === "number"
        ? `${Math.round((ttsOpts.rate - 1) * 100)}%`
        : "0%";
      const ssml =
        `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">` +
        `<voice name="${escapeXml(voice)}">` +
        `<prosody rate="${escapeXml(ratePct)}">${escapeXml(trimmed)}</prosody>` +
        `</voice></speak>`;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": opts.apiKey,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": outputFormat,
          "User-Agent": "harness-ccm-finops-agent",
        },
        body: ssml,
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(
          `Azure TTS request failed: HTTP ${res.status} ${res.statusText}` +
            (errBody ? ` — ${errBody.slice(0, 500)}` : ""),
        );
      }
      const arrayBuf = await res.arrayBuffer();
      return { buffer: Buffer.from(arrayBuf), mimeType: "audio/mpeg", extension: "mp3" };
    },
  };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
