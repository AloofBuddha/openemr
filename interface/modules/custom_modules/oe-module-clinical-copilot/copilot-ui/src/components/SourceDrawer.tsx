import { useEffect, useMemo, useRef, useState } from 'react';
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
  webRoot?: string;  // e.g. "/interface/modules/custom_modules/oe-module-clinical-copilot/public"
  docId?: number;    // OpenEMR document id for bbox-overlay page-image fetches
  citedText?: string; // exact phrase the user clicked, used to target the right bbox
}

// Pick the result whose value (or quote, or label) best matches the phrase
// the user clicked. This is what makes the bbox feel like proof: when you
// click [[D1]]232 mg/dL[[/D1]], the yellow rect lands on "232 mg/dL"
// specifically — not on whatever happens to be the first extracted item.
//
// Order of preference:
//   1. value contains the cited number/word (covers "232 mg/dL" → "232")
//   2. quote substring match
//   3. label match (e.g. "Hemoglobin A1c")
//   4. first result with a bbox (graceful fallback for top-level [[D1]] clicks)
function _matchResult(
  results: ExtractedResult[] | undefined,
  citedText: string,
): ExtractedResult | null {
  if (!results || results.length === 0) return null;
  const phrase = citedText.trim().toLowerCase();
  if (phrase) {
    const norm = (s: string | null | undefined) => (s ?? '').toLowerCase();
    const tokens = phrase.split(/\s+/).filter(t => t.length >= 2);

    // Strict match: cited phrase appears in the result value or quote.
    for (const r of results) {
      if (r.bbox && (norm(r.value).includes(phrase) || norm(r.quote).includes(phrase))) {
        return r;
      }
    }
    // Token-level: at least one substantive cited word is in the value.
    for (const r of results) {
      if (r.bbox && tokens.some(t => norm(r.value).includes(t) || norm(r.quote).includes(t))) {
        return r;
      }
    }
    // Label match: e.g. user clicked "Hemoglobin A1c" with no number.
    for (const r of results) {
      if (r.bbox && norm(r.label).includes(phrase)) return r;
    }
  }
  return results.find(r => r.bbox) ?? null;
}

interface OverlayProps {
  bbox: BBox;
  imgSrc: string;
}

// Renders the page PNG at its natural size and overlays a yellow rect
// scaled to match. PDF coords are bottom-origin in points, image is
// top-origin in pixels — we flip y at render time.
function PageOverlay({ bbox, imgSrc }: OverlayProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    setLoaded(false);
    setImgSize(null);
  }, [imgSrc]);

  const overlayStyle = useMemo(() => {
    if (!loaded || !imgSize) return null;
    // PDF coords are in points; the PNG is rendered at 150 DPI.
    // Both axes scale by (image_pixels / pdf_points).
    const sx = imgSize.w / bbox.page_width;
    const sy = imgSize.h / bbox.page_height;
    const left = bbox.x0 * sx;
    const width = (bbox.x1 - bbox.x0) * sx;
    // Flip y: PDF origin is bottom-left, canvas is top-left.
    const top = (bbox.page_height - bbox.y1) * sy;
    const height = (bbox.y1 - bbox.y0) * sy;
    return {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
    };
  }, [loaded, imgSize, bbox]);

  return (
    <div className="copilot-bbox-page">
      <img
        ref={imgRef}
        src={imgSrc}
        alt={`Page ${bbox.page}`}
        onLoad={() => {
          const el = imgRef.current;
          if (el) {
            setImgSize({ w: el.clientWidth, h: el.clientHeight });
            setLoaded(true);
          }
        }}
      />
      {overlayStyle && <div className="copilot-bbox-rect" style={overlayStyle} />}
    </div>
  );
}

export function SourceDrawer({ source, onClose, width, webRoot, docId, citedText = '' }: Props) {
  const typeLabel = TYPE_LABELS[source.type] ?? source.type;

  // OpenEMR uses jQuery + Bootstrap collapse for its expandable cards.
  // If the section we're scrolling into is currently collapsed, expand it
  // first so the highlight is actually visible.
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
      const target = el.closest<HTMLElement>('.card') ?? el;
      target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      target.classList.add('copilot-scroll-flash');
      setTimeout(() => target.classList.remove('copilot-scroll-flash'), SCROLL_FLASH_MS);
    }, 50);
  };

  return (
    <div className="copilot-drawer" style={{ width }}>
      <div className="copilot-drawer-header">
        <div>
          <span className={`copilot-drawer-type copilot-drawer-type-${source.type}`}>{typeLabel}</span>
          <span className="copilot-drawer-label">{source.label}</span>
        </div>
        <button className="copilot-drawer-close" onClick={onClose} title="Close"><X size={14} /></button>
      </div>
      <div className="copilot-drawer-body">
        {(() => {
          // Two paths into the bbox panel:
          // 1) [[DN]] clicks: source has extracted_results — pick the one
          //    whose value matches the cited phrase.
          // 2) [[PN]] clicks on chart rows that came from an intake doc:
          //    source has a source_link populated by the brief tool's
          //    JOIN against copilot_source_links.
          const featured = _matchResult(source.extracted_results, citedText);
          const linkBbox = source.source_link?.bbox ?? null;
          const linkDocId = source.source_link?.doc_id;

          let bbox = featured?.bbox ?? linkBbox ?? null;
          let activeDocId = featured?.bbox ? docId : (linkDocId ?? docId);
          let label = featured?.label ?? source.label;
          let value = featured?.value ?? '';
          let pageNum = bbox?.page ?? source.source_link?.page ?? null;

          // No bbox but we DO have a doc reference (e.g. PMH entry: doc-level
          // link, no per-field coords). Still render the page image so the
          // physician can scan for the value visually.
          const hasAnyDocRef = bbox || (linkDocId && pageNum);

          if (!hasAnyDocRef || !webRoot || !activeDocId) return null;
          const imgSrc = `${webRoot}/agent-page.php?doc_id=${activeDocId}&page=${pageNum}`;
          return (
            <div className="copilot-bbox-section">
              <p className="copilot-drawer-section-label">
                {citedText ? <>Source · &ldquo;{citedText}&rdquo; · page {pageNum}</>
                           : <>Source · page {pageNum}</>}
              </p>
              {bbox
                ? <PageOverlay bbox={bbox} imgSrc={imgSrc} />
                : <div className="copilot-bbox-page"><img src={imgSrc} alt={`Page ${pageNum}`} /></div>}
              <p className="copilot-bbox-caption">
                {bbox
                  ? <>Yellow box: <strong>{label}</strong>{value && <> = <code>{value}</code></>}</>
                  : <>Source page (no field-level coordinates for this entry)</>}
              </p>
            </div>
          );
        })()}
        {source.extracted_results && source.extracted_results.length > 0 ? (
          <>
            <p className="copilot-drawer-section-label">Extracted from this document</p>
            <ul className="copilot-drawer-quotes">
              {source.extracted_results.map((r, i) => (
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
        ) : source.fields?.length > 0 ? (
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
        )}
      </div>
      <div className="copilot-drawer-footer">
        {source.doc_url && (
          <a
            href={source.doc_url}
            target="_blank"
            rel="noopener noreferrer"
            className="copilot-drawer-link"
          >
            <ExternalLink size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            View source document
          </a>
        )}
        {source.scroll_to && (
          <button className="copilot-drawer-link" onClick={handleScrollTo}>View in chart ↓</button>
        )}
      </div>
    </div>
  );
}
