import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { marked } from 'marked';
import './styles.css';

type Status = 'idle' | 'loading' | 'streaming' | 'cached' | 'live' | 'error';

interface Props {
  pid: number;
  apiUrl: string;
  csrfToken: string;
}

marked.setOptions({ gfm: true, breaks: true });

// ---------------------------------------------------------------------------
// Streaming hook — owns all fetch/parse logic, exposes declarative state
// ---------------------------------------------------------------------------

function useBriefStream(pid: number, apiUrl: string, csrfToken: string) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');

  const requestBrief = useCallback(async (forceRefresh: boolean) => {
    setText('');
    setStatus('loading');
    setError('');

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

            if (eventType === 'delta') {
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

  const html = useMemo(
    () => (text ? (marked.parse(text) as string) : ''),
    [text]
  );

  return { html, status, error, requestBrief };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CopilotPanel({ pid, apiUrl, csrfToken }: Props) {
  const { html, status, error, requestBrief } = useBriefStream(pid, apiUrl, csrfToken);
  const [collapsed, setCollapsed] = useState(false);
  const isBusy = status === 'loading' || status === 'streaming';

  useEffect(() => {
    requestBrief(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
