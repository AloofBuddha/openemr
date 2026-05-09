import { Badge } from '@/components/ui/badge';
import { ClinicalCard } from '@/components/ClinicalCard';
import { useAllergies, fhirEntries } from '@/fhir/hooks';
import type { AllergyIntolerance } from '@/fhir/types';
import { slug } from '@/lib/format';

function describe(a: AllergyIntolerance): string {
  return a.code?.text ?? a.code?.coding?.[0]?.display ?? a.code?.coding?.[0]?.code ?? '—';
}

function reactionText(a: AllergyIntolerance): string | undefined {
  const r = a.reaction?.[0];
  if (!r) return undefined;
  const m = r.manifestation?.[0];
  return m?.text ?? m?.coding?.[0]?.display;
}

export function AllergiesCard({ patientId }: { patientId: string }) {
  const q = useAllergies(patientId);
  return (
    <ClinicalCard
      id="card-allergies"
      title="Allergies"
      isLoading={q.isLoading}
      isError={q.isError}
      error={q.error}
      items={fhirEntries(q.data)}
      getRowId={(a) => `card-allergies-row-${slug(describe(a))}`}
      renderItem={(a) => (
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="font-medium">{describe(a)}</p>
            {reactionText(a) && (
              <p className="text-xs text-muted-foreground">Reaction: {reactionText(a)}</p>
            )}
          </div>
          {a.criticality === 'high' && <Badge variant="destructive">High</Badge>}
          {a.criticality === 'low' && <Badge variant="warning">Low</Badge>}
        </div>
      )}
    />
  );
}
