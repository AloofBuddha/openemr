import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Search, AlertCircle } from 'lucide-react';
import { AppHeader } from '@/components/AppHeader';
import { AuthGuard } from '@/components/AuthGuard';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { usePatientSearch, fhirEntries } from '@/fhir/hooks';
import { ageFromBirthDate, formatDate, patientDisplayName, patientMRN } from '@/lib/format';

export function PatientPickerPage() {
  const [query, setQuery] = useState('');
  const search = usePatientSearch(query);
  const patients = fhirEntries(search.data);

  return (
    <AuthGuard>
      <div className="min-h-screen bg-slate-50">
        <AppHeader />
        <main className="max-w-3xl mx-auto px-6 pt-4 pb-8 space-y-4">
          <div>
            <h1 className="text-2xl font-bold">Patients</h1>
            <p className="text-sm text-muted-foreground">
              Select a patient to open their dashboard.
            </p>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
              autoFocus
            />
          </div>

          {search.isError && (
            <Card>
              <CardContent className="p-6 flex items-start gap-3 text-destructive">
                <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="font-medium">Failed to load patients</p>
                  <p className="mt-1 text-muted-foreground">
                    {search.error instanceof Error ? search.error.message : 'Unknown error'}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {search.isLoading && (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          )}

          {!search.isLoading && !search.isError && patients.length === 0 && (
            <Card>
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                No patients found.
              </CardContent>
            </Card>
          )}

          <ul className="space-y-2">
            {patients.map((p) => {
              const age = ageFromBirthDate(p.birthDate);
              return (
                <li key={p.id}>
                  <Link
                    to="/patient/$patientId"
                    params={{ patientId: p.id }}
                    className="block"
                  >
                    <Card className="hover:border-primary transition-colors">
                      <CardContent className="p-4 flex items-center justify-between gap-4">
                        <div>
                          <p className="font-medium">{patientDisplayName(p)}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {p.gender ?? '—'} · DOB {formatDate(p.birthDate)}
                            {age !== undefined ? ` (${age}y)` : ''}
                            {patientMRN(p) ? ` · MRN ${patientMRN(p)}` : ''}
                          </p>
                        </div>
                        {p.active === false && <Badge variant="outline">Inactive</Badge>}
                      </CardContent>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        </main>
      </div>
    </AuthGuard>
  );
}
