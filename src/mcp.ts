import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  getComponent,
  listComponents,
  renderComponent,
  schemas,
} from "./schemas.js";
import { recordToolCall } from "./telemetry.js";

// TODO: step 7 says "petal_components 4.18 or later". Confirm that version once
// petalframework/petal_components#716 (rules.md -> usage-rules.md) ships in a release.
const INSTALL_INSTRUCTIONS = `# Installing petal_components into a Phoenix project

Follow these steps. They are idempotent - safe to re-run if any step is partially done. Read each file before editing.

## 1. Add the dependency

Open \`mix.exs\`. In the \`deps/0\` function, add this entry if it is not already present:

\`\`\`elixir
{:petal_components, "~> 4.0"}
\`\`\`

If the user wants the chat markdown components (\`<.markdown>\`, \`<.rich_text>\`), also add \`{:mdex, "~> 0.12"}\`. The rest of the library needs no extra deps.

## 2. Fetch dependencies

Run: \`mix deps.get\`

## 3. Configure Tailwind CSS

Open \`assets/css/app.css\`. Find the \`@import "tailwindcss";\` line and add the two lines below it:

\`\`\`css
@import "tailwindcss";
@source "../deps/petal_components/**/*.*ex";
@source not "../deps/petal_components/lib/petal_components/showcase";
@import "../deps/petal_components/assets/default.css";
\`\`\`

If \`@import "tailwindcss";\` is missing, the project is on Tailwind v3 and petal_components 4.x will not work. Tell the user to upgrade to Tailwind v4, or pin to \`petal_components ~> 1.0\` for Tailwind v3 support.

## 4. Import the components in the web module

Find \`lib/<your_app>_web.ex\`. In umbrella apps it lives at \`apps/<your_app>_web/lib/<your_app>_web.ex\`. The file defines macros like \`def html\`, \`def controller\`, \`def live_view\`.

Inside the \`def html\` macro, locate the \`quote do\` block and add \`use PetalComponents\`:

\`\`\`elixir
def html do
  quote do
    use Phoenix.Component
    use PetalComponents
    # ... existing imports
  end
end
\`\`\`

If \`use PetalComponents\` is already there, skip this step.

## 5. Register the JS hooks

petal_components v4 ships a bundled JS hook set - toasts, the command palette and its trigger, the colour-scheme switch, carousel, charts, local time, sliders, OTP input, the chat family, popover, the combobox, the data table, the navigation menu's hover mode, the effects, and the enhanced inputs (everything else is CSS + LiveView.JS only). You never register hooks individually - spread the whole set once. Open \`assets/js/app.js\`, import the hooks, and merge them into the \`LiveSocket\`:

\`\`\`js
import PetalComponents from "../../deps/petal_components/assets/js/petal_components"

const liveSocket = new LiveSocket("/live", Socket, {
  params: { _csrf_token: csrfToken },
  hooks: { ...PetalComponents }, // merge with existing hooks if present
})
\`\`\`

Skip this only if the project has no \`assets/js/app.js\` (API-only or minimal app).

## 6. Verify

Run: \`mix compile\`

Should compile cleanly. To smoke test, drop \`<.button>Hello</.button>\` in any HEEx template and load the page.

## 7. Keep the rules in sync automatically (optional)

petal_components ships its AI usage rules as \`usage-rules.md\`, the file the [usage_rules](https://hexdocs.pm/usage_rules) package reads from each dependency. With usage_rules set up, \`mix usage_rules.sync\` copies the rules into the project's agent instructions file and refreshes them after every petal_components upgrade.

This needs petal_components 4.18 or later. Check the locked version in \`mix.lock\`. If it is older, skip this step unless the user wants to upgrade first with \`mix deps.update petal_components\`.

Offer this step rather than doing it unasked: it adds a dev dependency and writes several hundred lines of rules into the agent instructions file.

In \`mix.exs\`, add this entry to \`deps/0\` if it is not already present:

\`\`\`elixir
{:usage_rules, "~> 1.1", only: [:dev]}
\`\`\`

In the \`project/0\` function in \`mix.exs\`, add a \`usage_rules:\` key:

\`\`\`elixir
def project do
  [
    # ... existing config
    usage_rules: [file: "CLAUDE.md", usage_rules: [:petal_components]]
  ]
end
\`\`\`

Set \`file:\` to the file the project's agent reads: \`AGENTS.md\` for most agents, \`CLAUDE.md\` for Claude Code. Use the one that already exists if there is one. If the project already has a \`usage_rules:\` config, add \`:petal_components\` to its existing \`usage_rules:\` list instead of replacing it - the sync drops the rules for any package that is not listed.

Then run: \`mix deps.get\` and \`mix usage_rules.sync\`

The sync only rewrites the block between \`<!-- usage-rules-start -->\` and \`<!-- usage-rules-end -->\`, so the rest of the file is left alone and it is safe to re-run after each upgrade. If the inlined rules make the file too long, list \`{:petal_components, link: :markdown}\` instead of \`:petal_components\` to add a link to the rules rather than the full text.

## Notes

- \`use PetalComponents\` imports every component so you can call them as \`<.button>\`, \`<.modal>\`, \`<.table>\`, etc. without explicit aliases.
- After installing, call \`list_components\` to see the full inventory and \`get_component <name>\` for any component's attrs and slots.
- Report which steps you actually applied and which were already in place. Do not silently overwrite existing config.
`;

