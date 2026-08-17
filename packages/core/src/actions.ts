import type { ExportFormat, Family, GenDate, NamePart, Person, Place, Sex } from "./types";

/**
 * Shared, framework-agnostic actions.
 * Both the CLI and the MCP server call these functions; business logic lives
 * here once. Storage lives in @ftp/database, format codec in @ftp/gedcom, and
 * the bridge is @ftp/sync. This package defines the types and the action
 * contracts used across all of them.
 */

export interface AddPersonInput {
  given: string;
  surnames: string[];
  prefix?: string | null;
  suffix?: string | null;
  sex?: Sex;
  birth?: { date?: GenDate | null; place?: Place | null } | null;
  death?: { date?: GenDate | null; place?: Place | null } | null;
  burial?: { date?: GenDate | null; place?: Place | null } | null;
  /** auto-link: add this person to an existing family */
  familyId?: string | null;
  /** role within that family: "child" or "spouse" */
  role?: "child" | "spouse";
  notes?: string | null;
}

export interface AddFamilyInput {
  husbandId?: string | null;
  wifeId?: string | null;
  childrenIds?: string[];
  marriage?: { date?: GenDate | null; place?: Place | null } | null;
}

export interface UpdatePersonInput {
  /** full or partial overwrite of the person's name */
  names?: NamePart[];
  sex?: Sex;
  notes?: string | null;
  /** set (adds if none) or clear the birth/death/burial event on an existing person, by id */
  birth?: { date?: GenDate | null; place?: Place | null } | null;
  death?: { date?: GenDate | null; place?: Place | null } | null;
  burial?: { date?: GenDate | null; place?: Place | null } | null;
  /** add/remove family memberships */
  families?: Array<{ familyId: string; role: "husband" | "wife" | "child" }>;
}

export interface SearchResult {
  person: Person;
  score: number;
}

export interface TreeStore {
  addPerson(input: AddPersonInput): Promise<Person>;
  addFamily(input: AddFamilyInput): Promise<Family>;
  updatePerson(id: string, input: UpdatePersonInput): Promise<Person>;
  search(query: string): Promise<SearchResult[]>;
  exportTree(format?: ExportFormat): Promise<string>;
  listPeople(): Promise<Person[]>;
  listFamilies(): Promise<Family[]>;
  getPerson(id: string): Promise<Person | null>;
}

export interface Actions {
  addPerson(input: AddPersonInput): Promise<Person>;
  addFamily(input: AddFamilyInput): Promise<Family>;
  updatePerson(id: string, input: UpdatePersonInput): Promise<Person>;
  search(query: string): Promise<SearchResult[]>;
  exportTree(format?: ExportFormat): Promise<string>;
  listPeople(): Promise<Person[]>;
  listFamilies(): Promise<Family[]>;
  getPerson(id: string): Promise<Person | null>;
}

let store: TreeStore | null = null;

/** Registered by the sync layer at startup. */
export function registerStore(s: TreeStore): void {
  store = s;
}

export function getStore(): TreeStore {
  if (!store) throw new Error("sync layer not registered: call registerStore()");
  return store;
}