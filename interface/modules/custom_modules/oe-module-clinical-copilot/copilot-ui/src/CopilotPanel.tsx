import React, { useState, useEffect, useRef, useCallback } from 'react';
import { marked } from 'marked';
import './styles.css';

// Cards to keep visible on the patient summary page — all others are hidden.
const VISIBLE_CARD_IDS = [
  'allergy_ps_expand',
  'medical_problem_ps_expand',
  'medication_ps_expand',
  'prescriptions_ps_expand',
  'labdata_ps_expand',
  'encounters_ps_expand',
  'vitals_ps_expand',
];

type Status = 'loading' | 'streaming' | 'cached' | 'live' | 'error';

interface Props {
  pid: number;
  apiUrl: string;
  csrfToken: string;
}

marked.setOptions({ gfm: true, breaks: true });

export function CopilotPanel({ pid, apiUrl, csrfToken }: Props) {
  const [html, setHtml] = useState('');
  const [status, setStatus] = useState<Status>('loading');
  const [collapsed, setCollapsed] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const streaming = useRef(false);

  const fetchBrief = useCallback(async (forceRefresh: boolean) => {
    if (streaming.current) return;
    streaming.current = true;
    setHtml('');
    setStatus('loading');
    setErrorMsg('');

    const body = new URLSearchParams({ pid: String(pid), csrf_token_form: csrfToken });
    if (forceRefresh) body.append('refresh', '1');

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let lineBuffer = '';
      let accumulated = '';
      let eventType = '';
      setStatus('streaming');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('event: ')) {
            eventType = trimmed.slice(7);
          } else if (trimmed.startsWith('data: ')) {
            let data: Record<string, unknown>;
            try { data = JSON.parse(trimmed.slice(6)); } catch { continue; }

            if (eventType === 'delta') {
              accumulated += (data.text as string) ?? '';
              setHtml(marked.parse(accumulated) as string);
            } else if (eventType === 'cached') {
              accumulated = (data.text as string) ?? '';
              setHtml(marked.parse(accumulated) as string);
              setStatus('cached');
            } else if (eventType === 'done') {
              setHtml(marked.parse(accumulated) as string);
              setStatus((data.cached as boolean) ? 'cached' : 'live');
            } else if (eventType === 'error') {
              setErrorMsg((data.message as string) ?? 'Error generating brief.');
              setStatus('error');
            }
            eventType = '';
          }
        }
      }
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Request failed');
      setStatus('error');
    } finally {
      streaming.current = false;
    }
  }, [pid, apiUrl, csrfToken]);

  useEffect(() => {
    fetchBrief(false);
    setTimeout(hideEmptyCards, 400);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="copilot-header-wrap">
      <div className="copilot-header">
        <span><strong>🤖 Clinical Co-Pilot</strong></span>
        <div className="copilot-header-actions">
          <StatusBadge status={status} />
          <button
            onClick={() => fetchBrief(true)}
            disabled={streaming.current}
            title="Refresh brief"
            className="copilot-btn-icon"
          >↻</button>
          <button
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? 'Expand' : 'Collapse'}
            className="copilot-btn-icon"
          >{collapsed ? '▼' : '▲'}</button>
        </div>
      </div>

      <div className={`copilot-body${collapsed ? ' collapsed' : ''}`}>
        {status === 'error' ? (
          <div className="copilot-content copilot-error">⚠ {errorMsg}</div>
        ) : (
          <>
            <div
              className={`copilot-content${status === 'streaming' ? ' streaming' : ''}`}
              // marked output is from our own controlled LLM prompt — not user input
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

function StatusBadge({ status }: { status: Status }) {
  const variants: Record<Status, [string, string]> = {
    loading:   ['copilot-badge-loading',   'Loading…'],
    streaming: ['copilot-badge-loading',   'Generating…'],
    cached:    ['copilot-badge-cached',    'Cached'],
    live:      ['copilot-badge-live',      'Live'],
    error:     ['copilot-badge-error',     'Error'],
  };
  const [cls, label] = variants[status];
  return <span className={`copilot-badge ${cls}`}>{label}</span>;
}

function hideEmptyCards() {
  document.querySelectorAll<HTMLElement>('.card').forEach(card => {
    if (!card.id || card.id === 'copilot-widget') return;

    if (!VISIBLE_CARD_IDS.includes(card.id)) {
      const wrapper = card.closest<HTMLElement>('[class*="col-"]') ?? card;
      wrapper.style.display = 'none';
      return;
    }

    const body = card.querySelector('.card-body, .card-text');
    if (!body) return;
    const hasData =
      body.querySelectorAll('ul > li, ol > li, tbody tr').length > 0 ||
      (body.textContent ?? '').trim().length > 60;
    if (!hasData) {
      const wrapper = card.closest<HTMLElement>('[class*="col-"]') ?? card;
      wrapper.style.display = 'none';
    }
  });
}
