/**
 * Text-to-speech provider interface for the narrated video render.
 *
 * The video pipeline calls `synthesize(text, opts)` once per slide to turn
 * narration text into an audio buffer. Providers are deliberately tiny — they
 * only have to return a Buffer + mime type. Duration is measured downstream
 * from the saved file by `ffprobe`, so providers don't have to compute it.
 *
 * Phase 1 ships a single OpenAI implementation. Phase 3 adds ElevenLabs /
 * Azure / Google behind this same interface, plus a content-hash audio cache.
 */
export interface TtsOptions {
  /**
   * Provider-specific voice id (e.g. OpenAI: "alloy" | "echo" | "fable" |
   * "onyx" | "nova" | "shimmer"). Falls back to provider default.
   */
  voice?: string;
  /**
   * Provider-specific speech rate / speaking rate. Most providers accept a
   * value around 1.0 (normal). Falls back to provider default.
   */
  rate?: number;
}

export interface TtsResult {
  buffer: Buffer;
  /** "audio/mpeg" for MP3, "audio/wav" for WAV, etc. */
  mimeType: string;
  /** File extension WITHOUT the leading dot ("mp3", "wav", …). */
  extension: string;
}

export interface TtsProvider {
  /** Display name for logs / manifest. */
  readonly name: string;
  synthesize(text: string, opts?: TtsOptions): Promise<TtsResult>;
}
