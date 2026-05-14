import { randomUUID } from "node:crypto";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express from "express";

import { createServer } from "./mcp.js";
import { schemas } from "./schemas.js";

const app = express();
app.use(express.json());

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

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  console.log(`petal-components-mcp listening on :${port}`);
  console.log(`  - MCP endpoint:  POST /mcp`);
  console.log(`  - Health check:  GET  /healthz`);
  console.log(`  - Loaded ${schemas.components.length} components from petal_components v${schemas.version}`);
});
