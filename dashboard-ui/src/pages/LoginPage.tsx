import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/auth/useAuth';
import { startLogin } from '@/auth/oauth';
import { config } from '@/config';

export function LoginPage() {
  const navigate = useNavigate();
  const isAuthed = useAuth((s) => s.isAuthenticated());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthed) {
      navigate({ to: '/patients' });
    }
  }, [isAuthed, navigate]);

  const handleLogin = async () => {
    try {
      await startLogin();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">OpenEMR Patient Dashboard</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Modern React reimplementation of the OpenEMR patient summary, consuming the FHIR R4 API
            via OAuth2 + PKCE.
          </p>
          {!config.clientId && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              <strong>Setup required:</strong> register a SMART app at{' '}
              <code>{config.oauthBase}/registration</code> and rebuild with{' '}
              <code>VITE_OAUTH_CLIENT_ID</code> set.
            </div>
          )}
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              {error}
            </div>
          )}
          <Button onClick={handleLogin} disabled={!config.clientId} className="w-full">
            Sign in with OpenEMR
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
