#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import {
  buildSessionConfig,
  loadGlobalConfig,
  SessionAuthError,
  type Config,
  type GlobalConfig,
  type SessionAuthOverrides,
} from "./config.js";
import { setLogLevel, createLogger } from "./utils/logger.js";
import { HarnessClient } from "./client/harness-client.js";
import { Registry } from "./registry/index.js";
import { registerAllTools } from "./tools/index.js";
import { registerAllResources } from "./resources/index.js";
import { registerAllPrompts } from "./prompts/index.js";
import { parseArgs } from "./utils/cli.js";
import { mountReportRoutes, setHttpReportBaseUrl } from "./report-renderer/index.js";

const log = createLogger("main");

/** Extract JSON-RPC `method` from an MCP POST body for observability (no secrets). */
function mcpJsonRpcMethodFromBody(body: unknown): string | undefined {
  if (body && typeof body === "object" && "method" in body) {
    const m = (body as { method?: unknown }).method;
    if (typeof m === "string") return m;
  }
  return undefined;
}

/**
 * Headers map shape Express produces (lower-case keys, possibly array values).
 * We only consume the first value per header.
 */
type HeaderBag = Record<string, string | string[] | undefined>;

function firstHeader(headers: HeaderBag, name: string): string | undefined {
  const raw = headers[name.toLowerCase()];
  if (raw === undefined) return undefined;
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * Parse per-session Harness credential overrides from HTTP request headers.
 * Returns only the fields that were supplied by the client; missing fields
 * fall back to env defaults inside `buildSessionConfig`.
 *
 * Supported headers (case-insensitive):
 *   - X-Harness-Token         → HARNESS_BEARER_TOKEN
 *   - Authorization: Bearer … → HARNESS_BEARER_TOKEN (alternate)
 *   - X-Harness-Cookie        → HARNESS_COOKIE
 *   - X-Harness-Api-Key       → HARNESS_API_KEY
 *   - X-Harness-Account       → HARNESS_ACCOUNT_ID
 *   - X-Harness-Base-Url      → HARNESS_BASE_URL
 *   - X-Harness-Default-Org   → HARNESS_DEFAULT_ORG_ID
 *   - X-Harness-Default-Project → HARNESS_DEFAULT_PROJECT_ID
 *
 * Header values are NEVER logged or echoed back; only `buildSessionConfig`
 * sees them, and the resulting Config is held in memory on the session entry.
 */
export function parseSessionAuthHeaders(headers: HeaderBag): SessionAuthOverrides {
  const overrides: SessionAuthOverrides = {};

  let token = firstHeader(headers, "x-harness-token");
  if (!token) {
    const auth = firstHeader(headers, "authorization");
    if (auth && /^bearer\s+/i.test(auth)) {
      token = auth.replace(/^bearer\s+/i, "").trim();
    }
  }
  if (token) overrides.HARNESS_BEARER_TOKEN = token;

  const cookie = firstHeader(headers, "x-harness-cookie");
  if (cookie) overrides.HARNESS_COOKIE = cookie;

  const apiKey = firstHeader(headers, "x-harness-api-key");
  if (apiKey) overrides.HARNESS_API_KEY = apiKey;

  const account = firstHeader(headers, "x-harness-account");
  if (account) overrides.HARNESS_ACCOUNT_ID = account;

  const baseUrl = firstHeader(headers, "x-harness-base-url");
  if (baseUrl) overrides.HARNESS_BASE_URL = baseUrl;

  const defaultOrg = firstHeader(headers, "x-harness-default-org");
  if (defaultOrg) overrides.HARNESS_DEFAULT_ORG_ID = defaultOrg;

  const defaultProject = firstHeader(headers, "x-harness-default-project");
  if (defaultProject) overrides.HARNESS_DEFAULT_PROJECT_ID = defaultProject;

  return overrides;
}

/** Tail-mask a token for logging — keeps the last 4 chars only. */
function maskToken(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.length <= 4) return "****";
  return `****${value.slice(-4)}`;
}

/**
 * Create a fully-configured MCP server instance with all tools, resources, and prompts.
 */
