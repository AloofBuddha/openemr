import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { marked } from 'marked';
import './styles.css';

type Status = 'idle' | 'loading' | 'streaming' | 'cached' | 'live' | 'error';

interface CiteSource {
  type: string;
  label: string;
  detail: string;
}

interface Tooltip {
  source: CiteSource;
  x: number;
  y: number;
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

  const requestBrief = useCallback(async (forceRefresh: boolean) => {
    setText('');
    setStatus('loading');
    setError('');
    setSources({});

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

  // Inject citation buttons into rendered HTML so [N] markers become clickable
  const html = useMemo(() => {
    if (!text) return '';
    const raw = marked.parse(text) as string;
    return raw.replace(/\[(\d+)\]/g, '<button class="copilot-cite" data-src="$1">$1</button>');
  }, [text]);

  return { html, status, error, sources, requestBrief };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CopilotPanel({ pid, apiUrl, csrfToken }: Props) {
  const { html, status, error, sources, requestBrief } = useBriefStream(pid, apiUrl, csrfToken);
  const [collapsed, setCollapsed] = useState(false);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const isBusy = status === 'loading' || status === 'streaming';

  useEffect(() => {
    requestBrief(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Event delegation: handle citation button clicks inside dangerouslySetInnerHTML content
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const handleClick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-src]');
      if (!btn) return;
      const src = btn.getAttribute('data-src') ?? '';
      const source = sources[src];
      if (!source) return;
      const rect = btn.getBoundingClientRect();
      setTooltip({ source, x: rect.left, y: rect.bottom + 6 });
      e.stopPropagation();
    };

    el.addEventListener('click', handleClick);
    return () => el.removeEventListener('click', handleClick);
  }, [sources, html]);

  // Dismiss tooltip on outside click
  useEffect(() => {
    if (!tooltip) return;
    const dismiss = () => setTooltip(null);
    document.addEventListener('click', dismiss);
    return () => document.removeEventListener('click', dismiss);
  }, [tooltip]);

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
          >
            ↻
          </button>
          <button
            className="copilot-btn-icon"
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? '▼' : '▲'}
          </button>
        </div>
      </div>

      <div className={`copilot-body${collapsed ? ' collapsed' : ''}`}>
        {status === 'error' ? (
          <p className="copilot-content copilot-error">⚠ {error}</p>
        ) : (
          <>
            <div
              ref={contentRef}
              className={`copilot-content${status === 'streaming' ? ' streaming' : ''}`}
              // html is LLM output rendered from our own controlled prompt — not user input
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

      {tooltip && (
        <div
          className="copilot-tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="copilot-tooltip-label">{tooltip.source.label}</div>
          <div className="copilot-tooltip-detail">{tooltip.source.detail}</div>
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
