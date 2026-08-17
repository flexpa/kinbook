/**
 * Minimal FHIR R5 shapes — only the elements this exporter emits.
 * Modeled on https://hl7.org/fhir/R5/ (FamilyMemberHistory, Patient, Bundle).
 * Hand-rolled so the package carries no external dependency.
 */

export interface Coding {
  system: string;
  code: string;
  display?: string;
}

export interface CodeableConcept {
  coding?: Coding[];
  text?: string;
}

export interface Reference {
  reference: string;
  display?: string;
}

export interface Annotation {
  text: string;
}

export interface HumanName {
  text?: string;
  family?: string;
  given?: string[];
  prefix?: string[];
  suffix?: string[];
}

export interface FhirPatient {
  resourceType: "Patient";
  id: string;
  name?: HumanName[];
  gender?: "male" | "female" | "other" | "unknown";
  birthDate?: string;
  deceasedBoolean?: boolean;
  deceasedDateTime?: string;
}

/** FHIR R5 FamilyMemberHistory — born[x] and deceased[x] are mutually exclusive choices. */
export interface FhirFamilyMemberHistory {
  resourceType: "FamilyMemberHistory";
  id: string;
  status: "partial" | "completed" | "entered-in-error" | "health-unknown";
  patient: Reference;
  name?: string;
  relationship: CodeableConcept;
  sex?: CodeableConcept;
  bornDate?: string;
  bornString?: string;
  deceasedBoolean?: boolean;
  deceasedDate?: string;
  deceasedString?: string;
  note?: Annotation[];
}

export interface BundleEntry {
  resource: FhirPatient | FhirFamilyMemberHistory;
}

export interface FhirBundle {
  resourceType: "Bundle";
  type: "collection";
  entry: BundleEntry[];
}

export const V3_ROLE_CODE = "http://terminology.hl7.org/CodeSystem/v3-RoleCode";
export const ADMINISTRATIVE_GENDER = "http://hl7.org/fhir/administrative-gender";
