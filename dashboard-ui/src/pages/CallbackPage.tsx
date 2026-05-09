import { useEffect, useState } from 'react';
import { exchangeCode, consumeReturnTo } from '@/auth/oauth';
import { useAuth } from '@/auth/useAuth';

export function CallbackPage() {
  const setTokens = useAuth((s) => s.setTokens);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const oauthError = params.get('error');

    if (oauthError) {
      setError(`${oauthError}: ${params.get('error_description') ?? 'no description'}`);
      return;
    }
    if (!code || !state) {
      setError('Missing code or state in callback URL.');
      return;
    }

    let cancelled = false;
    exchangeCode(code, state)
      .then((tok) => {
        if (cancelled) return;
        setTokens({
          accessToken: tok.access_token,
          refreshToken: tok.refresh_token,
          expiresIn: tok.expires_in,
          patientContext: tok.patient,
        });
        // Full-page navigation so the URL the user originally
        // requested (with query params like ?embedded=1) is restored
        // exactly. Router.navigate would lose the search string.
        const returnTo = consumeReturnTo() ?? '/dashboard/patients';
        window.location.replace(returnTo);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [setTokens]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      {error ? (
        <div className="max-w-lg space-y-3">
          <h1 className="text-lg font-semibold">Sign-in failed</h1>
          <pre className="rounded-md border bg-slate-50 p-3 text-xs whitespace-pre-wrap break-all">
            {error}
          </pre>
          <a href="/dashboard/" className="text-sm text-primary underline">
            Back to login
          </a>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Completing sign-in…</p>
      )}
    </div>
  );
}
