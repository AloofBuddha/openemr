import { ExternalLink, X } from 'lucide-react';

import type { CiteSource } from '../types';

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
}

export function SourceDrawer({ source, onClose, width }: Props) {
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
        {source.fields?.length > 0 ? (
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
