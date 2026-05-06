import { useState } from 'react';
import {
  ChevronDown, ChevronUp, FileText, Plus,
} from 'lucide-react';

import type {
  CiteSource,
  Snapshot,
  SnapshotAllergy,
  SnapshotLab,
  SnapshotMed,
  SnapshotProblem,
} from '../types';
import { formatApptTime } from '../utils';

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
  scroll_to: '#medical_problem_ps_expand',
});

const makeAllergySource = (a: SnapshotAllergy): CiteSource => ({
  type: 'allergy', label: a.title,
  fields: [
    { key: 'Reaction', value: a.reaction },
    { key: 'Severity', value: a.severity },
  ].filter(f => f.value),
  scroll_to: '#allergy_ps_expand',
});

const makeMedSource = (m: SnapshotMed): CiteSource => ({
  type: 'medication', label: `${m.drug} ${m.dosage}`.trim(),
  fields: [
    { key: 'Drug',  value: m.drug },
    { key: 'Dose',  value: m.dosage },
    { key: 'Notes', value: m.note },
  ].filter(f => f.value),
  scroll_to: '#prescriptions_ps_expand',
});

const makeLabSource = (l: SnapshotLab): CiteSource => ({
  type: 'lab', label: `${l.test}: ${l.value} ${l.units}`.trim(),
  fields: [
    { key: 'Result',    value: `${l.value} ${l.units}`.trim() },
    { key: 'Flag',      value: l.abnormal || 'Within range' },
    { key: 'Collected', value: l.date },
  ].filter(f => f.value),
  scroll_to: '#labdata_ps_expand',
});

export function PatientSnapshot({
  snapshot, compact, onOpenSource, onOpenUpload, webRoot, pid, labsFlash,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const { patient, appointment, problems, medications, allergies, labs, documents } = snapshot;

  const sortedLabs = [...labs].sort((a, b) =>
    (LAB_FLAG_ORDER[a.abnormal ?? ''] ?? 1) - (LAB_FLAG_ORDER[b.abnormal ?? ''] ?? 1)
  );

  const chipClick = (src: CiteSource): void => onOpenSource?.(src);
  const reasonText = appointment?.reason ?? '';

  return (
    <div className={`copilot-snapshot${compact ? ' copilot-snapshot-compact' : ''}`}>
      <div className="copilot-snapshot-identity" onClick={() => setExpanded(e => !e)} role="button">
        <span className="copilot-snapshot-name">{patient.name}</span>
        <span className="copilot-snapshot-demo">
          {patient.age && `${patient.age}y`}{patient.sex && ` · ${patient.sex}`}
        </span>
        {appointment?.time && (
          <span className="copilot-snapshot-appt-time">{formatApptTime(appointment.time)}</span>
        )}
        {reasonText && !expanded && (
          <span className="copilot-snapshot-visit-reason copilot-snapshot-visit-reason--collapsed" title={reasonText}>
            {reasonText}
          </span>
        )}
        <span className="copilot-snapshot-chevron">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
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
