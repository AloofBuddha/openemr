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
  return (
    <div className="p-4">
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
