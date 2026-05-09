import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { fhirFetch } from './client';
import type {
  AllergyIntolerance,
  Bundle,
  CareTeam,
  Condition,
  Encounter,
  MedicationRequest,
  Patient,
} from './types';

export function fhirEntries<T>(bundle: Bundle<T> | undefined): T[] {
  return bundle?.entry?.map((e) => e.resource) ?? [];
}

export function usePatient(patientId: string) {
  return useQuery({
    queryKey: ['Patient', patientId],
    queryFn: () => fhirFetch<Patient>(`/Patient/${patientId}`),
    enabled: !!patientId,
  });
}

export function usePatientSearch(name: string) {
  // OpenEMR FHIR Patient search supports `name` as a partial match.
  // Empty string lists all patients (capped by _count).
  const trimmed = name.trim();
  return useQuery({
    queryKey: ['Patient.search', trimmed],
    queryFn: () =>
      fhirFetch<Bundle<Patient>>(
        `/Patient?_count=20${trimmed ? `&name=${encodeURIComponent(trimmed)}` : ''}`,
      ),
    placeholderData: (prev) => prev,
  });
}

function patientResourceQuery<T>(
  resourceType: string,
  patientId: string,
  extraParams = '',
  options?: Partial<UseQueryOptions<Bundle<T>>>,
) {
  return {
    queryKey: [resourceType, patientId, extraParams],
    queryFn: () =>
      fhirFetch<Bundle<T>>(`/${resourceType}?patient=${patientId}${extraParams}`),
    enabled: !!patientId,
    ...options,
  } satisfies UseQueryOptions<Bundle<T>>;
}

export function useAllergies(patientId: string) {
  return useQuery(patientResourceQuery<AllergyIntolerance>('AllergyIntolerance', patientId));
}

export function useConditions(patientId: string) {
  // problem-list-item per US Core. OpenEMR returns an empty list if the
  // patient has no problems coded as such; that's the empty state.
  return useQuery(
    patientResourceQuery<Condition>(
      'Condition',
      patientId,
      '&category=problem-list-item',
    ),
  );
}

export function useMedicationRequests(patientId: string, status?: string) {
  return useQuery(
    patientResourceQuery<MedicationRequest>(
      'MedicationRequest',
      patientId,
      status ? `&status=${status}` : '',
    ),
  );
}

export function useCareTeam(patientId: string) {
  return useQuery(patientResourceQuery<CareTeam>('CareTeam', patientId));
}

export function useEncounters(patientId: string) {
  return useQuery(
    patientResourceQuery<Encounter>('Encounter', patientId, '&_count=10'),
  );
}
