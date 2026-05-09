import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { usePatient } from '@/fhir/hooks';
import { ageFromBirthDate, formatDate, patientDisplayName, patientMRN } from '@/lib/format';
import { AlertCircle } from 'lucide-react';

interface Props {
  patientId: string;
}

// Persistent identity bar — required PRD deliverable. Mirrors what
// OpenEMR's PHP banner shows but rendered from the FHIR Patient
// resource the React app fetches itself, so we can demonstrate the
// React port handles the patient identity surface end-to-end.
export function PatientHeader({ patientId }: Props) {
  const { data, isLoading, isError, error } = usePatient(patientId);

  if (isLoading) {
    return (
      <div className="rounded-lg border bg-white px-4 py-3 mb-4">
        <Skeleton className="h-5 w-48 mb-2" />
        <Skeleton className="h-4 w-72" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 mb-4 flex items-center gap-2 text-sm text-red-900">
        <AlertCircle className="h-4 w-4" />
        <span>Failed to load patient: {error instanceof Error ? error.message : 'unknown'}</span>
      </div>
    );
  }

  const age = ageFromBirthDate(data.birthDate);
  const mrn = patientMRN(data);
  const active = data.active !== false;

  return (
    <div className="rounded-lg border bg-white px-4 py-3 mb-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-lg font-semibold m-0">{patientDisplayName(data)}</h1>
        {active ? (
          <Badge variant="success">Active</Badge>
        ) : (
          <Badge variant="outline">Inactive</Badge>
        )}
      </div>
      <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600">
        <div>
          <dt className="inline font-medium text-slate-900">DOB:</dt>{' '}
          <dd className="inline">
            {formatDate(data.birthDate)}
            {age !== undefined ? ` (${age}y)` : ''}
          </dd>
        </div>
        <div>
          <dt className="inline font-medium text-slate-900">Sex:</dt>{' '}
          <dd className="inline capitalize">{data.gender ?? '—'}</dd>
        </div>
        {mrn && (
          <div>
            <dt className="inline font-medium text-slate-900">MRN:</dt>{' '}
            <dd className="inline font-mono">{mrn}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
