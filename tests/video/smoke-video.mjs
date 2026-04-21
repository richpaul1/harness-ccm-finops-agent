#!/usr/bin/env node
/**
 * Smoke test for the narrated-video pipeline. Calls the live MCP HTTP server
 * (npm run dev) to:
 *   1. Register the techdocs report.
 *   2. Render a narrated MP4 (silent if OPENAI_API_KEY is unset).
 *
 * Logs the JSON result so the operator can eyeball slide / narration counts.
 */
const BASE = process.env.MCP_BASE_URL || "http://localhost:3000";
const REPORT_PATH = process.argv[2] || "/Users/richardpaul/work/harness-ccm-finops-agent/techdocs/finops-agent-capabilities.md";

async function rpc(sessionId, method, params) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;

  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const sid = res.headers.get("mcp-session-id") || sessionId;
  const ct = res.headers.get("content-type") || "";
  let body;
  if (ct.includes("text/event-stream")) {
    const text = await res.text();
    const lines = text.split("\n").filter((l) => l.startsWith("data: "));
    const last = lines[lines.length - 1];
    body = last ? JSON.parse(last.slice(6)) : { raw: text };
  } else {
    body = await res.json();
  }
  return { sid, body };
}

async function callTool(sid, name, args) {
  const { body } = await rpc(sid, "tools/call", { name, arguments: args });
  if (body.error) throw new Error(`${name} error: ${JSON.stringify(body.error)}`);
  const text = body.result?.content?.[0]?.text;
  return text ? JSON.parse(text) : body.result;
}

async function main() {
  console.log("== initialize ==");
  const init = await rpc(undefined, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "video-smoke", version: "0.1" },
  });
  const sid = init.sid;
  console.log("session:", sid);
  await rpc(sid, "notifications/initialized", {});

  console.log("\n== register report ==");
  const reg = await callTool(sid, "harness_ccm_finops_report_render", {
    markdown_path: REPORT_PATH,
    id: "finops-agent-capabilities",
    open_in_browser: false,
  });
  console.log(JSON.stringify(reg, null, 2));

  console.log("\n== render video ==");
  const t0 = Date.now();
  const result = await callTool(sid, "harness_ccm_finops_video_render", {
    markdown_path: REPORT_PATH,
    id: "finops-agent-capabilities",
    theme: "harness",
    min_dwell_ms: 1500,
  });
  const ms = Date.now() - t0;
  console.log(JSON.stringify(result, null, 2));
  console.log(`\nRender wall-clock: ${(ms / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error("FAILED:", e.stack || e);
  process.exit(1);
});
