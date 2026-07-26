import { randomUUID } from "node:crypto";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express from "express";

import { createServer } from "./mcp.js";
import { schemas } from "./schemas.js";

const app = express();
app.use(express.json());

// --- Channel instrumentation (bet 002) -------------------------------------
// In-memory counters since boot (the machine runs 24/7, so resets only on
// deploy) plus one structured log line per event for spot checks via
// `fly logs`. Only ACCEPTED requests are recorded - rejected traffic never
// touches the counters or stdout - and every key is validated against a
// known set (or a capped table for client names), so request-controlled
// strings cannot grow memory or logs unboundedly. Nothing is recorded
// beyond tool and component names.
const metrics = {
  since: new Date().toISOString(),
  initializes: 0,
  clients: {} as Record<string, number>,
  tools: {} as Record<string, number>,
  components: {} as Record<string, number>,
};

const KNOWN_TOOLS = new Set(["get_install_instructions", "list_components", "get_component"]);
const KNOWN_COMPONENTS = new Set(schemas.components.map((c) => c.name));
const MAX_CLIENT_KEYS = 24;

const bump = (table: Record<string, number>, key: string) => {
  table[key] = (table[key] ?? 0) + 1;
};

const clientKey = (name: unknown): string => {
  const raw = typeof name === "string" && name.trim() ? name.trim().slice(0, 40) : "unknown";
  if (metrics.clients[raw] !== undefined) return raw;
  return Object.keys(metrics.clients).length < MAX_CLIENT_KEYS ? raw : "_other";
};

type McpMessage = {
  method?: string;
  params?: { clientInfo?: { name?: string; version?: string }; name?: string; arguments?: { name?: unknown } };
};

// Called only when a new session was actually created for this request.
const trackInitialize = (body: unknown) => {
  const messages = Array.isArray(body) ? body : [body];
  const init = messages.find((m) => m && typeof m === "object" && (m as McpMessage).method === "initialize") as
    | McpMessage
    | undefined;
  if (!init) return;
  metrics.initializes += 1;
  const client = clientKey(init.params?.clientInfo?.name);
  bump(metrics.clients, client);
  const version = typeof init.params?.clientInfo?.version === "string" ? init.params.clientInfo.version.slice(0, 20) : undefined;
  console.log(JSON.stringify({ evt: "mcp_initialize", client, version, ts: new Date().toISOString() }));
};

// Called only when a valid session transport is about to handle the request.
const trackToolCalls = (body: unknown) => {
  for (const msg of Array.isArray(body) ? body : [body]) {
    if (!msg || typeof msg !== "object") continue;
    const { method, params } = msg as McpMessage;
    if (method !== "tools/call") continue;
    const tool = typeof params?.name === "string" && KNOWN_TOOLS.has(params.name) ? params.name : "_other";
    bump(metrics.tools, tool);
    let component: string | undefined;
    if (tool === "get_component") {
      const asked = typeof params?.arguments?.name === "string" ? params.arguments.name : "";
      component = KNOWN_COMPONENTS.has(asked) ? asked : "_other";
      bump(metrics.components, component);
    }
    console.log(JSON.stringify({ evt: "tool_call", tool, component, ts: new Date().toISOString() }));
  }
};
// ----------------------------------------------------------------------------

// Per-session transports — Streamable HTTP MCP sessions are sticky.
const transports = new Map<string, StreamableHTTPServerTransport>();

app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport && isInitializeRequest(req.body)) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, transport!);
      },
    });

    transport.onclose = () => {
      if (transport!.sessionId) transports.delete(transport!.sessionId);
    };

    const server = createServer();
    await server.connect(transport);
    trackInitialize(req.body);
  }

  if (!transport) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "No active session. Send initialize request first." },
      id: null,
    });
    return;
  }

  trackToolCalls(req.body);
  await transport.handleRequest(req, res, req.body);
});

const sessionRequest = async (req: express.Request, res: express.Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).send("No active session");
    return;
  }
  await transport.handleRequest(req, res);
};

app.get("/mcp", sessionRequest);
app.delete("/mcp", sessionRequest);

app.get("/healthz", (_req, res) => {
  res.json({
    ok: true,
    petal_components_version: schemas.version,
    components: schemas.components.length,
    schemas_generated_at: schemas.generated_at,
  });
});

app.get("/metrics", (_req, res) => {
  res.json(metrics);
});

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  console.log(`petal-components-mcp listening on :${port}`);
  console.log(`  - MCP endpoint:  POST /mcp`);
  console.log(`  - Health check:  GET  /healthz`);
  console.log(`  - Loaded ${schemas.components.length} components from petal_components v${schemas.version}`);
});
