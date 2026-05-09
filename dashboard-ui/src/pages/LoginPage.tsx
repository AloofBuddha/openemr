import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/auth/useAuth';
import { startLogin } from '@/auth/oauth';
import { config } from '@/config';

// `/dashboard/` immediately redirects to the OpenEMR OAuth authorize
// endpoint — there is no intermediate "click to log in" screen. The
// fallback card below renders only if redirect fails (missing client_id
// or thrown error from startLogin).
export function LoginPage() {
  const navigate = useNavigate();
  const isAuthed = useAuth((s) => s.isAuthenticated());
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (isAuthed) {
      navigate({ to: '/patients', replace: true });
      return;
    }
    if (!config.clientId) {
      setError(
        'OAuth client not configured. Set VITE_OAUTH_CLIENT_ID and rebuild — see dashboard-ui/.env.production.example.',
      );
      return;
    }
    // Guard against React 18 StrictMode double-invoke: PKCE verifier in
    // sessionStorage is consumed once; redirecting twice would overwrite it.
    if (startedRef.current) return;
    startedRef.current = true;
    startLogin().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
    });
  }, [isAuthed, navigate]);

  if (!error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <p className="text-sm text-muted-foreground">Redirecting to sign-in…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">Sign-in failed</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            {error}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
