import { openTree } from "@kinbook/sync";
import type { Family, Person, GenDate } from "@kinbook/core";

interface Flags {
  db: string;
}

function parseFlags(argv: string[]): { flags: Flags; args: string[] } {
  const flags: Flags = { db: "family-tree.db" };
  const args: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "--db" || a === "-d") {
      const v = argv[i + 1];
      if (v !== undefined) flags.db = v;
      i++;
    } else {
      args.push(a);
    }
  }
  return { flags, args };
}

/** "--key value" pairs from the trailing option slice. */
function parseOptions(tokens: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as string;
    if (t.startsWith("--") && tokens[i + 1] !== undefined && !tokens[i + 1]!.startsWith("--")) {
      out[t] = tokens[i + 1]!;
      i++;
    }
  }
  return out;
}

/** Accept "m|f|u" shorthands or full words; store only domain values. */
function parseSex(s: string | undefined): Person["sex"] | undefined {
  if (s === undefined) return undefined;
  const map: Record<string, Person["sex"]> = {
    m: "male", male: "male",
    f: "female", female: "female",
    o: "other", other: "other",
    u: "unknown", unknown: "unknown",
  };
  const sex = map[s.trim().toLowerCase()];
  if (!sex) throw new Error(`bad sex: ${s} (use m|f|o|u or male|female|other|unknown)`);
  return sex;
}

/** date and/or place → life-event input for addPerson; undefined when neither given */
function lifeEventInput(
  date: string | undefined,
  place: string | undefined,
): { date: GenDate | null; place: { name: string } | null } | undefined {
  if (date === undefined && place === undefined) return undefined;
  return {
    date: date !== undefined ? parseGenDate(date) : null,
    place: place !== undefined ? { name: place } : null,
  };
}

function parseGenDate(s: string): GenDate {
  const approx = s.trim().startsWith("abt");
  const iso = s.trim().replace(/^abt\s+/, "");
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(iso);
  if (!m) throw new Error(`bad date: ${s} (use YYYY-MM-DD, YYYY-MM, YYYY, or "abt YYYY")`);
  return {
    qualifier: approx ? "about" : "exact",
    calendar: "gregorian",
    year: Number(m[1]),
    month: m[2] ? Number(m[2]) : null,
    day: m[3] ? Number(m[3]) : null,
    text: null,
  };
}

