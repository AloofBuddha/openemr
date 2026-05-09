import { ClinicalCard } from '@/components/ClinicalCard';
import { useMedicationRequests, fhirEntries } from '@/fhir/hooks';
import type { MedicationRequest } from '@/fhir/types';
import { slug } from '@/lib/format';

function medName(m: MedicationRequest): string {
  return (
    m.medicationCodeableConcept?.text ??
    m.medicationCodeableConcept?.coding?.[0]?.display ??
    m.medicationReference?.display ??
    '—'
  );
}

function dosageText(m: MedicationRequest): string | undefined {
  return m.dosageInstruction?.[0]?.text;
}

export function MedicationsCard({ patientId }: { patientId: string }) {
  // Active medications — what the patient is currently on.
  const q = useMedicationRequests(patientId, 'active');
  return (
    <ClinicalCard
      id="card-medications"
      title="Medications"
      isLoading={q.isLoading}
      isError={q.isError}
      error={q.error}
      items={fhirEntries(q.data)}
      emptyMessage="No active medications."
      getRowId={(m) => `card-medications-row-${slug(medName(m).split(' ')[0])}`}
      renderItem={(m) => (
        <div>
          <p className="font-medium">{medName(m)}</p>
          {dosageText(m) && <p className="text-xs text-muted-foreground">{dosageText(m)}</p>}
        </div>
      )}
    />
  );
}
