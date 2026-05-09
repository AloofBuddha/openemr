import {
  FileText, Plus,
} from 'lucide-react';

import type {
  CiteSource,
  Snapshot,
  SnapshotAllergy,
  SnapshotLab,
  SnapshotMed,
  SnapshotProblem,
  SnapshotVitals,
} from '../types';
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

// Helpers: turn each snapshot entry into a CiteSource so clicking a chip
// opens the same shelf as clicking a citation in the chat.
const makeProblemSource = (p: SnapshotProblem): CiteSource => ({
  type: 'problem', label: p.title,
  fields: [
    { key: 'ICD-10', value: p.icd10 },
    { key: 'Since',  value: p.since },
  ].filter(f => f.value),
  // Scroll targets are React-dashboard card IDs (rendered by
  // patient-dashboard-bundle inside demographics.php's main column).
  // Legacy targets like #medical_problem_ps_expand are now hidden, so
  // we route everything to the new cards.
  scroll_to: '#card-problems',
});

const makeAllergySource = (a: SnapshotAllergy): CiteSource => ({
  type: 'allergy', label: a.title,
  fields: [
    { key: 'Reaction', value: a.reaction },
    { key: 'Severity', value: a.severity },
  ].filter(f => f.value),
  scroll_to: '#card-allergies',
});

const makeMedSource = (m: SnapshotMed): CiteSource => ({
  type: 'medication', label: `${m.drug} ${m.dosage}`.trim(),
  fields: [
    { key: 'Drug',  value: m.drug },
    { key: 'Dose',  value: m.dosage },
    { key: 'Notes', value: m.note },
  ].filter(f => f.value),
  scroll_to: '#card-medications',
});

const makeVitalsSource = (v: SnapshotVitals): CiteSource => ({
  type: 'vital',
  label: 'Vitals (intake form)',
  fields: _formatVitals(v).map(p => {
    const sp = p.indexOf(' ');
    return sp === -1 ? { key: p, value: '' } : { key: p.slice(0, sp), value: p.slice(sp + 1) };
  }),
  // Vitals card not implemented in dashboard yet — fall back to
  // the encounters card which is the closest visual match.
  scroll_to: '#card-encounters',
});

const makeLabSource = (l: SnapshotLab): CiteSource => ({
  type: 'lab', label: `${l.test}: ${l.value} ${l.units}`.trim(),
  fields: [
    { key: 'Result',    value: `${l.value} ${l.units}`.trim() },
    { key: 'Flag',      value: l.abnormal || 'Within range' },
    { key: 'Collected', value: l.date },
  ].filter(f => f.value),
  // Labs not yet a dedicated card in dashboard — point at encounters.
  scroll_to: '#card-encounters',
});

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

  const chipClick = (src: CiteSource): void => onOpenSource?.(src);
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
                  onClick={() => chipClick(makeProblemSource(p))}>
                  {p.title}
                </span>
              ))}
            </div>
          </div>
        )}

        {vitals && _formatVitals(vitals).length > 0 && (
          <div
            className="copilot-snapshot-row copilot-chip-clickable"
            onClick={() => chipClick(makeVitalsSource(vitals))}
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
                    onClick={() => chipClick(makeAllergySource(a))}>
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
                    onClick={() => chipClick(makeMedSource(m))}>
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
                    onClick={() => chipClick(makeLabSource(l))}
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
