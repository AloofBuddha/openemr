// FHIR proxy client. Calls a PHP endpoint inside the OpenEMR module
// that authenticates via the user's existing PHP session, calls the
// FHIR service classes server-side, and returns FHIR-formatted JSON.
// The browser never holds an OAuth token — auth is the OpenEMR session
// cookie that's already set when the dashboard loads.

export class FhirError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: string,
  ) {
    super(message);
  }
}

interface ProxyConfig {
  proxyUrl: string;
  csrfToken: string;
}

let config: ProxyConfig | null = null;

export function setProxyConfig(c: ProxyConfig): void {
  config = c;
}

export async function fhirFetch<T>(path: string): Promise<T> {
  if (!config) throw new FhirError('Dashboard not initialized', 500);
  const url = new URL(config.proxyUrl, window.location.origin);
  // path looks like `/Patient/20` or `/AllergyIntolerance?patient=20`.
  url.searchParams.set('path', path.replace(/^\//, ''));
  url.searchParams.set('csrf_token', config.csrfToken);

  const res = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new FhirError(`FHIR ${res.status}`, res.status, body);
  }
  return (await res.json()) as T;
}
