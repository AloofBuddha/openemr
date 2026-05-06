// Chat orchestration hook: owns messages, sources, snapshot, status; wires
// up the W1 brief and W2 follow-up endpoints; parses SSE events; persists
// to localStorage. Components stay declarative — they consume the values
// returned here.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { parseSseStream } from './sse';
import type {
  CiteSource,
  ExtractionSummary,
  Message,
  Snapshot,
  SnapshotAllergy,
  SnapshotDoc,
  SnapshotLab,
  SnapshotMed,
  SnapshotVitals,
  Status,
} from './types';
import {
  _formatVitals,
  buildNumberedPatientContext,
  loadCache,
  normaliseLabName,
  saveCache,
  todayKey,
  uid,
} from './utils';

export interface UseCopilotChatResult {
  messages: Message[];
  sources: Record<string, CiteSource>;
  activeSource: CiteSource | null;
  setActiveSource: (s: CiteSource | null) => void;
  snapshot: Snapshot | null;
  status: Status;
  statusMessage: string;
  send: (userText: string, hidden?: boolean, extraDocIds?: number[], forceAgent?: boolean) => Promise<void>;
  restart: () => void;
  addDocToSnapshot: (doc: SnapshotDoc) => void;
  addLabsToSnapshot: (labs: SnapshotLab[]) => void;
  addIntakeToSnapshot: (extraction: ExtractionSummary) => void;
  addDocId: (id: number) => void;
  uploadedDocIds: number[];
  labsFlash: boolean;
}

// ─── Module-level helpers (pure, no React) ────────────────────────────────

function _mergeIntake(prev: Snapshot | null, extraction: ExtractionSummary): Snapshot {
  // If no existing snapshot (new patient), bootstrap one from intake demographics.
  const base: Snapshot = prev ?? {
    patient:     {
      name: extraction.demographics?.name ?? 'Patient',
      age:  '',
      sex:  extraction.demographics?.sex ?? '',
      dob:  extraction.demographics?.dob ?? '',
    },
    appointment: null,
    problems:    [],
    medications: [],
    allergies:   [],
    labs:        [],
    documents:   [],
    vitals:      null,
  };

  const newMeds: SnapshotMed[] = (extraction.current_medications ?? [])
    .filter(m => m.name)
    .map(m => ({ drug: m.name!, dosage: m.dose ?? '', note: m.frequency ?? '' }));
  const newAllergies: SnapshotAllergy[] = (extraction.allergies ?? [])
    .filter(a => a.allergen)
    .map(a => ({ title: a.allergen!, reaction: a.reaction ?? '', severity: '' }));
  const existingMeds      = new Set(base.medications.map(m => m.drug.toLowerCase()));
  const existingAllergens = new Set(base.allergies.map(a => a.title.toLowerCase()));

  const v = extraction.vitals;
  const vitals: SnapshotVitals | null = v ? {
    bp:     v.blood_pressure    ?? undefined,
    hr:     v.heart_rate        ?? undefined,
    weight: v.weight            ?? undefined,
    height: v.height            ?? undefined,
    bmi:    v.bmi               ?? undefined,
    temp:   v.temperature       ?? undefined,
    o2sat:  v.oxygen_saturation ?? undefined,
  } : base.vitals;

  return {
    ...base,
    vitals: vitals ?? base.vitals,
    medications: [
      ...base.medications,
      ...newMeds.filter(m => !existingMeds.has(m.drug.toLowerCase())),
    ],
    allergies: [
      ...base.allergies,
      ...newAllergies.filter(a => !existingAllergens.has(a.title.toLowerCase())),
    ],
  };
}

