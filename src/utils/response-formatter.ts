/**
 * Standard MCP response formatters.
 *
 * Uses compact JSON (no indentation) to minimize token count for LLM consumers.
 * Errors keep minimal formatting for readability in tool-call error surfaces.
 */

export type ToolContentPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface ToolResult {
  /** Required: MCP SDK's CallToolResult extends Result which has an index signature. */
  [key: string]: unknown;
  content: ToolContentPart[];
  isError?: boolean;
}

export function jsonResult(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
  };
}

export function errorResult(message: string): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

/** PNG chart + JSON summary for MCP clients that render images inline. */
export function chartResult(summary: Record<string, unknown>, pngBuffer: Buffer): ToolResult {
  return {
    content: [
      { type: "text", text: JSON.stringify(summary) },
      { type: "image", data: pngBuffer.toString("base64"), mimeType: "image/png" },
    ],
  };
}
