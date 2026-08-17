import type { GenDate } from "@kinbook/core";

const MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

const QUALIFIER_PREFIX: Record<string, string> = {
  about: "ABT ",
  before: "BEF ",
  after: "AFT ",
  exact: "",
};

export function eventTag(type: string, dialect: "55" | "70"): string {
  switch (type) {
    case "birth": return "BIRT";
    case "death": return "DEAT";
    case "burial": return "BURI";
    case "marriage": return "MARR";
    case "divorce": return "DIV";
    default: return dialect === "70" ? type.toUpperCase() : "_EVENT";
  }
}

/** Render a structured date to the GEDCOM DATE value grammar. */
export function formatDate(date: GenDate | null | undefined): string | null {
  if (!date) return null;

  if (date.text) return date.text;

  const qual = QUALIFIER_PREFIX[date.qualifier] ?? "";
  if (date.year == null) return qual.trim() || null;

  let s = String(date.year);
  if (date.day != null && date.month != null) {
    s = `${date.day} ${MONTHS[date.month - 1] ?? ""} ${date.year}`.trim();
  } else if (date.month != null) {
    s = `${MONTHS[date.month - 1] ?? ""} ${date.year}`.trim();
  }
  return qual + s;
}