function _buildIntakeProcessedMessage(
  items: Array<{ doc_id: number; doc_name: string; extraction: ExtractionSummary }>,
): string {
  const lines: string[] = ['**Intake form detected** *(uploaded by front desk)* — processing...\n'];
  for (const item of items) {
    lines.push(`📋 **${item.doc_name}**\n`);
    const e = item.extraction;
    if (e.demographics) {
      const d = e.demographics;
      const parts = [d.name, d.dob, d.sex].filter(Boolean);
      if (parts.length) lines.push(`- **Patient:** ${parts.join(' · ')}`);
    }
    if (e.chief_concern) lines.push(`- **Chief concern:** ${e.chief_concern}`);

    if ((e.current_medications ?? []).length > 0) {
      const meds = e.current_medications!.slice(0, 6)
        .map(m => `${m.name}${m.dose ? ` ${m.dose}` : ''}`).join(', ');
      const extra = e.current_medications!.length > 6 ? ` +${e.current_medications!.length - 6} more` : '';
      lines.push(`- **Medications:** ${meds}${extra}`);
    } else {
      lines.push('- **Medications:** None reported');
    }

    if ((e.allergies ?? []).length > 0) {
      lines.push(`- **Allergies:** ${e.allergies!.map(a => a.allergen).join(', ')}`);
    } else {
      lines.push('- **Allergies:** None reported');
    }

    if (e.vitals) {
      const vParts = _formatVitals({
        bp: e.vitals.blood_pressure ?? undefined,
        hr: e.vitals.heart_rate ?? undefined,
        weight: e.vitals.weight ?? undefined,
        height: e.vitals.height ?? undefined,
        bmi: e.vitals.bmi ?? undefined,
        temp: e.vitals.temperature ?? undefined,
        o2sat: e.vitals.oxygen_saturation ?? undefined,
      });
      if (vParts.length) lines.push(`- **Vitals:** ${vParts.join(' · ')}`);
    }

    if (e.extraction_warnings?.length) {
      lines.push(`\n⚠️ *Notes: ${e.extraction_warnings.join('; ')}*`);
    }
  }
  lines.push('\n*Snapshot updated with intake data. Generating patient brief...*');
  return lines.join('\n');
}

