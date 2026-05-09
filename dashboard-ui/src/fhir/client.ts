import { config } from '@/config';
import { useAuth } from '@/auth/useAuth';
import { refreshAccessToken } from '@/auth/oauth';

export class FhirError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: string,
  ) {
    super(message);
  }
}

let inflightRefresh: Promise<string | null> | null = null;

async function refreshIfPossible(): Promise<string | null> {
  if (inflightRefresh) return inflightRefresh;
  const refreshToken = useAuth.getState().refreshToken;
  if (!refreshToken) return null;
  inflightRefresh = (async () => {
    try {
      const tok = await refreshAccessToken(refreshToken);
      useAuth.getState().setTokens({
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token,
        expiresIn: tok.expires_in,
      });
      return tok.access_token;
    } catch {
      useAuth.getState().clear();
      return null;
    } finally {
      inflightRefresh = null;
    }
  })();
  return inflightRefresh;
}

export async function fhirFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith('http') ? path : `${config.fhirBase}${path}`;
  const doFetch = async (token: string) => {
    return fetch(url, {
      ...init,
      headers: {
        Accept: 'application/fhir+json',
        ...init?.headers,
        Authorization: `Bearer ${token}`,
      },
    });
  };

  let token = useAuth.getState().accessToken;
  if (!token) throw new FhirError('Not authenticated', 401);

  let res = await doFetch(token);
  if (res.status === 401) {
    const refreshed = await refreshIfPossible();
    if (!refreshed) throw new FhirError('Session expired', 401);
    token = refreshed;
    res = await doFetch(token);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new FhirError(`FHIR ${res.status}`, res.status, body);
  }
  return (await res.json()) as T;
}
