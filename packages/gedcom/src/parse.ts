import type { GedNode } from "./model";
import { node } from "./model";

/**
 * Parse GEDCOM line text into a forest of GedNode trees based on level.
 * Lines are assumed pre-validated; structurally-garbled input throws.
 */
export function parse(text: string): GedNode[] {
  const roots: GedNode[] = [];
  const stack: GedNode[] = [];
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = raw.replace(/\r$/, "");
    if (line.trim() === "") continue;

    const n = parseLine(line);
    n.line = i + 1;

    let parent: GedNode | null = null;
    let top = stack[stack.length - 1];
    while (top && top.level >= n.level) {
      stack.pop();
      top = stack[stack.length - 1];
    }
    if (top) parent = top;

    if (parent) parent.children.push(n);
    else roots.push(n);
    stack.push(n);
  }

  return roots;
}

function parseLine(line: string): GedNode {
  // level [xref] TAG [value]
  const m = /^(\d+)(?:\s+(@[^@]+@))?\s+([A-Z0-9_]+)(?:\s+(.*))?$/.exec(line.trim());
  if (!m) throw new Error(`invalid GEDCOM line: ${line}`);
  return node(Number(m[1]), m[3]!, m[4] ?? null, m[2] ?? null);
}