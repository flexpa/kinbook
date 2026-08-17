import { describe, expect, test } from "bun:test";
import type { Family, GenDate, Person, Sex } from "@ftp/core";
import type { FhirBundle, FhirFamilyMemberHistory, FhirPatient } from "../src/index";
import { relatives, toFhir5, toFhirDate } from "../src/index";

function date(year: number, month?: number, day?: number, qualifier: GenDate["qualifier"] = "exact"): GenDate {
  return { qualifier, calendar: "gregorian", year, month: month ?? null, day: day ?? null, text: null };
}

function mk(
  id: string,
  given: string,
  sex: Sex,
  opts: { birth?: GenDate; death?: GenDate | null; notes?: string } = {},
): Person {
  const events: Person["events"] = [];
  if (opts.birth) events.push({ id: `${id}-b`, type: "birth", date: opts.birth });
  if (opts.death !== undefined) events.push({ id: `${id}-d`, type: "death", date: opts.death });
  return { id, names: [{ given, surname: "Test" }], sex, events, families: [], parentFamilyIds: [], notes: opts.notes };
}

function fam(id: string, husbandId: string | null, wifeId: string | null, childrenIds: string[] = []): Family {
  return { id, type: "spousal", husbandId, wifeId, childrenIds, events: [] };
}

/**
 * Four generations around patient P:
 *
 *   GGG ─ GG+GGW ─ G+GM ─┬─ F+M ─┬─ P(+W) ─┬─ SON1(+SW) ─ GS
 *                        │       └─ S(+SH) ─ N            └─ DAU1
 *                        └─ U+UW ─ C ─ C2
 *   W's side: WF+WM ─ W, WB.   X is disconnected.
 */
const people: Person[] = [
  mk("P", "Patient", "male", { birth: date(1980, 3, 5) }),
  mk("F", "Father", "male", { birth: date(1950, undefined, undefined, "about") }),
  mk("M", "Mother", "female", { birth: date(1955, 7) }),
  mk("S", "Sister", "female"),
  mk("W", "Wife", "female"),
  mk("SON1", "Son", "male"),
  mk("DAU1", "Daughter", "female"),
  mk("SW", "SonsWife", "female"),
  mk("GS", "Grandson", "male"),
  mk("G", "Grandfather", "male", { death: date(1999) }),
  mk("GM", "Grandmother", "female", { death: null }),
  mk("GG", "GreatGrandfather", "male"),
  mk("GGW", "GreatGrandmother", "female"),
  mk("GGG", "GreatGreatGrandfather", "male"),
  mk("U", "Uncle", "male"),
  mk("UW", "UnclesWife", "female"),
  mk("C", "Cousin", "female"),
  mk("C2", "CousinsChild", "other", { notes: "twice removed? no — once" }),
  mk("SH", "SistersHusband", "male"),
  mk("N", "Nephew", "male"),
  mk("WF", "WifesFather", "male"),
  mk("WM", "WifesMother", "female"),
  mk("WB", "WifesBrother", "male"),
  mk("X", "Stranger", "male"),
];

const families: Family[] = [
  fam("F1", "GGG", null, ["GG"]),
  fam("F2", "GG", "GGW", ["G"]),
  fam("F3", "G", "GM", ["F", "U"]),
  fam("F4", "F", "M", ["P", "S"]),
  fam("F5", "U", "UW", ["C"]),
  fam("F6", null, "C", ["C2"]),
  fam("F7", "P", "W", ["SON1", "DAU1"]),
  fam("F8", "SON1", "SW", ["GS"]),
  fam("F9", "SH", "S", ["N"]),
  fam("F10", "WF", "WM", ["W", "WB"]),
];

