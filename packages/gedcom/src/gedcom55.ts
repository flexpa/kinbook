import type { GedcomDocument } from "./model";
import { child, node, type GedNode } from "./model";
import { eventTag, formatDate } from "./date";
import { write } from "./write";
import type { GedEvent } from "./model";

/**
 * Build a GEDCOM 5.5.5 record tree from a dialect-agnostic document and
 * serialize it. 5.5.5 is the broadcast-compatible interchange dialect.
 */
export function toGedcom55(doc: GedcomDocument): string {
  const roots = [header55()];
  for (const indi of doc.individuals) roots.push(individual55(indi));
  for (const fam of doc.families) roots.push(family55(fam));
  roots.push(node(0, "TRLR"));
  return write(roots);
}

function header55() {
  const head = node(0, "HEAD");
  const sour = child(head, "SOUR", "FAMILY-TREE");
  child(sour, "VERS", "0.1.0");
  const gedc = child(head, "GEDC");
  child(gedc, "VERS", "5.5.5");
  child(gedc, "FORM", "LINEAGE-LINKED");
  child(head, "CHAR", "UTF-8");
  return head;
}

function individual55(indi: GedcomDocument["individuals"][number]) {
  const r = node(0, "INDI", null, indi.xref);
  for (const n of indi.names) {
    const name = child(r, "NAME", nameValue(n));
    if (n.given) child(name, "GIVN", n.given);
    if (n.surname) child(name, "SURN", n.surname);
  }
  if (indi.sex) child(r, "SEX", indi.sex.toUpperCase().slice(0, 1));
  for (const ev of indi.events) attachEvent(r, ev, "55");
  for (const ref of indi.childFamilyXrefs) child(r, "FAMC", ref);
  for (const ref of indi.spouseFamilyXrefs) child(r, "FAMS", ref);
  for (const note of indi.notes ?? []) addNote(r, note);
  return r;
}

function family55(fam: GedcomDocument["families"][number]) {
  const r = node(0, "FAM", null, fam.xref);
  if (fam.husbandXref) child(r, "HUSB", fam.husbandXref);
  if (fam.wifeXref) child(r, "WIFE", fam.wifeXref);
  for (const c of fam.childXrefs) child(r, "CHIL", c);
  for (const ev of fam.events) attachEvent(r, ev, "55");
  for (const note of fam.notes ?? []) addNote(r, note);
  return r;
}

function nameValue(n: { given: string; surname: string; suffix?: string | null }): string {
  let s = n.given;
  if (n.surname) s += ` /${n.surname}/`;
  if (n.suffix) s += ` ${n.suffix}`;
  return s;
}

function attachEvent(parent: ReturnType<typeof node>, ev: GedEvent, dialect: "55" | "70"): void {
  const e = child(parent, eventTag(ev.type, dialect));
  const d = formatDate(ev.date);
  if (d) child(e, "DATE", d);
  if (ev.place) child(e, "PLAC", ev.place);
  for (const note of ev.notes ?? []) addNote(e, note);
}

/** Emit a NOTE sub-record, using CONT for multi-line text. */
export function addNote(parent: GedNode, text: string): void {
  const lines = text.split("\n");
  const note = child(parent, "NOTE", lines[0] || null);
  for (let i = 1; i < lines.length; i++) {
    child(note, "CONT", lines[i]!);
  }
}

export { nameValue };