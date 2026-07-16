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

petal_components v4 ships JS hooks for the password/copyable/clearable inputs, the chat components, the navigation menu (hover mode), the command palette and the aurora backdrop (everything else is CSS + LiveView.JS only). Open \`assets/js/app.js\`, import the hooks, and merge them into the \`LiveSocket\`:

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
          "Get the canonical steps for installing petal_components in a Phoenix project. Call this when the user asks to install petal_components, when you are setting up a new Phoenix project that needs UI components, or when verifying an existing installation. Returns step-by-step instructions covering mix.exs, mix deps.get, Tailwind v4 CSS config, and the web module import. Steps are idempotent - safe to follow on a project that is partially configured.",
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
