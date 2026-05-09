// Embedded mode: when the dashboard is loaded inside OpenEMR's patient
// summary iframe (`/dashboard/patient/$pid?embedded=1`), we hide the
// AppHeader (OpenEMR provides its own top nav + patient banner) and
// drop the max-width constraint so cards fill the iframe.
//
// The flag rides in sessionStorage so it survives the OAuth round-trip
// (authorize → callback → patient page).

const KEY = 'oe-dashboard.embedded';

export function captureEmbeddedFromUrl(): void {
  const params = new URLSearchParams(window.location.search);
  if (params.get('embedded') === '1') {
    sessionStorage.setItem(KEY, '1');
  }
}

export function isEmbedded(): boolean {
  return sessionStorage.getItem(KEY) === '1';
}
