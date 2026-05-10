import {
  FileText, Plus,
} from 'lucide-react';

import type { CiteSource, Snapshot } from '../types';
import { _formatVitals, formatApptTime } from '../utils';

const LAB_FLAG_ORDER: Record<string, number> = { H: 0, '': 1, L: 2 };

interface Props {
  snapshot: Snapshot;
  compact: boolean;
  onOpenSource?: (src: CiteSource) => void;
  onOpenUpload: () => void;
  webRoot: string;
  pid: number;
  labsFlash?: boolean;
}

// Slug a label into a row id matching the React dashboard's card row
// IDs (e.g. "Penicillin" -> "penicillin", "Type 2 Diabetes" -> "type-2-diabetes").
// Must stay byte-for-byte identical to the slug() in
// dashboard-ui/src/lib/format.ts and PatientContextBuilder.php; the
// three encodings have to agree.
const slug = (s: string): string =>
  (s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const SCROLL_FLASH_MS = 1400;

// Try exact match first, then prefix match. Snapshot/PHP slug from
// the drug name ("Aspirin (baby)") while the card slug includes the
// dose ("aspirin-baby-81-mg") in some intake-form-derived rows;
// prefix match closes that gap.
const scrollToCardRow = (selector: string): void => {
  if (!selector) return;
  let el = document.querySelector<HTMLElement>(selector);
  if (!el && selector.startsWith('#')) {
    const idPrefix = selector.slice(1);
    el = document.querySelector<HTMLElement>(`[id^="${CSS.escape(idPrefix)}-"]`)
      ?? document.querySelector<HTMLElement>(`[id^="${CSS.escape(idPrefix)}"]`);
  }
  if (!el) {
    console.log('[copilot] scroll target not found for selector:', selector);
    return;
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('copilot-scroll-flash');
  setTimeout(() => el.classList.remove('copilot-scroll-flash'), SCROLL_FLASH_MS);
};

export function PatientSnapshot({
  snapshot, compact, onOpenSource, onOpenUpload, webRoot, pid, labsFlash,
}: Props) {
  // Always-expanded — the snapshot now serves as the persistent
  // patient header (PRD deliverable) instead of a collapsible drawer.
  const expanded = true;
  const { patient, appointment, problems, medications, allergies, labs, documents, vitals } = snapshot;

  const sortedLabs = [...labs].sort((a, b) =>
    (LAB_FLAG_ORDER[a.abnormal ?? ''] ?? 1) - (LAB_FLAG_ORDER[b.abnormal ?? ''] ?? 1)
  );

  // Chips in the identity bar now scroll to + flash the matching row
  // in the React dashboard cards, instead of opening the source drawer.
  // The drawer remains for citation chips inside chat messages.
  const goTo = (selector: string): void => scrollToCardRow(selector);
  const reasonText = appointment?.reason ?? '';

  return (
    <div className={`copilot-snapshot${compact ? ' copilot-snapshot-compact' : ''}`}>
      <div className="copilot-snapshot-identity">
        <span className="copilot-snapshot-name">{patient.name}</span>
        {patient.active === false ? (
          <span className="copilot-snapshot-status copilot-snapshot-status--inactive">Inactive</span>
        ) : (
          <span className="copilot-snapshot-status copilot-snapshot-status--active">Active</span>
        )}
        <span className="copilot-snapshot-demo">
          {patient.dob && `DOB ${patient.dob}`}
          {patient.age && ` · ${patient.age}y`}
          {patient.sex && ` · ${patient.sex}`}
          {patient.mrn && ` · MRN ${patient.mrn}`}
        </span>
        {appointment?.time && (
          <span className="copilot-snapshot-appt-time">{formatApptTime(appointment.time)}</span>
        )}
      </div>

      {expanded && <>
        {reasonText && (
          <div className="copilot-snapshot-visit-reason copilot-snapshot-visit-reason--expanded">
            {reasonText}
          </div>
        )}

        {problems.length > 0 && (
          <div className="copilot-snapshot-row">
            <span className="copilot-snapshot-label copilot-label-problem">Problems</span>
            <div className="copilot-snapshot-chips">
              {problems.map((p, i) => (
                <span key={i}
                  className="copilot-snapshot-chip copilot-chip-problem copilot-chip-clickable"
                  title={p.icd10 || undefined}
                  onClick={() => goTo(`#card-problems-row-${slug(p.title)}`)}>
                  {p.title}
                </span>
              ))}
            </div>
          </div>
        )}

        {vitals && _formatVitals(vitals).length > 0 && (
          <div
            className="copilot-snapshot-row copilot-chip-clickable"
            onClick={() => goTo('#card-encounters')}
            role="button"
            title="View vitals detail"
          >
            <span className="copilot-snapshot-label copilot-label-vital">Vitals</span>
            <div className="copilot-snapshot-chips">
              {_formatVitals(vitals).map((part, i) => (
                <span key={i} className="copilot-snapshot-chip copilot-chip-vital">{part}</span>
              ))}
            </div>
          </div>
        )}

        <div className="copilot-snapshot-row">
          <span className="copilot-snapshot-label copilot-label-allergy">Allergies</span>
          <div className="copilot-snapshot-chips">
            {allergies.length > 0
              ? allergies.map((a, i) => (
                  <span key={i}
                    className="copilot-snapshot-chip copilot-chip-allergy copilot-chip-clickable"
                    onClick={() => goTo(`#card-allergies-row-${slug(a.title)}`)}>
                    {a.title}
                  </span>
                ))
              : <span className="copilot-snapshot-chip copilot-chip-none">None documented</span>
            }
          </div>
        </div>

        <div className="copilot-snapshot-row">
          <span className="copilot-snapshot-label copilot-label-med">Meds</span>
          <div className="copilot-snapshot-chips">
            {medications.length > 0
              ? medications.map((m, i) => (
                  <span key={i}
                    className="copilot-snapshot-chip copilot-chip-med copilot-chip-clickable"
                    onClick={() => goTo(`#card-medications-row-${slug(m.drug)}`)}>
                    {m.drug} {m.dosage}
                  </span>
                ))
              : <span className="copilot-snapshot-chip copilot-chip-none">None on file</span>
            }
          </div>
        </div>

        {sortedLabs.length > 0 && (
          <div className={`copilot-snapshot-row${labsFlash ? ' copilot-lab-flash' : ''}`}>
            <span className="copilot-snapshot-label copilot-label-lab">Labs</span>
            <div className="copilot-snapshot-chips">
              {sortedLabs.map((l, i) => {
                const flag = (l.abnormal ?? '').toUpperCase();
                const cls = flag === 'H' ? 'copilot-chip-lab-h'
                          : flag === 'L' ? 'copilot-chip-lab-l'
                          : 'copilot-chip-lab-n';
                return (
                  <span key={i}
                    className={`copilot-snapshot-chip ${cls} copilot-chip-clickable`}
                    onClick={() => goTo('#card-encounters')}
                    title={`Collected ${l.date}`}>
                    {l.test} {l.value}{l.units}
                    {flag && <span className="copilot-chip-flag">{flag}</span>}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        <div className="copilot-snapshot-row">
          <span className="copilot-snapshot-label copilot-label-doc">Docs</span>
          <div className="copilot-snapshot-chips">
            {documents.map((d, i) => (
              <span key={i}
                className="copilot-snapshot-chip copilot-chip-doc copilot-chip-clickable"
                onClick={() => {
                  const url = `${webRoot}/controller.php?document&retrieve&patient_id=${pid}&document_id=${d.id}&as_file=false`;
                  window.open(url, '_blank');
                }}
                title={d.date || undefined}>
                <FileText size={11} style={{ marginRight: 3, verticalAlign: 'middle' }} />
                {d.name}
              </span>
            ))}
            <button
              className="copilot-snapshot-chip copilot-chip-add"
              title="Upload document"
              onClick={(e) => { e.stopPropagation(); onOpenUpload(); }}
            >
              <Plus size={12} />
            </button>
          </div>
        </div>
      </>}
    </div>
  );
}
