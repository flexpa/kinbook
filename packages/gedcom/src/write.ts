import type { GedNode } from "./model";

/** Serialize a GedNode tree into GEDCOM 5.5/7.0 line text. */
export function write(roots: GedNode[]): string {
  const lines: string[] = [];
  for (const root of roots) {
    emit(root, lines);
  }
  return lines.join("\n") + "\n";
}

function emit(n: GedNode, out: string[]): void {
  const xref = n.xref ? ` ${n.xref}` : "";
  const value = n.value ? ` ${n.value}` : "";
  out.push(`${n.level}${xref} ${n.tag}${value}`);
  for (const c of n.children) emit(c, out);
}