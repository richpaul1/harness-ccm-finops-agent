/**
 * Synthetic TTS provider for testing.
 *
 * Generates a real MP3 buffer for any input text by running ffmpeg with a
 * `sine` source for `chars * msPerChar` milliseconds. Produces actual valid
 * MP3 bytes so every downstream step (`fs.writeFile`, `ffprobe -show_entries
 * format=duration`, `-i mp3file` in ffmpeg) gets exercised end-to-end without
 * needing a network round-trip or an API key.
 *
 * Used by `techdocs/smoke-captions.mjs`. Not registered with the MCP server.
 */
import { spawn } from "node:child_process";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import type { TtsProvider, TtsResult } from "./index.js";

const FFMPEG_BIN = (ffmpegPath as unknown as { path: string }).path;
/** Roughly mimic OpenAI TTS pacing: ~14 chars/second of speech. */
const MS_PER_CHAR = 70;

export function createSyntheticTtsProvider(): TtsProvider {
  return {
    name: "synthetic:sine",
    async synthesize(text: string): Promise<TtsResult> {
      const seconds = Math.max(1, (text.length * MS_PER_CHAR) / 1000);
      // Pure tone at A4 (440Hz) — clearly audible if the test is played, but
      // we mostly just need a valid MP3 with a real duration.
      const args = [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=440:duration=${seconds.toFixed(2)}`,
        "-c:a",
        "libmp3lame",
        "-b:a",
        "96k",
        "-f",
        "mp3",
        "pipe:1",
      ];
      const buffer = await runForBuffer(FFMPEG_BIN, args);
      return { buffer, mimeType: "audio/mpeg", extension: "mp3" };
    },
  };
}

function runForBuffer(cmd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => chunks.push(b));
    child.stderr.on("data", (b: Buffer) => {
      stderr += b.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-512)}`));
    });
  });
}