export function createServer() {
  const server = new Server(
    {
      name: "petal-components-mcp",
      version: "0.2.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "get_install_instructions",
        description:
          "Get the canonical steps for installing petal_components in a Phoenix project. Call this when the user asks to install petal_components, when you are setting up a new Phoenix project that needs UI components, or when verifying an existing installation. Returns step-by-step instructions covering mix.exs, mix deps.get, Tailwind v4 CSS config, and the web module import, plus an optional step that keeps the petal_components usage rules synced into CLAUDE.md or AGENTS.md with the usage_rules package. Steps are idempotent - safe to follow on a project that is partially configured.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
      {
        name: "list_components",
        description:
          "List every component shipped by petal_components, the shadcn-style component library for Phoenix LiveView. This is the canonical Phoenix UI vocabulary - call it before composing any HEEx so you reach for an existing component instead of hand-rolling Tailwind divs.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
      {
        name: "get_component",
        description:
          "Get the full schema for one petal_components component: attrs, slots, defaults, allowed values, and a working HEEx usage example. Call this every time you are about to write a tag like <.button>, <.modal>, <.table>, or <.field> so the attrs and slots match the real library instead of training-data guesses.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description:
                "Component function name without the leading dot (e.g. 'button', 'modal', 'field', 'text_input'). The HEEx tag is the same name prefixed with a dot: <.button>. Call list_components for the full inventory.",
            },
          },
          required: ["name"],
          additionalProperties: false,
        },
      },
    ],
  }));

  const GetComponentInput = z.object({ name: z.string() });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    recordToolCall(name, (args as { name?: unknown } | undefined)?.name);

    if (name === "get_install_instructions") {
      return {
        content: [{ type: "text", text: INSTALL_INSTRUCTIONS }],
      };
    }

    if (name === "list_components") {
      const components = listComponents();
      const text = [
        `petal_components v${schemas.version} — ${components.length} components`,
        "",
        ...components.map((c) => `- \`${c.name}\` (${c.module}) — ${c.summary}`),
        "",
        "Call `get_component` with a name to get the full schema and usage example.",
      ].join("\n");

      return {
        content: [{ type: "text", text }],
      };
    }

    if (name === "get_component") {
      const { name: componentName } = GetComponentInput.parse(args);
      const component = getComponent(componentName);

      if (!component) {
        return {
          content: [
            {
              type: "text",
              text: `No component named "${componentName}" exists in petal_components v${schemas.version}. Call list_components to see what's available.`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: renderComponent(component) }],
      };
    }

    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  });

  return server;
}
