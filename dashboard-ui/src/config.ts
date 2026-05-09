// Build-time configuration. Hardcoded for the OpenEMR fork demo deploy;
// in a multi-tenant scenario these would come from env vars or runtime
// discovery via /.well-known/smart-configuration.
//
// Production: served at https://198.211.103.246.nip.io/dashboard/
// FHIR base:  https://198.211.103.246.nip.io/apis/default/fhir
// OAuth base: https://198.211.103.246.nip.io/oauth2/default

const isProd = window.location.hostname !== 'localhost';

export const config = {
  fhirBase: isProd
    ? 'https://198.211.103.246.nip.io/apis/default/fhir'
    : 'https://localhost:9300/apis/default/fhir',
  oauthBase: isProd
    ? 'https://198.211.103.246.nip.io/oauth2/default'
    : 'https://localhost:9300/oauth2/default',
  redirectUri: isProd
    ? 'https://198.211.103.246.nip.io/dashboard/callback'
    : 'http://localhost:5174/dashboard/callback',
  // Set after registering the SMART app on prod via /oauth2/default/registration.
  // OpenEMR requires a confidential client (no `none` auth method support);
  // we use client_secret_post + PKCE. The secret ends up in the bundle —
  // tradeoff documented in PATIENT_DASHBOARD_MIGRATION.md.
  clientId: import.meta.env.VITE_OAUTH_CLIENT_ID ?? '',
  clientSecret: import.meta.env.VITE_OAUTH_CLIENT_SECRET ?? '',
  // user/* scopes (not patient/*) so OpenEMR shows the provider login
  // form (username + password) instead of the patient-portal login form
  // (which requires email + password). The dashboard is a clinician
  // tool — providers log in, then pick a patient from the picker.
  scope: [
    'openid',
    'offline_access',
    'user/Patient.read',
    'user/AllergyIntolerance.read',
    'user/Condition.read',
    'user/MedicationRequest.read',
    'user/CareTeam.read',
    'user/Encounter.read',
  ].join(' '),
};
