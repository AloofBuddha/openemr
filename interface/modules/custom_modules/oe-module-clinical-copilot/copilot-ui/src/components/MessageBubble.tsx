import { useEffect, useMemo, useRef } from 'react';
import { AlertCircle, Sparkles } from 'lucide-react';

import { renderContent } from '../citations';
import type { CiteSource, Message } from '../types';

interface Props {
  msg: Message;
  sources: Record<string, CiteSource>;
  onCite: (src: CiteSource) => void;
  onChip: (text: string) => void;
  isBusy: boolean;
  showDisclaimer: boolean;
  statusMessage?: string;
}

// Routing trace is a developer-facing artifact — useful for graders / engineers,
// not for the physician. We only show it when the URL has `?debug=1`.
function useDebugMode(): boolean {
  return useMemo(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('debug') === '1';
  }, []);
}

export function MessageBubble({
  msg, sources, onCite, onChip, isBusy, showDisclaimer, statusMessage,
}: Props) {
  const contentRef = useRef<HTMLDivElement>(null);
  const debugMode = useDebugMode();

  // Wire citation-button clicks via event delegation since the HTML is
  // dangerouslySetInnerHTML — React handlers can't bind to those nodes.
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
        <>
          {!msg.isStreaming && msg.provenance && (
            <div className="copilot-provenance" title="What the agent looked at to answer this">
              <Sparkles size={11} className="copilot-provenance-icon" />
              <span>{msg.provenance}</span>
            </div>
          )}
          <div
            ref={contentRef}
            className={`copilot-content${msg.isStreaming ? ' streaming' : ''}`}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </>
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
      {!msg.isStreaming && debugMode && msg.routing && msg.routing.length > 0 && (() => {
        const totalMs = msg.routing.reduce((s, x) => s + (x.duration_ms ?? 0), 0);
        const totalTokIn = msg.routing.reduce((s, x) => s + (x.tokens?.input ?? 0), 0);
        const totalTokOut = msg.routing.reduce((s, x) => s + (x.tokens?.output ?? 0), 0);
        const totalCost = msg.routing.reduce((s, x) => s + (x.cost_usd ?? 0), 0);
        return (
          <details className="copilot-routing">
            <summary>
              Agent trace · {msg.routing.length} step{msg.routing.length === 1 ? '' : 's'} ·{' '}
              {totalMs}ms · {totalTokIn}→{totalTokOut} tok · ${totalCost.toFixed(4)}
            </summary>
            <ol className="copilot-routing-list">
              {msg.routing.map((step, i) => (
                <li key={i}>
                  <span className="copilot-routing-node">{step.node}</span>
                  <span className="copilot-routing-ms">{step.duration_ms}ms</span>
                  {(step.tokens || step.cost_usd != null) && (
                    <span className="copilot-routing-cost">
                      {step.tokens ? `${step.tokens.input}→${step.tokens.output} tok ` : ''}
                      {step.cost_usd != null ? `$${step.cost_usd.toFixed(5)}` : ''}
                    </span>
                  )}
                  <code className="copilot-routing-decision">
                    {JSON.stringify(step.decision)}
                  </code>
                </li>
              ))}
            </ol>
          </details>
        );
      })()}
    </div>
  );
}
