import React, { useState, useEffect, useCallback, useRef } from 'react';
import { marked } from 'marked';
import './styles.css';

type Status = 'idle' | 'loading' | 'streaming' | 'live' | 'cached' | 'error';

interface SourceField { key: string; value: string; }
interface CiteSource  { type: string; label: string; fields: SourceField[]; scroll_to?: string; }

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  suggestions?: string[];
  hidden?: boolean;
  isStreaming?: boolean;
}

interface CachedConvo {
  messages: Message[];
  sources: Record<string, CiteSource>;
}

interface Props { pid: number; apiUrl: string; csrfToken: string; physicianId: number; }

marked.setOptions({ gfm: true, breaks: true });

// Timestamp + random suffix — unique across page reloads, preventing ID collisions with localStorage-restored messages
const uid = () => `m${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

// ─── localStorage helpers ──────────────────────────────────────────────────

function loadCache(key: string): CachedConvo | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedConvo>;
    if (Array.isArray(parsed.messages) && parsed.messages.length > 0) {
      return { messages: parsed.messages, sources: parsed.sources ?? {} };
    }
  } catch { /* unavailable or corrupt */ }
  return null;
}

function saveCache(key: string, messages: Message[], sources: Record<string, CiteSource>): void {
  try {
    localStorage.setItem(key, JSON.stringify({ messages, sources }));
  } catch { /* quota or private browsing */ }
}

// Strip the SUGGESTIONS block and optionally render citation markers
function renderContent(content: string, isStreaming: boolean): string {
  let text = content.replace(/\nSUGGESTIONS:[\s\S]*$/, '').trimEnd();
  if (isStreaming) {
    text = text.replace(/\[\[(\d+)\]\]/g, '').replace(/\[\[\/\d+\]\]/g, '');
  } else {
    text = text.replace(/\[\[(\d+)\]\]([\s\S]*?)\[\[\/\1\]\]/g,
      '<button class="copilot-cite-text" data-src="$1">$2</button>');
  }
  return marked.parse(text) as string;
}

// ---------------------------------------------------------------------------
// Chat hook
// ---------------------------------------------------------------------------

function useCopilotChat(pid: number, apiUrl: string, csrfToken: string, physicianId: number) {
  const cacheKey = `copilot_${pid}_${physicianId}_${new Date().toISOString().slice(0, 10)}`;

  const [messages, setMessages]         = useState<Message[]>(() => loadCache(cacheKey)?.messages ?? []);
  const [sources, setSources]           = useState<Record<string, CiteSource>>(() => loadCache(cacheKey)?.sources ?? {});
  const [activeSource, setActiveSource] = useState<CiteSource | null>(null);
  const [status, setStatus]             = useState<Status>(() => loadCache(cacheKey) ? 'cached' : 'idle');
  const [error, setError]               = useState('');

  const messagesRef   = useRef<Message[]>([]);
  const sourcesRef    = useRef<Record<string, CiteSource>>({});
  const abortRef      = useRef<AbortController | null>(null);
  const wasCachedRef  = useRef(false);
  // Computed once on mount — suppresses auto-brief when conversation is restored
  const hasLocalCache = useRef(loadCache(cacheKey) !== null);

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { sourcesRef.current = sources; }, [sources]);

  const send = useCallback(async (userText: string, hidden = false) => {
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
    setError('');
    setActiveSource(null);

    const body = new URLSearchParams({
      pid:             String(pid),
      csrf_token_form: csrfToken,
      messages:        JSON.stringify(history),
    });

    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:   body.toString(),
        signal: abortRef.current.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error('No response body');

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

            if (eventType === 'sources') {
              setSources((data.sources as Record<string, CiteSource>) ?? {});
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
              setMessages(prev => {
                const updated = prev.map(m =>
                  m.id === assistantId ? { ...m, isStreaming: false } : m
                );
                saveCache(cacheKey, updated, sourcesRef.current);
                return updated;
              });
              setStatus(wasCachedRef.current ? 'cached' : 'live');
            } else if (eventType === 'error') {
              setError((data.message as string) ?? 'Error generating response.');
              setMessages(prev => prev.filter(m => m.id !== assistantId));
              setStatus('error');
            }
            eventType = '';
          }
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name === 'AbortError') return;
      setError(e instanceof Error ? e.message : 'Request failed');
      setMessages(prev => prev.filter(m => m.id !== assistantId));
      setStatus('error');
    }
  }, [pid, apiUrl, csrfToken, cacheKey]);

  const restart = useCallback(() => {
    abortRef.current?.abort();
    try { localStorage.removeItem(cacheKey); } catch { /* ignore */ }
    hasLocalCache.current = false;
    setMessages([]);
    setSources({});
    setActiveSource(null);
    setStatus('idle');
    setError('');
    setTimeout(() => send('Brief me on this patient.', true), 30);
  }, [send, cacheKey]);

  // Auto-fire brief only when not restored from localStorage
  useEffect(() => {
    if (!hasLocalCache.current) send('Brief me on this patient.', true);
  }, []); // eslint-disable-line

  return { messages, sources, activeSource, setActiveSource, status, error, send, restart };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CopilotPanel({ pid, apiUrl, csrfToken, physicianId }: Props) {
  const { messages, sources, activeSource, setActiveSource, status, error, send, restart } =
    useCopilotChat(pid, apiUrl, csrfToken, physicianId);

  const [collapsed, setCollapsed]   = useState(false);
  const [inputText, setInputText]   = useState('');
  const inputRef             = useRef<HTMLInputElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isBusy   = status === 'loading' || status === 'streaming';

  // Dual scroll: inner container tracks latest content; page keeps input visible
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
    if (isBusy) inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, isBusy]);

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text || isBusy) return;
    setInputText('');
    send(text);
  }, [inputText, isBusy, send]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleChip = (suggestion: string) => {
    if (isBusy) return;
    send(suggestion);
  };

  return (
    <div className="copilot-header-wrap">
      <div className="copilot-header">
        <strong>🤖 Clinical Co-Pilot</strong>
        <div className="copilot-header-actions">
          <StatusBadge status={status} />
          <button
            className="copilot-btn-icon"
            onClick={restart}
            disabled={isBusy}
            title="Restart conversation"
          >↻</button>
          <button
            className="copilot-btn-icon"
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? 'Expand' : 'Collapse'}
          >{collapsed ? '▼' : '▲'}</button>
        </div>
      </div>

      <div className={`copilot-body${collapsed ? ' collapsed' : ''}`}>
        <div className={`copilot-split${activeSource ? ' has-drawer' : ''}`}>

          {/* ── Message thread ── */}
          <div className="copilot-messages" ref={messagesContainerRef}>
            {error && <p className="copilot-content copilot-error">⚠ {error}</p>}

            {messages.map((msg, i) => {
              if (msg.hidden) return null;
              const isLastAssistant = msg.role === 'assistant'
                && messages.slice(i + 1).every(m => m.role !== 'assistant');

              return (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  sources={sources}
                  onCite={src => setActiveSource(prev => prev === src ? null : src)}
                  onChip={handleChip}
                  isBusy={isBusy}
                  showDisclaimer={isLastAssistant && !msg.isStreaming}
                />
              );
            })}
          </div>

          {/* ── Source drawer ── */}
          {activeSource && (
            <SourceDrawer source={activeSource} onClose={() => setActiveSource(null)} />
          )}
        </div>

        {/* ── Input row ── */}
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
            className="copilot-send-btn"
            onClick={handleSend}
            disabled={isBusy || !inputText.trim()}
            title="Send"
          >→</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------

function MessageBubble({
  msg, sources, onCite, onChip, isBusy, showDisclaimer,
}: {
  msg: Message;
  sources: Record<string, CiteSource>;
  onCite: (src: CiteSource) => void;
  onChip: (text: string) => void;
  isBusy: boolean;
  showDisclaimer: boolean;
}) {
  const contentRef = useRef<HTMLDivElement>(null);

  // Event delegation for citation clicks inside dangerouslySetInnerHTML
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

  const html = renderContent(msg.content, !!msg.isStreaming);

  return (
    <div className="copilot-message-assistant">
      <div
        ref={contentRef}
        className={`copilot-content${msg.isStreaming ? ' streaming' : ''}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
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
};

function SourceDrawer({ source, onClose }: { source: CiteSource; onClose: () => void }) {
  const typeLabel = TYPE_LABELS[source.type] ?? source.type;

  const handleScrollTo = () => {
    if (!source.scroll_to) return;
    const el = document.querySelector<HTMLElement>(source.scroll_to);
    if (!el) return;
    const jq = (window as Record<string, unknown>).$;
    if (typeof jq === 'function') {
      const $el = (jq as CallableFunction)(el);
      if ($el.hasClass('collapse') && !$el.hasClass('show')) $el.collapse('show');
    }
    onClose();
    setTimeout(() => {
      (el.closest('.card') ?? el).scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  return (
    <div className="copilot-drawer">
      <div className="copilot-drawer-header">
        <div>
          <span className={`copilot-drawer-type copilot-drawer-type-${source.type}`}>{typeLabel}</span>
          <span className="copilot-drawer-label">{source.label}</span>
        </div>
        <button className="copilot-drawer-close" onClick={onClose} title="Close">✕</button>
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
      {source.scroll_to && (
        <div className="copilot-drawer-footer">
          <button className="copilot-drawer-link" onClick={handleScrollTo}>View in chart ↓</button>
        </div>
      )}
    </div>
  );
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
