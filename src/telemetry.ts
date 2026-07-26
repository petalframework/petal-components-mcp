import { schemas } from "./schemas.js";

// --- Channel instrumentation (bet 002) -------------------------------------
// In-memory counters since boot (the machine runs 24/7, so resets only on
// deploy) plus one structured log line per event for spot checks via
// `fly logs`. Recording happens only at true acceptance points: initialize
// when a session transport has been created, tool calls inside the SDK's
// validated CallTool handler - so rejected or malformed traffic never
// touches counters or stdout, and a batch cannot amplify log writes beyond
// the messages the server actually processes. Every key is validated
// against a known set (or a capped table for client names), so
// request-controlled strings cannot grow memory. Nothing is recorded beyond
// tool and component names.

export const metrics = {
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

// Call only after a session transport has been created for this request.
export const recordInitialize = (body: unknown) => {
  const messages = Array.isArray(body) ? body : [body];
  const init = messages.find(
    (m) => m && typeof m === "object" && (m as { method?: string }).method === "initialize",
  ) as { params?: { clientInfo?: { name?: unknown; version?: unknown } } } | undefined;
  if (!init) return;
  metrics.initializes += 1;
  const client = clientKey(init.params?.clientInfo?.name);
  bump(metrics.clients, client);
  const version =
    typeof init.params?.clientInfo?.version === "string" ? init.params.clientInfo.version.slice(0, 20) : undefined;
  console.log(JSON.stringify({ evt: "mcp_initialize", client, version, ts: new Date().toISOString() }));
};

// Call only from the SDK's CallTool handler - the message has already been
// schema-validated and is genuinely being processed.
export const recordToolCall = (tool: string, componentArg?: unknown) => {
  const toolKey = KNOWN_TOOLS.has(tool) ? tool : "_other";
  bump(metrics.tools, toolKey);
  let component: string | undefined;
  if (toolKey === "get_component") {
    const asked = typeof componentArg === "string" ? componentArg : "";
    component = KNOWN_COMPONENTS.has(asked) ? asked : "_other";
    bump(metrics.components, component);
  }
  console.log(JSON.stringify({ evt: "tool_call", tool: toolKey, component, ts: new Date().toISOString() }));
};
