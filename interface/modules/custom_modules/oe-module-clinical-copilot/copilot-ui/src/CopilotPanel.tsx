import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { marked } from 'marked';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ChevronDown, ChevronUp, Minimize2, Maximize2,
  RotateCcw, X, Send, FileText, Plus, Upload,
  Check, XCircle, Loader2, AlertCircle, Paperclip,
  FlaskConical, ExternalLink,
} from 'lucide-react';
import './styles.css';

type Status = 'idle' | 'loading' | 'streaming' | 'live' | 'cached' | 'error';

interface SourceField { key: string; value: string; }
interface CiteSource  { type: string; label: string; fields: SourceField[]; scroll_to?: string; doc_url?: string; }

interface SnapshotPatient  { name: string; age: string; sex: string; dob: string; }
interface SnapshotAppt     { time: string; reason: string; }
interface SnapshotProblem  { title: string; icd10: string; since: string; }
interface SnapshotMed      { drug: string; dosage: string; note: string; }
interface SnapshotAllergy  { title: string; reaction: string; severity: string; }
interface SnapshotLab      { test: string; value: string; units: string; abnormal: string; date: string; }
interface SnapshotDoc      { id: number; name: string; date: string; }

interface Snapshot {
  patient:     SnapshotPatient;
  appointment: SnapshotAppt | null;
  problems:    SnapshotProblem[];
  medications: SnapshotMed[];
  allergies:   SnapshotAllergy[];
  labs:        SnapshotLab[];
  documents:   SnapshotDoc[];
}

interface LabResultItem {
  test_name: string;
  value: string;
  unit?: string;
  reference_range?: string;
  abnormal_flag?: string | null;
}
interface ExtractionSummary {
  doc_type: string;
  results?: LabResultItem[];
  chief_concern?: string;
  current_medications?: Array<{ name?: string; dose?: string; frequency?: string }>;
  extraction_warnings?: string[];
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  suggestions?: string[];
  hidden?: boolean;
  isStreaming?: boolean;
  isError?: boolean;
  retryText?: string;
}

interface CachedConvo {
  messages: Message[];
  sources: Record<string, CiteSource>;
  snapshot?: Snapshot;
}

type DocCategory = { id: number; name: string };
interface Props { pid: number; apiUrl: string; csrfToken: string; physicianId: number; webRoot: string; categories: DocCategory[]; }

marked.setOptions({ gfm: true, breaks: true });

