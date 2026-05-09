import { Badge } from '@/components/ui/badge';
import { ClinicalCard } from '@/components/ClinicalCard';
import { useMedicationRequests, fhirEntries } from '@/fhir/hooks';
import type { MedicationRequest } from '@/fhir/types';
import { formatDate } from '@/lib/format';

function medName(m: MedicationRequest): string {
  return (
    m.medicationCodeableConcept?.text ??
    m.medicationCodeableConcept?.coding?.[0]?.display ??
    m.medicationReference?.display ??
    '—'
  );
}

export function PrescriptionsCard({ patientId }: { patientId: string }) {
  // All MedicationRequests (no status filter) — the prescribing record,
  // including completed/stopped scripts. Sorted by authoredOn desc client-side.
  const q = useMedicationRequests(patientId);
  const items = fhirEntries(q.data)
    .slice()
    .sort((a, b) => (b.authoredOn ?? '').localeCompare(a.authoredOn ?? ''))
    .slice(0, 10);
  return (
    <ClinicalCard
      title="Prescriptions"
      isLoading={q.isLoading}
      isError={q.isError}
      error={q.error}
      items={items}
      emptyMessage="No prescriptions on file."
      renderItem={(m) => (
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="font-medium">{medName(m)}</p>
            <p className="text-xs text-muted-foreground">
              Written {formatDate(m.authoredOn)}
            </p>
          </div>
          {m.status && (
            <Badge
              variant={m.status === 'active' ? 'success' : 'outline'}
              className="capitalize"
            >
              {m.status}
            </Badge>
          )}
        </div>
      )}
    />
  );
}
