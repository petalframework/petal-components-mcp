import schemasJson from "./schemas.json" with { type: "json" };

export type ComponentAttr = {
  name: string;
  type: string;
  required: boolean;
  default: string | null;
  values: string[] | null;
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

export function listComponents() {
  return schemas.components.map((c) => ({
    name: c.name,
    module: c.module,
    summary: summarize(c),
  }));
}

export function getComponent(name: string): Component | null {
  return schemas.components.find((c) => c.name === name) ?? null;
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
  // from the showcase. The generated skeleton below is only a fallback for
  // components the showcase does not cover yet.
  if (c.examples?.length) {
    lines.push("## Examples", "");
    for (const ex of c.examples) {
      lines.push(`### ${ex.title}`);
      if (ex.description) lines.push("", ex.description);
      lines.push("", "```heex", ex.code.trim(), "```", "");
    }
  } else {
    lines.push("## Usage", "", "```heex", exampleUsage(c), "```", "");
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

function renderAttr(attr: ComponentAttr): string {
  const parts = [`- \`${attr.name}\` (${attr.type})`];
  if (attr.required) parts.push("**required**");
  if (attr.default !== null && attr.default !== "nil") parts.push(`default: \`${attr.default}\``);
  if (attr.values?.length) parts.push(`values: ${attr.values.map((v) => `\`${v}\``).join(", ")}`);
  let line = parts.join(" · ");
  if (attr.doc) line += ` — ${attr.doc}`;
  return line;
}

function renderSlot(slot: ComponentSlot): string {
  const parts = [`- \`<:${slot.name}>\``];
  if (slot.required) parts.push("**required**");
  let line = parts.join(" · ");
  if (slot.doc) line += ` — ${slot.doc}`;
  return line;
}

function exampleUsage(c: Component): string {
  const tag = `.${c.name}`;
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
