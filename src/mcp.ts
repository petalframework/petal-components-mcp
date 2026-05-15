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

export function createServer() {
  const server = new Server(
    {
      name: "petal-components-mcp",
      version: "0.1.0",
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
