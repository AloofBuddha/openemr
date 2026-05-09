import { Link } from '@tanstack/react-router';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/button';
import { Stethoscope } from 'lucide-react';

export function AppHeader() {
  const clear = useAuth((s) => s.clear);
  const isAuthed = useAuth((s) => s.isAuthenticated());
  return (
    <header className="border-b bg-white">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link to="/patients" className="flex items-center gap-2 font-semibold">
          <Stethoscope className="h-5 w-5 text-primary" />
          <span>OpenEMR Dashboard</span>
        </Link>
        {isAuthed && (
          <Button variant="ghost" size="sm" onClick={clear}>
            Sign out
          </Button>
        )}
      </div>
    </header>
  );
}
