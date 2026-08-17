import type { GenDate } from "@ftp/core";

/**
 * A GenDate rendered for a FHIR date/string choice element: `date` when the
 * value fits the FHIR date grammar (YYYY, YYYY-MM, YYYY-MM-DD, Gregorian,
 * exact), otherwise `text` for the *String alternative.
 */
export interface FhirDateValue {
  date?: string;
  text?: string;
}

const QUALIFIER_PREFIX: Record<string, string> = {
  about: "abt ",
  before: "bef ",
  after: "aft ",
  exact: "",
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function isoParts(d: GenDate): string {
  let s = String(d.year).padStart(4, "0");
  if (d.month != null) s += `-${pad2(d.month)}`;
  if (d.month != null && d.day != null) s += `-${pad2(d.day)}`;
  return s;
}

export function toFhirDate(date: GenDate | null | undefined): FhirDateValue | null {
  if (!date) return null;
  if (date.year == null) return date.text ? { text: date.text } : null;

  const iso = isoParts(date);
  const gregorian = date.calendar === "gregorian" || date.calendar === "unknown";
  if (date.qualifier === "exact" && gregorian) return { date: iso };

  const prefix = QUALIFIER_PREFIX[date.qualifier] ?? "";
  const calendar = gregorian ? "" : ` (${date.calendar})`;
  return { text: `${prefix}${iso}${calendar}` };
}
