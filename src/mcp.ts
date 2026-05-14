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
          "List every component available in petal_components (the Shadcn-style Phoenix LiveView component library). Use this first to see what's available before composing HEEx markup.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
      {
        name: "get_component",
        description:
          "Get the full schema for a single petal_components component — attrs, slots, defaults, allowed values, and a HEEx usage example. Call this any time you're about to write a Phoenix LiveView component reference like <.pc_button> or <.input>, to ensure the attrs and slots match the real library.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description:
                "Component function name (e.g. 'button', 'modal', 'input'). Get the full list via list_components.",
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
