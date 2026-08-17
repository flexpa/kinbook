export type ID = string;

export type Sex = "male" | "female" | "other" | "unknown";

export type DateQualifier = "exact" | "about" | "before" | "after";

export type Calendar = "gregorian" | "julian" | "hebrew" | "islamic" | "french-republican" | "unknown";

export interface GenDate {
  qualifier: DateQualifier;
  calendar: Calendar;
  year: number | null;
  month: number | null;
  day: number | null;
  text?: string | null;
}

export interface Place {
  name: string;
  /** jurisdiction parts from largest to smallest, e.g. ["USA","CA","Los Angeles"] */
  parts?: string[] | null;
}

export interface NamePart {
  given: string;
  surname: string;
  prefix?: string | null;
  suffix?: string | null;
}

export type EventType =
  | "birth"
  | "death"
  | "burial"
  | "marriage"
  | "divorce"
  | "residence"
  | "census"
  | "immigration"
  | "occupation"
  | "custom";

export interface Event {
  id: ID;
  type: EventType;
  date?: GenDate | null;
  place?: Place | null;
  /** array of GEDCOM source record references */
  sourceRefs?: string[];
  notes?: string | null;
}

export interface FamilyRole {
  familyId: ID;
  role: "husband" | "wife" | "child";
}

export interface Person {
  id: ID;
  names: NamePart[];
  sex: Sex;
  events: Event[];
  families: FamilyRole[];
  parentFamilyIds: ID[];
  notes?: string | null;
}

export interface Family {
  id: ID;
  type: "spousal" | "parent";
  husbandId?: ID | null;
  wifeId?: ID | null;
  childrenIds: ID[];
  events: Event[];
  notes?: string | null;
}

export type ExportFormat = "gedcom55" | "gedcom70" | "fhir5";