function createHarnessServer(config: Config): McpServer {
  const client = new HarnessClient(config);
  const registry = new Registry(config);

  const server = new McpServer(
    {
      name: "harness-ccm-finops-agent",
      version: "1.0.0",
      icons: [{ src: "https://app.harness.io/favicon.ico" }],
      websiteUrl: "https://harness.io",
    },
    {
      capabilities: { logging: {} },
      instructions:
        "IMPORTANT: Call harness_ccm_finops_guide (no parameters) at the start of every " +
        "session. It returns the complete agent guide covering all tool calling conventions, " +
        "resource types, group_by dimensions, time filters, spike/anomaly patterns, " +
        "recommendations, budgets, commitment orchestration, AutoStopping, maturity charts, " +
        "report rendering, and the full BVR playbook. Without this guide you will not know " +
        "how to use the other tools correctly.\n\n" +
        "When the user asks identity questions like \"what account am I connected to?\", " +
        "\"who am I?\", \"which Harness tenant is this?\", or anything similar — call " +
        "harness_ccm_finops_whoami (no parameters) and quote the returned `companyName` " +
        "(e.g. \"You're connected to TransUnion\"). Use the `summary` field for a one-line " +
        "answer. Never guess the account from URLs or env vars.",
    },
  );

  registerAllTools(server, registry, client, config);
  registerAllResources(server, registry, client, config);
  registerAllPrompts(server);

  return server;
}

/**
 * Start the server in stdio mode — single persistent connection.
 * Stdio is single-tenant: there are no per-request headers, so the session
 * config comes purely from env vars (`buildSessionConfig` with no overrides).
 */
async function startStdio(globalConfig: GlobalConfig): Promise<void> {
  const config = buildSessionConfig(globalConfig, {});
  const server = createHarnessServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("harness-ccm-finops-agent connected via stdio", {
    accountId: config.HARNESS_ACCOUNT_ID,
    baseUrl: config.HARNESS_BASE_URL,
    tokenPresent: Boolean(config.HARNESS_BEARER_TOKEN),
    cookiePresent: Boolean(config.HARNESS_COOKIE),
    apiKeyPresent: Boolean(config.HARNESS_API_KEY),
  });

  const shutdown = async (signal: string): Promise<void> => {
    log.info(`Received ${signal}, closing stdio transport...`);
    await transport.close();
    await server.close();
    log.info("Stdio server closed");
    process.exit(0);
  };

  process.on("SIGINT", () => { shutdown("SIGINT"); });
  process.on("SIGTERM", () => { shutdown("SIGTERM"); });
}

// ---------------------------------------------------------------------------
// Session store — maps session IDs to their MCP server + transport instances.
// ---------------------------------------------------------------------------
interface Session {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  lastActivity: number;
}

const SESSION_TTL_MS = 30 * 60_000; // 30 minutes
const REAP_INTERVAL_MS = 60_000;    // check every minute

/**
 * Start the server in HTTP mode — stateful, session-based.
 * Each `initialize` request creates a persistent session (server + transport).
 * Subsequent requests re-use the session via the `mcp-session-id` header.
 * GET /mcp opens an SSE stream for server-initiated messages (progress, elicitation).
 * DELETE /mcp terminates a session.
 * Uses the MCP SDK's Express adapter which provides automatic DNS rebinding protection
 * when bound to localhost (validates Host header against allowed hostnames).
 */