describe("kinship", () => {
  const byId = new Map(relatives(people, families, "P").map((r) => [r.person.id, r.kinship]));

  const expected: Array<[string, string, string | undefined]> = [
    ["F", "FTH", undefined],
    ["M", "MTH", undefined],
    ["S", "SIS", undefined],
    ["W", "WIFE", undefined],
    ["SON1", "SONC", undefined],
    ["DAU1", "DAUC", undefined],
    ["GS", "GRNDSON", undefined],
    ["G", "GRFTH", undefined],
    ["GM", "GRMTH", undefined],
    ["GG", "GGRFTH", undefined],
    ["GGW", "GGRMTH", undefined],
    ["GGG", "FAMMEMB", "great-great-grandfather"],
    ["U", "UNCLE", undefined],
    ["C", "COUSN", undefined],
    ["C2", "FAMMEMB", "first cousin once removed"],
    ["N", "NEPHEW", undefined],
    ["SH", "BROINLAW", undefined],
    ["SW", "DAUINLAW", undefined],
    ["WF", "FTHINLAW", undefined],
    ["WM", "MTHINLAW", undefined],
    ["WB", "BROINLAW", undefined],
    ["UW", "FAMMEMB", undefined],
  ];

  for (const [id, code, text] of expected) {
    test(`${id} -> ${code}${text ? ` (${text})` : ""}`, () => {
      expect(byId.get(id)?.code).toBe(code);
      expect(byId.get(id)?.text).toBe(text as never);
    });
  }

  test("disconnected people are not relatives", () => {
    expect(byId.has("X")).toBe(false);
  });

  test("the patient is not their own relative", () => {
    expect(byId.has("P")).toBe(false);
  });
});

describe("toFhirDate", () => {
  test("exact dates use the FHIR date grammar", () => {
    expect(toFhirDate(date(1980, 3, 5))).toEqual({ date: "1980-03-05" });
    expect(toFhirDate(date(1955, 7))).toEqual({ date: "1955-07" });
    expect(toFhirDate(date(1999))).toEqual({ date: "1999" });
  });

  test("qualified dates fall back to strings", () => {
    expect(toFhirDate(date(1950, undefined, undefined, "about"))).toEqual({ text: "abt 1950" });
    expect(toFhirDate(date(1950, 2, undefined, "before"))).toEqual({ text: "bef 1950-02" });
  });

  test("non-gregorian and empty dates", () => {
    expect(toFhirDate({ qualifier: "exact", calendar: "julian", year: 1700, month: null, day: null, text: null }))
      .toEqual({ text: "1700 (julian)" });
    expect(toFhirDate(null)).toBeNull();
    expect(toFhirDate({ qualifier: "exact", calendar: "gregorian", year: null, month: null, day: null, text: "unknown" }))
      .toEqual({ text: "unknown" });
  });
});

describe("toFhir5", () => {
  const bundle = JSON.parse(toFhir5({ people, families, patientId: "P" })) as FhirBundle;
  const patient = bundle.entry[0]!.resource as FhirPatient;
  const members = bundle.entry.slice(1).map((e) => e.resource as FhirFamilyMemberHistory);
  const member = (id: string) => members.find((m) => m.id === id)!;

  test("bundle is a collection with the Patient first", () => {
    expect(bundle.resourceType).toBe("Bundle");
    expect(bundle.type).toBe("collection");
    expect(patient.resourceType).toBe("Patient");
    expect(patient.id).toBe("P");
    expect(patient.gender).toBe("male");
    expect(patient.birthDate).toBe("1980-03-05");
    expect(patient.name?.[0]).toEqual({ text: "Patient Test", family: "Test", given: ["Patient"] });
  });

  test("every member is a FamilyMemberHistory pointing at the Patient", () => {
    expect(members.length).toBe(22);
    for (const m of members) {
      expect(m.resourceType).toBe("FamilyMemberHistory");
      expect(m.status).toBe("completed");
      expect(m.patient.reference).toBe("Patient/P");
      expect(m.relationship.coding?.[0]?.system).toBe("http://terminology.hl7.org/CodeSystem/v3-RoleCode");
    }
  });

  test("born[x] and deceased[x] choices", () => {
    expect(member("F").bornString).toBe("abt 1950");
    expect(member("F").bornDate).toBeUndefined();
    expect(member("M").bornDate).toBe("1955-07");
    expect(member("G").deceasedDate).toBe("1999");
    expect(member("GM").deceasedBoolean).toBe(true);
    expect(member("W").deceasedBoolean).toBeUndefined();
    expect(member("W").deceasedDate).toBeUndefined();
  });

  test("relationship text and notes carry through", () => {
    expect(member("GGG").relationship.text).toBe("great-great-grandfather");
    expect(member("C2").note?.[0]?.text).toBe("twice removed? no — once");
    expect(member("F").sex?.coding?.[0]).toEqual(
      { system: "http://hl7.org/fhir/administrative-gender", code: "male", display: "Male" },
    );
  });

  test("unknown patient id throws", () => {
    expect(() => toFhir5({ people, families, patientId: "NOPE" })).toThrow("person not found");
  });
});
