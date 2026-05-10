import type { HumanName, Patient } from '@/fhir/types';

// Slug a label so cards can derive stable row ids that match the
// snapshot chips' scroll targets. Must stay byte-for-byte identical
// to the slug() in copilot-ui PatientSnapshot.tsx and the slug() in
// PatientContextBuilder.php — three encodings have to agree.
export function slug(s: string | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Strip dose / frequency / notes from a medication label so the slug
// keys off just the drug name. "Aspirin (baby) 81 mg daily, with food"
// → "aspirin-baby". Mirrors PatientContextBuilder::medNameSlug() in PHP.
export function medSlug(label: string | undefined): string {
  const beforeComma = (label ?? '').split(',')[0];
  const beforeDose = beforeComma.replace(/\s+\d.*$/, '');
  return slug(beforeDose);
}

export function formatHumanName(name: HumanName | undefined): string {
  if (!name) return '—';
  if (name.text) return name.text;
  const given = (name.given ?? []).join(' ');
  return [given, name.family].filter(Boolean).join(' ') || '—';
}

export function patientDisplayName(p: Patient): string {
  const official = p.name?.find((n) => n.use === 'official') ?? p.name?.[0];
  return formatHumanName(official);
}

export function patientMRN(p: Patient): string | undefined {
  // OpenEMR uses the public ID identifier; fall back to the first identifier.
  const ids = p.identifier ?? [];
  const mrn =
    ids.find((i) => i.type?.coding?.some((c) => c.code === 'MR')) ??
    ids.find((i) => i.system?.includes('mrn')) ??
    ids[0];
  return mrn?.value;
}

export function formatDate(iso: string | undefined): string {
  if (!iso) return '—';
  // Avoid timezone shifts on date-only strings (FHIR `birthDate` etc.)
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

export function ageFromBirthDate(iso: string | undefined): number | undefined {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return undefined;
  const [y, m, d] = iso.split('-').map(Number);
  const today = new Date();
  let age = today.getFullYear() - y;
  const beforeBirthday =
    today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d);
  if (beforeBirthday) age--;
  return age >= 0 ? age : undefined;
}
