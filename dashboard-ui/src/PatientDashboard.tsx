import { AllergiesCard } from '@/components/cards/AllergiesCard';
import { ProblemListCard } from '@/components/cards/ProblemListCard';
import { MedicationsCard } from '@/components/cards/MedicationsCard';
import { PrescriptionsCard } from '@/components/cards/PrescriptionsCard';
import { CareTeamCard } from '@/components/cards/CareTeamCard';
import { EncountersCard } from '@/components/cards/EncountersCard';

interface Props {
  patientId: string;
}

// Mounted inline inside OpenEMR's demographics.php. The page already
// supplies the patient header (name/DOB/MRN) and global nav, so the
// dashboard renders just the cards. No router, no auth — the bundle
// receives an authenticated proxy URL via `patientDashboardInit`.
export function PatientDashboard({ patientId }: Props) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 p-4">
      <AllergiesCard patientId={patientId} />
      <ProblemListCard patientId={patientId} />
      <MedicationsCard patientId={patientId} />
      <PrescriptionsCard patientId={patientId} />
      <CareTeamCard patientId={patientId} />
      <EncountersCard patientId={patientId} />
    </div>
  );
}