async function main() {
  const { flags, args } = parseFlags(process.argv.slice(2));
  const cmd = args[0];

  const { actions, close } = openTree(flags.db);

  try {
    switch (cmd) {
      case "add": {
        const name = args[1];
        if (!name) throw new Error(`usage: ftree add "<given name>" [<surname>] [flags]`);
        const surname = args[2] ?? "";
        const opt = parseOptions(args.slice(3));
        const person = await actions.addPerson({
          given: name,
          surnames: surname ? [surname] : [],
          sex: parseSex(opt["--sex"]),
          birth: lifeEventInput(opt["--born"], opt["--born-place"]),
          death: lifeEventInput(opt["--died"], opt["--died-place"]),
          burial: lifeEventInput(opt["--buried-on"], opt["--buried"]),
          familyId: opt["--family"],
          role: opt["--role"] as "child" | "spouse" | undefined,
        });
        console.log(JSON.stringify(person, null, 2));
        break;
      }
      case "update": {
        const id = args[1];
        if (!id) throw new Error(`usage: ftree update <id> [--born <date>] [--died <date>] [--sex <m|f|o|u>] [flags]`);
        const opt = parseOptions(args.slice(2));
        const current = await actions.getPerson(id);
        if (!current) throw new Error(`person not found: ${id}`);
        // merge with the existing event so setting only a date keeps the
        // recorded place, and vice versa
        const merged = (type: "birth" | "death" | "burial", date?: string, place?: string) => {
          if (date === undefined && place === undefined) return undefined;
          const existing = current.events.find((e) => e.type === type);
          return {
            date: date !== undefined ? parseGenDate(date) : existing?.date ?? null,
            place: place !== undefined ? { name: place } : existing?.place ?? null,
          };
        };
        const person = await actions.updatePerson(id, {
          sex: parseSex(opt["--sex"]),
          birth: merged("birth", opt["--born"], opt["--born-place"]),
          death: merged("death", opt["--died"], opt["--died-place"]),
          burial: merged("burial", opt["--buried-on"], opt["--buried"]),
        });
        console.log(JSON.stringify(person, null, 2));
        break;
      }
      case "marry": {
        const a = args[1];
        const b = args[2];
        if (!a || !b) throw new Error(`usage: ftree marry <idA> <idB> [--on <date>] [--place <place>]`);
        const opt = parseOptions(args.slice(3));
        const [pa, pb] = await Promise.all([actions.getPerson(a), actions.getPerson(b)]);
        const atMale = pa?.sex === "male";
        const btMale = pb?.sex === "male";
        const [husband, wife] = atMale !== btMale && atMale ? [a, b] : atMale !== btMale && btMale ? [b, a] : [a, b];
        const family = await actions.addFamily({
          husbandId: husband,
          wifeId: wife,
          marriage:
            opt["--on"] || opt["--place"]
              ? {
                  date: opt["--on"] ? parseGenDate(opt["--on"]) : null,
                  place: opt["--place"] ? { name: opt["--place"] } : null,
                }
              : undefined,
        });
        console.log(JSON.stringify(family, null, 2));
        break;
      }
      case "search": {
        const q = args[1];
        if (!q) throw new Error(`usage: ftree search "<query>"`);
        const res = await actions.search(q);
        console.log(res.length === 0 ? "no matches" : `${res.length} match(es):`);
        for (const r of res) {
          const n = r.person.names[0];
          console.log(`  ${r.person.id}  ${n?.given ?? ""} ${n?.surname ?? ""} (score ${r.score})`);
        }
        break;
      }
      case "export": {
        const format = (args[1] as "gedcom55" | "gedcom70" | "fhir5") ?? "gedcom55";
        if (format === "fhir5" && !args[2]) {
          throw new Error(`usage: ftree export fhir5 <person-id>  (the person who is the FHIR Patient)`);
        }
        const out = await actions.exportTree(format, args[2]);
        process.stdout.write(out);
        break;
      }
      case "tree": {
        const [people, families] = await Promise.all([actions.listPeople(), actions.listFamilies()]);
        printTree({ people, families });
        break;
      }
      case "--help":
      case "help":
        console.log(usage());
        break;
      default:
        console.log(usage());
    }
  } finally {
    close();
  }
}

function usage(): string {
  return [
    "ftree — agent-first family tree",
    "",
    "Usage:",
    "  ftree [--db <file>] add <given> [<surname>] [--sex <m|f|o|u>] [--family <id> --role child|spouse] [event flags]",
    "  ftree [--db <file>] update <id> [--sex <m|f|o|u>] [event flags]",
    "  ftree [--db <file>] marry <idA> <idB> [--on <date>] [--place <place>]",
    "  ftree [--db <file>] search <query>",
    "  ftree [--db <file>] export [gedcom55|gedcom70]",
    "  ftree [--db <file>] export fhir5 <person-id>   (FHIR R5 Bundle; the person is the Patient)",
    "  ftree [--db <file>] tree",
    "  ftree help",
    "",
    "Event flags (add and update):",
    "  --born <date>  --born-place <place>",
    "  --died <date>  --died-place <place>",
    "  --buried <place>  --buried-on <date>",
    "On update, a date-only or place-only flag keeps the other half of the",
    "existing event. Dates: YYYY-MM-DD, YYYY-MM, YYYY, or \"abt YYYY\".",
  ].join("\n");
}

main();

// ---- ASCII tree -----------------------------------------------------------

