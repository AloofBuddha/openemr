import { describe, expect, it } from 'vitest';

import { autoLinkPhrases, buildPhraseMap, renderContent, replaceCites } from './citations';
import type { CiteSource } from './types';

const med: CiteSource = {
  type: 'medication',
  label: 'Metformin 500mg',
  fields: [{ key: 'Drug', value: 'Metformin' }],
};

const lab: CiteSource = {
  type: 'lab',
  label: 'Total Cholesterol: 240 mg/dL',
  fields: [{ key: 'Result', value: '240 mg/dL' }],
};

const problem: CiteSource = {
  type: 'problem',
  label: 'Type 2 DM (E11.9)',
  fields: [],
};

// ─── replaceCites ──────────────────────────────────────────────────────────

describe('replaceCites', () => {
  it('wraps a single citation in a button with data-src', () => {
    const out = replaceCites('[[P3]]Metformin[[/P3]]', { P3: med });
    expect(out).toContain('data-src="P3"');
    expect(out).toContain('Metformin');
    expect(out).toContain('copilot-cite-medication');
  });

  it('handles multiple distinct citations', () => {
    const out = replaceCites(
      'Patient has [[P3]]Metformin[[/P3]] and [[P4]]Cholesterol[[/P4]].',
      { P3: med, P4: lab },
    );
    expect(out).toContain('data-src="P3"');
    expect(out).toContain('data-src="P4"');
  });

  it('omits the type-specific class when the source key is unknown', () => {
    const out = replaceCites('[[P9]]Mystery[[/P9]]', {});
    expect(out).toContain('data-src="P9"');
    // Base class still applied; only the {type} suffix is missing.
    expect(out).toContain('copilot-cite-text');
    expect(out).toMatch(/class="copilot-cite-text"/);
  });

  it('returns text unchanged when no citation markers are present', () => {
    expect(replaceCites('plain text', {})).toBe('plain text');
  });

  it('handles [[DN]] document citations alongside [[PN]] EHR-record citations', () => {
    const docSrc: CiteSource = {
      type: 'document',
      label: 'Lab pdf',
      fields: [{ key: 'Doc ID', value: '101' }],
      doc_url: '/foo',
    };
    const out = replaceCites(
      'Lab shows [[D1]]A1c 9.2%[[/D1]] in [[P3]]58yo M[[/P3]].',
      { D1: docSrc, P3: med },
    );
    expect(out).toContain('data-src="D1"');
    expect(out).toContain('data-src="P3"');
    expect(out).toContain('copilot-cite-document');
  });
});

// ─── buildPhraseMap ────────────────────────────────────────────────────────

describe('buildPhraseMap', () => {
  it('returns longer phrases first so partial matches do not steal them', () => {
    const map = buildPhraseMap({ P1: med });
    // The full label and the bare drug name should both appear, full one first.
    expect(map[0][0]).toBe('Metformin 500mg');
    expect(map.find(([p]) => p === 'Metformin')).toBeDefined();
  });

  it('skips appointment and encounter types as too generic to auto-link', () => {
    const map = buildPhraseMap({
      P1: { type: 'appointment', label: "Today's appointment", fields: [] },
    });
    expect(map).toEqual([]);
  });

  it('strips ICD parenthetical from problem labels for the bare-name match', () => {
    const map = buildPhraseMap({ P1: problem });
    expect(map.find(([p]) => p === 'Type 2 DM')).toBeDefined();
  });
});

// ─── autoLinkPhrases ───────────────────────────────────────────────────────

describe('autoLinkPhrases', () => {
  it('wraps a known phrase outside an existing citation', () => {
    const phraseMap = buildPhraseMap({ P3: med });
    const out = autoLinkPhrases('Patient takes Metformin daily.', phraseMap);
    expect(out).toContain('[[P3]]Metformin[[/P3]]');
  });

  it('does not wrap phrases that are already inside a citation', () => {
    const phraseMap = buildPhraseMap({ P3: med });
    const input = 'Patient takes [[P3]]Metformin 500mg[[/P3]].';
    const out = autoLinkPhrases(input, phraseMap);
    // The Metformin inside the citation should not be re-wrapped.
    expect(out).toBe(input);
  });

  it('only links each source key once to avoid clutter', () => {
    const phraseMap = buildPhraseMap({ P3: med });
    const out = autoLinkPhrases('Metformin and Metformin again.', phraseMap);
    const matches = out.match(/\[\[P3\]\]/g) ?? [];
    expect(matches.length).toBe(1);
  });
});

// ─── renderContent ─────────────────────────────────────────────────────────

describe('renderContent', () => {
  it('strips citation tags during streaming so half-formed markers do not show', () => {
    const out = renderContent('Half [[P1]]way through', true, { P1: med });
    expect(out).not.toContain('[[P1]]');
  });

  it('drops the trailing SUGGESTIONS block from rendered text', () => {
    const out = renderContent('Real answer.\nSUGGESTIONS: ["a","b"]', false);
    expect(out).not.toContain('SUGGESTIONS');
  });

  it('strips dangling unmatched citation tags after rendering', () => {
    const out = renderContent('Trailing [[P1]] never closed', false, { P1: med });
    expect(out).not.toMatch(/\[\[P1\]\]/);
  });
});
