/**
 * Self-contained GEDCOM reader for the viewer. Accepts 5.5.x and 7.0 exports;
 * lenient about tags it does not know. No imports — the page must stay
 * dependency free.
 */

export interface GEvent {
  tag: string;
  /** human label, e.g. "Birth" */
  label: string;
  /** raw DATE value as written in the file */
  date: string | null;
  /** best-effort extracted year for density display */
  year: number | null;
  /** true when the date is qualified (ABT/EST/CAL) */
  approx: boolean;
  place: string | null;
  /** tag-line value, e.g. the occupation text of OCCU */
  value: string | null;
}

export interface GPerson {
  id: string;
  given: string;
  surname: string;
  suffix: string;
  sex: "M" | "F" | "U";
  events: GEvent[];
  birth: GEvent | null;
  death: GEvent | null;
  /** families where this person is a child */
  famc: string[];
  /** families where this person is a spouse */
  fams: string[];
}

export interface GFamily {
  id: string;
  husb: string | null;
  wife: string | null;
  children: string[];
  events: GEvent[];
  marriage: GEvent | null;
  divorce: GEvent | null;
}

export interface Archive {
  persons: Map<string, GPerson>;
  families: Map<string, GFamily>;
  warnings: string[];
}

interface Line {
  level: number;
  xref: string | null;
  tag: string;
  value: string | null;
  children: Line[];
}

const EVENT_LABELS: Record<string, string> = {
  BIRT: "Birth",
  CHR: "Christening",
  BAPM: "Baptism",
  DEAT: "Death",
  BURI: "Burial",
  CREM: "Cremation",
  MARR: "Marriage",
  DIV: "Divorce",
  ENGA: "Engagement",
  RESI: "Residence",
  CENS: "Census",
  IMMI: "Immigration",
  EMIG: "Emigration",
  NATU: "Naturalization",
  OCCU: "Occupation",
  EDUC: "Education",
  RELI: "Religion",
  EVEN: "Event",
  _EVENT: "Event",
};

export function parseGedcom(text: string): Archive {
  const roots = parseLines(text);
  const persons = new Map<string, GPerson>();
  const families = new Map<string, GFamily>();
  const warnings: string[] = [];

  for (const rec of roots) {
    if (rec.tag === "INDI" && rec.xref) persons.set(rec.xref, readPerson(rec));
    else if (rec.tag === "FAM" && rec.xref) families.set(rec.xref, readFamily(rec));
  }

  if (persons.size === 0) {
    throw new Error(
      roots.some((r) => r.tag === "HEAD")
        ? "The file has no individual records."
        : "The file is not a GEDCOM export (no HEAD record).",
    );
  }

  // Drop dangling references so layout never chases a missing record.
  for (const fam of families.values()) {
    if (fam.husb && !persons.has(fam.husb)) { warnings.push(`missing ${fam.husb}`); fam.husb = null; }
    if (fam.wife && !persons.has(fam.wife)) { warnings.push(`missing ${fam.wife}`); fam.wife = null; }
    fam.children = fam.children.filter((c) => persons.has(c));
  }
  for (const p of persons.values()) {
    p.famc = p.famc.filter((f) => families.has(f));
    p.fams = p.fams.filter((f) => families.has(f));
  }

  // Trust the family records over the person pointers: rebuild the person
  // side from HUSB/WIFE/CHIL so a partial export still links up.
  for (const p of persons.values()) { p.famc = []; p.fams = []; }
  for (const fam of families.values()) {
    for (const s of [fam.husb, fam.wife]) {
      const sp = s ? persons.get(s) : null;
      if (sp && !sp.fams.includes(fam.id)) sp.fams.push(fam.id);
    }
    for (const c of fam.children) {
      const cp = persons.get(c)!;
      if (!cp.famc.includes(fam.id)) cp.famc.push(fam.id);
    }
  }

  return { persons, families, warnings };
}

function parseLines(text: string): Line[] {
  const roots: Line[] = [];
  const stack: Line[] = [];

  for (const raw of text.split("\n")) {
    const s = raw.replace(/\r$/, "").replace(/^﻿/, "");
    if (s.trim() === "") continue;
    const m = /^\s*(\d+)(?:\s+(@[^@]+@))?\s+([A-Za-z0-9_]+)(?:\s(.*))?$/.exec(s);
    if (!m) continue; // lenient: skip garbled lines instead of failing the file
    const line: Line = {
      level: Number(m[1]),
      xref: m[2] ?? null,
      tag: m[3]!.toUpperCase(),
      value: m[4] ?? null,
      children: [],
    };

    // CONT/CONC extend the parent's value rather than adding structure.
    const top = () => stack[stack.length - 1];
    if (line.tag === "CONT" || line.tag === "CONC") {
      while (top() && top()!.level >= line.level) stack.pop();
      const parent = top();
      if (parent) {
        parent.value = (parent.value ?? "") + (line.tag === "CONT" ? "\n" : "") + (line.value ?? "");
      }
      continue;
    }

    while (top() && top()!.level >= line.level) stack.pop();
    const parent = top();
    if (parent) parent.children.push(line);
    else roots.push(line);
    stack.push(line);
  }
  return roots;
}

