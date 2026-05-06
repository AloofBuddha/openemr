import { useEffect, useRef } from 'react';
import { AlertCircle } from 'lucide-react';

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

export function MessageBubble({
  msg, sources, onCite, onChip, isBusy, showDisclaimer, statusMessage,
}: Props) {
  const contentRef = useRef<HTMLDivElement>(null);

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
