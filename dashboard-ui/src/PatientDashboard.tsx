import { useEffect, useRef, useState } from 'react';
import { useIsFetching } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { AllergiesCard } from '@/components/cards/AllergiesCard';
import { ProblemListCard } from '@/components/cards/ProblemListCard';
import { MedicationsCard } from '@/components/cards/MedicationsCard';
import { PrescriptionsCard } from '@/components/cards/PrescriptionsCard';
import { CareTeamCard } from '@/components/cards/CareTeamCard';
import { EncountersCard } from '@/components/cards/EncountersCard';

interface Props {
  patientId: string;
}

// Mounted inline inside OpenEMR's demographics.php. The persistent
// identity bar (name/DOB/sex/MRN/active) is provided by the copilot's
// PatientSnapshot at the top of the page — we don't duplicate it
// here. Our tree owns the six clinical cards.
export function PatientDashboard({ patientId }: Props) {
  // Hold a single loading state until ALL initial queries have settled,
  // so users see one spinner instead of cards trickling in. We can't
  // just check `fetching === 0` because that's true before queries
  // start; we need to observe the 0 → N → 0 transition.
  const fetching = useIsFetching();
  const sawFetchingRef = useRef(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  useEffect(() => {
    if (fetching > 0) sawFetchingRef.current = true;
    if (sawFetchingRef.current && fetching === 0 && !hasLoaded) setHasLoaded(true);
  }, [fetching, hasLoaded]);

  return (
    <div className="p-4">
      {!hasLoaded && (
        <div className="flex items-center justify-center py-16 text-slate-500">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          <span className="text-sm">Loading chart…</span>
        </div>
      )}
      <div
        className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-3 ${
          hasLoaded ? '' : 'hidden'
        }`}
      >
        <AllergiesCard patientId={patientId} />
        <ProblemListCard patientId={patientId} />
        <MedicationsCard patientId={patientId} />
        <PrescriptionsCard patientId={patientId} />
        <CareTeamCard patientId={patientId} />
        <EncountersCard patientId={patientId} />
      </div>
    </div>
  );
}