function nameOf(p: Person): string {
  const n = p.names[0];
  return n ? `${n.given ?? ""} ${n.surname ?? ""}`.trim() : p.id;
}

/** person id -> its children (from families), deduped */
function childrenByParent(people: Person[], families: Family[]): Map<string, Person[]> {
  const byId = new Map(people.map((p) => [p.id, p]));
  const children = new Map<string, Person[]>();
  const seen = new Set<string>();
  for (const fam of families) {
    // attach the couple's children under BOTH partners, so the family renders
    // as a single node no matter which spouse happens to be the root
    const parents = [fam.husbandId, fam.wifeId].filter((x): x is string => Boolean(x));
    if (parents.length === 0) continue;
    for (const c of fam.childrenIds) {
      const cp = byId.get(c);
      if (!cp || seen.has(cp.id)) continue;
      seen.add(cp.id);
      for (const parent of parents) {
        const list = children.get(parent) ?? [];
        list.push(cp);
        children.set(parent, list);
      }
    }
  }
  return children;
}

function printTree({ people, families }: { people: Person[]; families: Family[] }): void {
  const nameById = new Map(people.map((p) => [p.id, nameOf(p)]));

  // partners of a person (other spouse(s) across their families), by id
  const partnerIds = (id: string): string[] => {
    const out: string[] = [];
    for (const fam of families) {
      const other = fam.husbandId === id ? fam.wifeId : fam.wifeId === id ? fam.husbandId : null;
      if (other) out.push(other);
    }
    return out;
  };

  const children = childrenByParent(people, families);

  // roots: people who appear as no one's child
  const childIds = new Set<string>();
  for (const fam of families) for (const c of fam.childrenIds) childIds.add(c);
  const roots = people.filter((p) => !childIds.has(p.id));

  const printed = new Set<string>();
  // a spouse already shown on their partner's line — skip as its own root
  const partnerDone = new Set<string>();

  // A parentless person whose partner is an anchored descendant must NOT become
  // its own root — the couple renders beneath that descendant instead (e.g.
  // Olga Semenova renders under Joshua, not as a separate root).
  const anchored = new Set<string>();
  for (const fam of families) for (const c of fam.childrenIds) anchored.add(c);
  for (const root of roots) {
    if (partnerIds(root.id).some((pid) => anchored.has(pid))) partnerDone.add(root.id);
  }

  // "  ∞ PartnerOne, PartnerTwo" naming partners (not raw ids)
  const joint = (id: string): string => {
    const spouses = partnerIds(id)
      .filter((pid) => !printed.has(pid))
      .map((pid) => nameById.get(pid) ?? pid);
    return spouses.length ? `  ∞ ${spouses.join(", ")}` : "";
  };

  const visitChildren = (id: string, bars: string) => {
    const list = (children.get(id) ?? []).filter((k) => !printed.has(k.id));
    list.forEach((kid, i) => {
      const last = i === list.length - 1;
      const branch = last ? "└─ " : "├─ ";
      printed.add(kid.id);
      partnerIds(kid.id).forEach((pid) => partnerDone.add(pid));
      console.log(bars + branch + (nameById.get(kid.id) ?? kid.id) + joint(kid.id));
      visitChildren(kid.id, bars + (last ? "    " : "│   "));
    });
  };

  const renderRoot = (id: string) => {
    if (printed.has(id) || partnerDone.has(id)) return;
    printed.add(id);
    partnerIds(id).forEach((pid) => partnerDone.add(pid));
    console.log((nameById.get(id) ?? id) + joint(id));
    visitChildren(id, "");
  };

  for (const root of roots) renderRoot(root.id);
  for (const p of people) {
    if (!printed.has(p.id) && !partnerDone.has(p.id)) {
      printed.add(p.id);
      console.log((nameById.get(p.id) ?? p.id) + joint(p.id));
      visitChildren(p.id, "");
    }
  }
}