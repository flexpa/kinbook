import type { EventType, GenDate } from "@kinbook/core";

/**
 * Low-level GEDCOM node. A single line of a .ged file:
 *   `level xref? tag value?`
 * with child nodes forming the hierarchy.
 */
export interface GedNode {
  level: number;
  xref: string | null;
  tag: string;
  value: string | null;
  children: GedNode[];
  /** 1-based source line (set by parse; absent on hand-built nodes). */
  line?: number;
}

export function node(
  level: number,
  tag: string,
  value: string | null = null,
  xref: string | null = null,
): GedNode {
  return { level, tag, value, xref, children: [] };
}

export function child(parent: GedNode, tag: string, value: string | null = null): GedNode {
  const c = node(parent.level + 1, tag, value);
  parent.children.push(c);
  return c;
}

/** High-level, dialect-agnostic GEDCOM document. */
export interface GedName {
  given: string;
  surname: string;
  prefix?: string | null;
  suffix?: string | null;
}

export interface GedEvent {
  type: EventType;
  date?: GenDate | null;
  /** display form of the place */
  place?: string | null;
  notes?: string[];
}

export interface GedIndividual {
  xref: string; // "@I1@"
  names: GedName[];
  sex?: string;
  events: GedEvent[];
  notes?: string[];
  /** family xrefs where this person is a child */
  childFamilyXrefs: string[];
  /** family xrefs where this person is a spouse */
  spouseFamilyXrefs: string[];
}

export interface GedFamily {
  xref: string; // "@F1@"
  husbandXref?: string | null;
  wifeXref?: string | null;
  childXrefs: string[];
  events: GedEvent[];
  notes?: string[];
}

export interface GedcomDocument {
  submitter?: string;
  individuals: GedIndividual[];
  families: GedFamily[];
}