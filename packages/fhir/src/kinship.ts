import type { Family, Person, Sex } from "@ftp/core";

/**
 * Kinship of a family member relative to the patient, expressed with the
 * v3-RoleCode FamilyMember vocabulary that FamilyMemberHistory.relationship
 * binds to. When no specific code exists (e.g. great-great-grandparent),
 * `code` falls back to FAMMEMB and `text` carries the precise description.
 */
export interface Kinship {
  code: string;
  display: string;
  text?: string;
}

export interface Relative {
  person: Person;
  kinship: Kinship;
}

/** [male, female, neutral] code/display triple, chosen by the member's sex. */
type Triple = [Kinship, Kinship, Kinship];

const k = (code: string, display: string): Kinship => ({ code, display });

const PARENT: Triple = [k("FTH", "father"), k("MTH", "mother"), k("PRN", "parent")];
const GRANDPARENT: Triple = [k("GRFTH", "grandfather"), k("GRMTH", "grandmother"), k("GRPRN", "grandparent")];
const GREAT_GRANDPARENT: Triple = [
  k("GGRFTH", "great grandfather"),
  k("GGRMTH", "great grandmother"),
  k("GGRPRN", "great grandparent"),
];
const CHILD: Triple = [k("SONC", "son"), k("DAUC", "daughter"), k("CHILD", "child")];
const GRANDCHILD: Triple = [k("GRNDSON", "grandson"), k("GRNDDAU", "granddaughter"), k("GRNDCHILD", "grandchild")];
const SIBLING: Triple = [k("BRO", "brother"), k("SIS", "sister"), k("SIB", "sibling")];
const SPOUSE: Triple = [k("HUSB", "husband"), k("WIFE", "wife"), k("SPS", "spouse")];
const PARENT_SIBLING: Triple = [k("UNCLE", "uncle"), k("AUNT", "aunt"), k("EXT", "extended family member")];
const SIBLING_CHILD: Triple = [k("NEPHEW", "nephew"), k("NIECE", "niece"), k("NIENEPH", "niece/nephew")];
const PARENT_IN_LAW: Triple = [k("FTHINLAW", "father-in-law"), k("MTHINLAW", "mother-in-law"), k("PRNINLAW", "parent in-law")];
const CHILD_IN_LAW: Triple = [k("SONINLAW", "son in-law"), k("DAUINLAW", "daughter in-law"), k("CHLDINLAW", "child-in-law")];
const SIBLING_IN_LAW: Triple = [k("BROINLAW", "brother-in-law"), k("SISINLAW", "sister-in-law"), k("SIBINLAW", "sibling in-law")];
const FAMILY_MEMBER = k("FAMMEMB", "family member");

function bySex(triple: Triple, sex: Sex): Kinship {
  return sex === "male" ? triple[0] : sex === "female" ? triple[1] : triple[2];
}

/** FAMMEMB with a descriptive text for relationships the vocabulary lacks. */
function described(text: string): Kinship {
  return { ...FAMILY_MEMBER, text };
}

function pick(sex: Sex, male: string, female: string, neutral: string): string {
  return sex === "male" ? male : sex === "female" ? female : neutral;
}

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth"];

function cousinText(degree: number, removed: number): string {
  const ord = ORDINALS[degree - 1] ?? `${degree}th`;
  if (removed === 0) return `${ord} cousin`;
  const times = removed === 1 ? "once" : removed === 2 ? "twice" : `${removed} times`;
  return `${ord} cousin ${times} removed`;
}

/** graph edges derived from the family records */
interface Graph {
  parents: Map<string, string[]>;
  children: Map<string, string[]>;
  spouses: Map<string, string[]>;
}

function buildGraph(families: Family[]): Graph {
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  const spouses = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, key: string, value: string) => {
    const list = m.get(key) ?? [];
    if (!list.includes(value)) list.push(value);
    m.set(key, list);
  };
  for (const fam of families) {
    const couple = [fam.husbandId, fam.wifeId].filter((x): x is string => Boolean(x));
    if (couple.length === 2) {
      push(spouses, couple[0]!, couple[1]!);
      push(spouses, couple[1]!, couple[0]!);
    }
    for (const childId of fam.childrenIds) {
      for (const parentId of couple) {
        push(parents, childId, parentId);
        push(children, parentId, childId);
      }
    }
  }
  return { parents, children, spouses };
}

/** every ancestor of `id` (including `id` itself at 0) with its minimum generation distance */
function ancestorDepths(id: string, graph: Graph): Map<string, number> {
  const depths = new Map<string, number>([[id, 0]]);
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const depth = depths.get(current)!;
    for (const parent of graph.parents.get(current) ?? []) {
      if (!depths.has(parent)) {
        depths.set(parent, depth + 1);
        queue.push(parent);
      }
    }
  }
  return depths;
}

