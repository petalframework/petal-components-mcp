import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  getComponent,
  getPrivateHelper,
  listComponents,
  renderComponent,
  renderPrivateHelper,
  schemas,
} from "./schemas.js";
import { recordToolCall } from "./telemetry.js";

// The install steps mirror the "Installing petal_components" section of the
// library's usage-rules.md (same order, same edits, same verify step). Step 10
// is MCP-only. test/install.test.ts fails if a key fact drops out.
// Step 10 needs petal_components 4.18.0 or later: that release is the first to
// ship usage-rules.md in the Hex package (petalframework/petal_components#716).
export const INSTALL_INSTRUCTIONS = `# Installing petal_components into a Phoenix project

Follow these steps in order. They are idempotent - safe to re-run if any step is partially done. Read each file before editing, and do not blind-patch. If the project already uses petal_components, skip the steps that are already done and report what was already in place.

## 1. Add the dependency

Open \`mix.exs\`. In the \`deps/0\` function, add this entry if it is not already present:

\`\`\`elixir
{:petal_components, "~> 4.18"}
\`\`\`

If the user wants the chat components (\`PetalComponents.Chat\`: \`<Chat.conversation>\`, \`<Chat.markdown>\`, \`<Chat.rich_text>\` and the rest), also add the optional \`{:mdex, "~> 0.12"}\`. If the user wants \`<.qr_code>\`, also add the optional \`{:eqrcode, "~> 0.2"}\`; without it, rendering a QR code raises an error that says to add it. The other components need no extra deps. The Chat family is not pulled in by \`use PetalComponents\`: add \`alias PetalComponents.Chat\` and call it namespaced.

## 2. Fetch dependencies

Run: \`mix deps.get\`

Releases up to and including 4.18.0 declared \`websock_adapter ~> 0.5.7\`, which a new Phoenix 1.8 app's \`mix.lock\` (websock_adapter 0.7.x) does not satisfy, so resolution fails with a message naming \`websock_adapter\`. Later releases do not declare it. If you see that failure, run \`mix deps.unlock websock_adapter && mix deps.get\`.

## 3. Configure Tailwind CSS

Open \`assets/css/app.css\` and find the existing \`@import "tailwindcss"\` line (Phoenix 1.8 writes it as \`@import "tailwindcss" source(none);\`). Leave that line exactly as it is and do not add a second \`@import "tailwindcss"\`. Directly below it, add these four lines:

\`\`\`css
@source "../../deps/petal_components/**/*.*ex";
@source not "../../deps/petal_components/lib/petal_components/showcase";
@import "../../deps/petal_components/assets/default.css";
@plugin "@tailwindcss/forms";
\`\`\`

When you are done, \`app.css\` contains exactly one \`@import "tailwindcss"\` line.

The paths are relative to \`assets/css/\`, so they start with \`../../deps\`. The \`@source\` line tells Tailwind to scan petal_components source for class usage. The \`@source not\` line skips the \`showcase/\` example modules, which power petal.build's own docs and would only add unused utility classes to the user's CSS. \`@source not\` needs Tailwind v4.1+; on v4.0 it is harmless to drop the line. The \`@import\` line brings in the default component styles (the \`pc-*\` CSS prefix).

The \`@plugin\` line loads \`@tailwindcss/forms\`. The form components are styled on top of it: the plugin sets the border width and padding on text inputs, selects and textareas, and resets the native look of checkboxes and selects. Without it, Tailwind's preflight leaves inputs with no border and no padding. Skip the line if the app already loads the plugin. The \`tailwind\` Hex package that Phoenix uses runs the standalone Tailwind CLI, which already includes the plugin, so there is nothing to install. If the app builds Tailwind through Node instead, run \`npm install -D @tailwindcss/forms\` in \`assets/\`.

\`<.prose>\` renders Tailwind's \`prose\` classes, which come from the \`@tailwindcss/typography\` plugin. Without the plugin the content inside \`<.prose>\` has no typography styles at all. If the app uses \`<.prose>\`, add \`@plugin "@tailwindcss/typography";\` below the forms line, unless the app already loads it. The standalone Tailwind CLI includes this plugin too, so there is nothing to install; with a Node build, run \`npm install -D @tailwindcss/typography\` in \`assets/\`.

If there is no \`@import "tailwindcss"\` line, the project is on Tailwind v3 and petal_components 4.x will not work. Tell the user to upgrade to Tailwind v4, or pin to \`petal_components ~> 1.0\` for Tailwind v3 support.

## 4. Import the components in the web module

Find \`lib/<your_app>_web.ex\`. In umbrella apps it lives at \`apps/<your_app>_web/lib/<your_app>_web.ex\`. The file defines \`def html\`, \`def live_view\`, \`def live_component\` and a private \`defp html_helpers\`. All three of the public ones \`unquote(html_helpers())\`, but \`def live_view\` does not go through \`def html\`, so an import placed in \`def html\` never reaches a LiveView. Put it in \`html_helpers\`.

Phoenix 1.8's generated \`core_components.ex\` defines \`button/1\`, \`icon/1\`, \`input/1\` and \`table/1\`, the same names petal_components exports. Importing both makes every call to those four ambiguous, and the app stops compiling (\`function icon/1 imported from both <YourApp>Web.CoreComponents and PetalComponents.Icon, call is ambiguous\`, first in the generated \`Layouts\`). So exclude those four from the CoreComponents import. Inside \`defp html_helpers\`, change the generated line

\`\`\`elixir
import MyAppWeb.CoreComponents
\`\`\`

to these two lines:

\`\`\`elixir
use PetalComponents
import MyAppWeb.CoreComponents, except: [button: 1, icon: 1, input: 1, table: 1]
\`\`\`

(with the app's module name in place of \`MyAppWeb\`). The rest of CoreComponents (\`flash/1\`, \`header/1\`, \`list/1\` and the others) stays imported. If the compiler reports another \`call is ambiguous\` name (apps generated by older Phoenix versions also define \`modal/1\`, for example), add it to the \`except:\` list the same way. If \`use PetalComponents\` is already in \`html_helpers\`, skip this step; if it is in \`def html\`, move it.

\`use PetalComponents\` imports the components so you can call them as \`<.button>\`, \`<.modal>\`, etc. without explicit aliases. The one component family it does not import is Chat (\`PetalComponents.Chat\`, see step 1), which you alias and call as \`<Chat.markdown>\` and so on. The other modules it leaves out are not meant to be called from your templates: \`PetalComponents.DataTable.FilterEditor\`, which \`<.data_table>\` and \`<.filters>\` render for you; the old \`HeroiconsV1\` icon sets, which it aliases as \`HeroiconsV1\` (use \`<.icon name="hero-...">\` instead); and the \`Showcase\` and \`Svg\` helpers the library uses for its own docs and icons.

After this, \`<.button>\`, \`<.icon>\`, \`<.input>\` and \`<.table>\` everywhere in the app are the petal_components versions, which take different attributes from the CoreComponents ones. A fresh \`phx.new\` app compiles unchanged (its layouts only call \`<.icon name="hero-...">\`, which petal_components renders the same way). Pages written by \`mix phx.gen.live\` or \`mix phx.gen.auth\`, before or after the install, call the CoreComponents versions and need their call sites updated:

- \`<.input field={@form[:email]} type="email" label="Email" />\` becomes \`<.field field={@form[:email]} type="email" label="Email" />\`. petal_components' \`<.input>\` is the bare control and renders no label and no errors, so keeping \`<.input label=...>\` silently drops both.
- \`<.button variant="primary">\` becomes \`<.button>\` (solid primary is the default). A \`<.button>\` with no \`variant\` was the CoreComponents soft style (Cancel buttons, for example); make it \`<.button variant="soft">\` so it does not turn solid. \`<.button navigate={~p"/path"}>\` becomes \`<.button link_type="live_redirect" to={~p"/path"}>\`.
- Remove the daisyUI \`btn\`, \`btn-primary\`, \`btn-soft\` and other \`btn-*\` classes from a button's \`class\` (\`phx.gen.auth\` writes \`class="btn btn-primary w-full"\`). petal_components adds \`class\` to its own classes, so they would stack two button styles on one element. Keep layout classes such as \`w-full\`.
- \`<.table>\` has no \`:action\` slot. Move the row actions into a last \`<:col :let={row} label="">\`. \`rows={@streams.items}\` works as before. With \`row_click\` set, petal_components puts the row click on every cell, so the actions cell gets it too; drop \`row_click\` if the row should not open the record.
- Generated tests that match exact input HTML (for example \`phx.gen.auth\`'s login test asserting \`~s(<input type="email" name="user[email]" ...)\`) fail, because petal_components renders the attributes in a different order with its own classes. Rewrite them with \`has_element?/2\` and a selector.

\`mix compile --warnings-as-errors\` flags the \`variant="primary"\`, \`navigate\` and \`:action\` call sites. It does not flag \`<.input label=...>\` or the \`btn-*\` classes. A leftover \`<.input label=...>\` compiles and renders with no label and no errors; the generated LiveView tests catch it (their \`can't be blank\` assertions fail), so run \`mix test\` after the edits, and search the templates for \`<.input\` and \`btn\` as well. To keep one generated page exactly as generated instead, call the core component by its module: \`<MyAppWeb.CoreComponents.input field={@form[:email]} label="Email" />\`.

## 4b. Route form errors through the app's translator

In \`config/config.exs\`, add:

\`\`\`elixir
config :petal_components, :error_translator_function, {MyAppWeb.CoreComponents, :translate_error}
\`\`\`

(with the app's module name in place of \`MyAppWeb\`). Phoenix generates \`translate_error/1\` in \`core_components.ex\`, and it runs errors through Gettext. Without this line petal_components falls back to plain \`%{key}\` substitution, which cannot handle the list options some Ecto validations add: \`unsafe_validate_unique\` (used by \`phx.gen.auth\`) adds \`fields: [:email]\`, so "has already been taken" renders as "invalid value" and a warning is logged. If the app already sets \`:error_translator_function\`, skip this step.

## 5. Register the JS hooks

petal_components v4 ships a bundled JS hook set that many components need: toasts, dropdowns and popovers, alert dialogs, the command palette, the combobox, the data table, the date picker and calendar, sliders, charts, the chat family, the enhanced inputs and more. Without the hooks those components still render, but their interactive behaviour is missing and the browser console reports an unknown hook. You never register hooks individually - spread the whole set once. Open \`assets/js/app.js\`, import the hooks, and merge them into the \`LiveSocket\`:

\`\`\`js
import PetalComponents from "../../deps/petal_components/assets/js/petal_components"

const liveSocket = new LiveSocket("/live", Socket, {
  params: { _csrf_token: csrfToken },
  hooks: { ...PetalComponents }, // merge with existing hooks: { ...MyHooks, ...PetalComponents }
})
\`\`\`

Phoenix 1.8 already passes \`hooks: {...colocatedHooks}\`; make it \`hooks: {...colocatedHooks, ...PetalComponents}\`.

If the project has no \`assets/js/app.js\` (an API-only or minimal app), skip this step: only the interactive components need the hooks.

## 5b. Charts (only if the app uses \`<.chart>\`)

The \`<.chart>\` component drives Apache ECharts but does not bundle it: the engine is bring-your-own. Add it only when the app actually renders a \`<.chart>\`; skip otherwise. Either a script tag in the root layout:

\`\`\`html
<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
\`\`\`

or \`npm i echarts\` plus \`import * as echarts from "echarts"; window.echarts = echarts;\` in \`app.js\`. The \`PetalChart\` hook picks it up from \`window.echarts\` and warns in the console if it is missing (the chart area renders empty). \`<.sparkline>\` is pure server-rendered SVG and needs nothing.

## 6. Update the project's agent instructions

\`mix phx.new\` writes an \`AGENTS.md\` whose Phoenix guidelines tell an agent to always use the \`<.icon>\` and \`<.input>\` components from \`core_components.ex\`. After step 4 those two lines are wrong for this app. In \`AGENTS.md\`, replace the line that starts \`\`- Out of the box, \`core_components.ex\` imports an \`<.icon\`\` with:

\`\`\`text
- \`<.icon>\` comes from petal_components (\`use PetalComponents\` in \`html_helpers\`). Use \`<.icon name="hero-x-mark" class="w-5 h-5" />\` for hero icons, **never** \`Heroicons\` modules or similar
\`\`\`

and replace the line that starts \`\`- **Always** use the imported \`<.input>\` component\`\` with:

\`\`\`text
- Form fields use petal_components \`<.field field={@form[:name]} label="..." />\` (label, input, errors and help text). \`<.input>\` is the petal_components bare input and renders no label
\`\`\`

Delete the line after them that starts \`\`- If you override the default input classes\`\` (and its continuation line): petal_components adds your \`class\` to its own classes rather than replacing them. Further down, in the form section, change \`\`and the \`<.input>\` component in the template\`\` to \`\`and the \`<.field>\` component in the template\`\`, and in the form examples change every \`<.input field=\` to \`<.field field=\`. If the project keeps the same guidelines in \`CLAUDE.md\` or another rules file, make the same change there. If the project has no \`AGENTS.md\` and no such file (apps made with \`mix phx.new --no-agents-md\`, or by Phoenix before 1.8), skip this step.

## 7. Verify

Run: \`mix compile --warnings-as-errors\`

It must finish with no warnings. Warnings printed while compiling \`petal_components\` itself about \`MDEx\` or \`EQRCode\` are about optional dependencies and do not fail the build. Then check that a LiveView renders the library's markup, not the CoreComponents markup. A fresh \`phx.new\` app has no LiveView yet, so if the app has none that renders a \`<.button>\`, add a throwaway one:

\`\`\`elixir
# lib/my_app_web/live/install_check_live.ex
defmodule MyAppWeb.InstallCheckLive do
  use MyAppWeb, :live_view

  def render(assigns), do: ~H"<.button>Hello</.button>"
end
\`\`\`

with \`live "/install-check", InstallCheckLive\` in the router's \`"/"\` browser scope, and this test:

\`\`\`elixir
# test/my_app_web/live/install_check_live_test.exs
defmodule MyAppWeb.InstallCheckLiveTest do
  use MyAppWeb.ConnCase, async: true
  import Phoenix.LiveViewTest

  test "renders petal_components", %{conn: conn} do
    {:ok, view, _html} = live(conn, ~p"/install-check")
    assert has_element?(view, "button.pc-button")
  end
end
\`\`\`

Run \`mix test\`, then delete the three throwaway pieces. Finally run \`mix assets.build\` and confirm \`priv/static/assets/css/app.css\` contains \`.pc-button\`.

## 8. Brand colours (optional)

Components work out of the box: petal_components ships default colour ramps (blue \`primary\`, pink \`secondary\`, semantic hues, zinc \`gray\`). They are soft defaults (\`@theme default\`), so a plain \`@theme\` block in the project's \`app.css\` wins no matter where it sits relative to the import:

\`\`\`css
@theme inline {
  --color-primary-50: var(--color-violet-50);
  --color-primary-100: var(--color-violet-100);
  /* ...one line per stop, 50-950, for any ramp you want to change... */
  --color-primary-950: var(--color-violet-950);
}
\`\`\`

\`primary\` is the base action colour and tints every variant of every component; \`secondary\` is a second brand accent with the same rule; \`info\`/\`success\`/\`warning\`/\`danger\` carry meaning and should stay recognisable; \`gray\` is the neutral chrome. The \`gray\` role ships Tailwind's zinc values under the gray name, and because \`--color-gray-*\` is a shared namespace this also sets what the app's own \`text-gray-*\` / \`bg-gray-*\` utilities render as. To use a different neutral, remap it per stop (\`--color-gray-50: var(--color-slate-50);\` and so on). To restore Tailwind's original gray, add one import after the default styles:

\`\`\`css
@import "../../deps/petal_components/assets/default.css";
@import "../../deps/petal_components/assets/tailwind-gray.css";
\`\`\`

## 9. Type (optional)

Components inherit the host app's font stack, and that is the default. For a whole-app face, set Tailwind's own theme font (\`@theme { --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif; }\`) and the components follow. Three opt-in tokens exist for distinct faces; the package only reads them, so an app that sets nothing changes nothing: \`--pc-font-heading\` (the \`<.h1>\`..\`<.h5>\` components and prose headings, falling back through \`--pc-font-body\`), \`--pc-font-body\` (the typography components, \`<.prose>\`, chat) and \`--pc-font-mono\` (inline code and other mono surfaces, falling back through \`--font-mono\`).

## 10. Keep the rules in sync automatically (optional)

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
          "Get the canonical steps for installing petal_components in a Phoenix project. Call this when the user asks to install petal_components, when you are setting up a new Phoenix project that needs UI components, or when verifying an existing installation. Returns step-by-step instructions covering mix.exs, mix deps.get, Tailwind v4 CSS config, the web module import (including the Phoenix 1.8 CoreComponents name clash), the JS hooks, ECharts for charts, the project's AGENTS.md and a verify step, plus an optional step that keeps the petal_components usage rules synced into CLAUDE.md or AGENTS.md with the usage_rules package. Steps are idempotent - safe to follow on a project that is partially configured.",
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
          "Get the full schema for one petal_components component: attrs, slots, defaults, allowed values, and HEEx usage examples. Some examples call the library's demo data; the response marks those. Call this every time you are about to write a tag like <.button>, <.modal>, <.table>, or <.field> so the attrs and slots match the real library instead of training-data guesses.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description:
                "Component function name without the leading dot (e.g. 'button', 'modal', 'field', 'text_input'). For most components the HEEx tag is the name prefixed with a dot: <.button>. PetalComponents.Chat and PetalComponents.DataTable.FilterEditor components are called namespaced, e.g. <Chat.markdown>; the response says so. Call list_components for the full inventory.",
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
        "Components in PetalComponents.Chat are not imported by `use PetalComponents`: add `alias PetalComponents.Chat` and call them as `<Chat.name>`. The same goes for PetalComponents.DataTable.FilterEditor, which `<.data_table>` renders for you. The rest are plain tags such as `<.button>`.",
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
        const helper = getPrivateHelper(componentName);
        if (helper) {
          return {
            content: [{ type: "text", text: renderPrivateHelper(helper) }],
            isError: true,
          };
        }

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
