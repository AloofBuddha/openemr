// Shared types for the Clinical Co-Pilot UI.
// Anything that crosses a component boundary lives here.

export type Status = 'idle' | 'loading' | 'streaming' | 'live' | 'cached' | 'error';

export interface SourceField { key: string; value: string; }
export interface BBox {
  page: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  page_width: number;
  page_height: number;
}

export interface ExtractedResult {
  label: string;          // e.g. "Hemoglobin A1c", "Allergy: Penicillin"
  value: string;          // e.g. "9.2 %", "anaphylaxis"
  abnormal?: string | null; // 'H' | 'L' | 'C' | 'N' for labs
  page: string;           // "page 2", "Section 4.3"
  quote: string;          // verbatim text from the source PDF
  bbox?: BBox | null;     // optional — present when pdfplumber matched the value
}
/**
 * Provenance back-link from a chart row (medication, allergy, problem) to
 * the page region of the source intake/lab PDF it came from. Populated by
 * the PHP brief tool via the copilot_source_links table; consumed by the
 * UI to render the same yellow-bbox overlay we use for [[DN]] citations.
 *
 * `bbox` is optional because PMH / surgical-history strings carry only a
 * doc-level citation (no per-field coordinates). In that case the drawer
 * still shows the source PDF page, just without a highlighted region.
 */
export interface SourceLink {
  doc_id: number;
  page: number;
  quote?: string;
  bbox?: BBox | null;
}

export interface CiteSource {
  type: string;
  label: string;
  fields: SourceField[];
  scroll_to?: string;
  doc_url?: string;
  openemr_doc_id?: number;  // present on document-type citations; used for bbox page-image URL
  extracted_results?: ExtractedResult[];
  source_link?: SourceLink | null;  // chart-row back-link to its source intake/lab document
}

export interface SnapshotPatient { name: string; age: string; sex: string; dob: string; }
export interface SnapshotAppt    { time: string; reason: string; }
export interface SnapshotProblem { title: string; icd10: string; since: string; source_link?: SourceLink | null; }
export interface SnapshotMed     { drug: string; dosage: string; note: string; source_link?: SourceLink | null; }
export interface SnapshotAllergy { title: string; reaction: string; severity: string; source_link?: SourceLink | null; }
export interface SnapshotLab     { test: string; value: string; units: string; abnormal: string; date: string; }
export interface SnapshotDoc     { id: number; name: string; date: string; }
export interface SnapshotVitals  {
  bp?: string; hr?: string; weight?: string;
  height?: string; bmi?: string; temp?: string; o2sat?: string;
}

export interface Snapshot {
  patient:     SnapshotPatient;
  appointment: SnapshotAppt | null;
  problems:    SnapshotProblem[];
  medications: SnapshotMed[];
  allergies:   SnapshotAllergy[];
  labs:        SnapshotLab[];
  documents:   SnapshotDoc[];
  vitals:      SnapshotVitals | null;
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
  // lab_pdf fields
  results?: LabResultItem[];
  // intake_form fields
  chief_concern?: string;
  current_medications?: Array<{ name?: string; dose?: string; frequency?: string }>;
  allergies?: Array<{ allergen?: string; reaction?: string }>;
  demographics?: { name?: string; dob?: string; sex?: string };
  vitals?: {
    blood_pressure?: string | null; heart_rate?: string | null;
    weight?: string | null; height?: string | null; bmi?: string | null;
    temperature?: string | null; oxygen_saturation?: string | null;
  };
  // additional intake fields
  past_medical_history?: string[];
  surgical_history?: string[];
  social_history?: {
    tobacco?: string | null;
    alcohol?: string | null;
    exercise?: string | null;
    occupation?: string | null;
  } | null;
  // other / fallback fields
  detected_type?: string | null;
  summary?: string | null;
  extraction_warnings?: string[];
}

export interface RoutingStep {
  node: string;
  decision: Record<string, unknown>;
  duration_ms: number;
  tokens?: { input: number; output: number };
  cost_usd?: number;
  model?: string;
}

// One step in the per-message agent-progress trace.
//   text   — what the agent was doing ("Searching clinical guidelines...")
//   ms     — how long that step took (filled in when the next step starts
//            or the run ends; 0 while the step is still running)
//   running — true for the most recent step until the next one fires
export interface StatusStep {
  text: string;
  ms: number;
  running: boolean;
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
  routing?: RoutingStep[];
  provenance?: string;     // natural-language source summary, shown above answer
  // 'system' messages are produced locally (e.g. the synthetic intake summary)
  // and excluded from the history sent to the LLM, so the BRIEF prompt still
  // sees a single user turn and emits the 3-chip structure.
  kind?: 'intake_summary';
  // Per-message progress trace — accumulates as supervisor decisions stream
  // in, and persists after the final answer arrives so the user can see what
  // the agent did to produce it.
  statusTrace?: StatusStep[];
  statusStepStartedAt?: number;  // epoch ms when the latest step began
}

export interface CachedConvo {
  messages: Message[];
  sources: Record<string, CiteSource>;
  snapshot?: Snapshot;
  docIds?: number[];
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
