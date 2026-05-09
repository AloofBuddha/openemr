import { Badge } from '@/components/ui/badge';
import { ClinicalCard } from '@/components/ClinicalCard';
import { useEncounters, fhirEntries } from '@/fhir/hooks';
import type { Encounter } from '@/fhir/types';
import { formatDate } from '@/lib/format';

function encounterTitle(e: Encounter): string {
  return (
    e.type?.[0]?.text ??
    e.type?.[0]?.coding?.[0]?.display ??
    e.serviceType?.text ??
    e.class?.display ??
    'Encounter'
  );
}

function provider(e: Encounter): string | undefined {
  return e.participant?.[0]?.individual?.display;
}

export function EncountersCard({ patientId }: { patientId: string }) {
  const q = useEncounters(patientId);
  const items = fhirEntries(q.data)
    .slice()
    .sort((a, b) => (b.period?.start ?? '').localeCompare(a.period?.start ?? ''));
  return (
    <ClinicalCard
      title="Recent Encounters"
      isLoading={q.isLoading}
      isError={q.isError}
      error={q.error}
      items={items}
      emptyMessage="No encounters recorded."
      renderItem={(e) => (
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="font-medium">{encounterTitle(e)}</p>
            <p className="text-xs text-muted-foreground">
              {formatDate(e.period?.start)}
              {provider(e) ? ` · ${provider(e)}` : ''}
            </p>
          </div>
          {e.status && e.status !== 'finished' && (
            <Badge variant="outline" className="capitalize">
              {e.status}
            </Badge>
          )}
        </div>
      )}
    />
  );
}
