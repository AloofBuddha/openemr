// OAuth2 Authorization Code + PKCE for a public SMART-on-FHIR client.
// Spec: https://datatracker.ietf.org/doc/html/rfc7636

import { config } from '@/config';

const PKCE_VERIFIER_KEY = 'oauth.pkce_verifier';
const PKCE_STATE_KEY = 'oauth.state';
const RETURN_TO_KEY = 'oauth.return_to';

export function consumeReturnTo(): string | null {
  const v = sessionStorage.getItem(RETURN_TO_KEY);
  sessionStorage.removeItem(RETURN_TO_KEY);
  return v;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let str = '';
  bytes.forEach((b) => (str += String.fromCharCode(b)));
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(byteLen: number): string {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function sha256(input: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hash);
}

export async function startLogin(): Promise<void> {
  if (!config.clientId) {
    throw new Error(
      'VITE_OAUTH_CLIENT_ID is not set. Register a SMART app on OpenEMR and set the env var before building.',
    );
  }
  const verifier = randomString(32);
  const challenge = base64UrlEncode(await sha256(verifier));
  const state = randomString(16);

  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  sessionStorage.setItem(PKCE_STATE_KEY, state);

  // Remember the URL the user was trying to reach so the callback can
  // route them back. Skip the callback path itself.
  const here = window.location.pathname + window.location.search;
  if (!here.startsWith('/dashboard/callback')) {
    sessionStorage.setItem(RETURN_TO_KEY, here);
  }

  // Note: `aud` is intentionally omitted. OpenEMR's CustomAuthCodeGrant
  // skips the audience check when `aud` is absent and there's no SMART
  // `launch` param — and the configured site address on this instance
  // is `https://localhost:9300`, which the browser cannot reach. Pass
  // `aud` only when the OpenEMR site address matches the public URL.
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scope,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  window.location.assign(`${config.oauthBase}/authorize?${params.toString()}`);
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
  patient?: string; // SMART launch context
}

export async function exchangeCode(code: string, state: string): Promise<TokenResponse> {
  const expectedState = sessionStorage.getItem(PKCE_STATE_KEY);
  const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
  if (!expectedState || expectedState !== state) {
    throw new Error('OAuth state mismatch — possible CSRF; aborting login.');
  }
  if (!verifier) {
    throw new Error('Missing PKCE verifier; restart login.');
  }
  sessionStorage.removeItem(PKCE_STATE_KEY);
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code_verifier: verifier,
  });
  const res = await fetch(`${config.oauthBase}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
  const res = await fetch(`${config.oauthBase}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`Refresh failed (${res.status})`);
  }
  return (await res.json()) as TokenResponse;
}
