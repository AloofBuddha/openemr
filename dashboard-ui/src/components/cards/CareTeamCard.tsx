import { ClinicalCard } from '@/components/ClinicalCard';
import { useCareTeam, fhirEntries } from '@/fhir/hooks';
import type { CareTeam } from '@/fhir/types';

interface Row {
  member: string;
  role?: string;
}

function rows(ct: CareTeam): Row[] {
  return (ct.participant ?? []).map((p) => ({
    member: p.member?.display ?? '—',
    role: p.role?.[0]?.text ?? p.role?.[0]?.coding?.[0]?.display,
  }));
}

export function CareTeamCard({ patientId }: { patientId: string }) {
  const q = useCareTeam(patientId);
  const teams = fhirEntries(q.data);
  const allRows: Row[] = teams.flatMap(rows);
  return (
    <ClinicalCard
      id="card-careteam"
      title="Care Team"
      isLoading={q.isLoading}
      isError={q.isError}
      error={q.error}
      items={allRows}
      emptyMessage="No care team members assigned."
      renderItem={(r) => (
        <div>
          <p className="font-medium">{r.member}</p>
          {r.role && <p className="text-xs text-muted-foreground">{r.role}</p>}
        </div>
      )}
    />
  );
}
