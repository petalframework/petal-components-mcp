import schemasJson from "./schemas.json" with { type: "json" };

export type ComponentAttr = {
  name: string;
  type: string;
  required: boolean;
  default: string | null;
  // Atom values arrive as strings and nil as null (see formatValue).
  values: (string | null)[] | null;
  doc: string | null;
};

export type ComponentSlot = {
  name: string;
  required: boolean;
  doc: string | null;
  attrs: ComponentAttr[];
};

// A curated example from the library's Showcase registry - the same block the
// playground and petal.build render, captured from source at compile time.
export type ShowcaseExample = {
  title: string;
  description: string | null;
  code: string;
};

export type Component = {
  name: string;
  module: string;
  kind: string;
  attrs: ComponentAttr[];
  slots: ComponentSlot[];
  examples?: ShowcaseExample[];
};

export type SchemaFile = {
  version: string;
  generated_at: string;
  components: Component[];
};

export const schemas: SchemaFile = schemasJson as SchemaFile;

// The extract records every function component in each module, including
// private (`defp`) helpers. Those cannot be called from a template outside
// their own module, so they are never listed, counted or served as usable.
export const publicComponents: Component[] = schemas.components.filter((c) => c.kind === "def");

export function listComponents() {
  return publicComponents.map((c) => ({
    name: c.name,
    module: c.module,
    summary: summarize(c),
  }));
}

export function getComponent(name: string): Component | null {
  return publicComponents.find((c) => c.name === name) ?? null;
}

// A private helper with this name, if there is one. Used to tell the caller
// the name exists but is not callable, instead of serving it as a component.
export function getPrivateHelper(name: string): Component | null {
  return schemas.components.find((c) => c.name === name && c.kind !== "def") ?? null;
}

export function renderPrivateHelper(c: Component): string {
  const siblings = publicComponents.filter((s) => s.module === c.module).map((s) => `\`${s.name}\``);
  const lines = [
    `"${c.name}" is a private helper (\`defp ${c.name}/1\`) inside ${c.module} in petal_components v${schemas.version}. It is not a callable component: code outside that module cannot call it, and \`<.${c.name}>\` fails to compile with "undefined function ${c.name}/1".`,
  ];
  if (siblings.length) {
    lines.push("", `Use the public components from the same module instead: ${siblings.join(", ")}. Call get_component with one of those names.`);
  } else {
    lines.push("", "Call list_components to see the components you can use.");
  }
  return lines.join("\n");
}

function summarize(c: Component): string {
  const attrCount = c.attrs.length;
  const slotCount = c.slots.length;
  const required = c.attrs.filter((a) => a.required).map((a) => a.name);
  const requiredSlots = c.slots.filter((s) => s.required).map((s) => s.name);

  const parts = [`${attrCount} attrs`, `${slotCount} slots`];
  if (required.length) parts.push(`required attrs: ${required.join(", ")}`);
  if (requiredSlots.length) parts.push(`required slots: ${requiredSlots.join(", ")}`);

  return parts.join(" · ");
}

export function renderComponent(c: Component): string {
  const lines = [
    `# ${c.module}.${c.name}/1`,
    "",
    `Phoenix.Component from \`petal_components\` v${schemas.version}.`,
    "",
  ];

  // Prefer the library's own curated examples - real, idiomatic usage lifted
  // from the showcase. When every curated example is a broader composition
  // (the component only ever appears as a part of a larger whole), keep the
  // generated skeleton as the minimal form so a focused usage always leads.
  const curated = c.examples ?? [];
  const showSkeleton = curated.length === 0 || !hasDedicatedExample(c);

  const skeleton = showSkeleton ? exampleUsage(c) : null;
  const notes = scopeNotes([skeleton ?? "", ...curated.map((ex) => ex.code)].join("\n"));
  if (notes.length) {
    lines.push("## Before you paste", "", ...notes, "");
  }

  if (skeleton) {
    lines.push("## Usage", "", "```heex", skeleton, "```", "");
  }
  if (curated.length) {
    lines.push("## Examples", "");
    for (const ex of curated) {
      lines.push(`### ${ex.title}`);
      if (ex.description) lines.push("", ex.description);
      const note = demoDataNote(ex.code);
      if (note) lines.push("", note);
      lines.push("", "```heex", ex.code.trim(), "```", "");
    }
  }

  if (c.attrs.length) {
    lines.push("## Attributes", "");
    for (const attr of c.attrs) {
      lines.push(renderAttr(attr));
    }
    lines.push("");
  }

  if (c.slots.length) {
    lines.push("## Slots", "");
    for (const slot of c.slots) {
      lines.push(renderSlot(slot));
    }
  }

  return lines.join("\n");
}

// The extract is JSON, so atom values arrive as plain strings ("row" for
// :row) and nil arrives as null. Print them the way HEEx needs them.
function formatValue(attr: ComponentAttr, v: string | null): string {
  if (v === null) return "nil";
  return attr.type === ":atom" ? `:${v}` : v;
}

function atomHint(attr: ComponentAttr): string {
  const sample = attr.values?.find((v) => v !== null);
  if (!sample) return `pass an atom: \`${attr.name}={:...}\`, not a string`;
  return `pass an atom: \`${attr.name}={:${sample}}\`, not \`${attr.name}="${sample}"\``;
}