const uid = () => `m${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const todayKey = () => new Date().toISOString().slice(0, 10);

function formatApptTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return t;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 || 12;
  return `${hr}:${String(m).padStart(2, '0')} ${ampm}`;
}

// ─── localStorage helpers ──────────────────────────────────────────────────

function loadCache(key: string): CachedConvo | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedConvo>;
    if (Array.isArray(parsed.messages) && parsed.messages.length > 0) {
      return { messages: parsed.messages, sources: parsed.sources ?? {}, snapshot: parsed.snapshot };
    }
  } catch { /* unavailable or corrupt */ }
  return null;
}

function saveCache(key: string, messages: Message[], sources: Record<string, CiteSource>, snapshot: Snapshot | null): void {
  try {
    localStorage.setItem(key, JSON.stringify({ messages, sources, snapshot }));
  } catch { /* quota or private browsing */ }
}

// ─── Build numbered patient context + sourceMap for agent POST ─────────────
// Uses P-prefixed keys (P1, P2...) so they don't collide with the brief's
// numeric citation keys (1, 2, 3...) already in sources state.

interface NumberedContext {
  text: string;
  sourceMap: Record<string, CiteSource>;
}

function buildNumberedPatientContext(snap: Snapshot | null): NumberedContext {
  if (!snap) return { text: '', sourceMap: {} };

  const sourceMap: Record<string, CiteSource> = {};
  const lines: string[] = [
    `Patient: ${snap.patient.name}, ${snap.patient.age}y ${snap.patient.sex}`,
  ];
  let idx = 1;

  if (snap.appointment?.reason) {
    sourceMap[`P${idx}`] = {
      type: 'appointment', label: "Today's appointment",
      fields: [{ key: 'Reason', value: snap.appointment.reason }],
    };
    lines.push(`[${idx}] Today's visit: ${snap.appointment.reason}`);
    idx++;
  }

  for (const p of snap.problems) {
    sourceMap[`P${idx}`] = {
      type: 'problem', label: p.title,
      fields: [{ key: 'ICD-10', value: p.icd10 }, { key: 'Since', value: p.since }].filter(f => f.value),
      scroll_to: '#medical_problem_ps_expand',
    };
    lines.push(`[${idx}] Problem: ${p.title}${p.icd10 ? ` (${p.icd10})` : ''}`);
    idx++;
  }

  for (const m of snap.medications) {
    const label = `${m.drug} ${m.dosage}`.trim();
    sourceMap[`P${idx}`] = {
      type: 'medication', label,
      fields: [{ key: 'Drug', value: m.drug }, { key: 'Dose', value: m.dosage }].filter(f => f.value),
      scroll_to: '#prescriptions_ps_expand',
    };
    lines.push(`[${idx}] Medication: ${label}`);
    idx++;
  }

  for (const a of snap.allergies) {
    sourceMap[`P${idx}`] = {
      type: 'allergy', label: a.title,
      fields: [{ key: 'Reaction', value: a.reaction }, { key: 'Severity', value: a.severity }].filter(f => f.value),
      scroll_to: '#allergy_ps_expand',
    };
    lines.push(`[${idx}] Allergy: ${a.title}${a.reaction ? ` → ${a.reaction}` : ''}`);
    idx++;
  }

  for (const l of snap.labs.slice(0, 8)) {
    const label = `${l.test}: ${l.value} ${l.units}`.trim();
    sourceMap[`P${idx}`] = {
      type: 'lab', label,
      fields: [
        { key: 'Result', value: `${l.value} ${l.units}`.trim() },
        { key: 'Flag', value: l.abnormal || 'Within range' },
        { key: 'Collected', value: l.date },
      ].filter(f => f.value),
      scroll_to: '#labdata_ps_expand',
    };
    lines.push(`[${idx}] Lab: ${label}${l.abnormal ? ` [${l.abnormal}]` : ''}${l.date ? ` — ${l.date}` : ''}`);
    idx++;
  }

  return { text: lines.join('\n'), sourceMap };
}

// ─── Render markdown + citations ───────────────────────────────────────────

// Matches [[N]], [[GN]], [[PN]] citation pairs — brief uses [[N]], agent uses [[GN]]/[[PN]]
function replaceCites(text: string, sources: Record<string, CiteSource>): string {
  return text.replace(/\[\[([PG]?\d+)\]\]([\s\S]*?)\[\[\/\1\]\]/g, (_, idx, inner) => {
    const src = sources[idx];
    const typeClass = src ? ` copilot-cite-${src.type}` : '';
    return `<button class="copilot-cite-text${typeClass}" data-src="${idx}">${replaceCites(inner, sources)}</button>`;
  });
}

// Build (phrase, sourceKey) pairs from the known sources map so we can auto-link
// mentions that the LLM didn't cite explicitly.
function buildPhraseMap(sources: Record<string, CiteSource>): Array<[string, string]> {
  const seen = new Set<string>();
  const candidates: Array<[string, string]> = [];

  const add = (phrase: string, key: string) => {
    const norm = phrase.toLowerCase().trim();
    if (norm.length < 4 || seen.has(norm)) return;
    seen.add(norm);
    candidates.push([phrase, key]);
  };

  // Skip types that are too generic to match reliably
  const SKIP_TYPES = new Set(['appointment', 'encounter']);
  const SKIP_RE = /^(today|none|no |unknown|not |established)/i;

  for (const [key, src] of Object.entries(sources)) {
    if (SKIP_TYPES.has(src.type)) continue;
    const label = (src.label ?? '').trim();
    if (!label || SKIP_RE.test(label)) continue;

    add(label, key);

    if (src.type === 'medication') {
      // Also match drug name without dose: "Metformin 500mg" → "Metformin"
      const drugOnly = label.split(/\s+\d/)[0].trim();
      if (drugOnly !== label) add(drugOnly, key);
    } else if (src.type === 'lab') {
      // Also match test name: "Total Cholesterol: 240 mg/dL" → "Total Cholesterol"
      const testOnly = label.split(':')[0].trim();
      if (testOnly !== label) add(testOnly, key);
    } else if (src.type === 'problem') {
      // Strip ICD code parenthetical: "Type 2 DM (E11.9)" → "Type 2 DM"
      const titleOnly = label.replace(/\s*\(.*?\)/, '').trim();
      if (titleOnly !== label) add(titleOnly, key);
    }
  }

  // Longest-first so "Metformin 500mg" matches before "Metformin"
  return candidates.sort((a, b) => b[0].length - a[0].length);
}

