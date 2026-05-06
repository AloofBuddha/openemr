import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Check, FileText, FlaskConical, Loader2, Upload, X, XCircle,
} from 'lucide-react';

import type {
  DocCategory,
  ExtractionSummary,
  SnapshotDoc,
} from '../types';
import { uid } from '../utils';

interface UploadedFile {
  fid: string;
  name: string;
  size: string;
  status: 'uploading' | 'done' | 'error';
  error?: string;
  extraction?: ExtractionSummary | null;
}

type DocType = 'lab_pdf' | 'intake_form' | 'other';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  uploadUrl: string;
  csrfToken: string;
  categories: DocCategory[];
  pid: number;
  onUploaded: (doc: SnapshotDoc, extraction: ExtractionSummary | null) => void;
}

export function UploadModal({
  open, onOpenChange, uploadUrl, csrfToken, categories: _categories, pid: _pid, onUploaded,
}: Props) {
  const [files, setFiles]       = useState<UploadedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [docType, setDocType]   = useState<DocType>('lab_pdf');
  const fileInputRef            = useRef<HTMLInputElement>(null);

  // Map UI doc type → backend category_id for storage classification.
  // lab_pdf → "Lab Report" (2), intake_form → "Medical Record" (3), other → general (1)
  const categoryId = docType === 'lab_pdf' ? 2 : docType === 'intake_form' ? 3 : 1;

  useEffect(() => {
    if (!open) setFiles([]);
  }, [open]);

  const uploadFile = async (file: File): Promise<void> => {
    const fid = uid();
    setFiles(prev => [...prev, {
      fid,
      name: file.name,
      size: file.size > 1024 * 1024
        ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
        : `${Math.round(file.size / 1024)} KB`,
      status: 'uploading',
    }]);

    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('pid', String(_pid));
      fd.append('csrf_token_form', csrfToken);
      fd.append('category_id', String(categoryId));
      fd.append('doc_type', docType);

      const res  = await fetch(uploadUrl, { method: 'POST', body: fd, credentials: 'same-origin' });
      const text = await res.text();
      if (res.status === 401) throw new Error('Session expired — please refresh the page.');
      let json: { id?: number; name?: string; date?: string; error?: string; extraction?: ExtractionSummary | null };
      try { json = JSON.parse(text); } catch { throw new Error('Unexpected server response.'); }

      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);

      const extraction = json.extraction ?? null;
      onUploaded({ id: json.id!, name: json.name!, date: json.date! }, extraction);
      setFiles(prev => prev.map(f => f.fid === fid ? { ...f, status: 'done', extraction } : f));
    } catch (err) {
      setFiles(prev => prev.map(f =>
        f.fid === fid ? { ...f, status: 'error', error: (err as Error).message } : f
      ));
    }
  };

  const handleFiles = (raw: FileList | null): void => {
    if (!raw) return;
    Array.from(raw).forEach(f => uploadFile(f));
  };

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="copilot-modal-overlay" />
        <Dialog.Content className="copilot-modal-content">
          <div className="copilot-modal-header">
            <Dialog.Title className="copilot-modal-title">Upload Document</Dialog.Title>
            <Dialog.Close asChild>
              <button className="copilot-modal-close"><X size={16} /></button>
            </Dialog.Close>
          </div>

          <div className="copilot-modal-category">
            <label className="copilot-modal-category-label">Document Type</label>
            <div className="copilot-doctype-toggle">
              <button
                type="button"
                className={`copilot-doctype-btn${docType === 'lab_pdf' ? ' active' : ''}`}
                onClick={() => setDocType('lab_pdf')}
              >Lab Report</button>
              <button
                type="button"
                className={`copilot-doctype-btn${docType === 'intake_form' ? ' active' : ''}`}
                onClick={() => setDocType('intake_form')}
              >Intake Form</button>
              <button
                type="button"
                className={`copilot-doctype-btn${docType === 'other' ? ' active' : ''}`}
                onClick={() => setDocType('other')}
              >Other</button>
            </div>
          </div>

          <div
            className={`copilot-dropzone${dragOver ? ' drag-over' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              multiple
              style={{ display: 'none' }}
              onChange={e => handleFiles(e.target.files)}
            />
            <Upload size={28} className="copilot-dropzone-icon" />
            <span className="copilot-dropzone-text">Drop files here or click to browse</span>
            <span className="copilot-dropzone-sub">PDF, PNG, JPG · max 10 MB each</span>
          </div>

          {files.length > 0 && (
            <ul className="copilot-file-list">
              {files.map((f, i) => (
                <li key={i} className={`copilot-file-item copilot-file-${f.status}`}>
                  <div className="copilot-file-row">
                    <span className="copilot-file-icon">
                      {f.status === 'done'  ? <Check size={13} />
                     : f.status === 'error' ? <XCircle size={13} />
                     : <Loader2 size={13} className="copilot-spin" />}
                    </span>
                    <span className="copilot-file-name" title={f.name}>{f.name}</span>
                    <span className="copilot-file-size">{f.error ?? f.size}</span>
                  </div>
                  {f.status === 'done' && f.extraction && (
                    <ExtractionPreview extraction={f.extraction} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Extraction preview shown beneath each completed upload ────────────────

function ExtractionPreview({ extraction }: { extraction: ExtractionSummary }) {
  if (extraction.doc_type === 'lab_pdf' && extraction.results && extraction.results.length > 0) {
    const shown  = extraction.results.slice(0, 5);
    const hidden = extraction.results.length - shown.length;
    return (
      <div className="copilot-extraction">
        <div className="copilot-extraction-title">
          <FlaskConical size={11} /> Extracted {extraction.results.length} result{extraction.results.length !== 1 ? 's' : ''}
        </div>
        <table className="copilot-extraction-table">
          <tbody>
            {shown.map((r, i) => {
              const flag = r.abnormal_flag ?? '';
              return (
                <tr key={i} className={flag ? 'copilot-extraction-abnormal' : ''}>
                  <td className="copilot-extraction-test">{r.test_name}</td>
                  <td className="copilot-extraction-val">{r.value} {r.unit ?? ''}</td>
                  {flag && <td className="copilot-extraction-flag">{flag}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
        {hidden > 0 && <div className="copilot-extraction-more">+{hidden} more</div>}
        {extraction.extraction_warnings?.map((w, i) => (
          <div key={i} className="copilot-extraction-warning">{w}</div>
        ))}
      </div>
    );
  }

  if (extraction.doc_type === 'intake_form') {
    return (
      <div className="copilot-extraction">
        <div className="copilot-extraction-title">Intake form extracted</div>
        {extraction.chief_concern && (
          <div className="copilot-extraction-row">
            <span className="copilot-extraction-key">Chief concern</span>
            <span className="copilot-extraction-val">{extraction.chief_concern}</span>
          </div>
        )}
        {extraction.current_medications && extraction.current_medications.length > 0 && (
          <div className="copilot-extraction-row">
            <span className="copilot-extraction-key">Medications</span>
            <span className="copilot-extraction-val">
              {extraction.current_medications.slice(0, 3).map((m, i) => (
                <span key={i}>
                  {m.name}
                  {i < Math.min(extraction.current_medications!.length, 3) - 1 ? ', ' : ''}
                </span>
              ))}
            </span>
          </div>
        )}
        {extraction.extraction_warnings?.map((w, i) => (
          <div key={i} className="copilot-extraction-warning">{w}</div>
        ))}
      </div>
    );
  }

  // "other" or any unrecognised type — show whatever info we have.
  return (
    <div className="copilot-extraction">
      <div className="copilot-extraction-title">
        <FileText size={11} style={{ marginRight: 4 }} />
        {extraction.detected_type
          ? `Stored as: ${extraction.detected_type}`
          : 'Document stored'}
      </div>
      {extraction.summary && (
        <div className="copilot-extraction-row">
          <span className="copilot-extraction-val">{extraction.summary}</span>
        </div>
      )}
      {extraction.extraction_warnings?.map((w, i) => (
        <div key={i} className="copilot-extraction-warning">{w}</div>
      ))}
    </div>
  );
}
