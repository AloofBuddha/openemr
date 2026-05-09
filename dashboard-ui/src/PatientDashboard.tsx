import { PatientHeader } from '@/components/PatientHeader';
import { AllergiesCard } from '@/components/cards/AllergiesCard';
import { ProblemListCard } from '@/components/cards/ProblemListCard';
import { MedicationsCard } from '@/components/cards/MedicationsCard';
import { PrescriptionsCard } from '@/components/cards/PrescriptionsCard';
import { CareTeamCard } from '@/components/cards/CareTeamCard';
import { EncountersCard } from '@/components/cards/EncountersCard';

interface Props {
  patientId: string;
}

// Mounted inline inside OpenEMR's demographics.php. We render the
// patient header (PRD deliverable) + the six clinical cards.
// OpenEMR's outer chrome (top nav, scheduling, patient tabs) wraps
// us; our React tree owns just the patient summary content area.
export function PatientDashboard({ patientId }: Props) {
  return (
    <div className="p-4">
      <PatientHeader patientId={patientId} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
