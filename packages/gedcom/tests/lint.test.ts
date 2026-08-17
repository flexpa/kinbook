import { test, expect } from "bun:test";
import { lint } from "../src/lint";
import { toGedcom55, toGedcom70 } from "../src/index";
import type { GedcomDocument } from "../src/model";

const F = (name: string) => `${import.meta.dir}/fixtures/${name}`;
const read = async (name: string) => await Bun.file(F(name)).text();
const rules = (text: string, dialect: "55" | "70") =>
  lint(text, dialect).findings.map((f) => f.rule);

const doc: GedcomDocument = {
  individuals: [
    {
      xref: "@I1@",
      names: [{ given: "John", surname: "Smith" }],
      sex: "M",
      events: [{ type: "birth", date: { qualifier: "exact", year: 1920, month: 10, day: 12 }, place: "London", notes: ["Born at home"] }],
      notes: ["Research notes for John\nSecond line of note"],
      childFamilyXrefs: [],
      spouseFamilyXrefs: ["@F1@"],
    },
    {
      xref: "@I2@",
      names: [{ given: "Jane", surname: "Doe" }],
      sex: "F",
      events: [{ type: "birth", date: { qualifier: "about", year: 1925 } }],
      childFamilyXrefs: [],
      spouseFamilyXrefs: ["@F1@"],
    },
  ],
  families: [
    {
      xref: "@F1@",
      husbandXref: "@I1@",
      wifeXref: "@I2@",
      childXrefs: [],
      events: [{ type: "marriage", date: { qualifier: "exact", year: 1948 } }],
      notes: ["Marriage certificate on file"],
    },
  ],
};

test("valid-55.ged: zero findings", async () => {
  const res = lint(await read("valid-55.ged"), "55");
  expect(res.exitCode).toBe(0);
  expect(res.findings).toEqual([]);
});

test("valid-70.ged: zero findings", async () => {
  const res = lint(await read("valid-70.ged"), "70");
  expect(res.exitCode).toBe(0);
  expect(res.findings).toEqual([]);
});

test("writer output is lint-clean (55)", () => {
  const res = lint(toGedcom55(doc), "55");
  expect(res.findings).toEqual([]);
});

test("writer output is lint-clean (70)", () => {
  const res = lint(toGedcom70(doc), "70");
  expect(res.findings).toEqual([]);
});

test("broken-55.ged fires expected rules", async () => {
  const r = rules(await read("broken-55.ged"), "55");
  expect(r).toContain("level-skip");
  expect(r).toContain("missing-trlr");
  expect(r).toContain("name-slashes");
  expect(r).toContain("bad-sex");
  expect(r).toContain("bad-date");
  expect(r).toContain("dangling-ref");
  expect(r).toContain("empty-indi");
  expect(r).toContain("dup-xref");
});

test("broken-70.ged fires expected rules", async () => {
  const r = rules(await read("broken-70.ged"), "70");
  expect(r).toContain("unknown-tag");
  expect(r).toContain("fams-mismatch");
  expect(r).toContain("famc-mismatch");
  expect(r).toContain("dangling-ref");
  expect(r).toContain("dangling-note");
});

test("broken-struct.ged fires expected rules", async () => {
  const r = rules(await read("broken-struct.ged"), "55");
  expect(r).toContain("missing-head");
  expect(r).toContain("xref-format");
  expect(r).toContain("empty-fam");
});

test("fatal parse error returns exitCode 2", () => {
  const res = lint("this is not gedcom at all\n@@@ bad", "55");
  expect(res.exitCode).toBe(2);
  expect(res.findings[0]!.rule).toBe("parse");
});