async function startHttp(globalConfig: GlobalConfig, port: number): Promise<void> {
  const host = process.env.HOST || "127.0.0.1";
  const app = createMcpExpressApp({ host });

  const maxBodySize = globalConfig.HARNESS_MAX_BODY_SIZE_MB * 1024 * 1024;
  const { json } = await import("express");
  app.use(json({ limit: maxBodySize }));

  // CORS — allow GET, POST, DELETE for session-based MCP. The X-Harness-*
  // headers carry per-session Harness credentials (see parseSessionAuthHeaders).
  const allowedRequestHeaders = [
    "Content-Type",
    "mcp-session-id",
    "Authorization",
    "X-Harness-Token",
    "X-Harness-Cookie",
    "X-Harness-Api-Key",
    "X-Harness-Account",
    "X-Harness-Base-Url",
    "X-Harness-Default-Org",
    "X-Harness-Default-Project",
  ].join(", ");
  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", `http://${host}:${port}`);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", allowedRequestHeaders);
    res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
    next();
  });

  // Simple per-IP rate limiting: 60 requests per minute
  const ipHits = new Map<string, { count: number; resetAt: number }>();
  const RATE_WINDOW_MS = 60_000;
  const RATE_LIMIT = 60;

  app.use((req, res, next) => {
    const ip = req.ip ?? "unknown";
    const now = Date.now();
    let entry = ipHits.get(ip);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + RATE_WINDOW_MS };
      ipHits.set(ip, entry);
    }
    entry.count++;
    if (entry.count > RATE_LIMIT) {
      res.status(429).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Too many requests. Try again later." },
        id: null,
      });
      return;
    }
    next();
  });

  // Mount the report renderer routes on the same Express app — reports are
  // served from the same host:port as the MCP endpoint. The PDF exporter needs
  // to know the public base URL so Playwright can drive the print preview.
  const reportBaseUrl = `http://localhost:${port}`;
  mountReportRoutes(app, { publicBaseUrl: reportBaseUrl });
  setHttpReportBaseUrl(reportBaseUrl);

  // ---- Session store ----
  const sessions = new Map<string, Session>();

  function destroySession(sessionId: string): void {
    const session = sessions.get(sessionId);
    if (!session) return;
    sessions.delete(sessionId);
    session.transport.close().catch(() => {});
    session.server.close().catch(() => {});
    log.info("Session destroyed", { sessionId, remaining: sessions.size });
  }

  // TTL reaper — evicts idle sessions and expired rate-limit entries
  const reaper = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastActivity > SESSION_TTL_MS) {
        log.info("Reaping idle session", { sessionId: id });
        destroySession(id);
      }
    }
    // Evict expired rate-limit entries to prevent unbounded map growth
    for (const [ip, entry] of ipHits) {
      if (now >= entry.resetAt) {
        ipHits.delete(ip);
      }
    }
  }, REAP_INTERVAL_MS);
  reaper.unref();

  // ---- Routes ----

  // Health check (includes session count for observability)
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", sessions: sessions.size });
  });

  // POST /mcp — initialize new sessions or route to existing session
  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    // Existing session — route request to its transport
    if (sessionId) {
      const session = sessions.get(sessionId);
      if (!session) {
        res.status(404).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Session not found. Send an initialize request to start a new session." },
          id: null,
        });
        return;
      }
      session.lastActivity = Date.now();
      const httpStart = performance.now();
      const rpcMethod = mcpJsonRpcMethodFromBody(req.body);
      try {
        await session.transport.handleRequest(req, res, req.body);
      } catch (err) {
        log.error("Error handling session request", { sessionId, error: String(err) });
        if (!res.headersSent) {
          res.status(400).json({
            jsonrpc: "2.0",
            error: { code: -32700, message: "Invalid request" },
            id: null,
          });
        }
      } finally {
        log.info("MCP HTTP request", {
          durationMs: Math.round(performance.now() - httpStart),
          route: "POST /mcp",
          jsonrpcMethod: rpcMethod ?? "(none)",
          sessionId,
        });
      }
      return;
    }

    // No session header — must be an initialize request. Create a new session.
    let server: McpServer | undefined;
    let transport: StreamableHTTPServerTransport | undefined;
    let sessionConfig: Config | undefined;
    const initHttpStart = performance.now();
    const initRpcMethod = mcpJsonRpcMethodFromBody(req.body);
    try {
      // Resolve per-session credentials from headers, falling back to env defaults.
      const overrides = parseSessionAuthHeaders(req.headers as HeaderBag);
      try {
        sessionConfig = buildSessionConfig(globalConfig, overrides);
      } catch (authErr) {
        if (authErr instanceof SessionAuthError) {
          log.warn("Session auth rejected", { missing: authErr.missing });
          if (!res.headersSent) {
            res.status(401).json({
              jsonrpc: "2.0",
              error: {
                code: -32001,
                message: authErr.message,
                data: { missing: authErr.missing },
              },
              id: null,
            });
          }
          return;
        }
        throw authErr;
      }

      const sessionConfigSnapshot = sessionConfig;
      server = createHarnessServer(sessionConfigSnapshot);
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { server: server!, transport: transport!, lastActivity: Date.now() });
          log.info("Session created", {
            sessionId: id,
            total: sessions.size,
            accountId: sessionConfigSnapshot.HARNESS_ACCOUNT_ID,
            baseUrl: sessionConfigSnapshot.HARNESS_BASE_URL,
            tokenPresent: Boolean(sessionConfigSnapshot.HARNESS_BEARER_TOKEN),
            tokenTail: maskToken(sessionConfigSnapshot.HARNESS_BEARER_TOKEN),
            cookiePresent: Boolean(sessionConfigSnapshot.HARNESS_COOKIE),
            apiKeyPresent: Boolean(sessionConfigSnapshot.HARNESS_API_KEY),
          });
        },
      });

      transport.onclose = () => {
        if (transport!.sessionId) {
          destroySession(transport!.sessionId);
        }
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log.error("Error initializing session", { error: String(err) });
      if (!res.headersSent) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32700, message: "Invalid request. Send a JSON-RPC initialize message to start a session." },
          id: null,
        });
      }
      await transport?.close();
      await server?.close();
    } finally {
      log.info("MCP HTTP request", {
        durationMs: Math.round(performance.now() - initHttpStart),
        route: "POST /mcp",
        jsonrpcMethod: initRpcMethod ?? "(none)",
        sessionId: "initialize",
      });
    }
  });

  // GET /mcp — SSE stream for server-initiated messages (progress, elicitation)
  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "mcp-session-id header is required. Initialize a session first via POST." },
        id: null,
      });
      return;
    }

    const session = sessions.get(sessionId);
    if (!session) {
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Session not found. Send an initialize request to start a new session." },
        id: null,
      });
      return;
    }

    session.lastActivity = Date.now();
    const sseStart = performance.now();
    try {
      await session.transport.handleRequest(req, res);
    } catch (err) {
      log.error("Error handling SSE request", { sessionId, error: String(err) });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Failed to establish SSE stream" },
          id: null,
        });
      }
    } finally {
      log.info("MCP HTTP request", {
        durationMs: Math.round(performance.now() - sseStart),
        route: "GET /mcp",
        jsonrpcMethod: "sse",
        sessionId,
      });
    }
  });

  // DELETE /mcp — terminate a session
  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "mcp-session-id header is required." },
        id: null,
      });
      return;
    }

    const session = sessions.get(sessionId);
    if (!session) {
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Session not found." },
        id: null,
      });
      return;
    }

    const delStart = performance.now();
    const delRpcMethod = mcpJsonRpcMethodFromBody(req.body);
    try {
      await session.transport.handleRequest(req, res);
    } catch (err) {
      log.error("Error handling DELETE request", { sessionId, error: String(err) });
    } finally {
      log.info("MCP HTTP request", {
        durationMs: Math.round(performance.now() - delStart),
        route: "DELETE /mcp",
        jsonrpcMethod: delRpcMethod ?? "session_close",
        sessionId,
      });
    }
    destroySession(sessionId);
  });

  // Graceful shutdown — drain in-flight requests, then close all sessions
  const httpServer = app.listen(port, host, () => {
    log.info(`harness-ccm-finops-agent listening on http://${host}:${port}`);
    log.info(`  POST   /mcp    — MCP endpoint (session-based, DNS rebinding protected)`);
    log.info(`  GET    /mcp    — SSE stream (progress, elicitation)`);
    log.info(`  DELETE /mcp    — Terminate session`);
    log.info(`  GET    /health — Health check`);
  });

  let draining = false;

  const shutdown = (signal: string): void => {
    if (draining) return; // prevent double-shutdown
    draining = true;
    log.info(`Received ${signal}, draining...`);

    // 1. Stop accepting new connections
    httpServer.close(() => {
      log.info("HTTP server closed — no new connections");
    });

    // 2. Reject new requests immediately via middleware
    app.use((_req, res, _next) => {
      res.status(503).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Server is shutting down" },
        id: null,
      });
    });

    // 3. Close all sessions (terminates SSE streams, notifies transports)
    clearInterval(reaper);
    for (const [id] of sessions) {
      destroySession(id);
    }

    // 4. Allow in-flight responses to flush, then exit
    const DRAIN_TIMEOUT_MS = 10_000;
    setTimeout(() => {
      log.warn("Drain timeout — forcing exit");
      process.exit(1);
    }, DRAIN_TIMEOUT_MS).unref();

    // Check periodically if all connections are closed
    const drainCheck = setInterval(() => {
      httpServer.getConnections((err, count) => {
        if (err || count === 0) {
          clearInterval(drainCheck);
          log.info("All connections drained, exiting");
          process.exit(0);
        }
        log.debug("Draining...", { connections: count });
      });
    }, 500);
    drainCheck.unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

