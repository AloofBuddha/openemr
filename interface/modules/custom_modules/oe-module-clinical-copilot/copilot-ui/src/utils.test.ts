import { afterEach, describe, expect, it } from 'vitest';

import {
  buildNumberedPatientContext,
  formatApptTime,
  loadCache,
  normaliseLabName,
  saveCache,
} from './utils';
import type { Snapshot } from './types';

const baseSnapshot: Snapshot = {
  patient: { name: 'Margaret Chen', age: '52', sex: 'F', dob: '1973-08-12' },
  appointment: { time: '13:00', reason: 'Follow-up — chest tightness' },
  problems: [{ title: 'Type 2 DM', icd10: 'E11.9', since: '2018-04-01' }],
  medications: [{ drug: 'Metformin', dosage: '500mg', note: '' }],
  allergies: [{ title: 'Penicillin', reaction: 'rash', severity: 'mild' }],
  labs: [
    { test: 'HbA1c', value: '7.2', units: '%', abnormal: 'H', date: '2026-04-01' },
  ],
  documents: [],
};

// ─── formatApptTime ────────────────────────────────────────────────────────

describe('formatApptTime', () => {
  it('renders 24-hour input as 12-hour with AM/PM', () => {
    expect(formatApptTime('13:00')).toBe('1:00 PM');
    expect(formatApptTime('09:05')).toBe('9:05 AM');
    expect(formatApptTime('00:30')).toBe('12:30 AM');
    expect(formatApptTime('12:00')).toBe('12:00 PM');
  });

  it('passes through unparseable input unchanged', () => {
    expect(formatApptTime('invalid')).toBe('invalid');
    expect(formatApptTime('')).toBe('');
  });
});

// ─── normaliseLabName ──────────────────────────────────────────────────────

describe('normaliseLabName', () => {
  it('lowercases and strips all non-alphanumeric characters', () => {
    expect(normaliseLabName('Cholesterol Total')).toBe('cholesteroltotal');
    expect(normaliseLabName('Cholesterol-Total')).toBe('cholesteroltotal');
  });

  it('collapses typographic duplicates into a single key', () => {
    // The bug we fixed: "Cholesterol Total" and "Cholesterol, Total"
    // were distinct rows even though they're the same lab.
    expect(normaliseLabName('Cholesterol Total'))
      .toBe(normaliseLabName('Cholesterol, Total'));
  });

  it('keeps methodologically distinct lab names separate', () => {
    // Different methods can produce different values, so do NOT collapse.
    expect(normaliseLabName('LDL Cholesterol'))
      .not.toBe(normaliseLabName('LDL Cholesterol, Calculated'));
  });
});

// ─── localStorage cache ────────────────────────────────────────────────────

describe('loadCache / saveCache', () => {
  afterEach(() => localStorage.clear());

  it('returns null when nothing is stored', () => {
    expect(loadCache('absent')).toBeNull();
  });

  it('round-trips messages, sources, and snapshot', () => {
    const messages = [{ id: 'm1', role: 'user' as const, content: 'hi' }];
    const sources = { '1': { type: 'lab', label: 'A1c', fields: [] } };
    saveCache('k', messages, sources, baseSnapshot);
    const loaded = loadCache('k');
    expect(loaded?.messages).toEqual(messages);
    expect(loaded?.sources).toEqual(sources);
    expect(loaded?.snapshot).toEqual(baseSnapshot);
  });

  it('returns null for an empty messages array', () => {
    saveCache('empty', [], {}, null);
    expect(loadCache('empty')).toBeNull();
  });

  it('survives a corrupt JSON payload without throwing', () => {
    localStorage.setItem('bad', 'not-json{{');
    expect(loadCache('bad')).toBeNull();
  });
});

// ─── buildNumberedPatientContext ───────────────────────────────────────────

describe('buildNumberedPatientContext', () => {
  it('returns empty values for a null snapshot', () => {
    const out = buildNumberedPatientContext(null);
    expect(out.text).toBe('');
    expect(out.sourceMap).toEqual({});
  });

  it('emits a numbered SOURCES block in deterministic order', () => {
    const out = buildNumberedPatientContext(baseSnapshot);
    // First non-header line is the appointment
    const lines = out.text.split('\n');
    expect(lines[0]).toContain('Margaret Chen');
    expect(out.text).toContain('[1] Today\'s visit:');
    expect(out.text).toContain('[2] Problem: Type 2 DM');
    expect(out.text).toContain('[3] Medication: Metformin 500mg');
    expect(out.text).toContain('[4] Allergy: Penicillin');
    expect(out.text).toContain('[5] Lab: HbA1c');
  });

  it('uses P-prefixed keys in the source map to avoid colliding with brief citations', () => {
    const out = buildNumberedPatientContext(baseSnapshot);
    expect(Object.keys(out.sourceMap).every(k => k.startsWith('P'))).toBe(true);
  });

  it('caps labs at 8 to keep the prompt manageable', () => {
    const lots = Array.from({ length: 12 }, (_, i) => ({
      test: `Test${i}`, value: '1', units: '', abnormal: '', date: '2026-01-01',
    }));
    const out = buildNumberedPatientContext({ ...baseSnapshot, labs: lots });
    const labLines = out.text.split('\n').filter(l => l.startsWith('[') && l.includes('Lab:'));
    expect(labLines.length).toBe(8);
  });
});
