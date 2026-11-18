// Renderer invariants over the whole bundled snapshot. These catch a future
// schema sync that brings in a new Chat component, a new State example or a
// new showcase fixture the notes do not cover.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getComponent,
  listComponents,
  publicComponents,
  renderComponent,
  schemas,
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

  it("adds a DataTable alias note to every response that uses bare State or Engine", () => {
    for (const { c, text } of rendered) {
      const code = (c.examples ?? []).map((e) => e.code).join("\n");
      if (/(?<![\w.])(%State\{|State\.|Engine\.)/.test(code)) {
        assert.match(text, /alias PetalComponents\.DataTable\./, c.name);
      }
    }
  });

  it("marks every example that calls a Showcase fixture as demo data", () => {
    let fixtures = 0;
    for (const { c, text } of rendered) {
      const blocks = text.split(/^### /m).slice(1);
      for (const block of blocks) {
        if (block.includes("PetalComponents.Showcase.")) {
          fixtures++;
          assert.match(block, /\*\*Demo data:\*\*/, `${c.name}: ${block.split("\n")[0]}`);
        }
      }
    }
    assert.ok(fixtures >= 13, `expected the 13 known fixture examples, saw ${fixtures}`);
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
