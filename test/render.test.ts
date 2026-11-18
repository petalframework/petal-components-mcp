// Renderer invariants over the whole bundled snapshot. These catch a future
// schema sync that brings in a new Chat component, a new State example, a
// new showcase fixture or a new showcase-private helper the notes do not cover.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  demoFixtureCalls,
  getComponent,
  listComponents,
  publicComponents,
  renderComponent,
  schemas,
  SHOWCASE_PRIVATE_HELPERS,
} from "../src/schemas.js";

describe("renderComponent over every public component", () => {
  const rendered = publicComponents.map((c) => ({ c, text: renderComponent(c) }));

  it("lists exactly the public components", () => {
    assert.deepEqual(
      listComponents().map((c) => c.name),
      schemas.components.filter((c) => c.kind === "def").map((c) => c.name),
    );
  });

  it("never serves a private helper", () => {
    for (const c of schemas.components.filter((c) => c.kind !== "def")) {
      assert.equal(getComponent(c.name), null, c.name);
    }
  });

  it("adds the Chat alias note to every response that shows a Chat tag", () => {
    for (const { c, text } of rendered) {
      if (/<\/?Chat\./.test(text)) assert.match(text, /alias PetalComponents\.Chat`/, c.name);
    }
  });

  // Each "### " block in the Examples section is one example: its title,
  // its own notes and its code.
  const exampleBlocks = rendered.flatMap(({ c, text }) =>
    (text.split(/^## Examples$/m)[1] ?? "")
      .split(/^## /m)[0]
      .split(/^### /m)
      .slice(1)
      .map((block) => ({ c, block, code: block.match(/```heex\n([\s\S]*?)\n```/)?.[1] ?? "" })),
  );

  it("puts the alias each example needs on that example, and no alias it does not use", () => {
    let checked = 0;
    for (const { c, block, code } of exampleBlocks) {
      const where = `${c.name}: ${block.split("\n")[0]}`;
      const state = /(?<![\w.])(%State\{|State\.)/.test(code);
      const engine = /(?<![\w.])Engine\./.test(code);
      const js = /(?<![\w.])JS\./.test(code);
      if (state || engine || js) checked++;
      if (state && engine) assert.match(block, /alias PetalComponents\.DataTable\.\{State, Engine\}`/, where);
      else if (state) assert.match(block, /alias PetalComponents\.DataTable\.State`/, where);
      else if (engine) assert.match(block, /alias PetalComponents\.DataTable\.Engine`/, where);
      else assert.doesNotMatch(block, /alias PetalComponents\.DataTable\./, where);
      if (js) assert.match(block, /alias Phoenix\.LiveView\.JS`/, where);
      else assert.doesNotMatch(block, /alias Phoenix\.LiveView\.JS/, where);
    }
    assert.ok(checked >= 10, `expected the known State/Engine/JS examples, saw ${checked}`);
  });

  it("marks every example that calls a Showcase fixture or a showcase-private helper as demo data", () => {
    let fixtures = 0;
    for (const { c, block, code } of exampleBlocks) {
      if (demoFixtureCalls(code).length) {
        fixtures++;
        assert.match(block, /\*\*Demo data:\*\*/, `${c.name}: ${block.split("\n")[0]}`);
      }
    }
    assert.ok(fixtures >= 32, `expected the 32 known demo-data examples, saw ${fixtures}`);
  });

  // A bare call in an example has to resolve in the caller's module. These
  // names do: Kernel, Phoenix.Component, components imported by `use
  // PetalComponents`, and CSS functions inside attribute strings. Anything
  // else is most likely a new `defp` in a showcase module, which the example
  // can call but the caller cannot. Add it to SHOWCASE_PRIVATE_HELPERS (if it
  // is one) or here (if it resolves).
  const RESOLVABLE_BARE_CALLS = new Set([
    "length", "hd", "to_form", // Kernel, Phoenix.Component
    "show_modal", "hide_modal", "show_slide_over", "hide_slide_over", // imported by use PetalComponents
    "w", "url", "var", "rgba", // ~w sigil and CSS functions in attribute strings
  ]);

  it("knows every bare function call the served examples make", () => {
    for (const { c, block, code } of exampleBlocks) {
      for (const m of code.matchAll(/(?<![\w.:@])([a-z_]\w*[!?]?)\(/g)) {
        const fn = m[1];
        assert.ok(
          RESOLVABLE_BARE_CALLS.has(fn) || SHOWCASE_PRIVATE_HELPERS.includes(fn),
          `${c.name}: ${block.split("\n")[0]} calls ${fn}(), which this server does not know. If it is a defp in a showcase module, add it to SHOWCASE_PRIVATE_HELPERS.`,
        );
      }
    }
  });

  it("names the eqrcode dep wherever <.qr_code> is shown", () => {
    for (const { c, text } of rendered) {
      if (/<\.qr_code[\s/>]/.test(text)) assert.match(text, /\{:eqrcode, "~> 0\.2"\}/, c.name);
    }
  });

  it("prints no atom-typed allowed value as a bare string", () => {
    for (const { c, text } of rendered) {
      for (const line of text.split("\n")) {
        const m = line.match(/^\s*- `[^`]+` \(:atom\).*values: (.*?)( · | — |$)/);
        if (!m) continue;
        for (const v of m[1].split(", ")) assert.match(v, /^`(:\w+|nil)`$/, `${c.name}: ${line}`);
      }
    }
  });

  it("renders every slot attr in the snapshot", () => {
    for (const { c, text } of rendered) {
      for (const slot of c.slots) {
        for (const attr of slot.attrs) {
          assert.ok(text.includes(`  - \`${attr.name}\` (${attr.type})`), `${c.name} <:${slot.name}> ${attr.name}`);
        }
      }
    }
  });
});
