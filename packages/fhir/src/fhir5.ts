import type { Event, Family, NamePart, Person, Sex } from "@ftp/core";
import { toFhirDate } from "./date";
import type { Kinship } from "./kinship";
import { relatives } from "./kinship";
import type {
  CodeableConcept,
  FhirBundle,
  FhirFamilyMemberHistory,
  FhirPatient,
  HumanName,
} from "./types";
import { ADMINISTRATIVE_GENDER, V3_ROLE_CODE } from "./types";

/**
 * Export the tree as a FHIR R5 collection Bundle: one Patient resource for
 * the chosen person, plus one FamilyMemberHistory resource per connected
 * relative. References between resources are relative (Patient/<id>).
 */
export interface Fhir5ExportInput {
  people: Person[];
  families: Family[];
  /** node id of the person who is the Patient */
  patientId: string;
}

export function toFhir5(input: Fhir5ExportInput): string {
  const patient = input.people.find((p) => p.id === input.patientId);
  if (!patient) throw new Error(`person not found: ${input.patientId}`);

  const bundle: FhirBundle = {
    resourceType: "Bundle",
    type: "collection",
    entry: [
      { resource: patientResource(patient) },
      ...relatives(input.people, input.families, patient.id).map((rel) => ({
        resource: familyMemberHistory(rel.person, rel.kinship, patient),
      })),
    ],
  };
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

function eventOf(person: Person, type: Event["type"]): Event | undefined {
  return person.events.find((e) => e.type === type);
}

function fullName(person: Person): string | undefined {
  const n = person.names[0];
  if (!n) return undefined;
  const s = [n.prefix, n.given, n.surname, n.suffix].filter(Boolean).join(" ").trim();
  return s || undefined;
}

function humanName(n: NamePart): HumanName {
  const out: HumanName = {};
  const text = [n.prefix, n.given, n.surname, n.suffix].filter(Boolean).join(" ").trim();
  if (text) out.text = text;
  if (n.surname) out.family = n.surname;
  if (n.given) out.given = n.given.split(/\s+/);
  if (n.prefix) out.prefix = [n.prefix];
  if (n.suffix) out.suffix = [n.suffix];
  return out;
}

function genderConcept(sex: Sex): CodeableConcept {
  return {
    coding: [
      {
        system: ADMINISTRATIVE_GENDER,
        code: sex,
        display: sex.charAt(0).toUpperCase() + sex.slice(1),
      },
    ],
  };
}

function relationshipConcept(kinship: Kinship): CodeableConcept {
  const concept: CodeableConcept = {
    coding: [{ system: V3_ROLE_CODE, code: kinship.code, display: kinship.display }],
  };
  if (kinship.text) concept.text = kinship.text;
  return concept;
}

function patientResource(person: Person): FhirPatient {
  const resource: FhirPatient = { resourceType: "Patient", id: person.id };
  if (person.names.length > 0) resource.name = person.names.map(humanName);
  if (person.sex !== "unknown") resource.gender = person.sex;

  const born = toFhirDate(eventOf(person, "birth")?.date);
  if (born?.date) resource.birthDate = born.date;

  const death = eventOf(person, "death");
  if (death) {
    const died = toFhirDate(death.date);
    if (died?.date) resource.deceasedDateTime = died.date;
    else resource.deceasedBoolean = true;
  }
  return resource;
}

function familyMemberHistory(person: Person, kinship: Kinship, patient: Person): FhirFamilyMemberHistory {
  const resource: FhirFamilyMemberHistory = {
    resourceType: "FamilyMemberHistory",
    id: person.id,
    status: "completed",
    patient: { reference: `Patient/${patient.id}`, display: fullName(patient) },
    relationship: relationshipConcept(kinship),
  };

  const name = fullName(person);
  if (name) resource.name = name;
  if (person.sex !== "unknown") resource.sex = genderConcept(person.sex);

  const born = toFhirDate(eventOf(person, "birth")?.date);
  if (born?.date) resource.bornDate = born.date;
  else if (born?.text) resource.bornString = born.text;

  const death = eventOf(person, "death");
  if (death) {
    const died = toFhirDate(death.date);
    if (died?.date) resource.deceasedDate = died.date;
    else if (died?.text) resource.deceasedString = died.text;
    else resource.deceasedBoolean = true;
  }

  if (person.notes) resource.note = [{ text: person.notes }];
  return resource;
}