// Scan plain-text segments (between existing citation tags) for known phrases
// and wrap them — one auto-link per source key to avoid clutter.
function autoLinkPhrases(text: string, phraseMap: Array<[string, string]>): string {
  if (phraseMap.length === 0) return text;

  // Split on existing [[X]]...[[/X]] blocks; odd-index parts are already cited
  const CITE_SPLIT = /(\[\[[PG]?\d+\]\][\s\S]*?\[\[\/[PG]?\d+\]\])/g;
  const parts = text.split(CITE_SPLIT);

  const usedKeys = new Set<string>();

  return parts.map((part, i) => {
    if (i % 2 === 1) return part; // inside an existing citation — skip
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

function renderContent(
  content: string,
  isStreaming: boolean,
  sources: Record<string, CiteSource> = {},
): string {
  let text = content.replace(/\nSUGGESTIONS:[\s\S]*$/, '').trimEnd();
  if (isStreaming) {
    text = text.replace(/\[\[[PG]?\d+\]\]/g, '').replace(/\[\[\/[PG]?\d+\]\]/g, '');
  } else {
    // Auto-link known phrases the LLM didn't explicitly cite
    const phraseMap = buildPhraseMap(sources);
    text = autoLinkPhrases(text, phraseMap);
    // Render explicit citation tags
    text = replaceCites(text, sources);
    // Strip any remaining unmatched/unclosed tags
    text = text.replace(/\[\[\/?[PG]?\d+\]\]/g, '');
  }
  return marked.parse(text) as string;
}

// ---------------------------------------------------------------------------
// Chat hook
// ---------------------------------------------------------------------------

function useCopilotChat(pid: number, apiUrl: string, csrfToken: string, physicianId: number) {
  const cacheKey = `copilot_${pid}_${physicianId}_${todayKey()}`;

  const agentQueryUrl = useMemo(
    () => apiUrl.replace(/\/chat\.php([^/]*)$/, '/agent-query.php'),
    [apiUrl],
  );

  const [messages, setMessages]         = useState<Message[]>(() => loadCache(cacheKey)?.messages ?? []);
  // Merge sources rather than replace — preserves patient-brief citations when agent adds guideline sources
  const [sources, setSources]           = useState<Record<string, CiteSource>>(() => loadCache(cacheKey)?.sources ?? {});
  const [activeSource, setActiveSource] = useState<CiteSource | null>(null);
  const [snapshot, setSnapshot]         = useState<Snapshot | null>(() => loadCache(cacheKey)?.snapshot ?? null);
  const snapshotRef = useRef<Snapshot | null>(null);
  const [status, setStatus]             = useState<Status>(() => loadCache(cacheKey) ? 'cached' : 'idle');

  const [statusMessage, setStatusMessage]   = useState('');
  const [uploadedDocIds, setUploadedDocIds] = useState<number[]>([]);
  const uploadedDocIdsRef = useRef<number[]>([]);

  const messagesRef   = useRef<Message[]>([]);
  const sourcesRef    = useRef<Record<string, CiteSource>>({});
  const abortRef      = useRef<AbortController | null>(null);
  const wasCachedRef  = useRef(false);
  const hasLocalCache = useRef(loadCache(cacheKey) !== null);
  const [needsSave, setNeedsSave] = useState(false);

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { sourcesRef.current = sources; }, [sources]);
  useEffect(() => { snapshotRef.current = snapshot; }, [snapshot]);
  useEffect(() => { uploadedDocIdsRef.current = uploadedDocIds; }, [uploadedDocIds]);

  useEffect(() => {
    if (!needsSave) return;
    setNeedsSave(false);
    saveCache(cacheKey, messages, sources, snapshot);
  }, [needsSave, cacheKey, messages, sources, snapshot]);

  const send = useCallback(async (userText: string, hidden = false, extraDocIds: number[] = []) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    wasCachedRef.current = false;

    const userMsg: Message    = { id: uid(), role: 'user', content: userText, hidden };
    const assistantId: string = uid();

    const history = [...messagesRef.current, userMsg]
      .map(m => ({ role: m.role, content: m.content }));

    setMessages(prev => [
      ...prev,
      userMsg,
      { id: assistantId, role: 'assistant', content: '', isStreaming: true },
    ]);
    setStatus('loading');
    setActiveSource(null);

    // Route: hidden initial brief → W1 chat.php; all visible queries → W2 agent
    const useAgent = !hidden;
    const endpoint = useAgent ? agentQueryUrl : apiUrl;

    const docIds = useAgent
      ? [...new Set([...uploadedDocIdsRef.current, ...extraDocIds])]
      : [];

    // Build numbered patient context so agent can use [[PN]] citations
    const { text: patientCtxText, sourceMap: patientSrcMap } = buildNumberedPatientContext(snapshotRef.current);
    if (useAgent && Object.keys(patientSrcMap).length > 0) {
      setSources(prev => ({ ...prev, ...patientSrcMap }));
    }

    const body = useAgent
      ? new URLSearchParams({
          pid:             String(pid),
          csrf_token_form: csrfToken,
          query:           userText,
          doc_ids:         JSON.stringify(docIds),
          patient_context: patientCtxText,
        })
      : new URLSearchParams({
          pid:             String(pid),
          csrf_token_form: csrfToken,
          messages:        JSON.stringify(history),
        });

    const setInlineError = (retryText: string) => {
      setMessages(prev => prev.map(m =>
        m.id === assistantId
          ? { ...m, content: '', isStreaming: false, isError: true, retryText, suggestions: ['Try again'] }
          : m
      ));
      setStatus('error');
    };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:   body.toString(),
        signal: abortRef.current.signal,
      });
      if (!res.ok) { setInlineError(userText); return; }
      if (!res.body) { setInlineError(userText); return; }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let lineBuffer = '';
      let eventType  = '';
      setStatus('streaming');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split('\n');
        lineBuffer  = lines.pop() ?? '';

        for (const line of lines) {
          const t = line.trim();
          if (t.startsWith('event: ')) {
            eventType = t.slice(7);
          } else if (t.startsWith('data: ')) {
            let data: Record<string, unknown>;
            try { data = JSON.parse(t.slice(6)); } catch { continue; }

            if (eventType === 'status') {
              setStatusMessage((data.text as string) ?? '');
            } else if (eventType === 'snapshot') {
              const snap = data as unknown as Snapshot;
              setSnapshot(snap);
              snapshotRef.current = snap;
            } else if (eventType === 'sources') {
              // Merge — don't replace — so patient-brief citations stay live alongside guideline sources
              setSources(prev => ({ ...prev, ...(data.sources as Record<string, CiteSource> ?? {}) }));
            } else if (eventType === 'delta') {
              const chunk = (data.text as string) ?? '';
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, content: m.content + chunk } : m
              ));
            } else if (eventType === 'cached') {
              wasCachedRef.current = true;
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, content: (data.text as string) ?? '' } : m
              ));
            } else if (eventType === 'suggestions') {
              const chips = (data.suggestions as string[]) ?? [];
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, suggestions: chips } : m
              ));
            } else if (eventType === 'done') {
              setStatusMessage('');
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, isStreaming: false } : m
              ));
              setNeedsSave(true);
              setStatus(wasCachedRef.current ? 'cached' : 'live');
            } else if (eventType === 'error') {
              setInlineError(userText);
            }
            eventType = '';
          }
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name === 'AbortError') return;
      setInlineError(userText);
    }
  }, [pid, apiUrl, agentQueryUrl, csrfToken, cacheKey]);

  const restart = useCallback(() => {
    abortRef.current?.abort();
    try { localStorage.removeItem(cacheKey); } catch { /* ignore */ }
    hasLocalCache.current = false;
    setMessages([]);
    setSources({});
    setActiveSource(null);
    setUploadedDocIds([]);
    setStatus('idle');
    setTimeout(() => send('Brief me on this patient.', true), 30);
  }, [send, cacheKey]);

  useEffect(() => {
    if (!hasLocalCache.current) send('Brief me on this patient.', true);
  }, []); // eslint-disable-line

  const addDocToSnapshot = useCallback((doc: SnapshotDoc) => {
    setSnapshot(prev => prev ? { ...prev, documents: [doc, ...prev.documents] } : prev);
  }, []);

  const [labsFlash, setLabsFlash] = useState(false);

  // Push extracted lab results into the snapshot labs array so they appear in the card immediately
  const addLabsToSnapshot = useCallback((labs: SnapshotLab[]) => {
    setLabsFlash(false);
    // Force a re-trigger of the animation even if called twice in a row
    requestAnimationFrame(() => setLabsFlash(true));
    setSnapshot(prev => {
      if (!prev) return prev;
      // Normalize for dedup: strip everything after first comma (e.g. ", Calculated", ", Direct")
      // then lowercase and collapse non-alphanumeric chars. This makes
      // "LDL Cholesterol, Calculated" == "LDL Cholesterol" == "ldl cholesterol".
      const normName = (s: string) => s.split(',')[0].toLowerCase().replace(/[^a-z0-9]/g, '').replace(/\s+/g, ' ').trim();
      const dateOf = (l: SnapshotLab) => l.date || '';
      // Merge: build map keyed by normalized name, keeping the entry with the latest date
      const merged = new Map<string, SnapshotLab>();
      for (const l of [...prev.labs, ...labs]) {
        const k = normName(l.test);
        const existing = merged.get(k);
        if (!existing || dateOf(l) >= dateOf(existing)) merged.set(k, l);
      }
      // Preserve original order (most recent first) by sorting by date desc
      const sorted = Array.from(merged.values()).sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
      return { ...prev, labs: sorted };
    });
    // Save immediately so labs survive a page reload even if no agent query completes
    setNeedsSave(true);
  }, []);

  const addDocId = useCallback((id: number) => {
    setUploadedDocIds(prev => [...prev, id]);
  }, []);

  return {
    messages, sources, activeSource, setActiveSource, snapshot,
    status, statusMessage, send, restart,
    addDocToSnapshot, addLabsToSnapshot, addDocId, uploadedDocIds, labsFlash,
  };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const WIDE_BREAKPOINT = 800;

