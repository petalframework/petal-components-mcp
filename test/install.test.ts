// The install text is the step list an agent follows literally. Each test
// pins one fact a fresh Phoenix 1.8 install needs (verified against
// `mix phx.new` 1.8 in petalframework/petal_components#727). If a test here
// fails, the text has drifted from the library's usage-rules.md install
// section: fix the text, not the test, unless usage-rules.md changed too.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { INSTALL_INSTRUCTIONS as text } from "../src/mcp.js";

// The fenced block that follows the first line matching `after`.
function codeBlockAfter(after: RegExp): string {
  const at = text.search(after);
  assert.notEqual(at, -1, `no line matching ${after}`);
  const m = text.slice(at).match(/```[a-z]*\n([\s\S]*?)```/);
  assert.ok(m, `no code block after ${after}`);
  return m[1];
}

describe("get_install_instructions text", () => {
  it("keeps the library's step order", () => {
    const headings = [...text.matchAll(/^## (\S+)\. /gm)].map((m) => m[1]);
    assert.deepEqual(headings, ["1", "2", "3", "4", "4b", "5", "5b", "6", "7", "8", "9", "10"]);
  });

  it("pins the dependency to a release that ships usage-rules.md", () => {
    assert.match(text, /\{:petal_components, "~> 4\.18"\}/);
    assert.doesNotMatch(text, /"~> 4\.0"/);
  });

  it("names the websock_adapter unlock for a fresh 1.8 lock", () => {
    assert.match(text, /mix deps\.unlock websock_adapter && mix deps\.get/);
  });

  it("adds no second Tailwind import", () => {
    const css = codeBlockAfter(/^Open `assets\/css\/app\.css`/m);
    assert.doesNotMatch(css, /@import "tailwindcss"/);
    assert.match(css, /^@source "\.\.\/\.\.\/deps\/petal_components\/\*\*\/\*\.\*ex";$/m);
    assert.match(css, /^@source not "\.\.\/\.\.\/deps\/petal_components\/lib\/petal_components\/showcase";$/m);
    assert.match(css, /^@import "\.\.\/\.\.\/deps\/petal_components\/assets\/default\.css";$/m);
    assert.match(css, /^@plugin "@tailwindcss\/forms";$/m);
    assert.match(text, /do not add a second `@import "tailwindcss"`/);
    assert.match(text, /exactly one `@import "tailwindcss"` line/);
  });

  it("puts use PetalComponents in html_helpers, not def html", () => {
    assert.match(text, /Inside `defp html_helpers`/);
    assert.doesNotMatch(text, /Inside the `def html` macro/);
    assert.match(text, /`def live_view` does not go through `def html`/);
  });

  it("excludes the four clashing CoreComponents names", () => {
    const block = codeBlockAfter(/^to these two lines:/m);
    assert.equal(
      block,
      "use PetalComponents\nimport MyAppWeb.CoreComponents, except: [button: 1, icon: 1, input: 1, table: 1]\n",
    );
    assert.match(text, /call is ambiguous/);
  });

  it("says what generated phx.gen.* call sites need", () => {
    assert.match(text, /`<\.input field=\{@form\[:email\]\} type="email" label="Email" \/>` becomes `<\.field /);
    assert.match(text, /`<\.button variant="primary">` becomes `<\.button>`/);
    assert.match(text, /link_type="live_redirect"/);
    assert.match(text, /`<\.table>` has no `:action` slot/);
    assert.match(text, /btn-\*/);
  });

  it("routes form errors through the app's translator", () => {
    assert.match(text, /config :petal_components, :error_translator_function, \{MyAppWeb\.CoreComponents, :translate_error\}/);
  });

  it("merges the hooks with Phoenix 1.8's colocatedHooks", () => {
    assert.match(text, /hooks: \{\.\.\.colocatedHooks, \.\.\.PetalComponents\}/);
  });

  it("has the ECharts step that <.chart> needs", () => {
    assert.match(text, /^## 5b\. Charts \(only if the app uses `<\.chart>`\)/m);
    assert.match(text, /echarts\.min\.js/);
    assert.match(text, /window\.echarts = echarts/);
  });

  it("updates the AGENTS.md lines phx.new writes", () => {
    assert.match(text, /^## 6\. Update the project's agent instructions/m);
    assert.match(text, /`<\.icon>` comes from petal_components/);
  });

  it("verifies with warnings as errors and a LiveView render", () => {
    assert.match(text, /^Run: `mix compile --warnings-as-errors`$/m);
    assert.doesNotMatch(text, /^Run: `mix compile`$/m);
    assert.match(text, /assert has_element\?\(view, "button\.pc-button"\)/);
    assert.match(text, /contains `\.pc-button`/);
  });

  it("says the Chat family needs an alias", () => {
    assert.match(text, /alias PetalComponents\.Chat/);
    assert.match(text, /Chat family is not pulled in by `use PetalComponents`/);
    assert.doesNotMatch(text, /imports every component/);
  });
});
