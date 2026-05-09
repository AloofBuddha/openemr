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
  scope: [
    'openid',
    'offline_access',
    'launch/patient',
    'patient/Patient.read',
    'patient/AllergyIntolerance.read',
    'patient/Condition.read',
    'patient/MedicationRequest.read',
    'patient/CareTeam.read',
    'patient/Encounter.read',
  ].join(' '),
};