/**
 * Classify a blood relationship by generation counts: `up` generations from
 * the patient to the closest common ancestor, `down` from the member to it.
 */
function bloodKinship(up: number, down: number, sex: Sex): Kinship {
  const greats = (n: number) => "great-".repeat(n);
  if (down === 0) {
    // direct ancestor
    if (up === 1) return bySex(PARENT, sex);
    if (up === 2) return bySex(GRANDPARENT, sex);
    if (up === 3) return bySex(GREAT_GRANDPARENT, sex);
    return described(`${greats(up - 2)}grand${pick(sex, "father", "mother", "parent")}`);
  }
  if (up === 0) {
    // direct descendant
    if (down === 1) return bySex(CHILD, sex);
    if (down === 2) return bySex(GRANDCHILD, sex);
    return described(`${greats(down - 2)}grand${pick(sex, "son", "daughter", "child")}`);
  }
  if (up === 1 && down === 1) return bySex(SIBLING, sex);
  if (up === 2 && down === 1) {
    const kin = bySex(PARENT_SIBLING, sex);
    return kin.code === "EXT" ? { ...kin, text: "aunt or uncle" } : kin;
  }
  if (up === 1 && down === 2) return bySex(SIBLING_CHILD, sex);
  if (down === 1) return described(`${greats(up - 2)}${pick(sex, "uncle", "aunt", "aunt or uncle")}`);
  if (up === 1) return described(`${greats(down - 2)}${pick(sex, "nephew", "niece", "niece or nephew")}`);
  const degree = Math.min(up, down) - 1;
  const removed = Math.abs(up - down);
  if (degree === 1 && removed === 0) return k("COUSN", "cousin");
  return described(cousinText(degree, removed));
}

/**
 * Every person connected to the patient through parent/child/spouse links,
 * with a computed kinship. Blood lines get the most specific v3 code; direct
 * in-laws get INLAW codes; anything else connected only through marriage is a
 * generic FAMMEMB. People in disconnected components are not family and are
 * omitted.
 */
export function relatives(people: Person[], families: Family[], patientId: string): Relative[] {
  const graph = buildGraph(families);
  const byId = new Map(people.map((p) => [p.id, p]));

  // reachable set over all edge types
  const connected = new Set<string>([patientId]);
  const queue = [patientId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = [
      ...(graph.parents.get(current) ?? []),
      ...(graph.children.get(current) ?? []),
      ...(graph.spouses.get(current) ?? []),
    ];
    for (const n of neighbors) {
      if (!connected.has(n)) {
        connected.add(n);
        queue.push(n);
      }
    }
  }

  const patientAncestors = ancestorDepths(patientId, graph);
  const patientSpouses = new Set(graph.spouses.get(patientId) ?? []);
  const patientChildren = new Set(graph.children.get(patientId) ?? []);

  const isSibling = (id: string): boolean => {
    const anc = ancestorDepths(id, graph);
    for (const [a, d] of anc) if (d === 1 && patientAncestors.get(a) === 1) return true;
    return false;
  };

  const classify = (person: Person): Kinship => {
    if (patientSpouses.has(person.id)) return bySex(SPOUSE, person.sex);

    // blood: closest common ancestor by total distance, then by patient's side
    const memberAncestors = ancestorDepths(person.id, graph);
    let best: { up: number; down: number } | null = null;
    for (const [ancestor, down] of memberAncestors) {
      const up = patientAncestors.get(ancestor);
      if (up === undefined) continue;
      if (!best || up + down < best.up + best.down || (up + down === best.up + best.down && up < best.up)) {
        best = { up, down };
      }
    }
    if (best) return bloodKinship(best.up, best.down, person.sex);

    // affinal: related only through a marriage
    const memberSpouses = graph.spouses.get(person.id) ?? [];
    for (const spouseId of patientSpouses) {
      if ((graph.parents.get(spouseId) ?? []).includes(person.id)) return bySex(PARENT_IN_LAW, person.sex);
      const spouseAncestors = ancestorDepths(spouseId, graph);
      for (const [a, d] of ancestorDepths(person.id, graph)) {
        if (d === 1 && spouseAncestors.get(a) === 1) return bySex(SIBLING_IN_LAW, person.sex);
      }
    }
    if (memberSpouses.some((s) => patientChildren.has(s))) return bySex(CHILD_IN_LAW, person.sex);
    if (memberSpouses.some((s) => isSibling(s))) return bySex(SIBLING_IN_LAW, person.sex);
    return FAMILY_MEMBER;
  };

  const out: Relative[] = [];
  for (const person of people) {
    if (person.id === patientId || !connected.has(person.id)) continue;
    out.push({ person, kinship: classify(person) });
  }
  return out;
}
