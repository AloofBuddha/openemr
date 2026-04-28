import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { marked } from 'marked';
import './styles.css';

type Status = 'idle' | 'loading' | 'streaming' | 'cached' | 'live' | 'error';

interface SourceField {
  key: string;
  value: string;
}

interface CiteSource {
  type: string;
  label: string;
  fields: SourceField[];
  scroll_to?: string;
}

interface Props {
  pid: number;
  apiUrl: string;
  csrfToken: string;
}

marked.setOptions({ gfm: true, breaks: true });

// ---------------------------------------------------------------------------
// Streaming hook
// ---------------------------------------------------------------------------

function useBriefStream(pid: number, apiUrl: string, csrfToken: string) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [sources, setSources] = useState<Record<string, CiteSource>>({});
  const [activeSource, setActiveSource] = useState<CiteSource | null>(null);

  const requestBrief = useCallback(async (forceRefresh: boolean) => {
    setText('');
    setStatus('loading');
    setError('');
    setSources({});
    setActiveSource(null);

    const body = new URLSearchParams({ pid: String(pid), csrf_token_form: csrfToken });
    if (forceRefresh) body.append('refresh', '1');

    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let lineBuffer = '';
      let eventType = '';
      setStatus('streaming');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() ?? '';

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
              setText(prev => prev + ((data.text as string) ?? ''));
            } else if (eventType === 'cached') {
              setText((data.text as string) ?? '');
              setStatus('cached');
            } else if (eventType === 'done') {
              setStatus((data.cached as boolean) ? 'cached' : 'live');
            } else if (eventType === 'error') {
              setError((data.message as string) ?? 'Error generating brief.');
              setStatus('error');
            }
            eventType = '';
          }
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Request failed');
      setStatus('error');
    }
  }, [pid, apiUrl, csrfToken]);

  const html = useMemo(() => {
    if (!text) return '';
    // During streaming, strip markers so text reads cleanly; after done, wrap phrase as clickable
    const isStreaming = status === 'loading' || status === 'streaming';
    const processed = isStreaming
      ? text.replace(/\[\[(\d+)\]\]/g, '').replace(/\[\[\/\d+\]\]/g, '')
      : text.replace(/\[\[(\d+)\]\]([\s\S]*?)\[\[\/\1\]\]/g,
          '<button class="copilot-cite-text" data-src="$1">$2</button>');
    return marked.parse(processed) as string;
  }, [text, status]);

  return { html, status, error, sources, activeSource, setActiveSource, requestBrief };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CopilotPanel({ pid, apiUrl, csrfToken }: Props) {
  const { html, status, error, sources, activeSource, setActiveSource, requestBrief } =
    useBriefStream(pid, apiUrl, csrfToken);
  const [collapsed, setCollapsed] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const isBusy = status === 'loading' || status === 'streaming';

  useEffect(() => {
    requestBrief(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Event delegation: handle citation clicks inside dangerouslySetInnerHTML content
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const handleClick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-src]');
      if (!btn) return;
      const src = btn.getAttribute('data-src') ?? '';
      const source = sources[src];
      if (!source) return;
      // Toggle: clicking the same citation closes the drawer
      setActiveSource(prev => (prev === source ? null : source));
      e.stopPropagation();
    };
    el.addEventListener('click', handleClick);
    return () => el.removeEventListener('click', handleClick);
  }, [sources, html, setActiveSource]);

  return (
    <div className="copilot-header-wrap">
      <div className="copilot-header">
        <strong>🤖 Clinical Co-Pilot</strong>
        <div className="copilot-header-actions">
          <StatusBadge status={status} />
          <button
            className="copilot-btn-icon"
            onClick={() => requestBrief(true)}
            disabled={isBusy}
            title="Refresh brief"
          >↻</button>
          <button
            className="copilot-btn-icon"
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? 'Expand' : 'Collapse'}
          >{collapsed ? '▼' : '▲'}</button>
        </div>
      </div>

      <div className={`copilot-body${collapsed ? ' collapsed' : ''}${activeSource ? ' has-drawer' : ''}`}>
        <div className="copilot-brief">
          {status === 'error' ? (
            <p className="copilot-content copilot-error">⚠ {error}</p>
          ) : (
            <>
              <div
                ref={contentRef}
                className={`copilot-content${status === 'streaming' ? ' streaming' : ''}`}
                // html is LLM output from our own controlled prompt — not user input
                dangerouslySetInnerHTML={{ __html: html }}
              />
              {(status === 'live' || status === 'cached') && (
                <div className="copilot-footer">
                  <span className="copilot-disclaimer">
                    Brief reflects EHR data only. Undocumented conditions will not appear.
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {activeSource && (
          <SourceDrawer
            source={activeSource}
            onClose={() => setActiveSource(null)}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Source drawer — shows the raw EHR record fields for a cited data point
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
    // Expand the card if Bootstrap has it collapsed
    const jq = (window as Record<string, unknown>).$;
    if (typeof jq === 'function') {
      const $el = (jq as CallableFunction)(el);
      if ($el.hasClass('collapse') && !$el.hasClass('show')) {
        $el.collapse('show');
      }
    }
    // Close drawer then scroll so the card is fully visible
    onClose();
    setTimeout(() => {
      const card = el.closest('.card') ?? el;
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        {source.fields && source.fields.length > 0 ? (
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
          <button className="copilot-drawer-link" onClick={handleScrollTo}>
            View in chart ↓
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_VARIANTS: Record<Status, { cls: string; label: string }> = {
  idle:      { cls: 'copilot-badge-loading', label: '' },
  loading:   { cls: 'copilot-badge-loading', label: 'Loading…' },
  streaming: { cls: 'copilot-badge-loading', label: 'Generating…' },
  cached:    { cls: 'copilot-badge-cached',  label: 'Cached' },
  live:      { cls: 'copilot-badge-live',    label: 'Live' },
  error:     { cls: 'copilot-badge-error',   label: 'Error' },
};

function StatusBadge({ status }: { status: Status }) {
  const { cls, label } = STATUS_VARIANTS[status];
  if (!label) return null;
  return <span className={`copilot-badge ${cls}`}>{label}</span>;
}
