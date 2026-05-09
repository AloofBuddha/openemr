import { Badge } from '@/components/ui/badge';
import { ClinicalCard } from '@/components/ClinicalCard';
import { useConditions, fhirEntries } from '@/fhir/hooks';
import type { Condition } from '@/fhir/types';
import { formatDate, slug } from '@/lib/format';

function describe(c: Condition): string {
  return c.code?.text ?? c.code?.coding?.[0]?.display ?? c.code?.coding?.[0]?.code ?? '—';
}

function statusOf(c: Condition): string | undefined {
  return c.clinicalStatus?.coding?.[0]?.code;
}

export function ProblemListCard({ patientId }: { patientId: string }) {
  const q = useConditions(patientId);
  return (
    <ClinicalCard
      id="card-problems"
      title="Problem List"
      isLoading={q.isLoading}
      isError={q.isError}
      error={q.error}
      items={fhirEntries(q.data)}
      getRowId={(c) => `card-problems-row-${slug(describe(c))}`}
      renderItem={(c) => {
        const status = statusOf(c);
        return (
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="font-medium">{describe(c)}</p>
              {(c.onsetDateTime || c.recordedDate) && (
                <p className="text-xs text-muted-foreground">
                  {c.onsetDateTime ? `Onset ${formatDate(c.onsetDateTime)}` : null}
                  {c.onsetDateTime && c.recordedDate ? ' · ' : null}
                  {c.recordedDate && !c.onsetDateTime ? `Recorded ${formatDate(c.recordedDate)}` : null}
                </p>
              )}
            </div>
            {status && status !== 'active' && (
              <Badge variant="outline" className="capitalize">
                {status}
              </Badge>
            )}
          </div>
        );
      }}
    />
  );
}
