import { ExternalLink, X } from 'lucide-react';

import type { BBox, CiteSource, ExtractedResult } from '../types';

const TYPE_LABELS: Record<string, string> = {
  appointment: 'Appointment',
  encounter:   'Encounter',
  medication:  'Prescription',
  lab:         'Lab Result',
  problem:     'Problem',
  allergy:     'Allergy',
  document:    'Document',
  guideline:   'Clinical Guideline',
};

const SCROLL_FLASH_MS = 1400;

interface Props {
  source: CiteSource;
  onClose: () => void;
  width: number | undefined;
  webRoot?: string;       // module public URL (where agent-page.php lives)
                          // e.g. "/interface/modules/custom_modules/oe-module-clinical-copilot/public"
  openemrRoot?: string;   // OpenEMR site root (for the "Open full PDF" link via controller.php)
  pid?: number;           // patient id for the OpenEMR document URL
  docId?: number;         // OpenEMR document id for bbox-overlay page-image fetches
  citedText?: string;     // exact phrase the user clicked, used to target the right bbox
}

// Score every extracted result against the cited phrase and return the
// highest-scoring one. A first-match-wins approach was wrong for lab
// panels: clicking "Triglycerides: 178 mg/dL" matched on the token
// "mg/dl" against the FIRST result (Total Cholesterol), since every lab
// value contains "mg/dL". Scoring lets the more-specific token "178"
// beat the noise so Triglycerides wins.
//
// Scoring (per result):
//   +100  full phrase appears in value or quote
//   +20   per cited token in value or quote
//   +10   per cited token in label (label match counts but less)
//   +5    bonus for any result with a bbox (so we prefer something we
//         can highlight when scores are otherwise tied)
//
// Tokens are length-3+ and stripped of leading/trailing punctuation
// ("Triglycerides:" → "Triglycerides").
function _matchResult(
  results: ExtractedResult[] | undefined,
  citedText: string,
): ExtractedResult | null {
  if (!results || results.length === 0) return null;
  const phrase = citedText.trim().toLowerCase();
  if (!phrase) return results.find(r => r.bbox) ?? null;

  const norm = (s: string | null | undefined) => (s ?? '').toLowerCase();
  const tokens = phrase.split(/\s+/)
    .map(t => t.replace(/^[^\w]+|[^\w/%]+$/g, ''))
    .filter(t => t.length >= 3);

  let best: ExtractedResult | null = null;
  let bestScore = 0;
  for (const r of results) {
    const v = norm(r.value);
    const q = norm(r.quote);
    const l = norm(r.label);
    let score = 0;
    if (v.includes(phrase) || q.includes(phrase)) score += 100;
    for (const t of tokens) {
      if (v.includes(t) || q.includes(t)) score += 20;
      if (l.includes(t)) score += 10;
    }
    if (r.bbox && score > 0) score += 5;
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  if (best) return best;
  return results.find(r => r.bbox) ?? null;
}

// Build the agent-page.php URL. When bbox is supplied, request a cropped
// region with the highlight baked in by the sidecar — much more legible
// at the drawer's typical width than scaling a full page in CSS.
function _pageImageUrl(
  webRoot: string,
  docId: number,
  pageNum: number,
  bbox: BBox | null,
): string {
  const base = `${webRoot}/agent-page.php?doc_id=${docId}&page=${pageNum}`;
  if (!bbox) return base;
  const params = new URLSearchParams({
    x0: bbox.x0.toString(),
    y0: bbox.y0.toString(),
    x1: bbox.x1.toString(),
    y1: bbox.y1.toString(),
    pw: bbox.page_width.toString(),
    ph: bbox.page_height.toString(),
  });
  return `${base}&${params}`;
}

// OpenEMR document download URL — opens the full PDF in a new tab.
// openemrRoot is "" when OpenEMR is mounted at the domain root, so we check
// undefined explicitly rather than truthiness — empty string is valid.
function _fullDocUrl(
  openemrRoot: string | undefined,
  pid: number | undefined,
  docId: number,
): string | null {
  if (openemrRoot === undefined || !pid) return null;
  return `${openemrRoot}/controller.php?document&retrieve&patient_id=${pid}&document_id=${docId}&as_file=false`;
}

export function SourceDrawer({
  source, onClose, width, webRoot, openemrRoot, pid, docId, citedText = '',
}: Props) {
  // When we have a specific match for the cited text inside the document's
  // extracted fields, the chip should describe THAT field (Lab Result,
  // Medication, Allergy) — not the parent document. Clicking
  // "Triglycerides: 178 mg/dL" should show "Lab Result", not "Document".
  const featuredItem = _matchResult(source.extracted_results, citedText);
  const effectiveType = featuredItem?.kind ?? source.type;
  const typeLabel = TYPE_LABELS[effectiveType] ?? effectiveType;
  const headerLabel = featuredItem
    ? (featuredItem.label.replace(/^[A-Za-z ]+:\s*/, '') || source.label)
    : source.label;

  // OpenEMR uses jQuery + Bootstrap collapse for its expandable cards.
  // If the section we're scrolling into is currently collapsed, expand it
  // first so the highlight is actually visible.
  // OpenEMR uses jQuery + Bootstrap collapse for its expandable cards.
  // If the section we're scrolling into is currently collapsed, expand
  // it first so the highlight is actually visible. For the new React
  // patient-dashboard cards, scroll_to points at a specific row id
  // (e.g. `#card-allergies-row-penicillin`) so the highlight lands on
  // the matching row instead of the entire card container.
  const handleScrollTo = (): void => {
    if (!source.scroll_to) return;
    const el = document.querySelector<HTMLElement>(source.scroll_to);
    if (!el) return;
    const jq = (window as unknown as Record<string, unknown>).$;
    if (typeof jq === 'function') {
      const $el = (jq as CallableFunction)(el);
      if ($el.hasClass('collapse') && !$el.hasClass('show')) $el.collapse('show');
    }
    setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('copilot-scroll-flash');
      setTimeout(() => el.classList.remove('copilot-scroll-flash'), SCROLL_FLASH_MS);
    }, 50);
  };

  return (
    <div className="copilot-drawer" style={{ width }}>
      <div className="copilot-drawer-header">
        <div>
          <span className={`copilot-drawer-type copilot-drawer-type-${effectiveType}`}>{typeLabel}</span>
          <span className="copilot-drawer-label">{headerLabel}</span>
        </div>
        <button className="copilot-drawer-close" onClick={onClose} title="Close"><X size={14} /></button>
      </div>
      <div className="copilot-drawer-body">
        {/* DB info first — what the chart actually says, in plain text.
            When we can match the cited phrase to one specific extracted
            field, we show only that field. Otherwise (top-level [[DN]]
            click that names the document itself, or no good match) we
            fall back to the full extraction list as a doc-level overview. */}
        {source.extracted_results && source.extracted_results.length > 0 && (() => {
          const items = featuredItem ? [featuredItem] : source.extracted_results;
          const label = featuredItem
            ? 'Cited from this document'
            : 'Extracted from this document';
          return (
            <>
              <p className="copilot-drawer-section-label">{label}</p>
              <ul className="copilot-drawer-quotes">
                {items.map((r, i) => (
                  <li key={i} className="copilot-drawer-quote-item">
                    <div className="copilot-drawer-quote-row">
                      <span className="copilot-drawer-quote-label">{r.label}</span>
                      {r.value && <span className="copilot-drawer-quote-value">{r.value}</span>}
                      {r.abnormal && r.abnormal !== 'N' && (
                        <span className="copilot-drawer-quote-flag">{r.abnormal}</span>
                      )}
                      {r.page && <span className="copilot-drawer-quote-page">{r.page}</span>}
                    </div>
                    {r.quote && (
                      <blockquote className="copilot-drawer-quote-text">
                        &ldquo;{r.quote}&rdquo;
                      </blockquote>
                    )}
                  </li>
                ))}
              </ul>
            </>
          );
        })()}
        {!(source.extracted_results && source.extracted_results.length > 0) && (
          source.fields?.length > 0 ? (
            <table className="copilot-drawer-table">
              <tbody>
                {source.fields.map((f, i) => (
                  <tr key={i}>
                    <td className="copilot-drawer-key">{f.key}</td>
                    <td className="copilot-drawer-val">{f.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="copilot-drawer-empty">No record details available.</p>
          )
        )}

        {/* Cropped PDF region with the cited area highlighted. The sidecar
            crops + draws the yellow rect server-side so the image stays
            legible at any drawer width and we don't need a JS overlay.
            The "Open full PDF" link renders independently — even when we
            don't have bbox/page for the inline crop, knowing the doc id
            is enough to let the doctor pop the original. */}
        {(() => {
          const linkBbox = source.source_link?.bbox ?? null;
          const linkDocId = source.source_link?.doc_id;

          const bbox: BBox | null = featuredItem?.bbox ?? linkBbox ?? null;
          const activeDocId = featuredItem?.bbox ? docId : (linkDocId ?? docId);
          const label = featuredItem?.label ?? source.label;
          const value = featuredItem?.value ?? '';
          const pageNum = bbox?.page ?? source.source_link?.page ?? null;

          const fullPdfUrl = source.doc_url
            ?? (activeDocId ? _fullDocUrl(openemrRoot, pid, activeDocId) : null);
          const canShowImage = webRoot && activeDocId && pageNum;

          if (!canShowImage && !fullPdfUrl) return null;

          return (
            <div className="copilot-bbox-section">
              {canShowImage && (
                <>
                  <p className="copilot-drawer-section-label">
                    {citedText ? <>Source · &ldquo;{citedText}&rdquo; · page {pageNum}</>
                               : <>Source · page {pageNum}</>}
                  </p>
                  <div className="copilot-bbox-page">
                    <img
                      src={_pageImageUrl(webRoot!, activeDocId!, pageNum!, bbox)}
                      alt={`Page ${pageNum} excerpt`}
                    />
                  </div>
                  <p className="copilot-bbox-caption">
                    {bbox
                      ? <>Yellow box: <strong>{label}</strong>{value && <> = <code>{value}</code></>}</>
                      : <>Source page (no field-level coordinates for this entry)</>}
                  </p>
                </>
              )}
              {fullPdfUrl && (
                <a
                  href={fullPdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="copilot-drawer-link copilot-drawer-link-inline"
                >
                  <ExternalLink size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                  Open full PDF in new tab
                </a>
              )}
            </div>
          );
        })()}
      </div>
      <div className="copilot-drawer-footer">
        {source.scroll_to && (
          <button className="copilot-drawer-link" onClick={handleScrollTo}>View in chart ↓</button>
        )}
      </div>
    </div>
  );
}
