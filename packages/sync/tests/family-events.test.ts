import { test, expect } from "bun:test";
import { TreeDatabase, Repositories } from "@ftp/database";
import { SyncStore } from "../src/store";

function store() {
  const db = new TreeDatabase(":memory:");
  return new SyncStore(new Repositories(db));
}

async function couple(s: SyncStore) {
  const husband = await s.addPerson({ given: "John", surnames: ["Smith"], sex: "male" });
  const wife = await s.addPerson({ given: "Jane", surnames: ["Doe"], sex: "female" });
  return { husbandId: husband.id, wifeId: wife.id };
}

test("a marriage date and place survive a round trip through the database", async () => {
  const s = store();
  const { husbandId, wifeId } = await couple(s);

  const family = await s.addFamily({
    husbandId,
    wifeId,
    marriage: {
      date: { qualifier: "exact", calendar: "gregorian", year: 1946, month: 1, day: null, text: null },
      place: { name: "Olathe, Kansas" },
    },
  });

  const marriage = family.events.find((e) => e.type === "marriage");
  expect(marriage).toBeDefined();
  expect(marriage?.date?.year).toBe(1946);
  expect(marriage?.date?.month).toBe(1);
  expect(marriage?.place?.name).toBe("Olathe, Kansas");

  // and again on a fresh read, not just the value addFamily returned
  const [reread] = await s.listFamilies();
  expect(reread?.events.find((e) => e.type === "marriage")?.date?.year).toBe(1946);
});

test("a marriage is exported as a FAM-level MARR in both dialects", async () => {
  const s = store();
  const { husbandId, wifeId } = await couple(s);
  await s.addFamily({
    husbandId,
    wifeId,
    marriage: {
      date: { qualifier: "exact", calendar: "gregorian", year: 1946, month: 1, day: null, text: null },
      place: { name: "Olathe, Kansas" },
    },
  });

  for (const format of ["gedcom55", "gedcom70"] as const) {
    const text = await s.exportTree(format);
    expect(text).toContain("1 MARR");
    expect(text).toContain("2 DATE JAN 1946");
    expect(text).toContain("2 PLAC Olathe, Kansas");
  }
});

test("a family with no marriage recorded exports no MARR", async () => {
  const s = store();
  const { husbandId, wifeId } = await couple(s);
  await s.addFamily({ husbandId, wifeId });

  const family = (await s.listFamilies())[0];
  expect(family?.events).toEqual([]);
  expect(await s.exportTree("gedcom55")).not.toContain("MARR");
});