export function renderAttr(attr: ComponentAttr, indent = ""): string {
  const parts = [`${indent}- \`${attr.name}\` (${attr.type})`];
  if (attr.required) parts.push("**required**");
  if (attr.default !== null && attr.default !== "nil") parts.push(`default: \`${attr.default}\``);
  if (attr.values?.length) {
    parts.push(`values: ${attr.values.map((v) => `\`${formatValue(attr, v)}\``).join(", ")}`);
  }
  if (attr.type === ":atom") parts.push(atomHint(attr));
  let line = parts.join(" · ");
  if (attr.doc) line += ` — ${attr.doc}`;
  return line;
}

export function renderSlot(slot: ComponentSlot): string {
  const parts = [`- \`<:${slot.name}>\``];
  if (slot.required) parts.push("**required**");
  let line = parts.join(" · ");
  if (slot.doc) line += ` — ${slot.doc}`;
  if (slot.attrs?.length) {
    line += "\n" + slot.attrs.map((a) => renderAttr(a, "  ")).join("\n");
  }
  return line;
}

// Notes about names the served HEEx uses that `use PetalComponents` does not
// bring into scope. The schema data is left as extracted; the response says
// what the caller has to add.
function scopeNotes(code: string): string[] {
  const notes: string[] = [];
  if (/<\/?Chat\./.test(code)) {
    notes.push(
      "- The Chat family is not imported by `use PetalComponents`. Add `alias PetalComponents.Chat` to the module that renders this (or to the `html_helpers` block of your web module), then call the tags as `<Chat.name>`.",
    );
  }
  const usesState = /(?<![\w.])(%State\{|State\.)/.test(code);
  const usesEngine = /(?<![\w.])Engine\./.test(code);
  if (usesState || usesEngine) {
    const used = [usesState && "State", usesEngine && "Engine"].filter((n): n is string => Boolean(n));
    const target =
      used.length > 1 ? `PetalComponents.DataTable.{${used.join(", ")}}` : `PetalComponents.DataTable.${used[0]}`;
    const full = used.map((n) => `\`PetalComponents.DataTable.${n}\``).join(" and ");
    notes.push(
      `- The examples use ${used.map((n) => `\`${n}\``).join(" and ")} without a module prefix, and \`use PetalComponents\` does not alias them. Add \`alias ${target}\` to the module, or write ${full} in full.`,
    );
  }
  return notes;
}

// Calls into the library's showcase fixtures. These produce demo data for the
// playground and petal.build pages. `PetalComponents.Showcase.*` functions are
// public but are demo data; the bare helpers below are private to their
// showcase modules and do not exist in a caller's module at all.
const SHOWCASE_PRIVATE_HELPERS = ["scoping_spec", "framework_spec", "rag_sources", "shell_menu_items"];

export function demoFixtureCalls(code: string): string[] {
  const found = new Set<string>();
  for (const m of code.matchAll(/PetalComponents\.Showcase\.[\w.]+?\.\w+[!?]?(?=\()/g)) {
    found.add(`${m[0]}()`);
  }
  for (const helper of SHOWCASE_PRIVATE_HELPERS) {
    if (new RegExp(`(?<![\\w.])${helper}\\(`).test(code)) found.add(`${helper}()`);
  }
  return [...found];
}

function demoDataNote(code: string): string | null {
  const calls = demoFixtureCalls(code);
  if (!calls.length) return null;
  const list = calls.map((f) => `\`${f}\``).join(", ");
  let note = `> **Demo data:** this example calls ${list}, fixture data that feeds the library's own demo pages. It is not part of the component API. Replace it with your own data before you use the example.`;
  const bare = calls.filter((f) => !f.startsWith("PetalComponents."));
  if (bare.length === 1) {
    note += ` \`${bare[0]}\` is private to the showcase module, so it is undefined in your code.`;
  } else if (bare.length > 1) {
    note += ` ${bare.map((f) => `\`${f}\``).join(" and ")} are private to the showcase module, so they are undefined in your code.`;
  }
  return note;
}

// True when at least one curated example renders ONLY this component among
// its module siblings - i.e. a dedicated example, not a composition it
// appears in. Extraction orders examples most-focused-first, so checking the
// first example suffices.
function hasDedicatedExample(c: Component): boolean {
  const first = c.examples?.[0];
  if (!first) return false;
  const siblings = schemas.components.filter((s) => s.module === c.module).map((s) => s.name);
  const tagUsed = (name: string) =>
    new RegExp(`<(?:[A-Z][\\w.]*\\.|\\.)${name}[\\s/>]`).test(first.code);
  return siblings.filter(tagUsed).length === 1;
}

function exampleUsage(c: Component): string {
  // The Chat family is not imported by `use PetalComponents` - it is called
  // through `alias PetalComponents.Chat`, so the skeleton must show the
  // namespaced tag (the extractor applies the same rule to curated examples).
  const isChatFamily = c.module.split(".").pop() === "Chat";
  const tag = isChatFamily ? `Chat.${c.name}` : `.${c.name}`;
  const requiredAttrs = c.attrs.filter((a) => a.required && a.name !== "rest");
  const attrStrs = requiredAttrs.map((a) => `${a.name}={...}`);
  const hasInnerBlock = c.slots.some((s) => s.name === "inner_block");
  const otherSlots = c.slots.filter((s) => s.name !== "inner_block");

  const opening = attrStrs.length ? `<${tag} ${attrStrs.join(" ")}>` : `<${tag}>`;

  if (!hasInnerBlock && otherSlots.length === 0) {
    return attrStrs.length ? `<${tag} ${attrStrs.join(" ")} />` : `<${tag} />`;
  }

  const body: string[] = [];
  for (const slot of otherSlots) {
    body.push(`  <:${slot.name}>...</:${slot.name}>`);
  }
  if (hasInnerBlock) {
    body.push("  ...");
  }

  return [opening, ...body, `</${tag}>`].join("\n");
}
