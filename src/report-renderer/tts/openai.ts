/**
 * OpenAI-compatible text-to-speech provider — calls
 * `POST <baseUrl>/v1/audio/speech`.
 *
 * Defaults talk to `https://api.openai.com` with `tts-1` and require an API
 * key, but every constructor option is overridable so the *same* function
 * also drives any OpenAI-compatible local server (Orpheus-FastAPI,
 * Kokoro-FastAPI, LMStudio's TTS, OpenAI Edge TTS, vLLM with an audio model,
 * etc.). Local servers usually accept any string as the API key — or none at
 * all — so `apiKey` is optional whenever a non-default `baseUrl` is set.
 *
 * We talk to the REST endpoint with built-in `fetch` (Node 20+) instead of
 * pulling in the full `openai` SDK. The endpoint is single-purpose, the
 * payload is trivial, and avoiding the SDK keeps the cold-start small.
 */
import type { TtsOptions, TtsProvider, TtsResult } from "./index.js";

const DEFAULT_BASE_URL = "https://api.openai.com";
const DEFAULT_MODEL = "tts-1";
const DEFAULT_VOICE = "alloy";
/** Hard cap from openai.com per request. Local servers vary, so we only
 *  enforce it when we're actually talking to api.openai.com. */
const OPENAI_MAX_INPUT_CHARS = 4096;

export interface OpenAiTtsOptions {
  /** Required when talking to api.openai.com; optional for OpenAI-compatible
   *  local servers (Orpheus-FastAPI etc. typically ignore it). */
  apiKey?: string;
  /** Model name passed in the request body. Defaults to "tts-1". */
  model?: string;
  /** Default voice when the per-comment override is absent. */
  defaultVoice?: string;
  /** Override the API root (no trailing slash). Defaults to api.openai.com. */
  baseUrl?: string;
  /** Override the manifest / log name. Defaults to `openai:<model>`. */
  name?: string;
}

/** Map a Content-Type header to the extension / mimeType we'll store on disk. */
function resolveAudioFormat(contentType: string): { mimeType: string; extension: string } {
  const ct = contentType.toLowerCase().split(";")[0]!.trim();
  if (ct === "audio/wav" || ct === "audio/wave" || ct === "audio/x-wav") {
    return { mimeType: "audio/wav", extension: "wav" };
  }
  if (ct === "audio/ogg" || ct === "audio/opus") {
    return { mimeType: "audio/ogg", extension: "ogg" };
  }
  // Default: treat as MP3 (covers audio/mpeg, audio/mp3, and anything unrecognised)
  return { mimeType: "audio/mpeg", extension: "mp3" };
}

export function createOpenAiTtsProvider(opts: OpenAiTtsOptions = {}): TtsProvider {
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const isOfficial = baseUrl === DEFAULT_BASE_URL;
  const apiKey = opts.apiKey;
  if (isOfficial && !apiKey) {
    throw new Error("OpenAI TTS requires an OPENAI_API_KEY");
  }
  const model = opts.model ?? DEFAULT_MODEL;
  const fallbackVoice = opts.defaultVoice ?? DEFAULT_VOICE;
  const endpoint = `${baseUrl}/v1/audio/speech`;
  const displayName = opts.name ?? `openai:${model}`;

  return {
    name: displayName,
    async synthesize(text: string, ttsOpts?: TtsOptions): Promise<TtsResult> {
      const trimmed = text.trim();
      if (!trimmed) {
        throw new Error(`${displayName}: empty narration text`);
      }
      // Only enforce the 4096-char cap on api.openai.com itself. Local
      // servers can be smaller (chunk earlier) or larger (Orpheus accepts
      // long form), so we let them speak for themselves and surface the
      // server's HTTP error if it complains.
      if (isOfficial && trimmed.length > OPENAI_MAX_INPUT_CHARS) {
        throw new Error(
          `OpenAI TTS: narration of ${trimmed.length} chars exceeds the ${OPENAI_MAX_INPUT_CHARS} char limit. ` +
            "Split the slide into smaller `<!-- voice: ... -->` comments.",
        );
      }

      const body = {
        model,
        input: trimmed,
        voice: ttsOpts?.voice ?? fallbackVoice,
        response_format: "mp3" as const,
        ...(typeof ttsOpts?.rate === "number" ? { speed: ttsOpts.rate } : {}),
      };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(
          `${displayName} request failed: HTTP ${res.status} ${res.statusText}` +
            (errBody ? ` — ${errBody.slice(0, 500)}` : ""),
        );
      }

      const contentType = res.headers.get("content-type") ?? "audio/mpeg";
      const { mimeType, extension } = resolveAudioFormat(contentType);
      const arrayBuf = await res.arrayBuffer();
      return {
        buffer: Buffer.from(arrayBuf),
        mimeType,
        extension,
      };
    },
  };
}
