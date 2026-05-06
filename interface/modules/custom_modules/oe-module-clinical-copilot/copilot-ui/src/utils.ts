// Small pure helpers: time formatting, localStorage cache, patient-context
// builder. None of these touch React state — all easy to unit-test.

import type {
  CachedConvo,
  CiteSource,
  Message,
  Snapshot,
} from './types';

export const uid = (): string =>
  `m${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export const todayKey = (): string => new Date().toISOString().slice(0, 10);

export function formatApptTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return t;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 || 12;
  return `${hr}:${String(m).padStart(2, '0')} ${ampm}`;
}

// ─── localStorage helpers ──────────────────────────────────────────────────

export function loadCache(key: string): CachedConvo | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedConvo>;
    if (Array.isArray(parsed.messages) && parsed.messages.length > 0) {
      return {
        messages: parsed.messages,
        sources:  parsed.sources ?? {},
        snapshot: parsed.snapshot,
      };
    }
  } catch {
    // unavailable or corrupt — treat as no cache
  }
  return null;
}

export function saveCache(
  key: string,
  messages: Message[],
  sources: Record<string, CiteSource>,
  snapshot: Snapshot | null,
): void {
  try {
    localStorage.setItem(key, JSON.stringify({ messages, sources, snapshot }));
  } catch {
    // quota or private browsing — silently drop
  }
}

// ─── Build numbered patient context for the agent POST ─────────────────────

// Uses P-prefixed keys (P1, P2…) so they don't collide with the brief's
// numeric citation keys (1, 2, 3…) already in sources state.

export interface NumberedContext {
  text: string;
  sourceMap: Record<string, CiteSource>;
}

const LAB_LIMIT_FOR_CONTEXT = 8;

export function buildNumberedPatientContext(snap: Snapshot | null): NumberedContext {
  if (!snap) return { text: '', sourceMap: {} };

  const sourceMap: Record<string, CiteSource> = {};
  const lines: string[] = [
    `Patient: ${snap.patient.name}, ${snap.patient.age}y ${snap.patient.sex}`,
  ];
  let idx = 1;

  if (snap.appointment?.reason) {
    sourceMap[`P${idx}`] = {
      type: 'appointment',
      label: "Today's appointment",
      fields: [{ key: 'Reason', value: snap.appointment.reason }],
    };
    lines.push(`[${idx}] Today's visit: ${snap.appointment.reason}`);
    idx++;
  }

  for (const p of snap.problems) {
    sourceMap[`P${idx}`] = {
      type: 'problem',
      label: p.title,
      fields: [
        { key: 'ICD-10', value: p.icd10 },
        { key: 'Since',  value: p.since },
      ].filter(f => f.value),
      scroll_to: '#medical_problem_ps_expand',
    };
    lines.push(`[${idx}] Problem: ${p.title}${p.icd10 ? ` (${p.icd10})` : ''}`);
    idx++;
  }

  for (const m of snap.medications) {
    const label = `${m.drug} ${m.dosage}`.trim();
    sourceMap[`P${idx}`] = {
      type: 'medication',
      label,
      fields: [
        { key: 'Drug', value: m.drug },
        { key: 'Dose', value: m.dosage },
      ].filter(f => f.value),
      scroll_to: '#prescriptions_ps_expand',
    };
    lines.push(`[${idx}] Medication: ${label}`);
    idx++;
  }

  for (const a of snap.allergies) {
    sourceMap[`P${idx}`] = {
      type: 'allergy',
      label: a.title,
      fields: [
        { key: 'Reaction', value: a.reaction },
        { key: 'Severity', value: a.severity },
      ].filter(f => f.value),
      scroll_to: '#allergy_ps_expand',
    };
    lines.push(`[${idx}] Allergy: ${a.title}${a.reaction ? ` → ${a.reaction}` : ''}`);
    idx++;
  }

  for (const l of snap.labs.slice(0, LAB_LIMIT_FOR_CONTEXT)) {
    const label = `${l.test}: ${l.value} ${l.units}`.trim();
    sourceMap[`P${idx}`] = {
      type: 'lab',
      label,
      fields: [
        { key: 'Result',    value: `${l.value} ${l.units}`.trim() },
        { key: 'Flag',      value: l.abnormal || 'Within range' },
        { key: 'Collected', value: l.date },
      ].filter(f => f.value),
      scroll_to: '#labdata_ps_expand',
    };
    lines.push(
      `[${idx}] Lab: ${label}` +
      `${l.abnormal ? ` [${l.abnormal}]` : ''}` +
      `${l.date ? ` — ${l.date}` : ''}`
    );
    idx++;
  }

  return { text: lines.join('\n'), sourceMap };
}

// Lab dedup helper — used both for the initial snapshot and when adding
// extracted labs from an upload.
//
// Strategy: lowercase + strip non-alphanumeric. Collapses purely typographic
// variants (e.g. "Cholesterol Total" vs "Cholesterol, Total" vs
// "cholesterol-total") into one key. Methodologic variants like
// "LDL Cholesterol" vs "LDL Cholesterol, Calculated" stay distinct, which
// is what we want — different methods can produce different values.
export function normaliseLabName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}
