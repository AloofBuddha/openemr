// Citation rendering — turns markers like [[N]]phrase[[/N]] into clickable
// <button data-src="N"> elements that the MessageBubble component wires up.
// All pure string transformations.

import { marked } from 'marked';

import type { CiteSource } from './types';

marked.setOptions({ gfm: true, breaks: true });

const CITATION_PAIR_RE = /\[\[([PDG]?\d+)\]\]([\s\S]*?)\[\[\/\1\]\]/g;
const CITATION_TAG_RE  = /\[\[\/?[PDG]?\d+\]\]/g;
const CITE_SPLIT_RE    = /(\[\[[PDG]?\d+\]\][\s\S]*?\[\[\/[PDG]?\d+\]\])/g;

const MIN_AUTO_LINK_PHRASE_LEN = 4;
const SKIP_AUTO_LINK_TYPES     = new Set(['appointment', 'encounter']);
const SKIP_AUTO_LINK_RE        = /^(today|none|no |unknown|not |established)/i;

// ─── Replace explicit [[N]]phrase[[/N]] markers ────────────────────────────

// What kind of evidence backs this citation? Drives the inline color so the
// reader can tell at a glance whether a claim is grounded in a chart row,
// a chart row with PDF proof, or a clinical guideline.
//   db        — chart-only (no source PDF on file)
//   doc-pdf   — chart row OR document citation with a real PDF page to show
//   guideline — clinical-guideline corpus chunk
function _provenanceOf(src: CiteSource | undefined): 'db' | 'doc-pdf' | 'guideline' | null {
  if (!src) return null;  // unknown source — emit no provenance class
  if (src.type === 'guideline') return 'guideline';
  // Document citation ([[DN]]) — extracted_results carry per-value bboxes
  if (src.extracted_results?.some(r => r.bbox)) return 'doc-pdf';
  // Chart row ([[PN]]) — source_link carries the join from copilot_source_links
  if (src.source_link?.bbox) return 'doc-pdf';
  // Chart row with doc reference but no bbox: still has page-image proof
  if (src.source_link?.doc_id) return 'doc-pdf';
  return 'db';
}

export function replaceCites(
  text: string,
  sources: Record<string, CiteSource>,
  debug: boolean = false,
): string {
  return text.replace(CITATION_PAIR_RE, (_, idx, inner) => {
    const src = sources[idx];
    const typeClass = src ? ` copilot-cite-${src.type}` : '';
    const prov = _provenanceOf(src);
    const provClass = prov ? ` copilot-cite-prov-${prov}` : '';
    // In debug mode, prefix the citation with its raw key so engineers can
    // tell at a glance which namespace fired ([[3]] vs [[P3]] vs [[D1]] vs [[G2]])
    // and whether the source map actually has that key.
    const debugBadge = debug
      ? `<span class="copilot-cite-debug${src ? '' : ' copilot-cite-debug-miss'}">[[${idx}]]</span>`
      : '';
    return `<button class="copilot-cite-text${typeClass}${provClass}" data-src="${idx}">${debugBadge}${replaceCites(inner, sources, debug)}</button>`;
  });
}

// ─── Auto-link known phrases the model didn't cite explicitly ──────────────

// Build (phrase, sourceKey) candidates from the sources map. Returned
// longest-first so "Metformin 500mg" matches before bare "Metformin".
export function buildPhraseMap(
  sources: Record<string, CiteSource>,
): Array<[string, string]> {
  const seen = new Set<string>();
  const candidates: Array<[string, string]> = [];

  const add = (phrase: string, key: string): void => {
    const norm = phrase.toLowerCase().trim();
    if (norm.length < MIN_AUTO_LINK_PHRASE_LEN || seen.has(norm)) return;
    seen.add(norm);
    candidates.push([phrase, key]);
  };

  for (const [key, src] of Object.entries(sources)) {
    if (SKIP_AUTO_LINK_TYPES.has(src.type)) continue;
    const label = (src.label ?? '').trim();
    if (!label || SKIP_AUTO_LINK_RE.test(label)) continue;

    add(label, key);

    if (src.type === 'medication') {
      // "Metformin 500mg" → also match bare "Metformin"
      const drugOnly = label.split(/\s+\d/)[0].trim();
      if (drugOnly !== label) add(drugOnly, key);
    } else if (src.type === 'lab') {
      // "Total Cholesterol: 240 mg/dL" → also match "Total Cholesterol"
      const testOnly = label.split(':')[0].trim();
      if (testOnly !== label) add(testOnly, key);
    } else if (src.type === 'problem') {
      // "Type 2 DM (E11.9)" → also match "Type 2 DM"
      const titleOnly = label.replace(/\s*\(.*?\)/, '').trim();
      if (titleOnly !== label) add(titleOnly, key);
    }
  }

  return candidates.sort((a, b) => b[0].length - a[0].length);
}

// Wrap known phrases in [[key]]…[[/key]] markers, but only inside text
// segments that aren't already inside an existing citation. One auto-link
// per source key to avoid clutter.
export function autoLinkPhrases(
  text: string,
  phraseMap: Array<[string, string]>,
): string {
  if (phraseMap.length === 0) return text;

  const parts = text.split(CITE_SPLIT_RE);
  const usedKeys = new Set<string>();

  return parts.map((part, i) => {
    if (i % 2 === 1) return part; // already inside a citation block
    let result = part;
    for (const [phrase, key] of phraseMap) {
      if (usedKeys.has(key)) continue;
      const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`\\b${escaped}\\b`, 'i');
      if (re.test(result)) {
        result = result.replace(re, `[[${key}]]${phrase}[[/${key}]]`);
        usedKeys.add(key);
      }
    }
    return result;
  }).join('');
}

// ─── Public render entry point ─────────────────────────────────────────────

// During streaming, citation tags are stripped (the markers haven't been
// closed yet so partial rendering looks broken). After streaming, we
// auto-link known phrases, render explicit citations, and clean up any
// dangling tags before passing to marked.
export function renderContent(
  content: string,
  isStreaming: boolean,
  sources: Record<string, CiteSource> = {},
  debug: boolean = false,
): string {
  let text = content.replace(/\nSUGGESTIONS:[\s\S]*$/, '').trimEnd();

  if (isStreaming) {
    text = text.replace(CITATION_TAG_RE, '');
  } else {
    text = autoLinkPhrases(text, buildPhraseMap(sources));
    text = replaceCites(text, sources, debug);
    text = text.replace(CITATION_TAG_RE, '');
  }

  return marked.parse(text) as string;
}
