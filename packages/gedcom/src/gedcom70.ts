import type { GedcomDocument, GedEvent } from "./model";
import { child, node } from "./model";
import { eventTag, formatDate } from "./date";
import { write } from "./write";
import { addNote, nameValue } from "./gedcom55";

/**
 * Build a GEDCOM 7.0 record tree from a dialect-agnostic document and
 * serialize it. 7.0 is cleaner (UTF-8 native, structured names/places) but
 * has poor importer support today.
 */
export function toGedcom70(doc: GedcomDocument): string {
  const roots = [header70()];
  for (const indi of doc.individuals) roots.push(individual70(indi));
  for (const fam of doc.families) roots.push(family70(fam));
  roots.push(node(0, "TRLR"));
  return write(roots);
}

function header70() {
  const head = node(0, "HEAD");
  child(head, "SOUR", "FAMILY-TREE");
  child(head, "SCHMA", "https://gedcom.io/schema/v7.0/gedcom.json");
  child(head, "CHAR", "UTF-8");
  child(head, "GEDC");
  child(head, "VERS", "7.0");
  child(head, "FORM", "LINEAGE-LINKED");
  return head;
}

function individual70(indi: GedcomDocument["individuals"][number]) {
  const r = node(0, "INDI", null, indi.xref);
  for (const n of indi.names) {
    const name = child(r, "NAME", nameValue(n));
    if (n.given) child(name, "GIVN", n.given);
    if (n.surname) child(name, "SURN", n.surname); // 7.0 prefers structured name parts
  }
  if (indi.sex) child(r, "SEX", indi.sex.toUpperCase().slice(0, 1));
  for (const ev of indi.events) attachEvent(r, ev, "70");
  for (const ref of indi.childFamilyXrefs) child(r, "FAMC", ref);
  for (const ref of indi.spouseFamilyXrefs) child(r, "FAMS", ref);
  for (const note of indi.notes ?? []) addNote(r, note);
  return r;
}

function family70(fam: GedcomDocument["families"][number]) {
  const r = node(0, "FAM", null, fam.xref);
  if (fam.husbandXref) child(r, "HUSB", fam.husbandXref);
  if (fam.wifeXref) child(r, "WIFE", fam.wifeXref);
  for (const c of fam.childXrefs) child(r, "CHIL", c);
  for (const ev of fam.events) attachEvent(r, ev, "70");
  for (const note of fam.notes ?? []) addNote(r, note);
  return r;
}

function attachEvent(parent: ReturnType<typeof node>, ev: GedEvent, dialect: "55" | "70"): void {
  const e = child(parent, eventTag(ev.type, dialect));
  const d = formatDate(ev.date);
  if (d) child(e, "DATE", d);
  if (ev.place) child(e, "PLAC", ev.place);
  for (const note of ev.notes ?? []) addNote(e, note);
}