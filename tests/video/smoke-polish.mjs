#!/usr/bin/env node
/** Test ken_burns + transitions=cut paths. */
const BASE = "http://localhost:3000";
async function rpc(sid, method, params) {
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (sid) headers["mcp-session-id"] = sid;
  const res = await fetch(`${BASE}/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }) });
  const newSid = res.headers.get("mcp-session-id") || sid;
  const ct = res.headers.get("content-type") || "";
  let body;
  if (ct.includes("text/event-stream")) {
    const text = await res.text();
    const last = text.split("\n").filter((l) => l.startsWith("data: ")).pop();
    body = last ? JSON.parse(last.slice(6)) : { raw: text };
  } else body = await res.json();
  return { sid: newSid, body };
}
const init = await rpc(undefined, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "polish-test", version: "0.1" } });
const sid = init.sid;
await rpc(sid, "notifications/initialized", {});
const reg = await rpc(sid, "tools/call", { name: "harness_ccm_finops_report_render", arguments: { markdown_path: "/Users/richardpaul/work/harness-ccm-finops-agent/techdocs/finops-agent-capabilities.md", id: "finops-agent-capabilities", open_in_browser: false } });
console.log("registered:", JSON.parse(reg.body.result.content[0].text).ok);
const t0 = Date.now();
const r = await rpc(sid, "tools/call", { name: "harness_ccm_finops_video_render", arguments: { markdown_path: "/Users/richardpaul/work/harness-ccm-finops-agent/techdocs/finops-agent-capabilities.md", id: "finops-agent-capabilities", theme: "harness", min_dwell_ms: 1500, ken_burns: true, transitions: "cut" } });
const ms = Date.now() - t0;
const out = JSON.parse(r.body.result.content[0].text);
console.log(JSON.stringify({ ok: out.ok, slides: out.slides, narrated: out.narrated_slides, hint: out.hint, wallS: (ms/1000).toFixed(1) }, null, 2));
