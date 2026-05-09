import { useParams } from '@tanstack/react-router';
import { AppHeader } from '@/components/AppHeader';
import { AuthGuard } from '@/components/AuthGuard';
import { PatientHeader } from '@/components/PatientHeader';
import { AllergiesCard } from '@/components/cards/AllergiesCard';
import { ProblemListCard } from '@/components/cards/ProblemListCard';
import { MedicationsCard } from '@/components/cards/MedicationsCard';
import { PrescriptionsCard } from '@/components/cards/PrescriptionsCard';
import { CareTeamCard } from '@/components/cards/CareTeamCard';
import { EncountersCard } from '@/components/cards/EncountersCard';

export function PatientDashboardPage() {
  const { patientId } = useParams({ from: '/patient/$patientId' });
  return (
    <AuthGuard>
      <div className="min-h-screen bg-slate-50">
        <AppHeader />
        <PatientHeader patientId={patientId} />
        <main className="max-w-6xl mx-auto px-6 pt-4 pb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AllergiesCard patientId={patientId} />
          <ProblemListCard patientId={patientId} />
          <MedicationsCard patientId={patientId} />
          <PrescriptionsCard patientId={patientId} />
          <CareTeamCard patientId={patientId} />
          <EncountersCard patientId={patientId} />
        </main>
      </div>
    </AuthGuard>
  );
}
