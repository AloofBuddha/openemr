import { Badge } from '@/components/ui/badge';
import { ClinicalCard } from '@/components/ClinicalCard';
import { useAllergies, fhirEntries } from '@/fhir/hooks';
import type { AllergyIntolerance } from '@/fhir/types';
import { slug } from '@/lib/format';

function stripXhtml(div: string | undefined): string | undefined {
  if (!div) return undefined;
  const text = div.replace(/<[^>]+>/g, '').trim();
  return text || undefined;
}

function describe(a: AllergyIntolerance): string {
  // OpenEMR's FHIR allergy mapper sets code.coding[0].display = "Unknown"
  // when there's no SNOMED code (most intake-form-derived allergies).
  // The actual allergen name lives in the resource-level Narrative.
  const codeDisplay = a.code?.text ?? a.code?.coding?.[0]?.display;
  const narrative = stripXhtml(a.text?.div);
  const isUnknown = !codeDisplay || codeDisplay.toLowerCase() === 'unknown';
  if (isUnknown && narrative) return narrative;
  return codeDisplay ?? narrative ?? a.code?.coding?.[0]?.code ?? '—';
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