export function useCopilotChat(
  pid: number,
  apiUrl: string,
  csrfToken: string,
  physicianId: number,
): UseCopilotChatResult {
  const cacheKey = `copilot_${pid}_${physicianId}_${todayKey()}`;
  const agentQueryUrl = useMemo(
    () => apiUrl.replace(/\/chat\.php([^/]*)$/, '/agent-query.php'),
    [apiUrl],
  );
  const intakeProcessUrl = useMemo(
    () => apiUrl.replace(/\/chat\.php([^/]*)$/, '/intake-process.php'),
    [apiUrl],
  );

  // Initial state hydrated from localStorage so a refresh keeps the brief.
  const initialCache = useMemo(() => loadCache(cacheKey), [cacheKey]);

  const [messages, setMessages]         = useState<Message[]>(() => initialCache?.messages ?? []);
  const [sources, setSources]           = useState<Record<string, CiteSource>>(() => initialCache?.sources ?? {});
  const [activeSource, setActiveSource] = useState<CiteSource | null>(null);
  const [snapshot, setSnapshot]         = useState<Snapshot | null>(() => initialCache?.snapshot ?? null);
  const [status, setStatus]             = useState<Status>(() => initialCache ? 'cached' : 'idle');
  const [statusMessage, setStatusMessage]   = useState('');
  const [uploadedDocIds, setUploadedDocIds] = useState<number[]>(() => initialCache?.docIds ?? []);
  const [needsSave, setNeedsSave]       = useState(false);
  const [labsFlash, setLabsFlash]       = useState(false);

  // Refs that mirror state for use inside async callbacks.
  const messagesRef       = useRef<Message[]>([]);
  const snapshotRef       = useRef<Snapshot | null>(null);
  const uploadedDocIdsRef = useRef<number[]>([]);
  const abortRef          = useRef<AbortController | null>(null);
  const wasCachedRef      = useRef(false);
  const hasLocalCache     = useRef(initialCache !== null);

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { snapshotRef.current = snapshot; }, [snapshot]);
  useEffect(() => { uploadedDocIdsRef.current = uploadedDocIds; }, [uploadedDocIds]);

  useEffect(() => {
    if (!needsSave) return;
    setNeedsSave(false);
    saveCache(cacheKey, messages, sources, snapshot, uploadedDocIds);
  }, [needsSave, cacheKey, messages, sources, snapshot, uploadedDocIds]);

  const send = useCallback(async (
    userText: string,
    hidden = false,
    extraDocIds: number[] = [],
    forceAgent = false,
  ): Promise<void> => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    wasCachedRef.current = false;

    const userMsg: Message = { id: uid(), role: 'user', content: userText, hidden };
    const assistantId = uid();
    const history = [...messagesRef.current, userMsg]
      .map(m => ({ role: m.role, content: m.content }));

    setMessages(prev => [
      ...prev,
      userMsg,
      { id: assistantId, role: 'assistant', content: '', isStreaming: true },
    ]);
    setStatus('loading');
    setActiveSource(null);

    // Hidden initial brief → W1 chat.php; visible queries → W2 agent.
    // forceAgent=true routes even a hidden message through the agent (used when
    // intake forms were processed so the brief includes that context).
    const useAgent = !hidden || forceAgent;
    const endpoint = useAgent ? agentQueryUrl : apiUrl;
    const docIds = useAgent
      ? [...new Set([...uploadedDocIdsRef.current, ...extraDocIds])]
      : [];

    const { text: patientCtxText, sourceMap: patientSrcMap } =
      buildNumberedPatientContext(snapshotRef.current);
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

    const setInlineError = (retryText: string): void => {
      setMessages(prev => prev.map(m =>
        m.id === assistantId
          ? { ...m, content: '', isStreaming: false, isError: true, retryText, suggestions: ['Try again'] }
          : m
      ));
      setStatus('error');
    };

    try {
      const res = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    body.toString(),
        signal:  abortRef.current.signal,
      });
      if (!res.ok || !res.body) { setInlineError(userText); return; }

      setStatus('streaming');
      for await (const evt of parseSseStream(res.body)) {
        let data: Record<string, unknown>;
        try { data = JSON.parse(evt.data); } catch { continue; }
        handleEvent(evt.event, data, assistantId, userText, setInlineError);
      }
    } catch (e: unknown) {
      if ((e as Error).name === 'AbortError') return;
      setInlineError(userText);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, apiUrl, agentQueryUrl, csrfToken]);

  // Inner event dispatch — split out so send() reads top-down without a
  // 60-line if/else chain in the middle of the request flow.
  const handleEvent = useCallback((
    event: string,
    data: Record<string, unknown>,
    assistantId: string,
    userText: string,
    setInlineError: (retryText: string) => void,
  ): void => {
    switch (event) {
      case 'status':
        setStatusMessage((data.text as string) ?? '');
        break;
      case 'snapshot': {
        // Preserve vitals from intake form if W1 brief doesn't include them.
        const incoming = data as unknown as Snapshot;
        const merged: Snapshot = {
          ...incoming,
          vitals: incoming.vitals ?? snapshotRef.current?.vitals ?? null,
        };
        setSnapshot(merged);
        snapshotRef.current = merged;
        break;
      }
      case 'sources':
        // Merge — patient-brief citations stay live alongside guideline sources
        setSources(prev => ({
          ...prev,
          ...(data.sources as Record<string, CiteSource> ?? {}),
        }));
        break;
      case 'delta': {
        const chunk = (data.text as string) ?? '';
        setMessages(prev => prev.map(m =>
          m.id === assistantId ? { ...m, content: m.content + chunk } : m
        ));
        break;
      }
      case 'cached':
        wasCachedRef.current = true;
        setMessages(prev => prev.map(m =>
          m.id === assistantId ? { ...m, content: (data.text as string) ?? '' } : m
        ));
        break;
      case 'suggestions': {
        const chips = (data.suggestions as string[]) ?? [];
        setMessages(prev => prev.map(m =>
          m.id === assistantId ? { ...m, suggestions: chips } : m
        ));
        break;
      }
      case 'done':
        setStatusMessage('');
        setMessages(prev => prev.map(m =>
          m.id === assistantId ? { ...m, isStreaming: false } : m
        ));
        setNeedsSave(true);
        setStatus(wasCachedRef.current ? 'cached' : 'live');
        break;
      case 'error':
        setInlineError(userText);
        break;
    }
  }, []);

  const restart = useCallback((): void => {
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

  // Startup: check for pending intake forms first, then run initial brief if no cache.
  const startupRanRef = useRef(false);
  useEffect(() => {
    if (startupRanRef.current) return; // guard against React StrictMode double-invoke
    startupRanRef.current = true;

    (async () => {
      const { count, docIds: intakeDocIds } = await checkAndProcessIntakes();
      if (!hasLocalCache.current) {
        // If intakes were processed, route through the agent so the brief
        // can reference the extracted data. Otherwise use W1 chat.php.
        send('Brief me on this patient.', true, intakeDocIds, count > 0);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addDocToSnapshot = useCallback((doc: SnapshotDoc): void => {
    setSnapshot(prev => prev ? { ...prev, documents: [doc, ...prev.documents] } : prev);
  }, []);

  // Push extracted lab results into the snapshot card. Dedups across
  // existing rows + the new ones, keeping the latest-dated entry per
  // normalised lab name.
  const addLabsToSnapshot = useCallback((labs: SnapshotLab[]): void => {
    setLabsFlash(false);
    requestAnimationFrame(() => setLabsFlash(true));

    setSnapshot(prev => {
      if (!prev) return prev;
      const dateOf = (l: SnapshotLab): string => l.date || '';
      const merged = new Map<string, SnapshotLab>();
      for (const l of [...prev.labs, ...labs]) {
        const k = normaliseLabName(l.test);
        const existing = merged.get(k);
        if (!existing || dateOf(l) >= dateOf(existing)) merged.set(k, l);
      }
      const sorted = Array.from(merged.values())
        .sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
      return { ...prev, labs: sorted };
    });
    setNeedsSave(true);
  }, []);

  const addIntakeToSnapshot = useCallback((extraction: ExtractionSummary): void => {
    setSnapshot(prev => {
      const next = _mergeIntake(prev, extraction);
      snapshotRef.current = next;
      return next;
    });
    setNeedsSave(true);
  }, []);

  // Fetch any intake forms uploaded (e.g. by front desk) that haven't been
  // processed yet, merge them into the snapshot, and add a synthetic chat
  // message summarising what was found.
  const checkAndProcessIntakes = useCallback(async (): Promise<{ count: number; docIds: number[] }> => {
    try {
      const res = await fetch(intakeProcessUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    new URLSearchParams({ pid: String(pid), csrf_token_form: csrfToken }),
        credentials: 'same-origin',
      });
      if (!res.ok) return { count: 0, docIds: [] };

      const data = await res.json() as {
        processed: Array<{ doc_id: number; doc_name: string; extraction: ExtractionSummary }>;
      };
      const items = data.processed ?? [];
      if (!items.length) return { count: 0, docIds: [] };

      // Merge each extraction into snapshot (updating ref synchronously)
      for (const item of items) {
        addIntakeToSnapshot(item.extraction);
        setUploadedDocIds(prev => [...prev, item.doc_id]);
        uploadedDocIdsRef.current = [...uploadedDocIdsRef.current, item.doc_id];
      }

      // Add a synthetic message summarising what was extracted
      setMessages(prev => [...prev, {
        id: uid(),
        role: 'assistant',
        content: _buildIntakeProcessedMessage(items),
        isStreaming: false,
      }]);

      return { count: items.length, docIds: items.map(i => i.doc_id) };
    } catch {
      return { count: 0, docIds: [] };
    }
  }, [pid, csrfToken, intakeProcessUrl, addIntakeToSnapshot]);

  const addDocId = useCallback((id: number): void => {
    setUploadedDocIds(prev => [...prev, id]);
    setNeedsSave(true);
  }, []);

  return {
    messages,
    sources,
    activeSource,
    setActiveSource,
    snapshot,
    status,
    statusMessage,
    send,
    restart,
    addDocToSnapshot,
    addLabsToSnapshot,
    addIntakeToSnapshot,
    addDocId,
    uploadedDocIds,
    labsFlash,
  };
}
