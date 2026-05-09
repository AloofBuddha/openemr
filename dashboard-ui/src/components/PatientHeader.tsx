import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { usePatient } from '@/fhir/hooks';
import { ageFromBirthDate, formatDate, patientDisplayName, patientMRN } from '@/lib/format';
import { AlertCircle } from 'lucide-react';

interface Props {
  patientId: string;
}

export function PatientHeader({ patientId }: Props) {
  const { data, isLoading, isError, error } = usePatient(patientId);

  if (isLoading) {
    return (
      <div className="bg-white border-b">
        <div className="max-w-6xl mx-auto px-6 py-3">
          <Skeleton className="h-6 w-48 mb-2" />
          <Skeleton className="h-4 w-72" />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="bg-destructive/5 border-b border-destructive/30">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          <span>Failed to load patient: {error instanceof Error ? error.message : 'unknown'}</span>
        </div>
      </div>
    );
  }

  const age = ageFromBirthDate(data.birthDate);
  const mrn = patientMRN(data);
  const active = data.active !== false;

  return (
    <div className="bg-white border-b">
      <div className="max-w-6xl mx-auto px-6 py-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-xl font-semibold">{patientDisplayName(data)}</h1>
          {active ? (
            <Badge variant="success">Active</Badge>
          ) : (
            <Badge variant="outline">Inactive</Badge>
          )}
        </div>
        <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <div>
            <dt className="inline font-medium text-foreground">DOB:</dt>{' '}
            <dd className="inline">
              {formatDate(data.birthDate)}
              {age !== undefined ? ` (${age}y)` : ''}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium text-foreground">Sex:</dt>{' '}
            <dd className="inline capitalize">{data.gender ?? '—'}</dd>
          </div>
          {mrn && (
            <div>
              <dt className="inline font-medium text-foreground">MRN:</dt>{' '}
              <dd className="inline font-mono">{mrn}</dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  );
}
