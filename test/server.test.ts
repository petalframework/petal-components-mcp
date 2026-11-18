// End-to-end tests: start the built HTTP server, do a real MCP handshake
// over Streamable HTTP with the SDK client, and assert on what an agent
// would read. Run with `npm test` (builds first).
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

type Schema = {
  version: string;
  components: { name: string; kind: string; module: string }[];
};

const schemaFile: Schema = JSON.parse(readFileSync(new URL("../src/schemas.json", import.meta.url), "utf8"));
const publicNames = schemaFile.components.filter((c) => c.kind === "def").map((c) => c.name);
const privateNames = schemaFile.components.filter((c) => c.kind !== "def").map((c) => c.name);

let server: ChildProcess;
let baseUrl: string;
let client: Client;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHealth(url: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/healthz`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server at ${url} did not become healthy`);
}

async function callText(name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  return { text: result.content.map((c) => c.text).join("\n"), isError: result.isError === true };
}

// The section of a get_component response between two headings.
function section(text: string, heading: string): string {
  const start = text.indexOf(`## ${heading}`);
  if (start === -1) return "";
  const rest = text.slice(start + heading.length + 3);
  const next = rest.search(/^## /m);
  return next === -1 ? rest : rest.slice(0, next);
}

// One outer suite so the hooks run around every test on all Node versions.
describe("petal-components-mcp over HTTP", () => {
  before(async () => {
    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, ["dist/server.js"], {
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "ignore", "inherit"],
    });
    await waitForHealth(baseUrl);

    client = new Client({ name: "petal-mcp-test", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));
  });

  after(async () => {
    await client?.close().catch(() => {});
    server?.kill();
  });

  describe("handshake", () => {
    it("initializes and reports the server", () => {
      assert.equal(client.getServerVersion()?.name, "petal-components-mcp");
    });

    it("lists the three tools with unchanged names and arguments", async () => {
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map((t) => t.name).sort(), ["get_component", "get_install_instructions", "list_components"]);
      const get = tools.find((t) => t.name === "get_component")!;
      assert.deepEqual(get.inputSchema.required, ["name"]);
    });

    it("only answers MCP on /mcp", async () => {
      const res = await fetch(`${baseUrl}/`, { method: "POST" });
      assert.equal(res.status, 404);
    });
  });

  describe("private helpers", () => {
    it("schemas.json still carries the defp helpers this suite guards against", () => {
      assert.ok(privateNames.includes("bar"));
      assert.ok(privateNames.includes("month_nav"));
      assert.ok(privateNames.length > 0);
    });

    it("list_components lists and counts only public components", async () => {
      const { text } = await callText("list_components");
      assert.match(text, new RegExp(`v${schemaFile.version.replace(/\./g, "\\.")} — ${publicNames.length} components`));
      const listed = [...text.matchAll(/^- `([^`]+)`/gm)].map((m) => m[1]);
      assert.deepEqual(listed.sort(), [...publicNames].sort());
      for (const name of privateNames) assert.ok(!listed.includes(name), `${name} should not be listed`);
    });

    it("/healthz counts only public components", async () => {
      const health = await (await fetch(`${baseUrl}/healthz`)).json();
      assert.equal(health.components, publicNames.length);
      assert.equal(health.petal_components_version, schemaFile.version);
    });

    it("get_component on a private helper says it is not callable", async () => {
      const { text, isError } = await callText("get_component", { name: "bar" });
      assert.equal(isError, true);
      assert.match(text, /private helper/);
      assert.match(text, /not a callable component/);
      assert.match(text, /`progress`/);
      assert.doesNotMatch(text, /## Usage/);
    });

    it("get_component on an unknown name still reports it as missing", async () => {
      const { text, isError } = await callText("get_component", { name: "definitely_not_a_component" });
      assert.equal(isError, true);
      assert.match(text, /No component named "definitely_not_a_component"/);
    });
  });

  describe("get_component button", () => {
    it("renders the schema without notes it does not need", async () => {
      const { text, isError } = await callText("get_component", { name: "button" });
      assert.equal(isError, false);
      assert.match(text, /^# PetalComponents\.Button\.button\/1/);
      assert.match(text, /## Attributes/);
      assert.doesNotMatch(text, /## Before you paste/);
      assert.doesNotMatch(text, /Demo data/);
    });
  });

  describe("get_component checkbox_group", () => {
    it("prints atom values as atoms and shows how to pass one", async () => {
      const { text } = await callText("get_component", { name: "checkbox_group" });
      const layout = text.split("\n").find((l) => l.startsWith("- `layout`"));
      assert.ok(layout, "layout attr line present");
      assert.match(layout, /default: `:col`/);
      assert.match(layout, /values: `:row`, `:col`/);
      assert.match(layout, /layout=\{:row\}/);
      assert.doesNotMatch(layout, /values: `row`/);
    });

    it("prints nil for a nil allowed value", async () => {
      const { text } = await callText("get_component", { name: "skeleton" });
      const kind = text.split("\n").find((l) => l.startsWith("- `kind`"))!;
      assert.match(kind, /values: `nil`, `:default`/);
    });

    it("leaves string values as strings", async () => {
      const { text } = await callText("get_component", { name: "button" });
      const size = text.split("\n").find((l) => l.startsWith("- `size`"))!;
      assert.doesNotMatch(size, /`:md`/);
      assert.doesNotMatch(size, /pass an atom/);
    });
  });

  describe("get_component data_table", () => {
    it("renders slot attrs under each slot", async () => {
      const { text } = await callText("get_component", { name: "data_table" });
      const slots = section(text, "Slots");
      assert.match(slots, /- `<:col>`/);
      assert.match(slots, /\n {2}- `field` \(:atom\) · \*\*required\*\*/);
      assert.match(slots, /\n {2}- `sortable` \(:boolean\)/);
      assert.match(slots, /\n {2}- `filterable` \(:string\) · values: `text`, `number`, `select`, `date`/);
    });

    it("says State and Engine need an alias", async () => {
      const { text } = await callText("get_component", { name: "data_table" });
      const notes = section(text, "Before you paste");
      assert.match(notes, /alias PetalComponents\.DataTable\.\{State, Engine\}/);
    });

    it("marks examples that call a Showcase fixture as demo data", async () => {
      const { text } = await callText("get_component", { name: "data_table" });
      const examples = section(text, "Examples").split(/^### /m).slice(1);
      const withFixture = examples.filter((ex) => ex.includes("PetalComponents.Showcase."));
      assert.ok(withFixture.length > 0);
      for (const ex of withFixture) {
        assert.match(ex, /\*\*Demo data:\*\* this example calls `PetalComponents\.Showcase\./);
      }
      for (const ex of examples.filter((e) => !e.includes("PetalComponents.Showcase."))) {
        assert.doesNotMatch(ex, /Demo data/);
      }
    });

    it("names only the aliases a response uses", async () => {
      const { text } = await callText("get_component", { name: "empty" });
      const notes = section(text, "Before you paste");
      assert.match(notes, /alias PetalComponents\.DataTable\.State`/);
      assert.doesNotMatch(notes, /Engine/);
    });

    it("marks showcase-private helpers as demo data", async () => {
      const { text } = await callText("get_component", { name: "questionnaire" });
      assert.match(text, /\*\*Demo data:\*\* this example calls `scoping_spec\(\)`/);
      assert.match(text, /private to the showcase module/);
    });
  });

  describe("get_component Chat family", () => {
    it("says alias PetalComponents.Chat is required", async () => {
      const { text } = await callText("get_component", { name: "markdown" });
      assert.match(text, /^# PetalComponents\.Chat\.markdown\/1/);
      assert.match(text, /<Chat\.markdown/);
      assert.match(section(text, "Before you paste"), /alias PetalComponents\.Chat/);
    });

    it("list_components carries the Chat alias note", async () => {
      const { text } = await callText("list_components");
      assert.match(text, /alias PetalComponents\.Chat/);
    });
  });

  describe("get_install_instructions", () => {
    it("does not claim use PetalComponents imports the Chat family", async () => {
      const { text, isError } = await callText("get_install_instructions");
      assert.equal(isError, false);
      assert.match(text, /^# Installing petal_components into a Phoenix project/);
      assert.match(text, /imports every component except the Chat family/);
      assert.match(text, /alias PetalComponents\.Chat/);
      assert.doesNotMatch(text, /`<\.markdown>`|`<\.rich_text>`/);
    });
  });
});
