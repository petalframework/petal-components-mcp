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
// `fly logs`. Nothing is recorded beyond tool and component names — no
// arguments, no payloads.
const metrics = {
  since: new Date().toISOString(),
  initializes: 0,
  clients: {} as Record<string, number>,
  tools: {} as Record<string, number>,
  components: {} as Record<string, number>,
};

const bump = (table: Record<string, number>, key: string) => {
  table[key] = (table[key] ?? 0) + 1;
};

const track = (body: unknown) => {
  for (const msg of Array.isArray(body) ? body : [body]) {
    if (!msg || typeof msg !== "object") continue;
    const { method, params } = msg as {
      method?: string;
      params?: { clientInfo?: { name?: string; version?: string }; name?: string; arguments?: { name?: unknown } };
    };
    if (method === "initialize") {
      metrics.initializes += 1;
      const client = params?.clientInfo?.name ?? "unknown";
      bump(metrics.clients, client);
      console.log(
        JSON.stringify({ evt: "mcp_initialize", client, version: params?.clientInfo?.version, ts: new Date().toISOString() }),
      );
    } else if (method === "tools/call") {
      const tool = params?.name ?? "unknown";
      bump(metrics.tools, tool);
      const component = tool === "get_component" && params?.arguments?.name ? String(params.arguments.name) : undefined;
      if (component) bump(metrics.components, component);
      console.log(JSON.stringify({ evt: "tool_call", tool, component, ts: new Date().toISOString() }));
    }
  }
};
// ----------------------------------------------------------------------------

// Per-session transports — Streamable HTTP MCP sessions are sticky.
const transports = new Map<string, StreamableHTTPServerTransport>();

app.post("/mcp", async (req, res) => {
  track(req.body);
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
  }

  if (!transport) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "No active session. Send initialize request first." },
      id: null,
    });
    return;
  }

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
