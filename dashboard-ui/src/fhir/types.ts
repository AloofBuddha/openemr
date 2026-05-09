// Minimal FHIR R4 type subset. We type only what we render. Adding more
// fields is cheap; over-typing the whole spec is not — TanStack Query
// caches whatever the server returns regardless of declared type.

export interface Bundle<T> {
  resourceType: 'Bundle';
  type: string;
  total?: number;
  entry?: { resource: T; fullUrl?: string }[];
}

export interface Coding {
  system?: string;
  code?: string;
  display?: string;
}

export interface CodeableConcept {
  coding?: Coding[];
  text?: string;
}

export interface Identifier {
  system?: string;
  value?: string;
  type?: CodeableConcept;
  use?: string;
}

export interface HumanName {
  use?: string;
  family?: string;
  given?: string[];
  prefix?: string[];
  suffix?: string[];
  text?: string;
}

export interface Reference {
  reference?: string;
  display?: string;
  type?: string;
}

export interface Period {
  start?: string;
  end?: string;
}

export interface Patient {
  resourceType: 'Patient';
  id: string;
  active?: boolean;
  name?: HumanName[];
  gender?: string;
  birthDate?: string;
  identifier?: Identifier[];
  address?: { line?: string[]; city?: string; state?: string; postalCode?: string }[];
  telecom?: { system?: string; value?: string; use?: string }[];
}

export interface AllergyIntolerance {
  resourceType: 'AllergyIntolerance';
  id: string;
  clinicalStatus?: CodeableConcept;
  verificationStatus?: CodeableConcept;
  category?: string[];
  criticality?: 'low' | 'high' | 'unable-to-assess';
  code?: CodeableConcept;
  reaction?: { manifestation?: CodeableConcept[]; severity?: string }[];
  recordedDate?: string;
}

export interface Condition {
  resourceType: 'Condition';
  id: string;
  clinicalStatus?: CodeableConcept;
  verificationStatus?: CodeableConcept;
  category?: CodeableConcept[];
  severity?: CodeableConcept;
  code?: CodeableConcept;
  onsetDateTime?: string;
  recordedDate?: string;
}

export interface Dosage {
  text?: string;
  doseAndRate?: { doseQuantity?: { value?: number; unit?: string } }[];
}

export interface MedicationRequest {
  resourceType: 'MedicationRequest';
  id: string;
  status?: string;
  intent?: string;
  medicationCodeableConcept?: CodeableConcept;
  medicationReference?: Reference;
  authoredOn?: string;
  requester?: Reference;
  dosageInstruction?: Dosage[];
}

export interface CareTeam {
  resourceType: 'CareTeam';
  id: string;
  status?: string;
  name?: string;
  participant?: { role?: CodeableConcept[]; member?: Reference }[];
  period?: Period;
}

export interface Encounter {
  resourceType: 'Encounter';
  id: string;
  status?: string;
  class?: Coding;
  type?: CodeableConcept[];
  serviceType?: CodeableConcept;
  subject?: Reference;
  participant?: { individual?: Reference }[];
  period?: Period;
  reasonCode?: CodeableConcept[];
}

export type ResourceWithId = { resourceType: string; id: string };