function readPerson(rec: Line): GPerson {
  const p: GPerson = {
    id: rec.xref!,
    given: "",
    surname: "",
    suffix: "",
    sex: "U",
    events: [],
    birth: null,
    death: null,
    famc: [],
    fams: [],
  };

  let named = false;
  for (const c of rec.children) {
    switch (c.tag) {
      case "NAME": {
        if (named) break; // first NAME is the primary one
        named = true;
        const m = /^([^/]*?)\s*\/([^/]*)\/\s*(.*)$/.exec(c.value ?? "");
        if (m) {
          p.given = m[1]!.trim();
          p.surname = m[2]!.trim();
          p.suffix = m[3]!.trim();
        } else {
          p.given = (c.value ?? "").trim();
        }
        for (const nc of c.children) {
          if (nc.tag === "GIVN" && nc.value) p.given = nc.value.trim();
          if (nc.tag === "SURN" && nc.value) p.surname = nc.value.trim();
          if (nc.tag === "NSFX" && nc.value) p.suffix = nc.value.trim();
        }
        break;
      }
      case "SEX": {
        const v = (c.value ?? "").trim().toUpperCase();
        p.sex = v.startsWith("M") ? "M" : v.startsWith("F") ? "F" : "U";
        break;
      }
      case "FAMC":
        if (c.value) p.famc.push(c.value.trim());
        break;
      case "FAMS":
        if (c.value) p.fams.push(c.value.trim());
        break;
      default:
        if (c.tag in EVENT_LABELS) p.events.push(readEvent(c));
    }
  }

  p.birth = p.events.find((e) => e.tag === "BIRT") ?? p.events.find((e) => e.tag === "CHR" || e.tag === "BAPM") ?? null;
  p.death = p.events.find((e) => e.tag === "DEAT") ?? null;
  return p;
}

function readFamily(rec: Line): GFamily {
  const f: GFamily = {
    id: rec.xref!,
    husb: null,
    wife: null,
    children: [],
    events: [],
    marriage: null,
    divorce: null,
  };
  for (const c of rec.children) {
    switch (c.tag) {
      case "HUSB": f.husb = c.value?.trim() ?? null; break;
      case "WIFE": f.wife = c.value?.trim() ?? null; break;
      case "CHIL": if (c.value) f.children.push(c.value.trim()); break;
      default:
        if (c.tag in EVENT_LABELS) f.events.push(readEvent(c));
    }
  }
  f.marriage = f.events.find((e) => e.tag === "MARR") ?? null;
  f.divorce = f.events.find((e) => e.tag === "DIV") ?? null;
  return f;
}

function readEvent(rec: Line): GEvent {
  const ev: GEvent = {
    tag: rec.tag,
    label: EVENT_LABELS[rec.tag] ?? rec.tag,
    date: null,
    year: null,
    approx: false,
    place: null,
    value: rec.value?.trim() || null,
  };
  for (const c of rec.children) {
    if (c.tag === "DATE" && c.value) {
      ev.date = c.value.trim();
      const years = ev.date.match(/\d{3,4}/g);
      if (years && years.length > 0) ev.year = Number(years[years.length - 1]);
      ev.approx = /^(ABT|EST|CAL|C\.)/i.test(ev.date);
    }
    if (c.tag === "PLAC" && c.value) ev.place = c.value.trim();
    if (c.tag === "TYPE" && c.value && ev.label === "Event") ev.label = c.value.trim();
  }
  return ev;
}

/** Compact year for cards: "c.1826" for qualified dates, "" when unknown. */
export function yearOf(ev: GEvent | null): string {
  if (!ev || ev.year == null) return "";
  return (ev.approx ? "c." : "") + ev.year;
}

/** "* 1848 † 1912" — the archival lifespan line. */
export function lifespan(p: GPerson): string {
  const b = yearOf(p.birth);
  const d = yearOf(p.death);
  if (!b && !d) return "";
  let s = "";
  if (b) s += `* ${b}`;
  if (d) s += (s ? " " : "") + `† ${d}`;
  return s;
}
