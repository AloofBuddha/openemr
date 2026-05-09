import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuth } from '@/auth/useAuth';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const isAuthed = useAuth((s) => s.isAuthenticated());

  useEffect(() => {
    if (!isAuthed) navigate({ to: '/', replace: true });
  }, [isAuthed, navigate]);

  if (!isAuthed) return null;
  return <>{children}</>;
}
