import type {
  Event,
  EventType,
  Family,
  FamilyRole,
  GenDate,
  NamePart,
  Person,
  Place,
  Sex,
} from "@kinbook/core";
import type { TreeDatabase } from "./connection";
import type { Bindings } from "./connection";

function rowIdFor(prefix: string): string {
  return `${prefix}${crypto.randomUUID().slice(0, 8)}`;
}

export function genId(prefix: string): string {
  return rowIdFor(prefix);
}

function getOrCreatePlace(db: TreeDatabase["db"], name: string): string {
  // .get() returns the row object, not the bare column value
  const existing = db.query<{ id: string }, [string]>("SELECT id FROM places WHERE name = ?").get(name);
  if (existing) return existing.id;
  const id = rowIdFor("P");
  db.query("INSERT INTO places (id, name) VALUES (?, ?)").run(id, name);
  return id;
}

function readInt(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

export class Repositories {
  constructor(private readonly store: TreeDatabase) {}

  addPerson(input: {
    id?: string;
    names: NamePart[];
    sex?: Sex;
    notes?: string | null;
    birth?: { date?: GenDate | null; place?: Place | null } | null;
    death?: { date?: GenDate | null; place?: Place | null } | null;
    burial?: { date?: GenDate | null; place?: Place | null } | null;
  }): Person {
    const id = input.id ?? rowIdFor("P");
    const sex = input.sex ?? "unknown";
    this.store.db
      .query("INSERT INTO people (id, sex, notes) VALUES (?, ?, ?)")
      .run(id, sex, input.notes ?? null);

    for (const [i, n] of input.names.entries()) {
      this.store.db
        .query(
          "INSERT INTO name_parts (person_id, given, surname, prefix, suffix, preferred) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(id, n.given, n.surname, n.prefix ?? null, n.suffix ?? null, i === 0 ? 1 : 0);
    }

    if (input.birth) this.addEvent(id, { id: rowIdFor("E"), type: "birth", ...input.birth });
    if (input.death) this.addEvent(id, { id: rowIdFor("E"), type: "death", ...input.death });
    if (input.burial) this.addEvent(id, { id: rowIdFor("E"), type: "burial", ...input.burial });

    return this.getPerson(id)!;
  }

  addEvent(personId: string, ev: Event): Event {
    this.insertEvent(ev);
    this.store.db.query("INSERT INTO person_events (person_id, event_id) VALUES (?, ?)").run(personId, ev.id);
    return ev;
  }

  /** Attach an event to a family — marriage, divorce, and the like. */
  addFamilyEvent(familyId: string, ev: Event): Event {
    this.insertEvent(ev);
    this.store.db.query("INSERT INTO family_events (family_id, event_id) VALUES (?, ?)").run(familyId, ev.id);
    return ev;
  }

  private insertEvent(ev: Event): void {
    const placeId = ev.place ? getOrCreatePlace(this.store.db, ev.place.name) : null;
    this.store.db
      .query(
        `INSERT INTO events (id, type, date_qualifier, date_calendar, date_year, date_month, date_day, date_text, place_id, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ev.id,
        ev.type,
        ev.date?.qualifier ?? null,
        ev.date?.calendar ?? null,
        ev.date?.year ?? null,
        ev.date?.month ?? null,
        ev.date?.day ?? null,
        ev.date?.text ?? null,
        placeId,
        ev.notes ?? null,
      );
  }

  addFamily(input: {
    id: string;
    type?: "spousal" | "parent";
    husbandId?: string | null;
    wifeId?: string | null;
    childrenIds?: string[];
    marriage?: { date?: GenDate | null; place?: Place | null } | null;
  }): Family {
    const id = input.id ?? rowIdFor("F");
    this.store.db
      .query("INSERT INTO families (id, type, notes) VALUES (?, ?, ?)")
      .run(id, input.type ?? "spousal", null);

    if (input.husbandId) this.addMember(id, input.husbandId, "husband");
    if (input.wifeId) this.addMember(id, input.wifeId, "wife");
    for (const c of input.childrenIds ?? []) this.addMember(id, c, "child");

    if (input.marriage) {
      this.addFamilyEvent(id, {
        id: rowIdFor("E"),
        type: "marriage",
        date: input.marriage.date,
        place: input.marriage.place ?? null,
      });
    }
    return this.getFamily(id)!;
  }

  private addMember(familyId: string, personId: string, role: "husband" | "wife" | "child"): void {
    this.store.db
      .query("INSERT OR IGNORE INTO family_members (family_id, person_id, role) VALUES (?, ?, ?)")
      .run(familyId, personId, role);
  }

  updatePerson(id: string, patch: {
    names?: NamePart[];
    sex?: Sex;
    notes?: string | null;
    birth?: { date?: GenDate | null; place?: Place | null } | null;
    death?: { date?: GenDate | null; place?: Place | null } | null;
    burial?: { date?: GenDate | null; place?: Place | null } | null;
  }): void {
    const current = this.getPerson(id);
    if (!current) throw new Error(`person not found: ${id}`);

    if (patch.sex !== undefined) {
      this.store.db.query("UPDATE people SET sex = ? WHERE id = ?").run(patch.sex, id);
    }
    if (patch.notes !== undefined) {
      this.store.db.query("UPDATE people SET notes = ? WHERE id = ?").run(patch.notes, id);
    }
    if (patch.names !== undefined) {
      // replace name set wholesale
      this.store.db.query("DELETE FROM name_parts WHERE person_id = ?").run(id);
      for (const [i, n] of patch.names.entries()) {
        this.store.db
          .query(
            "INSERT INTO name_parts (person_id, given, surname, prefix, suffix, preferred) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(id, n.given, n.surname, n.prefix ?? null, n.suffix ?? null, i === 0 ? 1 : 0);
      }
    }

    if (patch.birth !== undefined) this.setLifeEvent(id, "birth", patch.birth);
    if (patch.death !== undefined) this.setLifeEvent(id, "death", patch.death);
    if (patch.burial !== undefined) this.setLifeEvent(id, "burial", patch.burial);
  }

  /** upsert a single life-event on a person by id — replaces an existing event of that type. */
  private setLifeEvent(
    personId: string,
    type: "birth" | "death" | "burial",
    ev: { date?: GenDate | null; place?: Place | null } | null,
  ): void {
    const existing = this.getPerson(personId)?.events.find((e) => e.type === type);
    if (existing) {
      if (ev == null) {
        this.store.db.query("DELETE FROM events WHERE id = ?").run(existing.id);
        return;
      }
      const placeId = ev.place ? getOrCreatePlace(this.store.db, ev.place.name) : null;
      this.store.db
        .query(
          `UPDATE events SET date_qualifier=?, date_calendar=?, date_year=?, date_month=?, date_day=?, date_text=?, place_id=?
           WHERE id=?`,
        )
        .run(
          ev.date?.qualifier ?? null,
          ev.date?.calendar ?? null,
          ev.date?.year ?? null,
          ev.date?.month ?? null,
          ev.date?.day ?? null,
          ev.date?.text ?? null,
          placeId,
          existing.id,
        );
      return;
    }
    if (ev == null) return;
    this.addEvent(personId, { id: rowIdFor("E"), type, date: ev.date, place: ev.place ?? null });
  }

  getPerson(id: string): Person | null {
    const row = this.store.db.query<Record<string, unknown>, Bindings[]>("SELECT * FROM people WHERE id = ?").get(id);
    if (!row) return null;

    const names = this.store.db
      .query<Record<string, unknown>, Bindings[]>(
        "SELECT given, surname, prefix, suffix FROM name_parts WHERE person_id = ? ORDER BY preferred DESC, id ASC",
      )
      .all(id)
      .map((r) => ({
        given: String(r.given ?? ""),
        surname: String(r.surname ?? ""),
        prefix: r.prefix == null ? null : String(r.prefix),
        suffix: r.suffix == null ? null : String(r.suffix),
      }));

    const events = this.loadPersonEvents(id);

    const members = this.store.db
      .query<Record<string, unknown>, Bindings[]>(
        "SELECT family_id, role FROM family_members WHERE person_id = ?",
      )
      .all(id);
    const families: FamilyRole[] = members.map((r) => ({
      familyId: String(r.family_id),
      role: r.role as "husband" | "wife" | "child",
    }));
    const parentFamilyIds = families.filter((f) => f.role === "child").map((f) => f.familyId);

    return {
      id,
      names,
      sex: row.sex as Sex,
      events,
      families,
      parentFamilyIds,
      notes: row.notes == null ? null : String(row.notes),
    };
  }

  private loadPersonEvents(personId: string): Event[] {
    return this.loadEvents("person_events", "person_id", personId);
  }

  private loadFamilyEvents(familyId: string): Event[] {
    return this.loadEvents("family_events", "family_id", familyId);
  }

  private loadEvents(linkTable: string, ownerColumn: string, ownerId: string): Event[] {
    const rows = this.store.db
      .query<Record<string, unknown>, Bindings[]>(
        `SELECT e.*, p.name as _place_name
         FROM events e
         LEFT JOIN places p ON e.place_id = p.id
         JOIN ${linkTable} le ON le.event_id = e.id
         WHERE le.${ownerColumn} = ?`,
      )
      .all(ownerId);

    return rows.map((r) => ({
      id: String(r.id),
      type: r.type as EventType,
      date: makeDate(r),
      place: r.place_id == null ? null : { name: String(r._place_name ?? "") },
      notes: r.notes == null ? null : String(r.notes),
    }));
  }

  getFamily(id: string): Family | null {
    const row = this.store.db.query<Record<string, unknown>, Bindings[]>("SELECT * FROM families WHERE id = ?").get(id);
    if (!row) return null;

    const members = this.store.db
      .query<Record<string, unknown>, Bindings[]>(
        "SELECT person_id, role FROM family_members WHERE family_id = ?",
      )
      .all(id);

    let husbandId: string | null = null;
    let wifeId: string | null = null;
    const childrenIds: string[] = [];
    for (const m of members) {
      const pid = String(m.person_id);
      if (m.role === "husband") husbandId = pid;
      else if (m.role === "wife") wifeId = pid;
      else if (m.role === "child") childrenIds.push(pid);
    }

    return {
      id,
      type: row.type === "parent" ? "parent" : "spousal",
      husbandId,
      wifeId,
      childrenIds,
      events: this.loadFamilyEvents(id),
      notes: row.notes == null ? null : String(row.notes),
    };
  }

  listPeople(): Person[] {
    const rows = this.store.db.query<Record<string, unknown>, Bindings[]>("SELECT id FROM people").all();
    const out: Person[] = [];
    for (const r of rows) {
      const p = this.getPerson(String(r.id));
      if (p) out.push(p);
    }
    return out;
  }

  listFamilies(): Family[] {
    const rows = this.store.db.query<Record<string, unknown>, Bindings[]>("SELECT id FROM families").all();
    const out: Family[] = [];
    for (const r of rows) {
      const f = this.getFamily(String(r.id));
      if (f) out.push(f);
    }
    return out;
  }

  get db() {
    return this.store.db;
  }
}

function makeDate(r: Record<string, unknown>): GenDate | null {
  if (r.date_year == null && r.date_month == null && r.date_day == null && r.date_text == null) return null;
  return {
    qualifier: (r.date_qualifier as GenDate["qualifier"]) ?? "exact",
    calendar: (r.date_calendar as GenDate["calendar"]) ?? "gregorian",
    year: readInt(r.date_year),
    month: readInt(r.date_month),
    day: readInt(r.date_day),
    text: r.date_text == null ? null : String(r.date_text),
  };
}