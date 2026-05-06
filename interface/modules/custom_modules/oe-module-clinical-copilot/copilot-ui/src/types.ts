// Shared types for the Clinical Co-Pilot UI.
// Anything that crosses a component boundary lives here.

export type Status = 'idle' | 'loading' | 'streaming' | 'live' | 'cached' | 'error';

export interface SourceField { key: string; value: string; }
export interface CiteSource {
  type: string;
  label: string;
  fields: SourceField[];
  scroll_to?: string;
  doc_url?: string;
}

export interface SnapshotPatient { name: string; age: string; sex: string; dob: string; }
export interface SnapshotAppt    { time: string; reason: string; }
export interface SnapshotProblem { title: string; icd10: string; since: string; }
export interface SnapshotMed     { drug: string; dosage: string; note: string; }
export interface SnapshotAllergy { title: string; reaction: string; severity: string; }
export interface SnapshotLab     { test: string; value: string; units: string; abnormal: string; date: string; }
export interface SnapshotDoc     { id: number; name: string; date: string; }

export interface Snapshot {
  patient:     SnapshotPatient;
  appointment: SnapshotAppt | null;
  problems:    SnapshotProblem[];
  medications: SnapshotMed[];
  allergies:   SnapshotAllergy[];
  labs:        SnapshotLab[];
  documents:   SnapshotDoc[];
}

export interface LabResultItem {
  test_name: string;
  value: string;
  unit?: string;
  reference_range?: string;
  abnormal_flag?: string | null;
}

export interface ExtractionSummary {
  doc_type: string;
  results?: LabResultItem[];
  chief_concern?: string;
  current_medications?: Array<{ name?: string; dose?: string; frequency?: string }>;
  extraction_warnings?: string[];
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  suggestions?: string[];
  hidden?: boolean;
  isStreaming?: boolean;
  isError?: boolean;
  retryText?: string;
}

export interface CachedConvo {
  messages: Message[];
  sources: Record<string, CiteSource>;
  snapshot?: Snapshot;
}

export type DocCategory = { id: number; name: string };

export interface CopilotPanelProps {
  pid: number;
  apiUrl: string;
  csrfToken: string;
  physicianId: number;
  webRoot: string;
  categories: DocCategory[];
}