async function main(): Promise<void> {
  // Global error handlers — must be installed before anything else.
  // Node 20+ defaults --unhandled-rejections=throw, so unhandled rejections
  // crash the process. We catch them to log context before exiting.
  process.on("unhandledRejection", (reason) => {
    log.error("Unhandled promise rejection — exiting", { error: String(reason), stack: (reason as Error)?.stack });
    process.exit(1);
  });
  process.on("uncaughtException", (err) => {
    log.error("Uncaught exception — exiting", { error: err.message, stack: err.stack });
    process.exit(1);
  });

  const globalConfig = loadGlobalConfig();
  setLogLevel(globalConfig.LOG_LEVEL);

  const { transport, port } = parseArgs();

  log.info("Starting harness-ccm-finops-agent", {
    transport,
    defaultBaseUrl: globalConfig.HARNESS_BASE_URL,
    defaultAccountId: globalConfig.HARNESS_ACCOUNT_ID ?? "(none — must be supplied via X-Harness-Account header)",
    defaultOrg: globalConfig.HARNESS_DEFAULT_ORG_ID,
    defaultProject: globalConfig.HARNESS_DEFAULT_PROJECT_ID ?? "(none)",
    toolsets: globalConfig.HARNESS_TOOLSETS ?? "(all)",
    authMode: transport === "http" ? "header (with .env fallback)" : "env",
  });

  if (transport === "stdio") {
    await startStdio(globalConfig);
  } else {
    await startHttp(globalConfig, port);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