export function CopilotPanel({ pid, apiUrl, csrfToken, physicianId, webRoot, categories }: Props) {
  const {
    messages, sources, activeSource, setActiveSource, snapshot,
    status, statusMessage, send, restart,
    addDocToSnapshot, addLabsToSnapshot, addDocId, uploadedDocIds, labsFlash,
  } = useCopilotChat(pid, apiUrl, csrfToken, physicianId);

  const uploadUrl = apiUrl.replace(/chat\.php([^/]*)$/, `upload.php?pid=${pid}&site=default`);

  const [collapsed, setCollapsed]           = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const [inputText, setInputText]           = useState('');
  const [drawerWidth, setDrawerWidth]       = useState(260);
  const [uploadOpen, setUploadOpen]         = useState(false);
  const wrapRef        = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const dragStartX     = useRef(0);
  const dragStartWidth = useRef(260);
  const isBusy  = status === 'loading' || status === 'streaming';
  const isWide  = containerWidth >= WIDE_BREAKPOINT;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      setContainerWidth(entries[0].contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const onDividerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStartX.current     = e.clientX;
    dragStartWidth.current = drawerWidth;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onDividerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!(e.currentTarget as HTMLDivElement).hasPointerCapture(e.pointerId)) return;
    const delta    = dragStartX.current - e.clientX;
    const newWidth = Math.max(180, Math.min(500, dragStartWidth.current + delta));
    setDrawerWidth(newWidth);
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages]);

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text || isBusy) return;
    setInputText('');
    send(text);
    inputRef.current?.focus();
  }, [inputText, isBusy, send]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleChip = useCallback((text: string) => { if (!isBusy) send(text); }, [isBusy, send]);

  const chatMessages = (
    <div className="copilot-messages">
      {messages.map((msg, i) => {
        if (msg.hidden) return null;
        const isLastAssistant = msg.role === 'assistant'
          && messages.slice(i + 1).every(m => m.role !== 'assistant');
        const isLastStreaming = msg.role === 'assistant' && msg.isStreaming &&
          messages.slice(i + 1).every(m => m.role !== 'assistant');
        return (
          <MessageBubble
            key={msg.id}
            msg={msg}
            sources={sources}
            onCite={src => setActiveSource(src)}
            onChip={handleChip}
            isBusy={isBusy}
            showDisclaimer={isLastAssistant && !msg.isStreaming && !msg.isError}
            statusMessage={isLastStreaming ? statusMessage : ''}
          />
        );
      })}
      <div ref={messagesEndRef} />
    </div>
  );

  const inputRow = (
    <div className="copilot-input-row">
      <input
        ref={inputRef}
        className="copilot-input"
        type="text"
        placeholder="Ask a follow-up…"
        value={inputText}
        onChange={e => setInputText(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isBusy}
      />
      <button
        className="copilot-upload-btn"
        onClick={() => setUploadOpen(true)}
        title="Upload document"
        type="button"
      ><Paperclip size={14} /></button>
      <button
        className="copilot-send-btn"
        onClick={handleSend}
        disabled={isBusy || !inputText.trim()}
        title="Send"
      ><Send size={14} /></button>
    </div>
  );

  return (
    <div className="copilot-header-wrap" ref={wrapRef}>
      <div className="copilot-header">
        <strong>Clinical Co-Pilot</strong>
        <div className="copilot-header-actions">
          {uploadedDocIds.length > 0 && (
            <span className="copilot-badge copilot-badge-docs" title={`${uploadedDocIds.length} document(s) uploaded this session`}>
              <FlaskConical size={11} style={{ marginRight: 3 }} />
              {uploadedDocIds.length} doc{uploadedDocIds.length !== 1 ? 's' : ''}
            </span>
          )}
          <StatusBadge status={status} />
          <button className="copilot-btn-icon" onClick={restart} disabled={isBusy} title="Restart">
            <RotateCcw size={14} />
          </button>
          <button
            className="copilot-btn-icon"
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? 'Expand' : 'Minimize'}
          >
            {collapsed ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
          </button>
        </div>
      </div>

      <div className={`copilot-body${collapsed ? ' collapsed' : ''}${isWide ? ' copilot-body-wide' : ''}`}>
        <div className="copilot-main">
          {snapshot && (
            <PatientSnapshot
              snapshot={snapshot}
              compact={!isWide}
              onOpenSource={setActiveSource}
              onOpenUpload={() => setUploadOpen(true)}
              webRoot={webRoot}
              pid={pid}
              labsFlash={labsFlash}
            />
          )}
          {chatMessages}
          {inputRow}
        </div>
        {activeSource && (
          <>
            <div
              className="copilot-divider"
              onPointerDown={onDividerPointerDown}
              onPointerMove={onDividerPointerMove}
            />
            <SourceDrawer
              source={activeSource}
              onClose={() => setActiveSource(null)}
              width={drawerWidth}
            />
          </>
        )}
      </div>

      <UploadModal
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        uploadUrl={uploadUrl}
        csrfToken={csrfToken}
        categories={categories}
        pid={pid}
        onUploaded={(doc, extraction) => {
          addDocToSnapshot(doc);
          addDocId(doc.id);
          // Push extracted labs into the snapshot card immediately
          if (extraction?.doc_type === 'lab_pdf' && extraction.results?.length) {
            const today = new Date().toISOString().slice(0, 10);
            addLabsToSnapshot(extraction.results.map(r => ({
              test:     r.test_name,
              value:    r.value,
              units:    r.unit ?? '',
              abnormal: r.abnormal_flag ?? '',
              date:     today,
            })));
          }
          // Auto-trigger agent analysis
          const label = extraction?.doc_type === 'intake_form' ? 'intake form' : 'lab report';
          setTimeout(() => {
            send(
              `Analyze the uploaded ${label} and highlight any abnormal values or clinical concerns. Reference applicable guidelines.`,
              false,
              [doc.id],
            );
          }, 300);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------

function MessageBubble({
  msg, sources, onCite, onChip, isBusy, showDisclaimer, statusMessage,
}: {
  msg: Message;
  sources: Record<string, CiteSource>;
  onCite: (src: CiteSource) => void;
  onChip: (text: string) => void;
  isBusy: boolean;
  showDisclaimer: boolean;
  statusMessage?: string;
}) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const handleClick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-src]');
      if (!btn) return;
      const src = sources[btn.getAttribute('data-src') ?? ''];
      if (src) { onCite(src); e.stopPropagation(); }
    };
    el.addEventListener('click', handleClick);
    return () => el.removeEventListener('click', handleClick);
  }, [sources, onCite]);

  if (msg.role === 'user') {
    return (
      <div className="copilot-message-user">
        <span className="copilot-user-bubble">{msg.content}</span>
      </div>
    );
  }

  if (msg.isError) {
    return (
      <div className="copilot-message-assistant">
        <div className="copilot-content copilot-error-inline">
          <AlertCircle size={13} style={{ verticalAlign: 'middle', marginRight: 5 }} />
          Something went wrong. This may be a temporary issue.
        </div>
        {msg.suggestions && msg.suggestions.length > 0 && (
          <div className="copilot-chips">
            {msg.suggestions.map((s, i) => (
              <button
                key={i}
                className="copilot-chip copilot-chip-retry"
                onClick={() => onChip(s === 'Try again' && msg.retryText ? msg.retryText : s)}
                disabled={isBusy}
              >{s}</button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const html = renderContent(msg.content, !!msg.isStreaming, sources);
  const showStatus = msg.isStreaming && !msg.content && statusMessage;

  return (
    <div className="copilot-message-assistant">
      {showStatus ? (
        <div className="copilot-status-message">
          <span className="copilot-status-dot" />
          {statusMessage}
        </div>
      ) : (
        <div
          ref={contentRef}
          className={`copilot-content${msg.isStreaming ? ' streaming' : ''}`}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
      {showDisclaimer && (
        <div className="copilot-footer">
          <span className="copilot-disclaimer">
            Brief reflects EHR data only. Undocumented conditions will not appear.
          </span>
        </div>
      )}
      {!msg.isStreaming && msg.suggestions && msg.suggestions.length > 0 && (
        <div className="copilot-chips">
          {msg.suggestions.map((s, i) => (
            <button
              key={i}
              className="copilot-chip"
              onClick={() => onChip(s)}
              disabled={isBusy}
            >{s}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Source drawer
// ---------------------------------------------------------------------------

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

function SourceDrawer({ source, onClose, width }: {
  source: CiteSource;
  onClose: () => void;
  width: number | undefined;
}) {
  const typeLabel = TYPE_LABELS[source.type] ?? source.type;

  const handleScrollTo = () => {
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
      setTimeout(() => target.classList.remove('copilot-scroll-flash'), 1400);
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

// ---------------------------------------------------------------------------
// Patient snapshot card
// ---------------------------------------------------------------------------

const LAB_FLAG_ORDER: Record<string, number> = { H: 0, '': 1, L: 2 };

function PatientSnapshot({ snapshot, compact, onOpenSource, onOpenUpload, webRoot, pid, labsFlash }: {
  snapshot: Snapshot;
  compact: boolean;
  onOpenSource?: (src: CiteSource) => void;
  onOpenUpload: () => void;
  webRoot: string;
  pid: number;
  labsFlash?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const { patient, appointment, problems, medications, allergies, labs, documents } = snapshot;

  const sortedLabs = [...labs].sort((a, b) =>
    (LAB_FLAG_ORDER[a.abnormal ?? ''] ?? 1) - (LAB_FLAG_ORDER[b.abnormal ?? ''] ?? 1)
  );

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

  const chipClick = (src: CiteSource) => onOpenSource?.(src);
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

// ---------------------------------------------------------------------------
// Upload modal — type dropdown removed; doc_type inferred from category name
// ---------------------------------------------------------------------------

interface UploadedFile {
  fid: string;
  name: string;
  size: string;
  status: 'uploading' | 'done' | 'error';
  error?: string;
  extraction?: ExtractionSummary | null;
}

function inferDocType(categoryName: string): 'lab_pdf' | 'intake_form' {
  const lower = categoryName.toLowerCase();
  if (lower.includes('intake') || lower.includes('consent') || lower.includes('history')) {
    return 'intake_form';
  }
  return 'lab_pdf';
}

function UploadModal({ open, onOpenChange, uploadUrl, csrfToken, categories, pid, onUploaded }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  uploadUrl: string;
  csrfToken: string;
  categories: DocCategory[];
  pid: number;
  onUploaded: (doc: SnapshotDoc, extraction: ExtractionSummary | null) => void;
}) {
  const [files, setFiles]           = useState<UploadedFile[]>([]);
  const [dragOver, setDragOver]     = useState(false);
  const [categoryId, setCategoryId] = useState<number>(categories[0]?.id ?? 1);
  const fileInputRef                = useRef<HTMLInputElement>(null);

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
      const cat        = categories.find(c => c.id === categoryId);
      const docType    = cat ? inferDocType(cat.name) : 'lab_pdf';

      const fd = new FormData();
      fd.append('file', file);
      fd.append('pid', String(pid));
      fd.append('csrf_token_form', csrfToken);
      fd.append('category_id', String(categoryId));
      fd.append('doc_type', docType);

      const res = await fetch(uploadUrl, { method: 'POST', body: fd, credentials: 'same-origin' });
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

  const handleFiles = (raw: FileList | null) => {
    if (!raw) return;
    Array.from(raw).forEach(f => uploadFile(f));
  };

  const onDrop = (e: React.DragEvent) => {
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

          {categories.length > 0 && (
            <div className="copilot-modal-category">
              <label className="copilot-modal-category-label" htmlFor="copilot-cat-select">Category</label>
              <select
                id="copilot-cat-select"
                className="copilot-modal-category-select"
                value={categoryId}
                onChange={e => setCategoryId(Number(e.target.value))}
              >
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

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
                      {f.status === 'done'      ? <Check size={13} />
                     : f.status === 'error'     ? <XCircle size={13} />
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

// ─── Extraction preview in upload modal ───────────────────────────────────

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
                <span key={i}>{m.name}{i < Math.min(extraction.current_medications!.length, 3) - 1 ? ', ' : ''}</span>
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

  return null;
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_VARIANTS: Partial<Record<Status, { cls: string; label: string }>> = {
  loading:   { cls: 'copilot-badge-loading', label: 'Loading…' },
  streaming: { cls: 'copilot-badge-loading', label: 'Generating…' },
  live:      { cls: 'copilot-badge-live',    label: 'Live' },
  cached:    { cls: 'copilot-badge-cached',  label: 'Cached' },
};

function StatusBadge({ status }: { status: Status }) {
  const v = STATUS_VARIANTS[status];
  if (!v) return null;
  return <span className={`copilot-badge ${v.cls}`}>{v.label}</span>;
}
