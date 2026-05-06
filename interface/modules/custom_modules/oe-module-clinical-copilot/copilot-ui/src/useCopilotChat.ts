// Chat orchestration hook: owns messages, sources, snapshot, status; wires
// up the W1 brief and W2 follow-up endpoints; parses SSE events; persists
// to localStorage. Components stay declarative — they consume the values
// returned here.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { parseSseStream } from './sse';
import type {
  CiteSource,
  Message,
  Snapshot,
  SnapshotDoc,
  SnapshotLab,
  Status,
} from './types';
import {
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
  send: (userText: string, hidden?: boolean, extraDocIds?: number[]) => Promise<void>;
  restart: () => void;
  addDocToSnapshot: (doc: SnapshotDoc) => void;
  addLabsToSnapshot: (labs: SnapshotLab[]) => void;
  addDocId: (id: number) => void;
  uploadedDocIds: number[];
  labsFlash: boolean;
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

  // Initial state hydrated from localStorage so a refresh keeps the brief.
  const initialCache = useMemo(() => loadCache(cacheKey), [cacheKey]);

  const [messages, setMessages]         = useState<Message[]>(() => initialCache?.messages ?? []);
  const [sources, setSources]           = useState<Record<string, CiteSource>>(() => initialCache?.sources ?? {});
  const [activeSource, setActiveSource] = useState<CiteSource | null>(null);
  const [snapshot, setSnapshot]         = useState<Snapshot | null>(() => initialCache?.snapshot ?? null);
  const [status, setStatus]             = useState<Status>(() => initialCache ? 'cached' : 'idle');
  const [statusMessage, setStatusMessage]   = useState('');
  const [uploadedDocIds, setUploadedDocIds] = useState<number[]>([]);
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
    saveCache(cacheKey, messages, sources, snapshot);
  }, [needsSave, cacheKey, messages, sources, snapshot]);

  const send = useCallback(async (
    userText: string,
    hidden = false,
    extraDocIds: number[] = [],
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
    const useAgent = !hidden;
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
        const snap = data as unknown as Snapshot;
        setSnapshot(snap);
        snapshotRef.current = snap;
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

  // Fire the initial brief if we don't have a cache yet.
  useEffect(() => {
    if (!hasLocalCache.current) send('Brief me on this patient.', true);
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

  const addDocId = useCallback((id: number): void => {
    setUploadedDocIds(prev => [...prev, id]);
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
    addDocId,
    uploadedDocIds,
    labsFlash,
  };
}
