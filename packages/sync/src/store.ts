import type {
  AddFamilyInput,
  AddPersonInput,
  ExportFormat,
  Family,
  Person,
  SearchResult,
  TreeStore,
  UpdatePersonInput,
} from "@kinbook/core";
import { genId } from "@kinbook/database";
import type { Repositories } from "@kinbook/database";
import { toFhir5 } from "@kinbook/fhir";
import type { GedcomDocument } from "@kinbook/gedcom";
import { toGedcom55 } from "@kinbook/gedcom";
import { toGedcom70 } from "@kinbook/gedcom";

/**
 * The bridge between the SQLite source of truth (@kinbook/database) and the
 * native GEDCOM format (@kinbook/gedcom). Implements the shared core actions
 * (TreeStore) used by both the CLI and the MCP server.
 */
export class SyncStore implements TreeStore {
  constructor(private readonly repo: Repositories) {}

  async addPerson(input: AddPersonInput): Promise<Person> {
    const sex = input.sex ?? "unknown";
    const person = this.repo.addPerson({
      names: [{ given: input.given, surname: input.surnames.join(" "), prefix: input.prefix, suffix: input.suffix }],
      sex,
      notes: input.notes,
      birth: input.birth,
      death: input.death,
      burial: input.burial,
    });

    if (input.familyId && input.role) {
      const fam = this.repo.getFamily(input.familyId);
      if (!fam) throw new Error(`family not found: ${input.familyId}`);
      const role = input.role === "spouse" ? (sex === "male" ? "husband" : "wife") : "child";
      this.repo.db
        .query("INSERT OR IGNORE INTO family_members (family_id, person_id, role) VALUES (?, ?, ?)")
        .run(input.familyId, person.id, role);
      // re-read so the returned person includes the new family link
      return this.repo.getPerson(person.id)!;
    }

    return person;
  }

  async addFamily(input: AddFamilyInput): Promise<Family> {
    return this.repo.addFamily({
      id: genId("F"),
      husbandId: input.husbandId,
      wifeId: input.wifeId,
      childrenIds: input.childrenIds,
      marriage: input.marriage,
    });
  }

  async updatePerson(id: string, input: UpdatePersonInput): Promise<Person> {
    this.repo.updatePerson(id, {
      names: input.names,
      sex: input.sex,
      notes: input.notes,
      birth: input.birth,
      death: input.death,
      burial: input.burial,
    });
    const p = this.repo.getPerson(id);
    if (!p) throw new Error(`person not found: ${id}`);
    return p;
  }

  async search(query: string): Promise<SearchResult[]> {
    const all = this.repo.listPeople();
    const q = query.toLowerCase();
    const scored: SearchResult[] = [];
    for (const p of all) {
      const nameStrs = p.names.flatMap((n) => [n.given, n.surname].filter(Boolean));
      let score = 0;
      for (const name of nameStrs) {
        if (name.toLowerCase().includes(q)) score += 10;
        if (name.toLowerCase().startsWith(q)) score += 5;
      }
      if (score > 0) scored.push({ person: p, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  async exportTree(format: ExportFormat = "gedcom55", patientId?: string): Promise<string> {
    const people = this.repo.listPeople();
    const families = this.repo.listFamilies();
    if (format === "fhir5") {
      if (!patientId) throw new Error("fhir5 export requires a patient: pass the person's node id");
      return toFhir5({ people, families, patientId });
    }
    const doc: GedcomDocument = {
      individuals: people.map((p) => ({
        xref: `@${p.id}@`,
        names: p.names.map((n) => ({
          given: n.given,
          surname: n.surname,
          prefix: n.prefix,
          suffix: n.suffix,
        })),
        sex: p.sex,
        events: p.events.map((e) => ({
          type: e.type,
          date: e.date,
          place: e.place?.name ?? null,
          notes: e.notes ? [e.notes] : undefined,
        })),
        notes: p.notes ? [p.notes] : undefined,
        childFamilyXrefs: p.parentFamilyIds.map((f) => `@${f}@`),
        spouseFamilyXrefs: p.families.filter((f) => f.role !== "child").map((f) => `@${f.familyId}@`),
      })),
      families: families.map((g) => ({
        xref: `@${g.id}@`,
        husbandXref: g.husbandId ? `@${g.husbandId}@` : null,
        wifeXref: g.wifeId ? `@${g.wifeId}@` : null,
        childXrefs: g.childrenIds.map((c) => `@${c}@`),
        events: g.events.map((e) => ({
          type: e.type,
          date: e.date,
          place: e.place?.name ?? null,
          notes: e.notes ? [e.notes] : undefined,
        })),
        notes: g.notes ? [g.notes] : undefined,
      })),
    };
    return format === "gedcom70" ? toGedcom70(doc) : toGedcom55(doc);
  }

  async listPeople(): Promise<Person[]> {
    return this.repo.listPeople();
  }

  async listFamilies(): Promise<Family[]> {
    return this.repo.listFamilies();
  }

  async getPerson(id: string): Promise<Person | null> {
    return this.repo.getPerson(id);
  }
}